import os
import logging
import asyncio
import threading
from pathlib import Path
from typing import Callable
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

# --- Environment variables configuration ---
ENDPOINT = os.getenv("CLOUDFLARE_R2_ENDPOINT")
ACCESS_KEY_ID = os.getenv("CLOUDFLARE_R2_ACCESS_KEY_ID")
SECRET_ACCESS_KEY = os.getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
BUCKET_NAME = os.getenv("CLOUDFLARE_R2_BUCKET_NAME")

# 15-minute expiry for presigned PUT URLs (matches the spec)
PRESIGNED_URL_EXPIRY_SECONDS = 900


def _get_s3_client():
    """Create and return a boto3 S3 client configured for Cloudflare R2."""
    if not all([ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY]):
        # Fallback for local development if R2 variables are not set yet
        logger.warning("Cloudflare R2 environment variables are incomplete. S3 client may fail to initialize.")
    
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )


def _upload_file_sync(local_path: str, r2_key: str, content_type: str) -> None:
    """Synchronous file upload to R2."""
    s3_client = _get_s3_client()
    try:
        s3_client.upload_file(
            local_path,
            BUCKET_NAME,
            r2_key,
            ExtraArgs={"ContentType": content_type}
        )
        logger.info(f"Successfully uploaded file to R2: {r2_key}")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"Failed to upload file {local_path} to R2 key {r2_key}: {e}")
        raise RuntimeError(f"Cloudflare R2 upload error: {e}") from e


def _upload_bytes_sync(data: bytes, r2_key: str, content_type: str) -> None:
    """Synchronous bytes data upload to R2."""
    s3_client = _get_s3_client()
    try:
        s3_client.put_object(
            Body=data,
            Bucket=BUCKET_NAME,
            Key=r2_key,
            ContentType=content_type
        )
        logger.info(f"Successfully uploaded bytes to R2: {r2_key}")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"Failed to upload bytes data to R2 key {r2_key}: {e}")
        raise RuntimeError(f"Cloudflare R2 put_object error: {e}") from e


def _delete_file_sync(r2_key: str) -> None:
    """Synchronous object deletion from R2."""
    s3_client = _get_s3_client()
    try:
        s3_client.delete_object(Bucket=BUCKET_NAME, Key=r2_key)
        logger.info(f"Successfully deleted object from R2: {r2_key}")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"Failed to delete R2 key {r2_key}: {e}")
        raise RuntimeError(f"Cloudflare R2 delete_object error: {e}") from e


def _download_file_sync(r2_key: str, local_path: str) -> None:
    """Synchronous file download from R2."""
    s3_client = _get_s3_client()
    try:
        # Ensure parent directories exist
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)
        s3_client.download_file(BUCKET_NAME, r2_key, local_path)
        logger.info(f"Successfully downloaded {r2_key} from R2 to {local_path}")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"Failed to download R2 key {r2_key} to {local_path}: {e}")
        raise RuntimeError(f"Cloudflare R2 download_file error: {e}") from e


def _delete_folder_sync(prefix: str) -> None:
    s3_client = _get_s3_client()
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=BUCKET_NAME, Prefix=prefix)
        delete_keys = []
        for page in pages:
            if "Contents" in page:
                for obj in page["Contents"]:
                    delete_keys.append({"Key": obj["Key"]})
        if delete_keys:
            # delete_objects takes a max of 1000 keys per request
            for i in range(0, len(delete_keys), 1000):
                chunk = delete_keys[i : i + 1000]
                s3_client.delete_objects(Bucket=BUCKET_NAME, Delete={"Objects": chunk})
            logger.info(f"Deleted R2 folder prefix: {prefix} ({len(delete_keys)} objects)")
    except (BotoCoreError, ClientError) as e:
        logger.error(f"Failed to delete folder prefix {prefix} from R2: {e}")
        raise RuntimeError(f"Cloudflare R2 delete_folder error: {e}") from e


# --- Public Asynchronous API ---

async def upload_file_to_r2(local_path: str, r2_key: str, content_type: str) -> None:
    """Upload a local file to R2 in a thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(_upload_file_sync, local_path, r2_key, content_type)


async def upload_bytes_to_r2(data: bytes, r2_key: str, content_type: str) -> None:
    """Upload bytes directly to R2 in a thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(_upload_bytes_sync, data, r2_key, content_type)


async def delete_file_from_r2(r2_key: str) -> None:
    """Delete an object from R2 in a thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(_delete_file_sync, r2_key)


async def download_file_from_r2(r2_key: str, local_path: str) -> None:
    """Download an object from R2 to a local file path in a thread pool to avoid blocking."""
    await asyncio.to_thread(_download_file_sync, r2_key, local_path)


async def delete_folder_from_r2(prefix: str) -> None:
    """Delete all objects under a folder prefix from R2 in a thread pool to avoid blocking."""
    await asyncio.to_thread(_delete_folder_sync, prefix)


# --- Presigned URL & Progress-Tracked Download (Phase 1 of upload-progress-improvement) ---


def _generate_presigned_url_sync(
    r2_key: str,
    content_type: str,
    content_length: int | None = None,
    expiry: int = PRESIGNED_URL_EXPIRY_SECONDS,
) -> str:
    """Generate a presigned PUT URL for direct R2 upload from a browser.

    The returned URL is signed for PUT, expires in `expiry` seconds (default 15
    minutes), and — when content_type / content_length are provided — restricts
    the upload to those values so the browser cannot bypass the limits we
    advertised.
    """
    s3_client = _get_s3_client()
    params: dict = {
        "Bucket": BUCKET_NAME,
        "Key": r2_key,
    }
    # Conditions enforce Content-Type / Content-Length at PUT time.
    # They MUST be a JSON-compatible list (per boto3 contract).
    conditions: list = []
    if content_type:
        conditions.append({"Content-Type": content_type})
    if content_length is not None:
        conditions.append(["content-length-range", content_length, content_length])
    if conditions:
        params["Conditions"] = conditions
        # Note: when Conditions are used, we also need to declare which fields
        # the presigner is allowed to embed in the policy. Otherwise boto3
        # refuses to sign.
        params["Fields"] = {
            "Content-Type": content_type,
        }

    try:
        url = s3_client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=expiry,
            HttpMethod="PUT",
        )
        logger.info(
            "Generated presigned PUT URL for key=%s, expires_in=%ss, "
            "content_type=%s, content_length=%s",
            r2_key, expiry, content_type, content_length,
        )
        return url
    except (BotoCoreError, ClientError) as e:
        logger.error("Failed to generate presigned URL for key %s: %s", r2_key, e)
        raise RuntimeError(f"Cloudflare R2 presigned URL error: {e}") from e


async def generate_presigned_url(
    r2_key: str,
    content_type: str,
    content_length: int | None = None,
    expiry: int = PRESIGNED_URL_EXPIRY_SECONDS,
) -> str:
    """Async wrapper around _generate_presigned_url_sync.

    Runs the boto3 call in a thread pool so the event loop is not blocked.
    """
    return await asyncio.to_thread(
        _generate_presigned_url_sync,
        r2_key,
        content_type,
        content_length,
        expiry,
    )


# Regex for FFmpeg-style progress lines is intentionally not here — this is the
# R2 layer. The download callback receives raw byte-count deltas from boto3.


def _download_file_with_progress_sync(
    r2_key: str,
    local_path: str,
    progress_callback: Callable[[int, int], None] | None = None,
) -> None:
    """Synchronous boto3 download with a progress callback (bytes transferred, total).

    Uses boto3's `Callback` parameter (S3Transfer) to receive byte-count
    updates. The callback is invoked from the boto3 worker thread, so it
    MUST be thread-safe. The async wrapper takes care of marshalling onto
    the event loop with `run_coroutine_threadsafe`.
    """
    s3_client = _get_s3_client()
    Path(local_path).parent.mkdir(parents=True, exist_ok=True)

    # First, get the total object size so we can compute percentages.
    try:
        head = s3_client.head_object(Bucket=BUCKET_NAME, Key=r2_key)
        total_bytes = int(head.get("ContentLength", 0))
    except (BotoCoreError, ClientError) as e:
        logger.error("Failed to head_object %s: %s", r2_key, e)
        raise RuntimeError(f"Cloudflare R2 head_object error: {e}") from e

    transferred = 0
    last_reported_pct = -1

    class _ProgressCallback:
        def __init__(self) -> None:
            self._lock = threading.Lock()

        def __call__(self, bytes_amount: int) -> None:
            nonlocal transferred, last_reported_pct
            with self._lock:
                transferred += bytes_amount
                if progress_callback is None or total_bytes == 0:
                    return
                pct = int((transferred / total_bytes) * 100)
                # Throttle: only report when percentage actually changes.
                if pct != last_reported_pct:
                    last_reported_pct = pct
                    try:
                        progress_callback(transferred, total_bytes)
                    except Exception as cb_err:  # noqa: BLE001
                        # Never let a buggy callback abort the upload.
                        logger.warning("Progress callback raised: %s", cb_err)

    try:
        s3_client.download_file(
            BUCKET_NAME,
            r2_key,
            local_path,
            Callback=_ProgressCallback(),
        )
        logger.info(
            "Downloaded %s -> %s (%d/%d bytes)", r2_key, local_path, transferred, total_bytes
        )
    except (BotoCoreError, ClientError) as e:
        logger.error("Failed to download %s: %s", r2_key, e)
        raise RuntimeError(f"Cloudflare R2 download_file error: {e}") from e


async def download_file_with_progress(
    r2_key: str,
    local_path: str,
    on_progress: Callable[[int, int], "asyncio.Future | None"] | None = None,
) -> None:
    """Async download with progress reporting that is safe to await from async code.

    `on_progress` is called with (bytes_transferred, total_bytes) from a
    boto3 worker thread. The typical use case is an SSE pipeline: pass a
    callback that schedules a coroutine onto the event loop (e.g. via
    `asyncio.run_coroutine_threadsafe`) or just updates a thread-safe queue.
    """
    def _bridge(transferred: int, total: int) -> None:
        if on_progress is None:
            return
        try:
            on_progress(transferred, total)
        except Exception as e:  # noqa: BLE001
            logger.warning("download progress bridge raised: %s", e)

    await asyncio.to_thread(
        _download_file_with_progress_sync,
        r2_key,
        local_path,
        _bridge,
    )

import os
import logging
import asyncio
from pathlib import Path
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

# --- Environment variables configuration ---
ENDPOINT = os.getenv("CLOUDFLARE_R2_ENDPOINT")
ACCESS_KEY_ID = os.getenv("CLOUDFLARE_R2_ACCESS_KEY_ID")
SECRET_ACCESS_KEY = os.getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
BUCKET_NAME = os.getenv("CLOUDFLARE_R2_BUCKET_NAME")


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

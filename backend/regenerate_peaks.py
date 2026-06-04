"""Regenerate waveform peaks for all existing submissions.

Run this on the VPS after deploying the new analyzer.py:
    python regenerate_peaks.py

It downloads each MP3 from R2, extracts new peaks with the updated algorithm,
and updates the database.
"""

import asyncio
import os
import sys
import tempfile
from sqlmodel import Session, select
from app.database import engine, get_session
from app.models import Submission
from app.audio.analyzer import _extract_waveform_peaks
from app.services.r2 import download_file_from_r2
import librosa


async def regenerate_peaks_for_submission(session: Session, submission: Submission) -> bool:
    """Regenerate peaks for a single submission. Returns True if successful."""
    if not submission.mp3_path:
        return False

    temp_mp3_path = os.path.join(tempfile.gettempdir(), f"{submission.id}_regen.mp3")

    try:
        # Download MP3 from R2
        r2_key = f"tracks/{submission.id}/preview.mp3"
        await download_file_from_r2(r2_key, temp_mp3_path)

        # Extract peaks with new algorithm
        def load_and_extract(path):
            y, sr = librosa.load(path, sr=None, mono=False)
            peaks = _extract_waveform_peaks(y)
            duration = float(len(librosa.to_mono(y)) / sr) if sr and len(y) > 0 else 0.0
            return peaks, duration

        peaks, duration = await asyncio.to_thread(load_and_extract, temp_mp3_path)

        # Update database
        submission.peaks = peaks
        if not submission.duration:
            submission.duration = duration
        session.add(submission)
        session.commit()

        return True

    except Exception as e:
        print(f"  ❌ Failed: {e}")
        return False

    finally:
        if os.path.exists(temp_mp3_path):
            try:
                os.remove(temp_mp3_path)
            except OSError:
                pass


async def main():
    print("🔄 Regenerating waveform peaks for all submissions...")
    print("=" * 60)

    with Session(engine) as session:
        # Get all submissions with mp3_path
        statement = select(Submission).where(Submission.mp3_path != None)
        submissions = session.exec(statement).all()

        total = len(submissions)
        success = 0
        failed = 0

        print(f"📊 Found {total} submissions with audio files")
        print()

        for i, sub in enumerate(submissions, 1):
            print(f"[{i}/{total}] {sub.track_name} by {sub.producer_name}...")

            result = await regenerate_peaks_for_submission(session, sub)

            if result:
                success += 1
                print(f"  ✅ Updated ({len(sub.peaks)} peaks)")
            else:
                failed += 1

        print()
        print("=" * 60)
        print(f"✅ Done! {success}/{total} updated, {failed} failed")


if __name__ == "__main__":
    asyncio.run(main())

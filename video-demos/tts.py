"""Speaks each caption with Kokoro (https://huggingface.co/hexgrad/Kokoro-82M).

voiceover.ts runs this inside video-demos/.venv with a JSON job file:
{"voice": "bf_emma", "speed": 1.0, "items": [{"text": "...", "out": "x.wav"}]}
Each item becomes a 24 kHz mono WAV file.
"""

import json
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24_000


def main() -> None:
    with open(sys.argv[1], encoding="utf-8") as job_file:
        job = json.load(job_file)
    voice = job["voice"]
    # The voice name's first letter is its language: a American, b British.
    pipeline = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
    for item in job["items"]:
        chunks = [
            audio.numpy() if hasattr(audio, "numpy") else audio
            for _, _, audio in pipeline(item["text"], voice=voice, speed=job["speed"])
            if audio is not None
        ]
        sf.write(item["out"], np.concatenate(chunks), SAMPLE_RATE)
        print(f"spoke {item['out']}", flush=True)


if __name__ == "__main__":
    main()

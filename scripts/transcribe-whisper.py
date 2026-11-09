"""Transcribe OpenCluely's 16 kHz mono PCM WAV directly, without FFmpeg."""
import argparse
from pathlib import Path
import wave

import numpy as np
import whisper


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="en")
    parser.add_argument("--task", default="transcribe")
    parser.add_argument("--output_format", default="txt")
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--model_dir")
    parser.add_argument("--verbose")
    parser.add_argument("--fp16")
    args = parser.parse_args()
    with wave.open(args.audio, "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError("Expected 16 kHz mono 16-bit PCM WAV for direct transcription")
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    model = whisper.load_model(args.model, download_root=args.model_dir)
    result = model.transcribe(samples, language=args.language, task=args.task, fp16=False, verbose=None)
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / (Path(args.audio).stem + ".txt")).write_text(result["text"].strip(), encoding="utf-8")


if __name__ == "__main__":
    main()

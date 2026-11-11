"""Local JSON-lines worker for SpeechBrain ECAPA speaker embeddings.

The worker never downloads a model. MODEL_DIR must point at a model installed
explicitly by scripts/setup-speaker-model.ps1.
"""
import base64
import json
import os
import sys
import time

MODEL_DIR = os.environ.get("SPEAKER_MODEL_DIR", "")
MODEL_REVISION = "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286"
model = None


def reply(request_id, **value):
    value["id"] = request_id
    print(json.dumps(value, separators=(",", ":")), flush=True)


def load_model():
    global model
    if model is not None:
        return model
    if not MODEL_DIR or not os.path.isfile(os.path.join(MODEL_DIR, "hyperparams.yaml")):
        raise RuntimeError("Speaker model is not installed. Run scripts/setup-speaker-model.ps1.")
    import torch
    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy
    runtime_dir = os.path.join(MODEL_DIR, "runtime")
    model = EncoderClassifier.from_hparams(
        source=MODEL_DIR,
        savedir=runtime_dir,
        run_opts={"device": "cpu"},
        local_strategy=LocalStrategy.COPY,
        overrides={"pretrained_path": MODEL_DIR},
    )
    model._torch = torch
    return model


def embed(pcm_b64):
    recognizer = load_model()
    import numpy as np
    samples = np.frombuffer(base64.b64decode(pcm_b64), dtype="<i2").astype("float32") / 32768.0
    if samples.size < 16000:
        raise ValueError("At least one second of 16 kHz mono PCM is required.")
    waveform = recognizer._torch.from_numpy(samples).unsqueeze(0)
    started = time.perf_counter()
    with recognizer._torch.inference_mode():
        vector = recognizer.encode_batch(waveform, normalize=True).squeeze().cpu().tolist()
    return vector, round((time.perf_counter() - started) * 1000, 2)


for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        request_id = request.get("id")
        if request.get("command") == "health":
            load_model()
            reply(request_id, ok=True, model="speechbrain/spkrec-ecapa-voxceleb", revision=MODEL_REVISION)
        elif request.get("command") == "embed":
            vector, inference_ms = embed(request.get("pcm", ""))
            reply(request_id, ok=True, embedding=vector, inferenceMs=inference_ms)
        else:
            raise ValueError("Unknown worker command.")
    except Exception as exc:
        reply(request.get("id"), ok=False, error=str(exc)[:300])

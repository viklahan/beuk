"""Speak a list of lines to WAV files: speak.py <in.json> <outdir>.

in.json: {"voice": "af_heart", "speed": 1.0, "lines": [{"id": "s1", "text": "..."}]}
Writes <outdir>/<id>.wav per line and <outdir>/durations.json (seconds per id),
so the recorder can hold each step on screen exactly as long as its narration.
"""
import json, sys, os
import soundfile as sf
from kokoro_onnx import Kokoro

src, out = sys.argv[1], sys.argv[2]
spec = json.load(open(src, encoding="utf-8"))
os.makedirs(out, exist_ok=True)
k = Kokoro("/models/kokoro-v1.0.onnx", "/models/voices-v1.0.bin")
durations = {}
for line in spec["lines"]:
    samples, rate = k.create(line["text"], voice=spec.get("voice", "af_heart"), speed=spec.get("speed", 1.0), lang="en-us")
    sf.write(os.path.join(out, line["id"] + ".wav"), samples, rate)
    durations[line["id"]] = round(len(samples) / rate, 3)
json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=1)
print(json.dumps(durations))

# Beuk School narration: Kokoro-82M (Apache-2.0 weights) through kokoro-onnx (MIT),
# CPU only. Pinned model files from the kokoro-onnx release "model-files-v1.0".
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir kokoro-onnx==0.5.0 soundfile==0.13.1
WORKDIR /models
RUN curl -fsSL -o kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
 && curl -fsSL -o voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
WORKDIR /work
COPY speak.py /usr/local/bin/speak.py
ENTRYPOINT ["python", "/usr/local/bin/speak.py"]

FROM python:3.11-slim-bookworm@sha256:94a8fee35252d06ab75856f15f12c7bae67b10e8a6da93c7fded82b2610926cd
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    STT_DATA_DIR=/data STT_MODEL_DIR=/data/stt-models STT_THREADS=4 STT_MODEL=whisper HF_HOME=/data/stt-models/.huggingface
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 1000 stt && useradd --uid 1000 --gid stt --create-home stt
COPY stt ./stt
USER stt
EXPOSE 4020
HEALTHCHECK --interval=15s --timeout=3s --start-period=300s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4020/health', timeout=2)"
CMD ["python", "-m", "uvicorn", "stt.app:app", "--host", "0.0.0.0", "--port", "4020", "--workers", "1", "--limit-concurrency", "32", "--ws-max-size", "64000", "--ws-max-queue", "8", "--ws-ping-interval", "20", "--ws-ping-timeout", "20"]

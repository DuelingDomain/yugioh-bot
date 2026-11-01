# Remote STT implementation plan

Goal: accuracy-first CPU transcription for Remote Duels, isolated on feat/remote-stt.
Architecture: Python FastAPI HTTP/WebSocket service, sherpa-onnx Parakeet TDT v3 int8,
Silero VAD, bounded audio and inference concurrency. Offline partials re-decode at
400 ms intervals with backpressure; PTT release finalizes immediately. A selectable
streaming Zipformer backend provides a low-latency fallback. No game actions execute here.

The owner's explicit build-and-push instruction authorizes implementation and delivery;
no additional design or integration approval is needed. Exactly one matcher unit test
file; real-model benchmark and API smoke checks cover the remaining behavior.

- [ ] Add pinned runtime / benchmark dependencies and selective, revision-pinned model downloads.
- [ ] Test matcher against card-name errors and false positives, then implement catalog loading,
  duel/staple/full-catalog priority, fuzzy + Double Metaphone scoring and original-text spans.
- [ ] Implement interchangeable model adapters, Silero endpointing, HTTP PCM and WS PTT,
  optional partials, bounded buffers / requests and connection cleanup.
- [ ] Generate 40 local Piper clips from fixed phrases, multiple English voices, command/card/
  player-name negatives. Compare all three models on identical audio, raw and normalized WER,
  model load, RSS, RTF, 1s/3s release latency and streaming finalization. Preserve raw results.
- [ ] Choose default by measured accuracy then latency; keep only winner + one fallback.
- [ ] Add standalone Docker image / compose on 127.0.0.1:4020, ignored data/stt-models volume,
  docs with API/run steps, limitations, benchmark table and model license/source links.
- [ ] Run matcher test, real HTTP/WS smoke checks including silence/invalid frames, Docker
  build/start/health/transcription. Review changes, commit in small chunks and push branch only.

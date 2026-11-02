# Embedder bake-off implementation plan — 2026-11-01

Approved scope: six candidates, local RX 7900 XTX, retained `train.py`
InfoNCE/memory bank, synthetic plus reviewed real crops, browser evaluation.
All additions are new files, including the report addendum. No deployment/PR.

1. Add a dependency-free real-data/split validator and one-command orchestrator.
   Reject synthetic/unreviewed sessions, split leakage and missing crop geometry
   before importing torch or downloading weights. Freeze input hashes.
2. Adapt DINOv3/MobileCLIP to the retained trainer without editing its objective.
   Use equal steps, seed, batch composition and full-backbone fine-tuning; retain
   only last/best checkpoints. Export FP32, q8 WASM and FP16 WebGPU models.
3. Rebuild each gallery in the browser using that precise exported model.
   Calibrate sure thresholds only on calibration sessions; report frozen-test
   top-1/top-5, sure coverage/wrong accepts, paired deck modes and warm latency.
   Missing hardware/unsupported operators become explicit skips/errors.
4. Add a loopback browser harness, results template, owner commands, HF env-file
   instructions, licence notes, ROCm estimates and updated recommendation.
5. Run lean guard/scoring tests, syntax/type checks and a tiny browser plumbing
   check. Do not run training or the bake-off without real recordings. Commit in
   small pieces, review the new files, push the existing branch; no attribution.

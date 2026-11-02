# Owner RX 7900 XTX embedder bake-off — results template

Status: **NOT RUN — no real owner recordings/crops yet**. Dashes are unmeasured.
Fill from `browser-results.json` / generated `browser-summary.md`, never estimates.
Each candidate has separate q8/WASM and fp16/WebGPU accuracy/threshold results.

| Candidate | Params (nominal) | Export / backend | Top-1 / top-5 with deck | Top-1 / top-5 without deck | Sure at 0 wrong with / without | Wrong sure with / without | Crop p50 / p95 ms | Model MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DINOv2-S/14 (duel family) | 21M | q8 / WASM | — | — | — | — | — | — |
| DINOv2-S/14 (duel family) | 21M | fp16 / WebGPU | — | — | — | — | — | — |
| DINOv3 ViT-S/16 distilled | 21M | q8 / WASM | — | — | — | — | — | — |
| DINOv3 ViT-S/16 distilled | 21M | fp16 / WebGPU | — | — | — | — | — | — |
| DINOv3 ViT-S+/16 | 29M | q8 / WASM | — | — | — | — | — | — |
| DINOv3 ViT-S+/16 | 29M | fp16 / WebGPU | — | — | — | — | — | — |
| DINOv2-B/14 | 86M | q8 / WASM | — | — | — | — | — | — |
| DINOv2-B/14 | 86M | fp16 / WebGPU | — | — | — | — | — | — |
| MobileCLIP2-S0, vision only | measured at export | q8 / WASM | — | — | — | — | — | — |
| MobileCLIP2-S0, vision only | measured at export | fp16 / WebGPU | — | — | — | — | — | — |
| MobileCLIP2-S2, vision only | measured at export | q8 / WASM | — | — | — | — | — | — |
| MobileCLIP2-S2, vision only | measured at export | fp16 / WebGPU | — | — | — | — | — | — |

Record alongside the table:

- Frozen input SHA256, git commit, candidate source/revision, checkpoint and
  ONNX hashes, package versions, initial checkpoint provenance, shared recipe.
- Train/calibration/test session IDs and camera/mat/light conditions; positive
  crop, negative crop and physical-track counts; out-of-deck positives included.
- Owner CPU model, OS/browser, logical cores, WASM threads/isolation, GPU adapter
  and shader-f16, graph capture, native/browser parity, export sizes in bytes.
- Native `--bench` seconds/step for each model and actual training/evaluation
  time. No per-candidate batch/step adjustments without a separately named run.
- Top-k denominator: positive crops. Sure denominator: all test crops, including
  negative hands/mats/backs. Also report positive sure coverage and raw counts.
  Thresholds are frozen on calibration. Any test wrong sure fails; do not tune
  on test to manufacture 0 wrong. Zero observed errors is a finite-sample result.
- Crop latency: batch 1, both 0/180 orientations, preprocessing, normalization
  and readback; excludes load/gallery/search/detector. Search p50/p95 is separate.
- For adoption, replay frozen whole sessions in the actual app worker with its
  model/index spec updated; record lifecycle/zone/detector/prompt/latency gates.
  This crop bake-off alone cannot establish the >90% end-to-end event claim.

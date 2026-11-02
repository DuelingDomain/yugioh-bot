# Quick pretrained DINOv3 live comparison

Goal: compare frozen DINOv3 ViT-S/16 with the current DINOv2-small-duel in the existing lab; no training, long benchmark, or new unit tests.

- Keep DINOv2 the default. Add a recognizer embedder option and a server `VISION_EMBEDDER` default for the lab. Resolve DINOv3's generated manifest before initializing its worker; use the matching SHA and `yugioh-index-v3` files. Retain the source image/frozen frame when switching.
- Acquisition: require the owner's private HF_TOKEN file, try the HF ONNX q8 export first, otherwise export the pretrained Meta model on CPU and quantize weight-only q8. Ship the upstream DINOv3 licence beside the weights. Delete temporary exports/download caches.
- Rebuild all 14,816 artwork vectors plus the back from the existing thumbnails using the shared pixel/embed/index code, all available CPU threads, no image downloads or per-vector cache. Require exact source coverage before publishing v3 metadata.
- Run a short browser WASM comparison on existing synthetic scenes (detect/straighten once), fixture crops and labelled feedback crops. Record top-1/top-5 for catalog and a fixed 40-card deck, embedding/preprocessing ms per crop; distinguish synthetic feedback from physical captures.
- Verify existing focused tests, typecheck, bundle and browser smoke. Commit small, push `feat/remote-dinov3`, no PR or attribution lines.

Current acquisition blocker: `~/.config/yugioh-vision/bakeoff.env` is absent. Do not acquire weights until the owner accepts the model licence and installs the token. Prepare and verify the code and DINOv2 baseline meanwhile; never invent DINOv3 measurements.

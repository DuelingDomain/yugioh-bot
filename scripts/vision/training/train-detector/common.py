# Ported from mathulbrich/duel-lens f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
# Modified: local data/profile paths and CPU/CUDA/MPS selection.
# Licence: ../../../../packages/vision/src/licenses/duel-lens.LICENSE.
"""Shared paths and constants for the card detector (tools/train-detector/)."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ASSETS = Path(os.environ.get("VISION_TRAINING_DIR", ROOT / "data/vision/training"))
PROFILE = json.load(open(ASSETS / "profile.json"))
DATA = ASSETS / "train-detector"
HF_DIR = DATA / "hf"
CKPT_DIR = DATA / "ckpt"
LOGS = DATA / "logs"
SHEETS = DATA / "sheets"
ONNX_DIR = DATA / "onnx"
EVAL_DIR = DATA / "eval"
BENCH_DIR = DATA / "bench"
os.environ.setdefault("HF_HOME", str(HF_DIR))

# card sources
CARDS_SMALL = ASSETS / "cards-small"  # 1,905 full-card images (YGOPRODeck cards_small, 268x391)
ARTWORKS = ASSETS / "artworks"  # 14,643 artworks (624x624)
TEMPLATES = ASSETS / "train/templates"  # Phase 2's frame templates (+ manifest.json)
CARD_BACK_FULL = ASSETS / "card-back.jpg"  # the official card back, 927x1353
CARDS_JSON = ASSETS / "cards.json"

# real evaluation data (never trained on)
FULLVIEW = ASSETS / "eval/fullview"
FRAMES = ASSETS / "eval/frames"
REALSET = ASSETS / "eval/realset"

CARD_ASPECT = PROFILE["card"]["width"] / PROFILE["card"]["height"]  # width / height
# The extension's working size: a screenshot is resized so its long side is at most this (then padded to /32).
WORK_LONG = 1280

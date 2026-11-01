# Ported from mathulbrich/duel-lens f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
# Modified: local data/profile paths and CPU/CUDA/MPS selection.
# Licence: ../../../../packages/vision/src/licenses/duel-lens.LICENSE.
"""Data preparation for the embedder fine-tuning. Run each step once (they are idempotent).

  python tools/train/prepare.py cache       224x224 uint8 cache of every index artwork (data/train/cache)
  python tools/train/prepare.py split       unseen cards (released >= 2026 + a random 5% of older cards)
  python tools/train/prepare.py templates   full-card frame templates from YGOPRODeck (cards_small)
  python tools/train/prepare.py real        real ground-truth art crops from the real set's labelled quads (data/train/real)
  python tools/train/prepare.py all
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from multiprocessing import Pool

import cv2
import numpy as np
from PIL import Image

from common import (ART_BOX, ART_CACHE, ARTWORKS, BENCH_REPORT, CARD_BACK, CARD_BACK_ID, CARD_H, CARD_W,
                    CACHE_DIR, ENTRIES, FRAMES_DIR, GT_CARDS, REAL_DIR, ROOT, ASSETS, PROFILE, S, SPLIT, TEACHER_OUT, TEMPLATES,
                    art_box_px, load_cards)


# ---------------------------------------------------------------- cache

def _load_one(image_id: int) -> np.ndarray:
    p = CARD_BACK if image_id == CARD_BACK_ID else ARTWORKS / f"{image_id}.jpg"
    # Pillow BILINEAR is the antialiased triangle filter of src/shared/preprocess.ts.
    return np.asarray(Image.open(p).convert("RGB").resize((S, S), Image.BILINEAR), dtype=np.uint8)


def build_cache():
    if ART_CACHE.exists() and ENTRIES.exists():
        print("cache exists:", ART_CACHE)
        return
    meta = json.load(open(ASSETS / "index.meta.json"))
    entries = meta["entries"]
    ids = [e["imageId"] for e in entries]
    tmp = CACHE_DIR / "art224.tmp.npy"
    out = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.uint8, shape=(len(ids), S, S, 3))
    t0 = time.time()
    with Pool(6) as pool:
        for i, a in enumerate(pool.imap(_load_one, ids, chunksize=64)):
            out[i] = a
            if (i + 1) % 2000 == 0:
                print(f"  {i + 1}/{len(ids)} {time.time() - t0:.0f}s", flush=True)
    out.flush()
    del out
    tmp.rename(ART_CACHE)
    # Original sizes tell pendulum illustrations (712x908) apart from square artworks.
    for e in entries:
        p = CARD_BACK if e["imageId"] == CARD_BACK_ID else ARTWORKS / f"{e['imageId']}.jpg"
        e["size"] = list(Image.open(p).size)
    json.dump(entries, open(ENTRIES, "w"))
    print(f"cache {len(ids)} x {S}x{S}x3 in {time.time() - t0:.0f}s")


# ---------------------------------------------------------------- split

def first_release() -> dict[int, str]:
    """Earliest TCG/OCG release date per card id (YGOPRODeck misc_info), '' when unknown."""
    raw = json.load(open(ASSETS / "cardinfo.json"))["data"]
    out = {}
    for c in raw:
        ds = [m.get(k) for m in c.get("misc_info") or [] for k in ("tcg_date", "ocg_date") if m.get(k)]
        out[c["id"]] = min(ds) if ds else ""
    return out


def build_split():
    """Unseen cards (never trained on, not even as negatives; still in the index):
      - new: every card first released on or after 2026-01-01 (tcg_date/ocg_date), which covers the
        2026 cards of the real set (the Sacred Beasts, Hyperinvoked Aeon, Aiwass, ...);
      - random: a seeded random 5% of the older cards, a clean unseen split beyond 2026.
    Everything else (and the card back) is seen."""
    entries = json.load(open(ENTRIES))
    dates = first_release()
    cards = sorted({e["cardId"] for e in entries if e["cardId"] != CARD_BACK_ID})
    new = {c for c in cards if dates.get(c, "") >= "2026-01-01"}
    older = [c for c in cards if c not in new]
    rng = np.random.default_rng(2026)
    rand = set(rng.choice(older, int(round(0.05 * len(older))), replace=False).tolist())
    held = new | rand
    realset = ROOT / "data" / "realset" / "set.json"
    rs = json.load(open(realset)) if realset.exists() else []
    train = [i for i, e in enumerate(entries) if e["cardId"] not in held]
    val = [i for i, e in enumerate(entries) if e["cardId"] in held]
    group = {c: ("unseen-new" if c in new else "unseen-random" if c in rand else "seen") for c in cards}
    json.dump({"heldOutCards": sorted(held), "newCards": sorted(new), "randomCards": sorted(rand), "group": group,
               "trainIdx": train, "valIdx": val}, open(SPLIT, "w"))
    rs_groups = {}
    for e in rs:
        rs_groups.setdefault(group.get(int(e["cardId"]), "seen"), set()).add(e["name"])
    print(f"unseen cards {len(held)}: {len(new)} released >= 2026, {len(rand)} random older (5%); "
          f"train artworks {len(train)}, unseen artworks {len(val)}")
    for g, names in sorted(rs_groups.items()):
        print(f"  real set, {g}: {sorted(names)}")


# ---------------------------------------------------------------- templates

TEMPLATE_QUOTA = {name: 20 for name in PROFILE["frameTypes"]}


def build_templates():
    """Full-card images (YGOPRODeck cards_small, 168x246) of training cards: their frame, name bar,
    stars and text box surround the pasted artwork, so misframed crops bleed in real frame detail."""
    cards = load_cards()
    held = set(json.load(open(SPLIT))["heldOutCards"])
    rng = np.random.default_rng(7)
    ids = list(cards)
    rng.shuffle(ids)
    got = {k: 0 for k in TEMPLATE_QUOTA}
    manifest = []
    have = {p.stem for p in TEMPLATES.glob("*.jpg")}
    for cid in ids:
        c = cards[cid]
        ft = c.get("frameType")
        if ft not in TEMPLATE_QUOTA or got[ft] >= TEMPLATE_QUOTA[ft] or cid in held:
            continue
        img_id = c["imageIds"][0]
        out = TEMPLATES / f"{img_id}.jpg"
        if str(img_id) not in have:
            try:
                req = urllib.request.Request(f"https://images.ygoprodeck.com/images/cards_small/{img_id}.jpg",
                                             headers={"User-Agent": "duel-lens-train/1.0"})
                out.write_bytes(urllib.request.urlopen(req, timeout=20).read())
                time.sleep(0.255)
            except Exception as err:
                print("skip", img_id, err)
                continue
        got[ft] += 1
        manifest.append({"imageId": img_id, "cardId": cid, "frameType": ft})
        if all(got[k] >= v for k, v in TEMPLATE_QUOTA.items()):
            break
    json.dump(manifest, open(TEMPLATES / "manifest.json", "w"), indent=1)
    print("templates", got)



if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    TEMPLATES.mkdir(parents=True, exist_ok=True)
    if step in ("cache", "all"): build_cache()
    if step in ("split", "all"): build_split()
    if step in ("templates", "all"): build_templates()

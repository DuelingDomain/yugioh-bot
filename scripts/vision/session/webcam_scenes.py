"""Webcam scenes using the existing Duel Lens compositor, corners and damage.

No downloads. Source images and generated scenes stay local. This extends scene.py
without changing it; both the preview exporter and GPU trainer use render_frame.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
DETECTOR = ROOT / 'scripts/vision/training/train-detector'


def load_scene():
    sys.path.insert(0, str(DETECTOR))
    import scene
    if not hasattr(scene, "_webcam_original_assets"):
        scene._webcam_original_assets = scene.Assets
    return scene


def card_split(path, identities):
    # All alternate artworks of a card stay together, independently of file order.
    key = str(identities.get(path.stem.removesuffix('-small'), path.stem.removesuffix('-small')))
    return 'val' if int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) % 10 == 0 else 'train'


def assets(split='train'):
    import cv2
    import types
    scene = load_scene()
    data = Path(os.environ.get('VISION_DATA_DIR', ROOT / 'data/vision'))
    cards = Path(os.environ.get('VISION_WEBCAM_CARDS', ROOT / 'data/card-images'))
    meta = json.loads((data / 'yugioh-index.meta.json').read_text())
    identities = {str(e['imageId']): e['cardId'] for e in meta['entries']}
    pool = [p for p in sorted(cards.glob('*.jpg')) if p.stem.removesuffix('-small') in identities and card_split(p, identities) == split]
    if not pool:
        raise ValueError(f'No {split} full-card JPEGs in {cards}; set VISION_WEBCAM_CARDS to the full-card JPEG cache, not artwork thumbnails')
    a = object.__new__(scene._webcam_original_assets)
    a.small = a.arts = a.templates = pool
    sample = cv2.imread(str(pool[0]))
    if sample is None or not .58 < sample.shape[1] / sample.shape[0] < .80:
        raise ValueError('Full-card portrait JPEGs required; square artwork thumbnails are not detector training cards')
    a._tpl_cache = {}
    def checked_read(path, flags=cv2.IMREAD_COLOR):
        image = scene._webcam_original_assets._read(path, flags)
        if image is None or not .58 < image.shape[1] / image.shape[0] < .80:
            raise ValueError(f'Expected full-card portrait image, not square artwork: {path}')
        return image
    a._read = checked_read  # Applies to every card/template consumed, including mixed caches.
    back = Path(os.environ.get('VISION_WEBCAM_BACK', ROOT / 'packages/web/public/duel/card-back-main-hd.webp'))
    if not back.exists():
        # Prepared training root contains the game's own official back.
        back = scene.CARD_BACK_FULL
    image = cv2.imread(str(back))
    if image is None:
        raise ValueError(f'Missing card back {back}; run prepare-training.ts or set VISION_WEBCAM_BACK')
    a.back = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), (scene.TW, scene.TH))
    def artwork(self, rng, reduced=True):
        im = self.card_image(rng)
        b = scene.ART_BOX
        return im[int(b['y']*im.shape[0]):int((b['y']+b['h'])*im.shape[0]),
                  int(b['x']*im.shape[1]):int((b['x']+b['w'])*im.shape[1])].copy()
    a.artwork = types.MethodType(artwork, a)
    return a


def render_frame(a, rng, W=1280, H=720, kind=None, spreads=True):
    import cv2
    import numpy as np
    s = load_scene()
    kind = kind if kind in ('black', 'felt', 'wood', 'playmat') else str(rng.choice(['black', 'felt', 'wood', 'playmat']))
    cv = s.Canvas(H, W)
    base = {'black': (13, 14, 17), 'felt': (25, 65, 42), 'wood': (108, 78, 52), 'playmat': (38, 34, 62)}[kind]
    cv.img[:] = base
    cv.img += s.texture_noise(H, W, rng, amp=8)
    if kind == 'wood':
        yy = np.arange(H)[:, None, None]
        cv.img += 9*np.sin(yy*.18 + np.sin(yy*.009))
    elif kind == 'playmat':
        s.pattern_mat(cv.img, rng)
        art = cv2.resize(a.artwork(rng), (W, H)).astype(np.float32)
        cv.img = cv.img*.6 + art*.4  # Printed art is a negative, never a card.
    cw = W * s.U(rng, .055, .10)
    if rng.random() > .15:  # Empty mat / hands are explicit negative scenes.
        for i in rng.choice(10, size=int(rng.integers(1, 9)), replace=False):
            x = W*(.20 + (i % 5)*.145) + s.U(rng, -.02, .02)*W
            y = H*(.32 + (i // 5)*.38)
            s.place_card(cv, a, rng, x, y, cw, s.rotation(rng), face_up=rng.random()>.18, persp=.10)
        if rng.random() < .6:
            s.place_pile(cv, a, rng, W*.91, H*.73, cw, 0, top_face_up=rng.random()<.4)
        if rng.random() < .25:
            s.place_xyz(cv, a, rng, W*.11, H*.35, cw, math.pi/2)
    for _ in range(int(rng.choice([0, 1, 2], p=[.45, .40, .15]))):
        s.arm(cv, rng, (W*s.U(rng, 0, 1), H*1.1), (W*s.U(rng, .15, .85), H*s.U(rng, .2, .8)), cw*s.U(rng, .6, 1.2))
    counts = np.bincount(cv.owner[cv.owner >= 0].ravel(), minlength=len(cv.objs))
    for i, obj in enumerate(cv.objs):
        obj.area = abs(float(cv2.contourArea(obj.quad.astype(np.float32))))
        obj.visible = float(counts[i])/max(1, obj.area)
    frame = s.camera_tilt(cv, rng, s.U(rng, .1, .65)) if rng.random() < .8 else cv.img
    return s.degrade(frame, rng, s.U(rng, .4, 1.2)), cv.objs, kind


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT/'data/vision-webcam-scenes')
    parser.add_argument('--count', type=int, default=32, help='Preview default; use 20000-50000 only on training host')
    parser.add_argument('--seed', type=int, default=633)
    parser.add_argument('--size', type=int, default=640, choices=[320, 640, 1280])
    args = parser.parse_args()
    if not 1 <= args.count <= 50000:
        parser.error('count must be between 1 and 50000')
    import cv2
    import numpy as np
    s = load_scene()
    args.out.mkdir(parents=True, exist_ok=True)
    if any(args.out.iterdir()):
        raise ValueError('Output must be empty; preserve existing generated datasets')
    pools = {split: assets(split) for split in ('train', 'val')}
    records = []
    for i in range(args.count):
        split = 'val' if i % 10 == 0 else 'train'
        rng = np.random.default_rng([args.seed, i])
        image, objects, kind = render_frame(pools[split], rng, W=args.size, H=args.size*9//16)
        h, w = image.shape[:2]
        name = f'{split}-{i:06d}'
        cv2.imwrite(str(args.out/f'{name}.jpg'), cv2.cvtColor(image, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 86])
        # Native CenterNet labels, including -1 ignores, plus ordered true corners.
        rows = [s.row_of(s.label_of(o, o.visible), o, 0, 0) for o in objects if s.label_of(o, o.visible) != -2]
        np.savez_compressed(args.out/f'{name}.npz', rows=np.asarray(rows, dtype=np.float32).reshape(-1, s.ROW))
        records.append({'image': f'{name}.jpg', 'labels': f'{name}.npz', 'split': split, 'mat': kind, 'objects': len(rows), 'seed': [args.seed, i], 'width': w, 'height': h})
    manifest = {'version': 1, 'generator': 'webcam_scenes+duel-lens/scene.py', 'split': 'card identity SHA256 modulo 10; alternate artworks grouped', 'frames': records}
    (args.out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'frames': len(records), 'out': str(args.out), 'bytes': sum(p.stat().st_size for p in args.out.iterdir())}))


if __name__ == '__main__':
    main()

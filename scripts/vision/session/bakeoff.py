"""Local embedder bake-off. Validation/--help use stdlib only; run needs ROCm.

python scripts/vision/session/bakeoff.py run --manifest /mnt/d/VisionData/bakeoff.json
The browser phase runs separately on the owner's Windows Chrome; see BAKEOFF-REPORT.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CANDIDATES = {
    'dinov2-small': 'facebook/dinov2-small',
    'dinov3-small': 'facebook/dinov3-vits16-pretrain-lvd1689m',
    'dinov3-small-plus': 'facebook/dinov3-vits16plus-pretrain-lvd1689m',
    'dinov2-base': 'facebook/dinov2-base',
    'mobileclip2-s0': 'timm/MobileCLIP2-S0-OpenCLIP',
    'mobileclip2-s2': 'timm/MobileCLIP2-S2-OpenCLIP',
}


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def validate_manifest(path):
    """Require reviewed physical recordings, disjoint sessions/videos/conditions.

    Manual quads are normalized portrait-card TL,TR,BR,BL (first edge short);
    landscape DEF cards use cyclically reordered screen corners. Labeler boxes are
    deliberately insufficient for perspective-correct training. No ML imports.
    """
    path = Path(path).resolve()
    manifest = read_json(path)
    if not manifest.get('sessions') or not manifest.get('crops'):
        raise ValueError('No real reviewed sessions/crops: record and label first; no downloads or training started')
    sessions, video_splits = {}, {}
    for record in manifest['sessions']:
        labels_path = (path.parent / record['labels']).resolve()
        labels = read_json(labels_path)
        split = record['split']
        if split not in ('train', 'calibration', 'test') or not record.get('condition'):
            raise ValueError('Every session needs train/calibration/test and a camera/mat/light condition')
        if labels.get('source') != 'real' or labels.get('reviewed') is not True:
            raise ValueError('Only real, exhaustively reviewed sessions may enter the bake-off')
        if not labels.get('events') or any(e.get('reviewed') is not True for e in labels['events']):
            raise ValueError('Review every session event first')
        sid = labels['id']
        if sid in sessions:
            raise ValueError('Duplicate session or session split leakage')
        video = labels_path.parent / labels['video']
        if not video.is_file():
            raise ValueError(f'Missing real session video for {sid}')
        video_hash = sha(video)
        if video_hash in video_splits and video_splits[video_hash] != split:
            raise ValueError('Same video content occurs across session splits')
        video_splits[video_hash] = split
        sessions[sid] = {**record, 'labelsPath': str(labels_path), 'labels': labels,
                         'videoPath': str(video), 'videoSha256': video_hash}
    conditions = {s: {r['condition'] for r in sessions.values() if r['split'] == s}
                  for s in ('train', 'calibration', 'test')}
    if any(not c for c in conditions.values()):
        raise ValueError('Need real train, calibration and frozen test sessions')
    if not conditions['test'] - (conditions['train'] | conditions['calibration']):
        raise ValueError('Hold out at least one test camera/mat/light condition')
    counts = {(s, positive): 0 for s in conditions for positive in (True, False)}
    seen = set()
    for crop in manifest['crops']:
        sid = crop['sessionId']
        if not crop.get('instanceId'):
            raise ValueError('Every positive/negative crop needs an instanceId')
        if sid not in sessions:
            raise ValueError('Crop refers to unknown session')
        s = sessions[sid]
        at = crop['atMs']
        if not isinstance(at, (int, float)) or not math.isfinite(at) or not 0 <= at < s['labels']['durationMs']:
            raise ValueError('Crop timestamp outside recording')
        quad = crop.get('quad', [])
        if len(quad) != 4 or any(len(p) != 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in quad):
            raise ValueError('Every crop requires four reviewed normalized card corners')
        cross = []
        for i in range(4):
            a, b, c = quad[i], quad[(i+1)%4], quad[(i+2)%4]
            cross.append((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))
        if min(cross) <= 1e-6:
            raise ValueError('Quad must be convex clockwise portrait-card order with nonzero area')
        positive = crop.get('cardId') is not None
        if crop.get('rotation', 0) not in (0, 180):
            raise ValueError('Reviewed crop rotation must be 0 or 180 degrees')
        if positive:
            if not crop.get('instanceId') or crop.get('imageId') is None:
                raise ValueError('Positive crop needs physical instanceId and exact artwork imageId')
            if not any(str(e.get('cardId')) == str(crop['cardId']) and e.get('instanceId') == crop['instanceId'] for e in s['labels']['events']):
                raise ValueError('Crop identity must agree with reviewed physical session labels')
        key = (sid, at, json.dumps(quad))
        if key in seen:
            raise ValueError('Duplicate crop')
        seen.add(key)
        counts[s['split'], positive] += 1
    if any(n == 0 for n in counts.values()):
        raise ValueError('Each split needs positive cards and negative hand/mat/back crops')
    return {**manifest, 'sessions': sessions, 'manifestPath': str(path)}


def load_env(path):
    """Read KEY=value secrets without executing shell code or printing values."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        key, value = line.removeprefix('export ').split('=', 1)
        if key not in ('HF_TOKEN', 'HF_HOME', 'TORCH_HOME', 'TMPDIR', 'HSA_ENABLE_DXG_DETECTION'):
            raise ValueError('Unsupported key in bakeoff env file')
        os.environ.setdefault(key, value.strip().strip('\"\''))


def prepare_data(manifest, training, out):
    """Seek only selected real frames; keep art mmap shared and stream the gallery."""
    import cv2
    import numpy as np
    from PIL import Image

    sys.path.insert(0, str(HERE.parent / 'training/train'))
    from common import ART_BOX, CARD_H, CARD_W, art_box_px, index_entries, load_art_cache, load_split, pil_resize_224
    entries = index_entries()
    by_image = {str(e['imageId']): (i, str(e['cardId'])) for i, e in enumerate(entries)}
    train_idx = set(load_split()['trainIdx'])
    real = {'built': sha(manifest['manifestPath']), 'mCrop': 0, 'pos': [], 'neg': []}
    tracks, queries = {}, []
    crop_dir = out / 'crops'
    crop_dir.mkdir()
    query_file = out / 'queries.u8'
    with query_file.open('wb') as qout:
        for n, crop in enumerate(manifest['crops']):
            record = manifest['sessions'][crop['sessionId']]
            cap = cv2.VideoCapture(record['videoPath'])
            try:
                cap.set(cv2.CAP_PROP_POS_MSEC, crop['atMs'])
                ok, frame = cap.read()
            finally:
                cap.release()
            if not ok:
                raise ValueError(f'Cannot decode real crop {n}; inspect timestamp/codec')
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            h, w = frame.shape[:2]
            quad = np.float32(crop['quad']) * np.float32([w-1, h-1])
            target = np.float32([[0,0],[CARD_W-1,0],[CARD_W-1,CARD_H-1],[0,CARD_H-1]])
            warp = cv2.warpPerspective(frame, cv2.getPerspectiveTransform(quad, target), (CARD_W, CARD_H))
            card = str(crop['cardId']) if crop.get('cardId') is not None else None
            anchor = None
            if card is not None:
                anchor, gallery_card = by_image.get(str(crop['imageId']), (None, None))
                if anchor is None or gallery_card != card:
                    raise ValueError(f'Unknown/mismatched catalog artwork in crop {n}')
            if record['split'] == 'train':
                if card is not None and anchor not in train_idx:
                    raise ValueError('Real training anchor belongs to the synthetic held-out split; choose another training card')
                file = crop_dir / f'{n:06d}.png'
                if crop.get('rotation', 0) == 180:
                    warp = np.ascontiguousarray(warp[::-1, ::-1])
                Image.fromarray(warp).save(file)
                key = (crop['sessionId'], crop['instanceId'], card, anchor)
                if key not in tracks:
                    item = {'files': [], 'kind': 'labeled', 'w': 1, 'anchor': anchor}
                    tracks[key] = item
                    real['pos' if card is not None else 'neg'].append(item)
                tracks[key]['files'].append(str(file.resolve()))
            else:
                x0,y0,x1,y1 = art_box_px(CARD_W, CARD_H, ART_BOX)
                # Each orientation cuts artwork from the WHOLE oriented card.
                # Rotating only a previously cut artwork misses inverted cards.
                for oriented in (warp, warp[::-1, ::-1]):
                    art = pil_resize_224(np.ascontiguousarray(oriented[y0:y1,x0:x1]))
                    qout.write(art.tobytes())
                queries.append({'sessionId': crop['sessionId'], 'cardId': card,
                                'split': record['split'], 'decklist': record['labels']['decklist'],
                                'atMs': crop['atMs'], 'instanceId': crop['instanceId']})
    write_json(out / 'real-train.json', real)
    art = load_art_cache()
    # No copy of the uint8 gallery on disk; the local server streams the .npy
    # payload via a generated symlink-free path/offset description.
    write_json(out / 'data.json', {'queries': queries,
        'gallery': [{'cardId': str(e['cardId']), 'imageId': str(e['imageId'])} for e in entries],
        'artCache': str((training / 'train/cache/art224.npy').resolve()),
        'artOffset': art.offset, 'artBytes': int(art.nbytes)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'run', 'bench'])
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, default=Path.home() / '.config/yugioh-vision/bakeoff.env')
    args = parser.parse_args()
    manifest = validate_manifest(args.manifest)  # Always before ML/env/import/download/output.
    if args.action == 'validate':
        print(f'Ready: {len(manifest["sessions"])} real sessions, {len(manifest["crops"])} reviewed quads')
        return
    load_env(args.env_file)
    training = Path(manifest['trainingDir']).expanduser().resolve()
    out = Path(manifest['outputDir']).expanduser().resolve()
    if args.action == 'bench':
        out = out.with_name(out.name + '-pilot')
    candidates = manifest.get('candidates', list(CANDIDATES))
    if not candidates or len(set(candidates)) != len(candidates) or any(c not in CANDIDATES for c in candidates):
        raise ValueError('Unknown/duplicate/empty candidate selection')
    if any(c.startswith('dinov3') for c in candidates) and not os.environ.get('HF_TOKEN'):
        raise ValueError('DINOv3 requires owner-approved HF access; put HF_TOKEN in the documented env file, never chat')
    import torch
    if not torch.version.hip or not torch.cuda.is_available():
        raise ValueError('Working ROCm GPU required; run check_gpu.py first')
    if shutil.disk_usage(out.parent if out.parent.exists() else training).free < 5 * 1024**3:
        raise ValueError('Choose an output drive with at least 5 GiB free (environment/cache space is additional)')
    os.environ['VISION_TRAINING_DIR'] = str(training)
    recipe = {'steps': 12000, 'seed': 633, 'bs': 16, 'k': 2, 'real-bs': 8, 'real-neg': 2,
              'workers': 2, 'amp': 'none', 'first': 0, 'decay': 1, 'std': 0, 'max-epochs': 100000,
              'lr': 3e-5, 'tau': .05, 'wd': .05, 'neg': 4, 'warmup': 150}
    # One shared recipe, no per-candidate tuning on test. Explicit whole-run override.
    for key, value in manifest.get('recipe', {}).items():
        if key not in ('steps', 'workers', 'bs', 'real-bs') or not isinstance(value, int) or value < 1:
            raise ValueError('Only positive shared steps/workers/bs/real-bs overrides are supported')
        recipe[key] = value
    if args.action == 'bench':
        recipe['steps'] = max(25, recipe['steps'])
    if out.exists():
        raise ValueError('Output exists: use a fresh outputDir to preserve frozen run evidence')
    out.mkdir(parents=True)
    if args.action == 'run':
        inputs = {str(args.manifest.resolve()): sha(args.manifest)}
        for record in manifest['sessions'].values():
            inputs[record['labelsPath']] = sha(record['labelsPath'])
            inputs[record['videoPath']] = record['videoSha256']
        for file in [training/'profile.json', training/'train/split.json',
                     training/'train/cache/entries.json', training/'train/cache/art224.npy']:
            inputs[str(file)] = sha(file)
        for candidate in candidates:
            init = manifest.get('initialCheckpoints', {}).get(candidate)
            if init:
                file = Path(init).expanduser().resolve()
                inputs[str(file)] = sha(file)
        write_json(out / 'frozen.json', {'inputs': inputs, 'recipe': recipe,
            'candidates': {c: CANDIDATES[c] for c in candidates},
            'gitCommit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
            'torch': torch.__version__, 'hip': torch.version.hip, 'gpu': torch.cuda.get_device_name(0)})
    prepare_data(manifest, training, out)
    results = []
    for candidate in candidates:
        command = [sys.executable, str(HERE / 'bakeoff_model.py'),
                   '--candidate', candidate, '--out', str(out), '--training-dir', str(training)]
        if args.action == 'bench':
            command += ['--bench']
        init = manifest.get('initialCheckpoints', {}).get(candidate)
        if init:
            command += ['--init', str(Path(init).expanduser().resolve())]
        command += ['--recipe', json.dumps(recipe)]
        # Sequential foreground jobs; preserve stdout, no detached processes.
        subprocess.run(command, check=True, cwd=ROOT)
        if args.action == 'run':
            results.append(read_json(out / candidate / 'model.json'))
            write_json(out / 'models.json', results)
    if args.action == 'run':
        subprocess.run(['npx','tsx','scripts/vision/bakeoff-browser.ts','--dir',str(out)], check=True, cwd=ROOT)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, FileNotFoundError, subprocess.CalledProcessError) as error:
        print(f'Bake-off stopped: {error}', file=sys.stderr)
        sys.exit(2)

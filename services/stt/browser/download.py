"""Fetch pinned browser-only ONNX exports, never into the source tree."""
import hashlib
import argparse
import json
import sys
from pathlib import Path
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3]
TARGET = ROOT / 'data/stt-models/browser-parakeet-v3'
REPO = 'istupakov/parakeet-tdt-0.6b-v3-onnx'
REVISION = '8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce'
FILES = {
    'encoder-model.int8.onnx': '6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09',
    'decoder_joint-model.int8.onnx': 'eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70',
    'vocab.txt': None,
    'config.json': None,
}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, help='Optional cards.cdb or names JSON; default: service catalog discovery')
    args = parser.parse_args()
    for name, digest in FILES.items():
        path = Path(hf_hub_download(REPO, name, revision=REVISION, local_dir=TARGET))
        if digest:
            with path.open('rb') as source:
                assert hashlib.file_digest(source, 'sha256').hexdigest() == digest, name
        print(name, path.stat().st_size, flush=True)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from stt.catalog import catalog_path
    from stt.matcher import load_catalog
    cards, source = load_catalog(args.catalog or catalog_path())
    (TARGET / 'cards.json').write_text(json.dumps([
        {'name': c.name, 'passcode': c.passcode} for c in sorted(cards, key=lambda c: c.passcode)
    ]))
    print('Catalog:', len(cards), source, flush=True)

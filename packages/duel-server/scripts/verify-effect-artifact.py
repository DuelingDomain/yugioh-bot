#!/usr/bin/env python3
"""Verify the independently pinned searchygo artifact before engine installation.

No application dependencies and no engine writes. Pin changes are read from the
shared source (VM checkout) or compiled output (runtime container).
"""
import gzip
import hashlib
import json
import pathlib
import re
import sys

packages = pathlib.Path(__file__).resolve().parents[2]
shared = packages / 'shared'
source = shared / 'src/cards/effects/artifact.ts'
if not source.exists():
    source = shared / 'dist/cards/effects/artifact.js'
pin = source.read_text()
expected = re.search(r'CARD_EFFECT_ARTIFACT_MANIFEST_SHA256\s*=\s*"([a-f0-9]{64})"', pin)
if not expected:
    raise SystemExit('Missing shared effect artifact integrity pin')
root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else shared / 'data/effects'
manifest_bytes = (root / 'manifest.json').read_bytes()
sha = lambda value: hashlib.sha256(value).hexdigest()
if sha(manifest_bytes) != expected[1]:
    raise SystemExit('Effect artifact manifest integrity mismatch')
manifest = json.loads(manifest_bytes)
for entry in manifest['files'].values():
    path = pathlib.Path(entry['path'])
    if path.name != str(path) or path.is_absolute():
        raise SystemExit('Invalid effect artifact path')
    compressed = (root / path).read_bytes()
    if len(compressed) != entry['gzipBytes'] or sha(compressed) != entry['gzipSha256']:
        raise SystemExit(f'Effect artifact compressed integrity mismatch: {path}')
    with gzip.open(root / path, 'rb') as stream:
        content = stream.read(entry['bytes'] + 1)
    if len(content) != entry['bytes'] or sha(content) != entry['sha256']:
        raise SystemExit(f'Effect artifact content integrity mismatch: {path}')
print(f"Effect artifact verified: {manifest['artifactVersion']}")

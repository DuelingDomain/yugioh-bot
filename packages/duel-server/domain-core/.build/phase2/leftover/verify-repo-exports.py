"""Check an explicit controller-turn and Fork route. Write only a private copy."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[5]
parser = argparse.ArgumentParser()
parser.add_argument('--controller', choices=['A', 'B'], required=True)
parser.add_argument('--fork', choices=['production', 'owner-seat'], required=True)
args = parser.parse_args()
config = json.loads((OUT / 'repo-apply-order.json').read_text())
route = config['routes'][args.controller]
order = json.loads((OUT / route['orderFiles'][args.fork]).read_text())
predecessors = [OUT / p for p in config['forkRoutes'][args.fork]['predecessors']]
patches = predecessors + [OUT / p for p in order]
c6 = json.loads((OUT / 'fix2/c6-input.json').read_text())
assert hashlib.sha256(Path(c6['current_source']).read_bytes()).hexdigest() == c6['sha256'], 'C6 changed. Regenerate the registration and owner-context C6 patch before this check.'
expected = next(r for r in json.loads((OUT / 'fix2/integration-apply.json').read_text()) if r['route'] == args.controller and r['fork'] == args.fork)
for patch, record in zip(patches, expected['checked'], strict=True):
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == record['sha256'], f'Patch changed: {patch}. Repeat the route check with the new export.'
with tempfile.TemporaryDirectory(prefix='leftover-fix2-apply-') as tmp:
    shadow = Path(tmp)
    paths = set()
    for patch in patches:
        paths.update(re.findall(r'^--- a/(.+)$', patch.read_text(), re.M))
    for relative in sorted(paths):
        assert not relative.startswith('/') and '..' not in Path(relative).parts
        source = ROOT / relative
        if source.is_file():
            destination = shadow / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
    subprocess.run(['git', 'init', '-q'], cwd=shadow, check=True)
    for patch in patches:
        subprocess.run(['git', 'apply', '--check', str(patch)], cwd=shadow, check=True)
        subprocess.run(['git', 'apply', str(patch)], cwd=shadow, check=True)
    manifest = (shadow / 'packages/duel-server/scripts/native/checks/checks.tsv').read_text()
    assert 'dead-across-zones\t' in manifest and 'leftover-seat-queries\t' in manifest
    print(json.dumps({'controller': args.controller, 'fork': args.fork, 'patches': len(patches), 'failed': 0}))

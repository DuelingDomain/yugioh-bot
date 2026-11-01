"""Reapply the final matcher to saved hypotheses without re-running ASR.

Raw recognition/timing results remain unchanged. This makes all models use the same
final matching rules when fixes are made during the prototype. It also stamps the
corpus hash after pinning the TTS source metadata (audio SHA256s are checked).
"""
import hashlib
import json
from pathlib import Path
import statistics
import time
import numpy as np
from jiwer import process_words
from stt.download import MODELS
from stt.matcher import CardMatcher, clean, load_catalog

root = Path(__file__).resolve().parents[3]
manifest_path = root / 'data/stt-benchmark/manifest.json'
manifest = json.loads(manifest_path.read_text())
cards, _ = load_catalog(root / 'data/duel-engine/cards.cdb')
matcher = CardMatcher(cards)
for path in Path(__file__).parent.glob('*.json'):
    result = json.loads(path.read_text())
    if result.get('model') not in MODELS or 'clips' not in result:
        continue
    assert len(result['clips']) == len(manifest['clips'])
    for row, source in zip(result['clips'], manifest['clips']):
        for key in ['file', 'reference', 'sha256', 'duration']:
            assert row[key] == source[key], (path, key)
        assert hashlib.sha256((manifest_path.parent / row['file']).read_bytes()).hexdigest() == row['sha256']
        started = time.perf_counter()
        matched = matcher.match(row['text'], manifest['hotwords'])
        row['matchMs'] = round((time.perf_counter() - started) * 1000, 2)
        row.update(matched)
    refs = [clean(r['reference']) for r in result['clips']]
    norm = process_words(refs, [clean(r['normalizedText']) for r in result['clips']])
    result['normalizedWer'] = round(norm.wer, 6)
    result['normalizedErrors'] = norm.substitutions + norm.insertions + norm.deletions
    result['matcherP50Ms'] = round(statistics.median(r['matchMs'] for r in result['clips']), 2)
    result['matcherP95Ms'] = round(float(np.percentile([r['matchMs'] for r in result['clips']], 95)), 2)
    result['manifestSha256'] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    result['catalogCount'] = len(cards)
    result['modelRepository'], result['modelRevision'], _ = MODELS[result['model']]
    result['precision'] = 'int8 (runtime quantization from upstream fp16)' if result['model'] == 'whisper' else 'int8 ONNX'
    result['rescoredWithFinalMatcher'] = True
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(path.name, 'raw', result['rawWer'], 'normalized', result['normalizedWer'])

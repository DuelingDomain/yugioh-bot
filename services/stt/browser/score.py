"""Score browser hypotheses and verify JS/Python matcher parity (benchmark check)."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from jiwer import process_words
from stt.matcher import CardMatcher, clean, phonetic, load_catalog

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=Path, default=ROOT / 'services/stt/benchmarks/browser-parakeet.json')
parser.add_argument('--catalog', type=Path, default=ROOT / 'data/duel-engine/cards.cdb')
args = parser.parse_args()
report = json.loads(args.report.read_text())
manifest = json.loads((ROOT / 'data/stt-benchmark/manifest.json').read_text())
assert report['manifestSha256'] == hashlib.sha256((ROOT / 'data/stt-benchmark/manifest.json').read_bytes()).hexdigest()
cards, _ = load_catalog(args.catalog)
exported_path = ROOT / 'data/stt-models' / report.get('modelDirectory', 'browser-parakeet-v3') / 'cards.json'
exported = json.loads(exported_path.read_text())
assert sorted((c.name, c.passcode) for c in cards) == sorted((c['name'], c['passcode']) for c in exported), 'Browser catalog differs from scoring catalog; rerun download.py --catalog'
matcher = CardMatcher(cards)
rows = []
for path in (ROOT / 'services/stt/benchmarks').glob('*.json'):
    result = json.loads(path.read_text())
    if result.get('model') in ['parakeet', 'zipformer', 'whisper']:
        rows.extend(r['text'] for r in result.get('clips', []))
for run in report['runs']:
    rows.extend(r['text'] for r in run.get('clips', []))
    for probe in run.get('probes', {}).values():
        rows.extend(r['text'] for r in probe['runs'])
words = sorted(set(clean(c.name) for c in cards) | set(clean(text) for text in rows))
script = """
import { CardMatcher } from './matcher.js';
import { doubleMetaphone } from './phonetics.js';
import { readFileSync } from 'node:fs';
const { cards, rows, words, hotwords } = JSON.parse(readFileSync(0, 'utf8'));
const matcher = new CardMatcher(cards);
process.stdout.write(JSON.stringify({ results: rows.map(text => matcher.match(text, hotwords)), phones: words.map(doubleMetaphone) }));
"""
js = subprocess.run(['node', '--input-type=module', '-e', script], cwd=HERE, check=True, capture_output=True, text=True, input=json.dumps({
    'cards': [{'name': c.name, 'passcode': c.passcode} for c in cards],
    'rows': rows, 'words': words, 'hotwords': manifest['hotwords'],
}))
actual = json.loads(js.stdout)
for word, phone in zip(words, actual['phones']):
    assert list(phonetic(word)) == phone, ('phonetic mismatch', word, phonetic(word), phone)
for text, result in zip(rows, actual['results']):
    expected = matcher.match(text, manifest['hotwords'])
    assert result == expected, ('matcher mismatch', text, expected, result)
for run in report['runs']:
    clips = run.get('clips', [])
    if not clips:
        continue
    assert len(clips) == len(manifest['clips']), 'Incomplete accuracy corpus'
    for clip in clips:
        assert {k: clip[k] for k in ['text', 'normalizedText', 'cardMatches']} == matcher.match(clip['text'], manifest['hotwords'])
    refs = [clean(r['reference']) for r in clips]
    raw = process_words(refs, [clean(r['text']) for r in clips])
    norm = process_words(refs, [clean(r['normalizedText']) for r in clips])
    run['accuracy'] = {'rawWer': raw.wer, 'normalizedWer': norm.wer, 'referenceWords': raw.hits + raw.substitutions + raw.deletions,
                       'rawErrors': raw.substitutions + raw.deletions + raw.insertions,
                       'normalizedErrors': norm.substitutions + norm.deletions + norm.insertions}
    run['rtf'] = sum(r['decodeMs'] for r in clips) / 1000 / sum(r['duration'] for r in clips)
    print(run['mode'], run['accuracy'], 'RTF', run['rtf'], flush=True)
report['matcherVerification'] = {'hypotheses': len(rows), 'phoneticInputs': len(words), 'differences': 0,
                                 'catalogSha256': hashlib.sha256(args.catalog.read_bytes()).hexdigest(),
                                 'browserCatalogSha256': hashlib.sha256(exported_path.read_bytes()).hexdigest(), 'catalogCount': len(cards)}
args.report.write_text(json.dumps(report, indent=2) + '\n')
print('JS/Python parity:', report['matcherVerification'], flush=True)

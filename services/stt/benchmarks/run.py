"""Run ONE model per process; save every hypothesis and measured timing."""
import argparse
import hashlib
import json
import platform
import resource
import statistics
import time
from pathlib import Path
import wave
import numpy as np
import psutil
from jiwer import process_words
from stt.matcher import CardMatcher, clean, load_catalog
from stt.models import Recognizer, RATE


def audio(path):
    with wave.open(str(path)) as wav:
        assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (RATE, 1, 2)
        return np.frombuffer(wav.readframes(wav.getnframes()), '<i2').astype(np.float32) / 32768


def percentile(values, p=95):
    return round(float(np.percentile(values, p)), 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=['parakeet', 'zipformer', 'whisper'], required=True)
    parser.add_argument('--corpus', type=Path, default=Path('data/stt-benchmark'))
    parser.add_argument('--catalog', type=Path, default=Path('data/duel-engine/cards.cdb'))
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.corpus / 'manifest.json').read_text())
    cards, source = load_catalog(args.catalog)
    matcher = CardMatcher(cards)
    hotwords = manifest['hotwords']
    recognizer = Recognizer(args.model, args.threads)
    rss_loaded = psutil.Process().memory_info().rss / 2**20
    # Warmup is excluded from decode timing, load timing excludes download.
    recognizer.decode(audio(args.corpus / manifest['clips'][0]['file']), hotwords)
    rows = []
    for clip in manifest['clips']:
        samples = audio(args.corpus / clip['file'])
        started = time.perf_counter()
        text = recognizer.decode(samples, hotwords)
        decode_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        matched = matcher.match(text, hotwords)
        match_ms = (time.perf_counter() - started) * 1000
        row = {**clip, **matched, 'decodeMs': round(decode_ms, 2), 'matchMs': round(match_ms, 2)}
        rows.append(row)
        print(f"{len(rows):02d}: {decode_ms:.0f} ms | {text}", flush=True)
    refs = [clean(r['reference']) for r in rows]
    raw = process_words(refs, [clean(r['text']) for r in rows])
    norm = process_words(refs, [clean(r['normalizedText']) for r in rows])
    probes = {}
    for probe in manifest['probes']:
        samples = audio(args.corpus / probe['file'])
        full_times, tail_times = [], []
        for _ in range(7):
            started = time.perf_counter(); text = recognizer.decode(samples, hotwords)
            full_times.append((time.perf_counter() - started) * 1000)
            if args.model == 'zipformer':
                stream = recognizer.stream(hotwords)
                for offset in range(0, len(samples), 320):
                    recognizer.feed(stream, samples[offset:offset + 320])
                started = time.perf_counter(); recognizer.finish(stream)
                tail_times.append((time.perf_counter() - started) * 1000)
        probes[str(probe['duration'])] = {
            'reference': probe['reference'], 'text': text,
            'fullDecodeP50Ms': round(statistics.median(full_times), 2), 'fullDecodeP95Ms': percentile(full_times),
            'releaseP50Ms': round(statistics.median(tail_times or full_times), 2),
            'releaseP95Ms': percentile(tail_times or full_times),
        }
    total_sec = sum(r['duration'] for r in rows)
    result = {
        'model': args.model, 'threads': args.threads, 'platform': platform.platform(),
        'cpu': 'AMD Ryzen 7 9800X3D, CPU only, WSL2', 'catalog': source, 'catalogCount': len(cards),
        'manifestSha256': hashlib.sha256((args.corpus / 'manifest.json').read_bytes()).hexdigest(),
        'loadSeconds': round(recognizer.load_seconds, 3), 'loadedRssMiB': round(rss_loaded, 1),
        'peakRssMiB': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        'rawWer': round(raw.wer, 6), 'normalizedWer': round(norm.wer, 6),
        'rawErrors': raw.substitutions + raw.deletions + raw.insertions,
        'referenceWords': raw.hits + raw.substitutions + raw.deletions,
        'rtf': round(sum(r['decodeMs'] for r in rows) / 1000 / total_sec, 4),
        'decodeP50Ms': round(statistics.median([r['decodeMs'] for r in rows]), 2),
        'decodeP95Ms': percentile([r['decodeMs'] for r in rows]),
        'matcherP50Ms': round(statistics.median([r['matchMs'] for r in rows]), 2),
        'matcherP95Ms': percentile([r['matchMs'] for r in rows]),
        'audioSeconds': round(total_sec, 2), 'probes': probes, 'clips': rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'clips'}, indent=2), flush=True)

if __name__ == '__main__':
    main()

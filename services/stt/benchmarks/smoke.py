"""Real HTTP/WS integration smoke and paced release timing; requires a running API."""
import argparse
import asyncio
import json
from pathlib import Path
import statistics
import time
import wave
import httpx
import numpy as np
import websockets


def read_pcm(path):
    with wave.open(str(path)) as wav:
        return wav.readframes(wav.getnframes())

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4020')
    parser.add_argument('--token', default='')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    corpus = root / 'data/stt-benchmark'
    url = args.url.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
    headers = {'Authorization': f'Bearer {args.token}'} if args.token else {}
    async def connect():
        ws = await websockets.connect(url)
        # Browser-compatible auth; intentionally no custom WS headers.
        if args.token:
            await ws.send(json.dumps({'type': 'auth', 'token': args.token}))
        ready = json.loads(await ws.recv())
        assert ready['type'] == 'ready', ready
        return ws

    async def utterance(raw, options=None):
        ws = await connect()
        async with ws:
            await ws.send(json.dumps({'type': 'start', **(options or {})}))
            assert json.loads(await ws.recv())['type'] == 'started'
            partials = []
            started = time.perf_counter()
            async def receive():
                while True:
                    result = json.loads(await ws.recv())
                    if result['type'] == 'partial':
                        partials.append({'text': result['text'], 'receivedMs': round((time.perf_counter()-started)*1000, 2)})
                    if result['type'] == 'final':
                        return result
                    assert result['type'] != 'error', result
            response = asyncio.create_task(receive())
            for offset in range(0, len(raw), 640):
                await ws.send(raw[offset:offset + 640])
                await asyncio.sleep(.02)
            released = time.perf_counter()
            await ws.send('{"type":"end"}')
            result = await response
            return {**result, 'observedReleaseMs': round((time.perf_counter()-released)*1000, 2), 'partials': partials}

    async with httpx.AsyncClient(timeout=90, headers=headers) as client:
        health = (await client.get(args.url + '/health')).json()
        pcm_headers = {'Content-Type': 'audio/pcm'}
        raw = read_pcm(corpus / '00-00.wav')
        r = await client.post(args.url + '/transcribe', content=raw,
                              headers={**pcm_headers, 'X-STT-Hotwords': json.dumps(['Blue-Eyes White Dragon', 'Dark Magician'])})
        assert r.status_code == 200, r.text
        assert [c['passcode'] for c in r.json()['cardMatches']] == [89631139, 46986414], r.json()
        silence = await client.post(args.url + '/transcribe', content=b'\0'*32000, headers=pcm_headers)
        assert silence.json()['text'] == '' and not silence.json()['speechDetected']
        assert (await client.post(args.url + '/transcribe', content=b'\0', headers=pcm_headers)).status_code == 422
        assert (await client.post(args.url + '/transcribe', content=b'\0'*(16000*2*16), headers=pcm_headers)).status_code == 413
        assert (await client.post(args.url + '/transcribe', content=b'\0'*320, headers={**pcm_headers, 'X-STT-Hotwords': '{}'})).status_code == 422
        # Legitimate punctuated card names are accepted as hints, including over HTTP.
        assert (await client.post(args.url + '/transcribe', content=b'\0'*32000,
               headers={**pcm_headers, 'X-STT-Hotwords': json.dumps(['D/D Swirl Slime', 'Number 39: Utopia'])})).status_code == 200
        for payload in [b'', b'\0']:
            ws = await connect()
            async with ws:
                await ws.send('{"type":"start"}'); await ws.recv(); await ws.send(payload)
                assert json.loads(await ws.recv())['type'] == 'error'
        ws = await connect()
        async with ws:
            await ws.send('{"type":"start"}'); await ws.recv(); await ws.send('{"type":"cancel"}')
            assert json.loads(await ws.recv())['type'] == 'cancelled'
            await ws.send('{"type":"start"}'); await ws.recv()  # disconnect cleanup
        await asyncio.sleep(.05)
        assert (await client.get(args.url + '/health')).json()['activeUtterances'] == 0
        phrase = await utterance(raw, {'cards': ['Blue-Eyes White Dragon', 'Dark Magician'], 'requestId': 'smoke'})
        assert [c['passcode'] for c in phrase['cardMatches']] == [89631139, 46986414], phrase
        assert phrase['partials'], 'Expected provisional text during speech'
        silent = await utterance(b'\0'*32000, {'partials': False})
        assert silent['text'] == '' and not silent['speechDetected']
        probes = {}
        for seconds in [1, 3]:
            outcomes = [await utterance(read_pcm(corpus / f'probe-{seconds}s.wav'), {'partials': True}) for _ in range(3)]
            elapsed = [o['observedReleaseMs'] for o in outcomes]
            probes[str(seconds)] = {'p50Ms': round(statistics.median(elapsed), 2),
                                    'p95Ms': round(float(np.percentile(elapsed, 95)), 2), 'runs': outcomes}
        # VAD opt-in must emit a final without an explicit release message.
        ws = await connect()
        async with ws:
            await ws.send('{"type":"start","mode":"vad","partials":false}'); await ws.recv()
            raw_vad = read_pcm(corpus / '00-01.wav') + b'\0'*16000
            for offset in range(0,len(raw_vad),640):
                await ws.send(raw_vad[offset:offset+640])
            vad_final = json.loads(await ws.recv())
            assert vad_final['type'] == 'final' and vad_final['reason'] == 'silence', vad_final
        # Model load / request count remain bounded after all cleanup paths.
        await asyncio.sleep(.05)
        assert (await client.get(args.url + '/health')).json()['activeUtterances'] == 0
    result = {'health': health, 'checks': 'HTTP/WS transcript, canonical IDs, PCM validation, size bounds, hotword validation, punctuated names, silence, cancel, disconnect, partials, VAD',
              'phrase': phrase, 'probes': probes, 'vad': vad_final}
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'model': health['model'], 'checks': 'passed', 'probes': {k:{s:v for s,v in p.items() if s!='runs'} for k,p in probes.items()}}, indent=2))

if __name__ == '__main__':
    asyncio.run(main())

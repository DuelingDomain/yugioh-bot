"""Standalone PCM speech API. See ../README.md for its wire protocol."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
import hmac
import json
import logging
import os
from pathlib import Path
import time
from typing import Literal
import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from .catalog import catalog_path
from .matcher import CardMatcher, STAPLES, clean, load_catalog
from .models import Endpoint, RATE, Recognizer

LOG = logging.getLogger('stt')
MAX_SECONDS = int(os.getenv('STT_MAX_SECONDS', '15'))
MAX_BYTES = MAX_SECONDS * RATE * 2
MAX_ACTIVE = int(os.getenv('STT_MAX_ACTIVE', '4'))
API_KEY = os.getenv('STT_API_KEY', '')
ALLOWED_ORIGINS = [o.strip() for o in os.getenv('STT_ALLOWED_ORIGINS', '').split(',') if o.strip()]

class Options(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['start'] = 'start'
    requestId: str = Field(default='', max_length=64)
    sampleRate: Literal[16000] = 16000
    format: Literal['s16le'] = 's16le'
    mode: Literal['ptt', 'vad'] = 'ptt'
    partials: bool = True
    hotwords: list[str] = Field(default_factory=list, max_length=256)
    cards: list[str] = Field(default_factory=list, max_length=256)

    def words(self):
        words = list(dict.fromkeys(self.cards + self.hotwords))
        if len(words) > 256 or any(not w.strip() or len(w) > 120 or any(c in w for c in '\r\n') for w in words):
            raise ValueError('Use at most 256 nonempty hotwords (120 characters each, no newline)')
        return words

class Engine:
    def __init__(self):
        self.recognizer = Recognizer(os.getenv('STT_MODEL', 'whisper'), int(os.getenv('STT_THREADS', '4')))
        self.partial_recognizer = self.recognizer
        partial_model = os.getenv('STT_PARTIAL_MODEL', 'parakeet' if self.recognizer.name == 'whisper' else self.recognizer.name)
        if partial_model != 'none' and partial_model != self.recognizer.name:
            self.partial_recognizer = Recognizer(partial_model, self.recognizer.threads)
        self.partials_enabled = partial_model != 'none'
        catalog = catalog_path()
        cards, self.catalog_source = load_catalog(catalog)
        self.matcher = CardMatcher(cards)
        self.staples = [name for name in STAPLES if self.matcher.cards.get(clean(name))]
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='stt')
        self.lock = asyncio.Lock()
        self.final_waiters = 0
        self.active = 0
        # Download/check Silero once before readiness; never download per request.
        Endpoint()

    def reserve(self):
        if self.active >= MAX_ACTIVE:
            raise HTTPException(429, 'STT is busy; retry after this utterance')
        self.active += 1

    async def run(self, fn, *args, provisional=False):
        if provisional and (self.lock.locked() or self.final_waiters):
            return None
        if not provisional:
            self.final_waiters += 1
        try:
            async with self.lock:
                job = asyncio.get_running_loop().run_in_executor(self.pool, partial(fn, *args))
                try:
                    return await asyncio.shield(job)
                except asyncio.CancelledError:
                    # Keep the lock until the native decode actually finishes.
                    await job
                    raise
        finally:
            if not provisional:
                self.final_waiters -= 1

    def result(self, text, words):
        return self.matcher.match(text, words)

@asynccontextmanager
async def lifespan(app):
    app.state.engine = Engine()
    yield
    app.state.engine.pool.shutdown(wait=True)

app = FastAPI(title='Remote Duels STT', version='1.0.0', lifespan=lifespan)
if ALLOWED_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=['POST', 'GET'],
                       allow_headers=['Authorization', 'Content-Type', 'X-STT-Hotwords'])


def authorized(headers):
    return not API_KEY or hmac.compare_digest(headers.get('authorization', '').encode(), f'Bearer {API_KEY}'.encode())


def pcm(data):
    if len(data) % 2:
        raise ValueError('PCM must contain complete 16-bit samples')
    return np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768

@app.get('/health')
async def health(request: Request):
    engine = request.app.state.engine
    return {'status': 'ready', 'model': engine.recognizer.name, 'sampleRate': RATE,
            'modelLoadSeconds': round(engine.recognizer.load_seconds, 3),
            'partialModel': engine.partial_recognizer.name if engine.partials_enabled else None, 'activeUtterances': engine.active,
            'catalogSource': engine.catalog_source, 'catalogSize': len(engine.matcher.cards)}

@app.post('/transcribe')
async def transcribe(request: Request):
    if not authorized(request.headers):
        raise HTTPException(401, 'Invalid bearer token')
    content_type = request.headers.get('content-type', '').split(';')[0]
    if content_type not in {'audio/pcm', 'application/octet-stream'}:
        raise HTTPException(415, 'Send raw mono 16 kHz signed 16-bit little-endian PCM as audio/pcm')
    try:
        options = Options(hotwords=json.loads(request.headers.get('x-stt-hotwords', '[]')))
        words = options.words()
    except (ValueError, ValidationError):
        raise HTTPException(422, 'X-STT-Hotwords must be a JSON array of at most 256 card names')
    engine = request.app.state.engine
    engine.reserve()
    try:
        data = bytearray()
        async with asyncio.timeout(30):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, f'Audio exceeds {MAX_SECONDS} seconds')
                data.extend(chunk)
        try:
            samples = pcm(data)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        started = time.perf_counter()
        endpoint = Endpoint()
        endpoint.feed(samples)
        speech = endpoint.finish()
        text = await engine.run(engine.recognizer.decode, samples, words + engine.staples) if speech else ''
        result = await engine.run(engine.result, text, words)
        return {**result, 'model': engine.recognizer.name, 'durationMs': len(samples) / 16,
                'speechDetected': speech, 'processingMs': round((time.perf_counter() - started) * 1000, 2)}
    except TimeoutError:
        raise HTTPException(408, 'Audio upload timed out')
    finally:
        engine.active -= 1

class Utterance:
    def __init__(self, options, words, engine):
        self.options, self.words, self.engine = options, words, engine
        self.endpoint = Endpoint()
        self.frames = []
        self.count = 0
        self.stream = engine.recognizer.stream(words + engine.staples)
        self.partial_task = None
        self.partial_at = 0
        self.cached = None
        self.ending = False
        self.deadline = asyncio.get_running_loop().time() + MAX_SECONDS + 10

    def samples(self):
        return np.concatenate(self.frames) if self.frames else np.empty(0, dtype=np.float32)

    async def drain(self):
        if self.partial_task:
            await self.partial_task
            self.partial_task = None

@app.websocket('/ws')
async def websocket(ws: WebSocket):
    if ALLOWED_ORIGINS and ws.headers.get('origin') and ws.headers['origin'] not in ALLOWED_ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    if not authorized(ws.headers):
        try:
            auth_message = await asyncio.wait_for(ws.receive(), timeout=5)
            raw_auth = auth_message.get('text')
            if not isinstance(raw_auth, str):
                raise ValueError('Authentication must be a JSON text frame')
            if len(raw_auth) > 4096:
                raise ValueError('Authentication message too large')
            auth = json.loads(raw_auth)
            if not isinstance(auth, dict) or auth.get('type') != 'auth' or not isinstance(auth.get('token'), str):
                raise ValueError('Expected auth message')
            if not hmac.compare_digest(auth['token'].encode(), API_KEY.encode()):
                raise ValueError('Invalid token')
        except (ValueError, TimeoutError, WebSocketDisconnect):
            await ws.close(code=1008)
            return
    engine = ws.app.state.engine
    utterance = None
    send_lock = asyncio.Lock()

    async def send(payload):
        async with send_lock:
            await ws.send_json(payload)

    async def provisional(u):
        count = u.count
        if u.stream is not None or not u.endpoint.speech:
            return
        text = await engine.run(engine.partial_recognizer.decode, u.samples(), u.words + engine.staples, provisional=True)
        if text is not None:
            u.cached = (count, text)
            if not u.ending:
                await send({'type': 'partial', 'requestId': u.options.requestId, 'text': text,
                            'audioMs': count / 16, 'model': engine.partial_recognizer.name})

    async def finalize(u, reason):
        u.ending = True
        started = time.perf_counter()
        await u.drain()
        speech = u.endpoint.finish()
        if not speech:
            text = ''
        elif u.stream is not None:
            text = await engine.run(engine.recognizer.finish, u.stream)
        elif u.cached and u.cached[0] == u.count and engine.partial_recognizer is engine.recognizer:
            text = u.cached[1]
        else:
            text = await engine.run(engine.recognizer.decode, u.samples(), u.words + engine.staples)
        result = await engine.run(engine.result, text, u.words)
        return {**result, 'type': 'final', 'requestId': u.options.requestId, 'reason': reason,
                'model': engine.recognizer.name, 'durationMs': u.count / 16,
                'speechDetected': speech, 'processingMs': round((time.perf_counter() - started) * 1000, 2)}

    try:
        await send({'type': 'ready', 'model': engine.recognizer.name,
                    'partialModel': engine.partial_recognizer.name if engine.partials_enabled else None, 'sampleRate': RATE,
                    'format': 's16le', 'maxSeconds': MAX_SECONDS})
        while True:
            timeout = min(30, utterance.deadline - asyncio.get_running_loop().time()) if utterance else 30
            if timeout <= 0:
                raise TimeoutError
            message = await asyncio.wait_for(ws.receive(), timeout=timeout)
            if message['type'] == 'websocket.disconnect':
                break
            if message.get('bytes') is not None:
                if utterance is None:
                    raise ValueError('Send start before audio')
                raw = message['bytes']
                if not raw:
                    raise ValueError('Empty audio frames are not allowed')
                if len(utterance.frames) >= 2000:
                    raise ValueError('Too many audio frames; send approximately 20 ms per frame')
                if len(raw) > 64000:
                    raise ValueError('Audio frames must be at most 64000 bytes (recommended: 640 bytes / 20 ms)')
                samples = pcm(raw)
                u = utterance
                if u.count + len(samples) > MAX_SECONDS * RATE:
                    raise ValueError(f'Utterance exceeds {MAX_SECONDS} seconds')
                u.frames.append(samples)
                u.count += len(samples)
                ended = u.endpoint.feed(samples)
                if u.stream is not None:
                    text = await engine.run(engine.recognizer.feed, u.stream, samples)
                    if u.options.partials and u.count - u.partial_at >= 6400:
                        await send({'type': 'partial', 'requestId': u.options.requestId, 'text': text, 'audioMs': u.count / 16})
                        u.partial_at = u.count
                elif engine.partials_enabled and u.options.partials and u.count - u.partial_at >= 6400:
                    if u.partial_task is None or u.partial_task.done():
                        await u.drain()
                        u.partial_at = u.count
                        u.partial_task = asyncio.create_task(provisional(u))
                if ended and u.options.mode == 'vad':
                    result = await finalize(u, 'silence')
                    utterance = None
                    engine.active -= 1
                    await send(result)
                continue
            raw = message.get('text', '')
            if len(raw) > 64000:
                raise ValueError('Control message is too large')
            control = json.loads(raw)
            if not isinstance(control, dict):
                raise ValueError('Control message must be a JSON object')
            kind = control.get('type')
            if kind == 'start':
                if utterance is not None:
                    raise ValueError('End or cancel the current utterance before start')
                options = Options.model_validate(control)
                words = options.words()
                engine.reserve()
                try:
                    utterance = Utterance(options, words, engine)
                except Exception:
                    engine.active -= 1
                    raise
                await send({'type': 'started', 'requestId': options.requestId})
            elif kind == 'end':
                if utterance is None:
                    raise ValueError('No active utterance')
                result = await finalize(utterance, 'release')
                utterance = None
                engine.active -= 1
                await send(result)
            elif kind == 'cancel':
                if utterance:
                    utterance.ending = True
                    await utterance.drain()
                    utterance = None
                    engine.active -= 1
                await send({'type': 'cancelled'})
            else:
                raise ValueError('Unknown control type; expected start, end or cancel')
    except (WebSocketDisconnect, ConnectionError):
        pass
    except (ValueError, ValidationError, TimeoutError, HTTPException) as exc:
        message = exc.detail if isinstance(exc, HTTPException) else ('Connection idle timeout' if isinstance(exc, TimeoutError) else str(exc))
        try:
            await send({'type': 'error', 'error': message})
            await ws.close(code=1008)
        except (WebSocketDisconnect, RuntimeError):
            pass
    except Exception:
        LOG.exception('STT WebSocket failure')
        try:
            await send({'type': 'error', 'error': 'Transcription failed'})
            await ws.close(code=1011)
        except (WebSocketDisconnect, RuntimeError):
            pass
    finally:
        if utterance:
            utterance.ending = True
            try:
                await utterance.drain()
            except (WebSocketDisconnect, ConnectionError, RuntimeError):
                pass
            engine.active -= 1

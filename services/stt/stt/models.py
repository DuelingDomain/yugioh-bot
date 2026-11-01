"""Small CPU adapters shared by the server and reproducible benchmark."""
from pathlib import Path
import time
import numpy as np
from .download import download, download_vad

RATE = 16000

class Recognizer:
    def __init__(self, name='parakeet', threads=4):
        path = download(name)
        self.name = name
        self.threads = threads
        started = time.perf_counter()
        if name == 'whisper':
            from faster_whisper import WhisperModel
            self.model = WhisperModel(str(path), device='cpu', compute_type='int8', cpu_threads=threads, num_workers=1)
        else:
            import sherpa_onnx
            common = dict(tokens=str(path / 'tokens.txt'), num_threads=threads, sample_rate=RATE, provider='cpu')
            if name == 'parakeet':
                self.model = sherpa_onnx.OfflineRecognizer.from_transducer(
                    encoder=str(path / 'encoder.int8.onnx'), decoder=str(path / 'decoder.int8.onnx'),
                    joiner=str(path / 'joiner.int8.onnx'), model_type='nemo_transducer', **common)
            elif name == 'zipformer':
                import sentencepiece
                self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(path / 'bpe.model'))
                vocab = path / 'bpe.vocab'
                if not vocab.exists():
                    vocab.write_text(''.join(f'{self.tokenizer.id_to_piece(i)} {self.tokenizer.get_score(i)}\n' for i in range(self.tokenizer.get_piece_size())))
                self.model = sherpa_onnx.OnlineRecognizer.from_transducer(
                    encoder=str(path / 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
                    decoder=str(path / 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx'),
                    joiner=str(path / 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx'),
                    decoding_method='modified_beam_search', max_active_paths=4,
                    modeling_unit='bpe', bpe_vocab=str(vocab), hotwords_score=1.5, **common)
            else:
                raise ValueError(f'Unknown model: {name}')
        self.load_seconds = time.perf_counter() - started

    def stream(self, hotwords=()):
        if self.name != 'zipformer':
            return None
        encoded = '/'.join(w.upper() for w in hotwords)
        return self.model.create_stream(encoded) if encoded else self.model.create_stream()

    def feed(self, stream, samples):
        stream.accept_waveform(RATE, samples)
        while self.model.is_ready(stream):
            self.model.decode_stream(stream)
        return self.model.get_result(stream).strip()

    def finish(self, stream):
        # Flush the encoder lookahead immediately; no wall-clock silence wait.
        self.feed(stream, np.zeros(int(RATE * 0.66), dtype=np.float32))
        stream.input_finished()
        while self.model.is_ready(stream):
            self.model.decode_stream(stream)
        return self.model.get_result(stream).strip()

    def decode(self, samples, hotwords=()):
        if not len(samples):
            return ''
        if self.name == 'whisper':
            segments, _ = self.model.transcribe(
                samples, language='en', beam_size=5, condition_on_previous_text=False,
                vad_filter=False, hotwords=', '.join(hotwords) or None,
                temperature=0, without_timestamps=True)
            return ' '.join(s.text.strip() for s in segments).strip()
        if self.name == 'zipformer':
            stream = self.stream(hotwords)
            for offset in range(0, len(samples), 320):
                self.feed(stream, samples[offset:offset + 320])
            return self.finish(stream)
        stream = self.model.create_stream()
        stream.accept_waveform(RATE, samples)
        self.model.decode_stream(stream)
        return stream.result.text.strip()

class Endpoint:
    """One Silero state per utterance; PTT release always bypasses silence wait."""
    def __init__(self):
        import sherpa_onnx
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = str(download_vad())
        config.silero_vad.threshold = 0.5
        config.silero_vad.min_silence_duration = 0.35
        config.silero_vad.min_speech_duration = 0.10
        config.silero_vad.max_speech_duration = 15
        config.sample_rate = RATE
        config.num_threads = 1
        self.vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)
        self.pending = np.empty(0, dtype=np.float32)
        self.speech = False
        self.ended = False

    def feed(self, samples):
        self.pending = np.concatenate((self.pending, samples))
        while len(self.pending) >= 512:
            window, self.pending = self.pending[:512], self.pending[512:]
            self.vad.accept_waveform(window)
            self.speech = self.speech or self.vad.is_speech_detected()
            if not self.vad.empty():
                self.ended = True
                self.vad.pop()
        return self.ended

    def finish(self):
        if len(self.pending):
            self.feed(np.zeros(512 - len(self.pending), dtype=np.float32))
        self.vad.flush()
        self.speech = self.speech or not self.vad.empty()
        return self.speech

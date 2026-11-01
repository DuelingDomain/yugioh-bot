"""Fetch only required model files into an external, ignored model directory."""
import argparse
import os
from pathlib import Path
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3]
MODEL_ROOT = Path(os.environ.get('STT_MODEL_DIR', ROOT / 'data/stt-models'))
MODELS = {
    'parakeet': ('csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
                 '2bda32ec70b097a55adaa07d9a7173915b43cc78',
                 ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']),
    'zipformer': ('csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26',
                  '672fbf1b30579d6585301139bb363f42a0ad4a24',
                  ['encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
                   'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
                   'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx', 'tokens.txt', 'bpe.model']),
    'whisper': ('mobiuslabsgmbh/faster-whisper-large-v3-turbo',
                '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
                ['config.json', 'model.bin', 'preprocessor_config.json', 'tokenizer.json', 'vocabulary.json']),
}

def download(name: str) -> Path:
    repo, revision, files = MODELS[name]
    target = MODEL_ROOT / name
    for filename in files:
        if not (target / filename).is_file():
            hf_hub_download(repo, filename, revision=revision, local_dir=target)
    return target

def download_vad() -> Path:
    target = MODEL_ROOT / 'silero_vad.onnx'
    if not target.is_file():
        import urllib.request
        MODEL_ROOT.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.partial')
        # Official sherpa-onnx ASR model release (Silero v5, 512-sample windows).
        urllib.request.urlretrieve('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', temporary)
        temporary.replace(target)
    return target

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', choices=list(MODELS), default=['parakeet', 'zipformer'])
    args = parser.parse_args()
    for name in args.models:
        print(download(name), flush=True)
    print(download_vad(), flush=True)

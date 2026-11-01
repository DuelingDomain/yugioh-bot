"""Generate a fixed 40-clip local Piper corpus (no network TTS)."""
import argparse
import hashlib
import json
from pathlib import Path
import wave
import numpy as np
from huggingface_hub import hf_hub_download
from piper import PiperVoice, SynthesisConfig

PHRASES = [
    'Blue-Eyes White Dragon attacks Dark Magician',
    'moving to standby phase',
    'I activate Ash Blossom and Joyous Spring',
    'take 2400 damage',
    'Imran attack directly',
    'I summon Dark Magician',
    'I activate Infinite Impermanence',
    'I activate Called by the Grave',
    'I summon Nibiru the Primal Being',
    'I discard Effect Veiler',
    'I summon Red-Eyes Black Dragon',
    'I activate Monster Reborn',
    'I activate Pot of Prosperity',
    'I summon Swordsoul of Mo Ye',
    'I summon Kashtira Fenrir',
    'I activate Droll and Lock Bird',
    'go to battle phase',
    'end my turn',
    'take eight hundred damage',
    'I summon Accesscode Talker',
]
CARDS = ['Blue-Eyes White Dragon', 'Dark Magician', 'Ash Blossom & Joyous Spring',
         'Infinite Impermanence', 'Called by the Grave', 'Nibiru, the Primal Being',
         'Effect Veiler', 'Red-Eyes Black Dragon', 'Monster Reborn', 'Pot of Prosperity',
         'Swordsoul of Mo Ye', 'Kashtira Fenrir', 'Droll & Lock Bird', 'Accesscode Talker']
VOICES = ['en_US-lessac-medium', 'en_GB-alan-medium']
# Source revision also recorded in manifest for exact re-generation.
VOICE_REVISION = 'b4e358ffcb232591bf73a540e70f7de528e4174a'

def write_wav(path, audio):
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())

def synthesize(voice, phrase, work, speed=1.0):
    raw = work / 'synthesis.wav'
    with wave.open(str(raw), 'wb') as wav:
        voice.synthesize_wav(phrase, wav, syn_config=SynthesisConfig(length_scale=speed))
    with wave.open(str(raw)) as wav:
        rate = wav.getframerate()
        audio = np.frombuffer(wav.readframes(wav.getnframes()), '<i2').astype(np.float32) / 32768
    # Linear sample-rate conversion only; no temporal compression of test utterances.
    output = np.interp(np.arange(round(len(audio) * 16000 / rate)) * rate / 16000, np.arange(len(audio)), audio)
    return output.astype(np.float32)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('data/stt-benchmark'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    clips = []
    voice_sources = []
    for v, name in enumerate(VOICES):
        lang = name.split('_')[0]
        _, speaker, quality = name.split('-')
        folder = f'{lang}/{name.split("-")[0]}/{speaker}/{quality}/{name}'
        paths = [hf_hub_download('rhasspy/piper-voices', folder + suffix, revision=VOICE_REVISION,
                               local_dir=args.output / 'voices') for suffix in ['.onnx', '.onnx.json']]
        voice_sources.append({'voice': name, 'sha256': hashlib.sha256(Path(paths[0]).read_bytes()).hexdigest()})
        voice = PiperVoice.load(paths[0], use_cuda=False)
        for i, phrase in enumerate(PHRASES):
            audio = synthesize(voice, phrase, args.output)
            name_wav = f'{v:02d}-{i:02d}.wav'
            write_wav(args.output / name_wav, audio)
            clips.append({'file': name_wav, 'voice': name, 'reference': phrase, 'duration': len(audio) / 16000,
                          'sha256': hashlib.sha256((args.output / name_wav).read_bytes()).hexdigest()})
        if v == 0:
            probes = []
            for duration, phrase, speed in [(1, 'end turn', 0.75), (3, 'moving to standby phase', 0.90)]:
                audio = synthesize(voice, phrase, args.output, speed)
                # Trim Piper trailing silence, never speech, before zero-padding to fixed duration.
                active = np.flatnonzero(np.abs(audio) > 0.008)
                audio = audio[max(0, active[0] - 320):min(len(audio), active[-1] + 640)]
                if len(audio) > duration * 16000:
                    raise ValueError(f'Probe does not fit {duration}s without cutting speech')
                audio = np.pad(audio, (0, duration * 16000 - len(audio)))
                filename = f'probe-{duration}s.wav'; write_wav(args.output / filename, audio)
                probes.append({'file': filename, 'duration': duration, 'reference': phrase})
        print(f'Generated {len(clips)} clips', flush=True)
    (args.output / 'synthesis.wav').unlink(missing_ok=True)
    manifest = {'tts': 'piper-tts 1.3.0', 'voiceRevision': VOICE_REVISION, 'voices': voice_sources,
                'hotwords': CARDS, 'clips': clips, 'probes': probes}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

if __name__ == '__main__':
    main()

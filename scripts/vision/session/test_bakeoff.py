"""Lean real-data gate scenario; stdlib only, no model downloads."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


class DataGate(unittest.TestCase):
    def test_real_review_and_session_separation_before_training(self):
        target = Path(__file__).with_name('bakeoff.py')
        self.assertTrue(target.exists(), 'real-data gate is not implemented')
        spec = importlib.util.spec_from_file_location('bakeoff', target)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = {'sessions': [], 'crops': []}
            path = root / 'manifest.json'
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, 'real'):
                mod.validate_manifest(path)
            for split in ('train', 'calibration', 'test'):
                (root / f'{split}.webm').write_bytes(f'local video {split}'.encode())
                labels = {'id': split, 'source': 'real', 'reviewed': True,
                          'durationMs': 1000, 'video': f'{split}.webm',
                          'decklist': ['1'], 'events': [{'reviewed': True, 'cardId': '1', 'instanceId': 'a'}]}
                (root / f'{split}.json').write_text(json.dumps(labels))
                config['sessions'].append({'labels': f'{split}.json', 'split': split, 'condition': split})
                for card in ('1', None):
                    config['crops'].append({'sessionId': split, 'atMs': 100 if card else 200, 'cardId': card,
                                            'imageId': '1', 'instanceId': 'a' if card else 'negative',
                                            'quad': [[.1,.1],[.8,.1],[.8,.8],[.1,.8]]})
            path.write_text(json.dumps(config))
            self.assertEqual(len(mod.validate_manifest(path)['sessions']), 3)
            config['sessions'].append({'labels': 'train.json', 'split': 'test', 'condition': 'test'})
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, 'session'):
                mod.validate_manifest(path)
            config['sessions'].pop()
            labels = json.loads((root / 'test.json').read_text())
            labels['source'] = 'synthetic'
            (root / 'test.json').write_text(json.dumps(labels))
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, 'real'):
                mod.validate_manifest(path)


if __name__ == '__main__':
    unittest.main()

"""One lean generator feature test; requires only numpy and OpenCV, no GPU."""
import unittest
import tempfile
import cv2
import numpy as np
from pathlib import Path
from webcam_scenes import assets, card_split, load_scene, render_frame


class WebcamGeneratorTest(unittest.TestCase):
    def test_native_labels_and_grouped_deterministic_scenes(self):
        identities = {'art1': 'same-card', 'art2': 'same-card'}
        self.assertEqual(card_split(Path('art1.jpg'), identities), card_split(Path('art2.jpg'), identities))
        pool, scene = assets('train'), load_scene()
        a, objects, kind = render_frame(pool, np.random.default_rng(633), W=320, H=180, kind='black')
        b, _, _ = render_frame(pool, np.random.default_rng(633), W=320, H=180, kind='black')
        self.assertEqual(a.shape, (180, 320, 3))
        np.testing.assert_array_equal(a, b)
        self.assertEqual(kind, 'black')
        self.assertTrue(objects)
        rows = np.asarray([scene.row_of(scene.label_of(o, o.visible), o, 0, 0) for o in objects])
        self.assertEqual(rows.shape[1], 14)
        self.assertTrue(np.isfinite(rows).all())
        with tempfile.TemporaryDirectory() as folder:
            square = Path(folder) / 'square-art.jpg'
            cv2.imwrite(str(square), np.zeros((32, 32, 3), np.uint8))
            with self.assertRaisesRegex(ValueError, 'portrait'):
                pool._read(square)


if __name__ == '__main__':
    unittest.main()

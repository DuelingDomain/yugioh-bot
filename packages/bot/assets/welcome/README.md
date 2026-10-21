# First Pull welcome card

`first-pull.svg` is the approved **B — First Pull** design from `.fx-demo/welcome-cards/B.svg`, with tokens for avatar artwork, display name, name size and member number. Keep its geometry, gradients, gold frame, fanned backs and brand paths intact when updating the renderer.

The three TTF files are converted without changing outlines from the repository's `site/public/fonts` WOFF2 Latin subsets. Chakra Petch uses weights 500 and 700; Russo One uses weight 400. Both are distributed under the SIL Open Font License 1.1; their complete licence texts are alongside the fonts. No system or remote fonts are used at runtime.

To reproduce from the repository root (Python `fonttools` and `brotli` required):

```python
from pathlib import Path
from fontTools.ttLib import TTFont

source = Path("site/public/fonts")
target = Path("packages/bot/assets/welcome/fonts")
for name in ("chakra-petch-500-latin", "chakra-petch-700-latin", "russo-one-400-latin"):
    font = TTFont(source / f"{name}.woff2")
    font.flavor = None
    font.save(target / f"{name}.ttf")
```

Copy `chakra-petch-OFL.txt` and `russo-one-OFL.txt` unchanged from the source directory. `render.cjs` runs resvg in a fresh worker per card to release native bitmaps before the next render. It probes downloaded avatars on a transparent canvas and uses gradient initials for undecodable or fully transparent images.

The renderer uses OpenType advances and kerning for sizing, strips emoji/unsupported glyphs, and uses “Duelist” when no supported characters remain. It does not claim to render arbitrary scripts.

// Render the original SVG table diagram used in the trailer slot. Requires sharp.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
await sharp(fileURLToPath(new URL('arena-poster.svg', import.meta.url)))
  .webp({ quality: 85 })
  .toFile(fileURLToPath(new URL('../public/assets/arena-poster.webp', import.meta.url)));

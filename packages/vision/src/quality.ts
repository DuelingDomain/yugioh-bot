import { cropRGBA, type RGBAImage } from './pixels';
import type { GameProfile, Point } from './types';
/** Population variance of the 4-neighbour Laplacian of luma (0..255). */
export function sharpness(img: RGBAImage, click?: Point): number {
  // Score near the clicked card: desk texture should not win the frame vote.
  const region = click ? cropRGBA(img, (click.x - 0.16) * img.width, (click.y - 0.2) * img.height, img.width * 0.32, img.height * 0.4) : img;
  if (region.width < 3 || region.height < 3) return 0;
  const { width: w, height: h, data } = region;
  const gray = (i: number) => .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = gray(i - 1) + gray(i + 1) + gray(i - w) + gray(i + w) - 4 * gray(i);
    sum += l; sq += l * l; n++;
  }
  return Math.max(0, sq / n - (sum / n) ** 2);
}
export function classifyBorder(img: RGBAImage, profile: GameProfile): string | undefined {
  const colors: number[][] = [];
  for (const box of profile.borderSamples) {
    const crop = cropRGBA(img, box.x * img.width, box.y * img.height, box.w * img.width, box.h * img.height);
    for (let i = 0; i < crop.data.length; i += 16) {
      const rgb = [crop.data[i], crop.data[i + 1], crop.data[i + 2]];
      // Discard highlights and near-black outlines; Xyz remains eligible from dark grey.
      if (Math.max(...rgb) < 245 && Math.max(...rgb) > 25) colors.push(rgb);
    }
  }
  if (!colors.length) return undefined;
  const rgb = [0, 1, 2].map(c => colors.map(v => v[c]).sort((a, b) => a - b)[Math.floor(colors.length / 2)]);
  const ranked = profile.frameClasses.map(c => ({ id: c.id, d: Math.hypot(...rgb.map((v, i) => v - c.rgb[i])) })).sort((a, b) => a.d - b.d);
  return ranked[0] && ranked[0].d < 65 && (ranked[1]?.d ?? 999) - ranked[0].d > 12 ? ranked[0].id : undefined;
}

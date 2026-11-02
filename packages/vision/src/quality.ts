import { cropRGBA, type RGBAImage } from './pixels';
import type { GameProfile, Point } from './types';
/** Population variance of the 4-neighbour Laplacian of luma (0..255). */
export function sharpness(img: RGBAImage, click?: Point): number {
  // Score near the clicked card: desk texture should not win the frame vote.
  const {width:w,height:h,data}=img;
  const x0=click?Math.max(0,Math.floor((click.x-.16)*w)):0;
  const y0=click?Math.max(0,Math.floor((click.y-.2)*h)):0;
  const x1=click?Math.min(w,Math.floor((click.x-.16)*w+w*.32)):w;
  const y1=click?Math.min(h,Math.floor((click.y-.2)*h+h*.4)):h;
  if(x1-x0<3 || y1-y0<3)return 0;
  const gray = (i: number) => .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
  let sum = 0, sq = 0, n = 0;
  for (let y = y0+1; y < y1-1; y++) for (let x = x0+1; x < x1-1; x++) {
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

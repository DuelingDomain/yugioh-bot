import * as THREE from "three";
import { cardArtUrl } from "../constants";

/**
 * Card art textures for the embodiment. Small art is usually in the browser cache already (the
 * board shows it); the full image is sharper. Both start loading on `prefetch`, and `peek` returns
 * the best one that has arrived. A small LRU keeps GPU memory bounded.
 */
const MAX_TEXTURES = 16;

type Entry = { full: THREE.Texture | null; small: THREE.Texture | null; failed: boolean };

export class ArtStore {
  private readonly entries = new Map<number, Entry>();
  private disposed = false;

  prefetch(code: number): void {
    if (this.disposed || code <= 0) return;
    const known = this.entries.get(code);
    if (known) {
      // Touch: most recently used goes last.
      this.entries.delete(code);
      this.entries.set(code, known);
      return;
    }
    const entry: Entry = { full: null, small: null, failed: false };
    this.entries.set(code, entry);
    this.load(cardArtUrl(code, "small"), (texture) => {
      entry.small = texture;
    });
    this.load(cardArtUrl(code, "full"), (texture) => {
      entry.full = texture;
    });
    while (this.entries.size > MAX_TEXTURES) {
      const oldest = this.entries.keys().next().value as number;
      this.drop(oldest);
    }
  }

  /** The best texture loaded so far (full, else small), or null. */
  peek(code: number): THREE.Texture | null {
    const entry = this.entries.get(code);
    return entry?.full ?? entry?.small ?? null;
  }

  private load(url: string, done: (texture: THREE.Texture) => void): void {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (this.disposed) return;
      const texture = new THREE.Texture(image);
      // Colours pass through untouched: the shaders work in display space.
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      done(texture);
    };
    image.onerror = () => undefined;
    image.src = url;
  }

  private drop(code: number): void {
    const entry = this.entries.get(code);
    entry?.full?.dispose();
    entry?.small?.dispose();
    this.entries.delete(code);
  }

  dispose(): void {
    this.disposed = true;
    for (const code of [...this.entries.keys()]) this.drop(code);
  }
}

export type Asset = { url: string; sha256: string; bytes: number };
export type Manifest = { version: 1; release: string; cards: number; fingerprint: string; files: Record<string, Asset> };
export const assetNames: readonly string[];
export const manifestPath: string;
export function sha256(bytes: Uint8Array | string): string;
export function assetUrl(release: string, name: string): string;
export function readManifest(path?: string): Promise<Manifest | null>;

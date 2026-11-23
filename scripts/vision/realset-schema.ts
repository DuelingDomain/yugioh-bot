import { createHash } from 'node:crypto';
import type { Quad } from '../../packages/vision/src/geometry';

export const REALSET_SCHEMA = 'vision-realset/1';
export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export interface CardLabel {
  quad: Quad;
  cardId: string | null;
  name?: string;
  face: 'up' | 'down' | 'unknown';
  position: 'upright' | 'sideways' | 'other' | 'unknown';
  zone?: string;
  status: 'verified' | 'uncertain';
  provenance: 'player-confirmed' | 'board-agreed' | 'hand-labeled';
  evidence?: string;
}
export interface ClipRef { id: string; file: string; source: string }
export interface FrameLabels {
  clip: string;
  atMs: number;
  file: string;
  cards: CardLabel[];
  /** Regions excluded from the phantom count, e.g. deck stacks or a screen. */
  ignore: Quad[];
}
interface FileHash { sha256: string }
export interface RealsetManifest {
  schema: typeof REALSET_SCHEMA;
  version: string;
  clips: (ClipRef & FileHash)[];
  frames: (FrameLabels & FileHash)[];
}

const clipPath = /^clips\/[\w.-]+\.(webm|mp4)$/;
const framePath = /^frames\/[\w.-]+\.png$/;
const digest = /^[a-f0-9]{64}$/;

function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Real set: ${message}`);
}

const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

function checkQuad(quad: Quad, where: string) {
  requireValue(Array.isArray(quad) && quad.length === 4 && quad.every(p => p &&
    Number.isFinite(p.x) && p.x >= 0 && p.x <= 1 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1),
  `${where} needs four normalized corners`);
  const clockwise = quad.every((p, i) => {
    const a = quad[(i + 1) % 4], b = quad[(i + 2) % 4];
    return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x) > 0;
  });
  requireValue(clockwise, `${where} needs a convex quad in clockwise order`);
}

function validateAnnotations(input: unknown): asserts input is Omit<RealsetManifest, 'schema' | 'clips' | 'frames'> & { clips: ClipRef[]; frames: FrameLabels[] } {
  const value = input as RealsetManifest;
  requireValue(value && typeof value.version === 'string' && /^v[1-9]\d*$/.test(value.version), 'expected a version such as v1');
  requireValue(Array.isArray(value.clips) && value.clips.length > 0, 'expected clips');
  requireValue(Array.isArray(value.frames) && value.frames.length > 0, 'expected frames');
  const clipIds = new Set<string>(), files = new Set<string>(), times = new Set<string>();
  for (const clip of value.clips) {
    requireValue(clip && typeof clip.id === 'string' && /^[\w-]+$/.test(clip.id) && typeof clip.file === 'string' &&
      clipPath.test(clip.file) && nonempty(clip.source), 'invalid clip id, file or source');
    requireValue(!clipIds.has(clip.id) && !files.has(clip.file), `duplicate clip ${clip.id} or file ${clip.file}`);
    clipIds.add(clip.id);
    files.add(clip.file);
  }
  for (const frame of value.frames) {
    requireValue(frame && typeof frame.file === 'string' && framePath.test(frame.file) &&
      clipIds.has(frame.clip) && Number.isSafeInteger(frame.atMs) && frame.atMs >= 0, 'invalid frame file, clip or time');
    const when = `${frame.clip}@${frame.atMs}`;
    requireValue(!times.has(when) && !files.has(frame.file), `duplicate frame ${when} or file ${frame.file}`);
    files.add(frame.file);
    times.add(when);
    requireValue(Array.isArray(frame.cards) && Array.isArray(frame.ignore), `${when} requires cards and ignore lists`);
    for (const quad of frame.ignore) checkQuad(quad, when);
    for (const card of frame.cards) {
      requireValue(card && ['verified', 'uncertain'].includes(card.status) &&
        ['up', 'down', 'unknown'].includes(card.face) && ['upright', 'sideways', 'other', 'unknown'].includes(card.position) &&
        ['player-confirmed', 'board-agreed', 'hand-labeled'].includes(card.provenance), `${when} has an invalid card label`);
      checkQuad(card.quad, when);
      if (card.status === 'verified' && card.face === 'up') {
        requireValue(typeof card.cardId === 'string' && /^[0-9]+$/.test(card.cardId) && nonempty(card.name),
          `${when} requires a card id and name for a verified face-up card`);
      } else {
        requireValue(card.cardId === null && card.name === undefined, `${when} requires a null identity for a face-down or uncertain card`);
        if (card.status === 'verified') requireValue(card.face === 'down', `${when} requires a known face for a verified card`);
      }
    }
  }
}

export function makeManifest(input: unknown, hashes: ReadonlyMap<string, string>): RealsetManifest {
  validateAnnotations(input);
  const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const seal = <T extends { file: string }>(entry: T): T & FileHash => {
    const hash = hashes.get(entry.file);
    requireValue(hash && digest.test(hash), `missing SHA-256 for ${entry.file}`);
    return { ...entry, sha256: hash };
  };
  return {
    schema: REALSET_SCHEMA, version: input.version,
    clips: [...input.clips].sort((a, b) => byId(a.id, b.id)).map(seal),
    frames: [...input.frames].sort((a, b) => byId(a.clip, b.clip) || a.atMs - b.atMs).map(seal),
  };
}

export function parseManifest(input: unknown): RealsetManifest {
  validateAnnotations(input);
  const manifest = input as RealsetManifest;
  requireValue(manifest.schema === REALSET_SCHEMA, `expected schema ${REALSET_SCHEMA}`);
  for (const { file, sha256: hash } of [...manifest.clips, ...manifest.frames]) {
    requireValue(typeof hash === 'string' && digest.test(hash), `invalid SHA-256 for ${file}`);
  }
  return manifest;
}

export function annotationFiles(input: unknown): string[] {
  validateAnnotations(input);
  return [...input.clips, ...input.frames].map(x => x.file);
}

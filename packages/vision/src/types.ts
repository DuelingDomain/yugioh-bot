/** Data-only contracts: another game can supply these without changing the engine. */
export interface Point { x: number; y: number }
export interface FractionalBox { x: number; y: number; w: number; h: number }
export interface ConfidenceThresholds {
  score: number; margin: number; floor: number;
  second?: { score: number; margin: number }; cardBackMargin?: number;
}
export type RecognitionTier = 'sure' | 'not sure' | 'low match';
export interface EmbeddingModelSpec {
  thresholds: ConfidenceThresholds; maxBatch?: number;
  id: string; url: string; sha256: string; inputSize: number; dim: number;
  inputName: string; outputName: string; pooling: 'none' | 'cls';
  mean: [number, number, number]; std: [number, number, number];
}
export interface GameProfile {
  id: string;
  card: { width: number; height: number; warpWidth: number; warpHeight: number };
  artWindow: FractionalBox;
  /** Optional alternative windows (e.g. full-art variants); all use the same artwork index. */
  alternateArtWindows?: FractionalBox[];
  fullArtIndex?: { indexUrl: string; metaUrl: string };
  cardBack: { cardId: string; imageUrl: string };
  /** Border sample windows avoid art, text and sleeves. RGB prototypes are conservative hints. */
  frameClasses: { id: string; rgb: [number, number, number] }[];
  borderSamples: FractionalBox[];
  textBoxColor?: [number, number, number];
  indexUrl: string; metaUrl: string;
  thresholdsUrl?:string;
  embedding: EmbeddingModelSpec;
  detector: { url: string; sha256: string; longSide: number };
  /** Missed detection: card height as a fraction of frame height. */
  fallbackHeight: number;
}
export interface RecognitionPriors {
  decklist?: string[]; seen?: string[]; voiceMentioned?: string[];
  /** Explicit caller restriction; inferred border colour remains a soft filter. */
  frameClasses?: string[];
}
export interface DetectedQuad { quad: Point[]; kind: 'face-up' | 'face-down'; confidence: number; partial: boolean; covered?: boolean }
export type BoardSide = 'near' | 'far';
export interface PeekOptions { card: DetectedQuad; cards?: DetectedQuad[]; priors?: RecognitionPriors; signal?: AbortSignal }
export interface PeekResult {
  cardId?: string; name: string | null; tier: RecognitionTier; faceDown: boolean; covered: boolean;
}
export interface BoardCard extends PeekResult { outline: DetectedQuad; index: number; side: BoardSide; error?: string }
export interface ReadAllOptions { cards?: DetectedQuad[]; priors?: RecognitionPriors; signal?: AbortSignal }
export interface BoardResult { near: BoardCard[]; far: BoardCard[]; timingsMs: { detect: number; total: number } }
export interface RecognizeOptions { clickPoint?: Point; k?: number; priors?: RecognitionPriors; card?: DetectedQuad; includeCrop?: boolean; includeFeedback?: boolean; /** Live clicks inspect the single sharpest recent frame. Default: three-frame fusion. */ maxFrames?: 1 | 3; /** Retain raw decision evidence for offline threshold replay. */ includeRaw?: boolean; /** Disable temporal early exit for calibration/motion audits. */ earlyExit?: boolean }
export interface Candidate { cardId: string; score: number }
export interface RecognitionResult {
  candidates: Candidate[];
  /** Normalized outline in the sharpest successfully read frame; absent for fallback crops. */
  detectedCard?: DetectedQuad;
  /** Present only on request; never uploaded automatically. */
  cropJpeg?: string;
  /** Separate high-resolution source warp for explicit AI reads. */
  aiCropJpeg?: string;
  aiCandidateNames?: string[];
  aiWarpedCard?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  raw?: RecognitionEvidence;
  /** Core-only pixels; worker converts to JPEG and removes these. */
  warpedCard?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  feedback?: { embedding:number[];gameId:string;modelId:string;modelSha256:string;indexVersion:string;layoutKey:string;space:'art-box'|'whole-card';deltaVersion:string };
  tier: RecognitionTier;
  quality: { sharpness: number; detected: boolean; cornersFound: boolean; framesUsed: number; selectedFrameIndices: number[]; frameClass?: string; fallback: boolean; fullArt?: boolean; fullArtReferences?: number; partial?: boolean; covered?: boolean; confusionChecked?:boolean; faceDown?:boolean; framesAgree?:boolean; notInDecklist?:boolean; hypothesis?: 'art-box' | 'whole-card' };
  timingsMs: { sharpness: number; detect: number; warp: number; embed: number; search: number; total: number };
  backend: 'webgpu' | 'wasm';
  /** Worker diagnostics; absent when the core pipeline is used directly. */
  runtime?: { crossOriginIsolated: boolean; wasmThreads: number; simd: boolean };
}
export interface IndexEntry { cardId: string; passcode: number; name: string; imageId?: number; frameClass?: string; imageUrl?: string; thumbnailUrl?: string }
export interface IndexMeta { version: 1; gameId?: string; layoutKey?: string; modelId: string; modelSha256: string; dim: number; count: number; dtype: 'float32' | 'int8'; quant?: 'float32' | 'int8'; builtAt?: string; entries: IndexEntry[]; generatedAt?: string; catalog?: string }
export interface LoadedIndex { meta: IndexMeta; vectors: Float32Array | Int8Array }

/** Scores before thresholds, with all non-threshold safety decisions frozen. */
export interface RecognitionEvidence {
  visual: Candidate[]; ranked?:Candidate[]; winnerId?: string; cardBackId: string; blocked: string[];
  frames: { frameIndex:number; hypotheses?:Candidate[][]; clean:Candidate[]; ranked:Candidate[]; deck:Candidate[]; faceDown:boolean; eligible:boolean }[];
  thresholds: ConfidenceThresholds; modelId:string; modelSha256:string; indexVersion:string; layoutKey:string; learningVersion:string;
  priors?:RecognitionPriors; earlyExit:boolean;
}

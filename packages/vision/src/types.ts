import type {FieldIdentityEntry} from './field-gallery';
/** Data-only contracts: another game can supply these without changing the engine. */
export interface Point { x: number; y: number }
export interface FractionalBox { x: number; y: number; w: number; h: number }
export interface ConfidenceThresholds {
  score: number; margin: number; floor: number;
  second?: { score: number; margin: number }; cardBackMargin?: number;
}
export type RecognitionTier = 'sure' | 'not sure' | 'low match';
/** A WebGPU graph. `url` is half precision (needs shader-f16) unless `precision` is 'fp32'; `fp32` is the float32 graph for adapters without shader-f16 or a half-precision graph that fails. */
export interface ModelVariant { url: string; sha256: string; precision?: 'fp16' | 'fp32'; fp32?: { url: string; sha256: string } }
export interface WebGpuDiagnostics {
  navigatorGpu: boolean; secureContext: boolean; worker: boolean;
  adapter?: Record<string, string | boolean>; features?: string[];
  limits?: Record<string, number>; deviceLimits?: Record<string, number>;
  attempts: string[]; modelPath?: string;
}
export interface BackendStatus {
  backend: 'webgpu' | 'wasm'; fallbackReason?: string;
  models: { model: string; backend: 'webgpu' | 'wasm'; fallbackReason?: string; gpu?: WebGpuDiagnostics }[];
}
export interface PrepareOptions { priors?: RecognitionPriors; sessionGallery?: {cardId:string;embedding:{values:number[];space:'art-box'|'whole-card'}}[] }
export interface EmbeddingModelSpec {
  /** Parity-checked alternate weights; does not change index identity. */
  webgpu?: ModelVariant;
  /** Output check for the half-precision WebGPU graph: the float32 graph's L2-normalised vector for the fixed check input (gpu-check.ts), and the lowest cosine a WebGPU run may have with it. */
  gpuCheck?: { reference: readonly number[]; minCosine: number };
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
  detector: { url: string; sha256: string; longSide: number; webgpu?: ModelVariant };
  /** Missed detection: card height as a fraction of frame height. */
  fallbackHeight: number;
}
export interface RecognitionPriors {
  decklist?: string[]; seen?: string[]; voiceMentioned?: string[];
  /** Epoch time, checked when ranking so a queued read cannot revive an expired hint. */
  voiceExpiresAt?: number;
  related?: { cardId: string; reason: string }[];
  /** Explicit caller restriction; inferred border colour remains a soft filter. */
  frameClasses?: string[];
}
export interface DetectedQuad { quad: Point[]; kind: 'face-up' | 'face-down'; confidence: number; partial: boolean; covered?: boolean; /** Kept only to hold an existing card (low-score hysteresis or the shadow-lifted pass); never starts a new card. */ kept?: boolean; /** Kept only because it sits in a calibrated Deck/Extra cell (pile floor); may score below the pile floor (debug probe). */ pile?: boolean; /** A face-down outline below minConfidence kept because it sits in a calibrated field zone cell (light sleeves score low); the watcher also needs a sleeve colour unlike the mat. */ cell?: boolean }
/** Detector call options for the field watcher. `keep`: outlines of cards already on the field (their low-score outlines stay). `piles`: calibrated Deck/Extra cells (a stack there keeps a lower-score outline). `cells`: calibrated field zone cells (a face-down card there keeps a lower-score outline). */
export interface DetectOptions { /** Live plausible tracks eligible for shadow rescue; defaults to keep. */ shadowKeep?: Point[][]; /** false: skip the second, shadow-lifted pass for lost known cards (the watcher saw no shadow and its retry timer is not due). */ shadowPass?: boolean; region?: FractionalBox; keep?: Point[][]; piles?: Point[][]; cells?: Point[][] }
export type BoardSide = 'near' | 'far';
export interface PeekOptions { card: DetectedQuad; cards?: DetectedQuad[]; priors?: RecognitionPriors; signal?: AbortSignal }
export interface PeekResult {
  cardId?: string; name: string | null; tier: RecognitionTier; faceDown: boolean; covered: boolean;
}
export interface BoardCard extends PeekResult { outline: DetectedQuad; index: number; side: BoardSide; error?: string }
export interface ReadAllOptions { cards?: DetectedQuad[]; priors?: RecognitionPriors; signal?: AbortSignal }
export interface BoardResult { near: BoardCard[]; far: BoardCard[]; timingsMs: { detect: number; total: number } }

export interface RecognizeOptions {
  /** Light/glare pre-clean A/B on unsure or glare reads. Default: on; false reads only the raw crop. */
  preclean?: boolean;
  /** Serializable session identities (e.g. fieldGallery.entries()); absent by default. */
  gallery?: readonly FieldIdentityEntry[];
  /** Allow strong unboosted priors.decklist matches to skip catalog search. Default: true. */
  deckFirst?: boolean;
  /** Minimum unboosted gallery gap (default .02); deck exits require at least .08. */
  earlyExitMargin?: number;
  /** Normalized source region, including neighbouring-card margin; detector uses a 448px crop. */ region?: FractionalBox; /** Consume ImageData buffers instead of copying them. */ transferFrames?: boolean; clickPoint?: Point; k?: number; priors?: RecognitionPriors; card?: DetectedQuad; includeCrop?: boolean; /** Small decision crop only; no AI source retention or feedback collection. */ includeDiagnosticCrop?:boolean; /** Keep AI source pixels in the worker; warp/encode only for an explicit askAI call. */ deferAICrop?:boolean; includeFeedback?: boolean; /** Reuse clean visual evidence for local identity tracking without retaining pixels. */ includeIdentityEmbedding?: boolean; /** Live clicks inspect the single sharpest recent frame. Default: three-frame fusion. */ maxFrames?: 1 | 3; /** Permit a clean upright answer to skip the reverse view, including when retaining raw evidence. */ preferUpright?:boolean; /** Retain raw decision evidence for offline threshold replay. */ includeRaw?: boolean; /** Disable temporal and gallery/deck early exits for calibration/motion audits. */ earlyExit?: boolean; /** Feed clicks require an actual detected card. */ regionFallback?: boolean
}
export interface Candidate { cardId: string; score: number; prior?: string }
export interface RecognitionResult {
  candidates: Candidate[];
  /** Bounded ranking reason; confidence always uses raw visual evidence. */
  prior?: string;
  /** Normalized outline in the sharpest successfully read frame; absent for fallback crops. */
  detectedCard?: DetectedQuad;
  /** Present only on request; never uploaded automatically. */
  cropJpeg?: string;
  /** Separate high-resolution source warp for explicit AI reads. */
  aiCropJpeg?: string;
  /** Worker-scoped handle to at most six retained AI sources (64 MiB total). Never uploaded. */
  aiCropToken?:string;
  aiCandidateNames?: string[];
  aiWarpedCard?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  raw?: RecognitionEvidence;
  /** Core-only pixels; worker converts to JPEG and removes these. */
  warpedCard?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  feedback?: { embedding:number[];gameId:string;modelId:string;modelSha256:string;indexVersion:string;layoutKey:string;space:'art-box'|'whole-card';deltaVersion:string };
  /** Opt-in clean visual reference for local tracking; never uploaded or broadcast automatically. */
  identityEmbedding?: { values:number[];space:'art-box'|'whole-card' };
  tier: RecognitionTier;
  quality: { searchSource?: 'deck' | 'dynamic' | 'likely' | 'gallery' | 'catalog'; sharpness: number; detected: boolean; cornersFound: boolean; framesUsed: number; selectedFrameIndices: number[]; frameClass?: string; fallback: boolean; fullArt?: boolean; fullArtReferences?: number; partial?: boolean; covered?: boolean; confusionChecked?:boolean; faceDown?:boolean; framesAgree?:boolean; notInDecklist?:boolean; hypothesis?: 'art-box' | 'whole-card' };
  timingsMs: { sharpness: number; detect: number; warp: number; embed: number; search: number; total: number; queue?:number; pixels?:number; encode?:number; worker?:number; roundTrip?:number; /** Embedder split (profile): tensor preprocess, session run incl. output readback, and how many crops ran. */ embedPreprocess?:number; embedRun?:number; embedCount?:number; /** Main thread: frame clone before transfer, and postMessage→reply wait outside the worker. */ clone?:number; transfer?:number; /** Light/glare pre-clean (Debug line): crop cost, glare %, 1 when the clean crop won, applied RGB gains. */ precleanMs?:number; precleanGlare?:number; precleanShadow?:number; precleanUsed?:number; precleanGainR?:number; precleanGainG?:number; precleanGainB?:number };
  backend: 'webgpu' | 'wasm';
  /** Light/glare pre-clean report for the Debug line: glare share, applied RGB gains and which crop won. */
  preclean?: { on: boolean; glare?: number; shadow?: number; gains?: [number, number, number]; ms?: number; used: 'raw' | 'clean'; rawScore?: number; cleanScore?: number };
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
  /** Set when the answer came from a closed set (deck list, cards confirmed in this duel, cards related to them) and passed its accept bar. */
  closedSet?:'deck'|'dynamic'|'likely';
}

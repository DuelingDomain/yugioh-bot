export { createRecognizer } from './client';
export type { Recognizer, RecognizerConfig, AIReading } from './client';
export { yugioh } from './games/yugioh';
export type { GameProfile, ConfidenceThresholds, RecognitionTier, EmbeddingModelSpec, RecognizeOptions, RecognitionPriors, RecognitionResult, Candidate, IndexMeta, IndexEntry } from './types';

export { hitTestQuad } from './scene';
export type { DetectedQuad } from './types';
export type { PeekOptions, PeekResult, ReadAllOptions, BoardResult, BoardCard, BoardSide } from './types';

export type { FeedbackSource } from './client';

export {createOwnFeedBuffer} from './frame-buffer';
export {toRemoteRecognitionResult} from './remote-result';
export {catalogCardId,isPhysicalEntry,filterPhysicalIndex,PHYSICAL_INDEX_POLICY} from './physical-index';
export {replayTier} from './decision';
export type {RemoteRecognitionResult} from './remote-result';
export type {RecognitionEvidence} from './types';

export type {RealsetSample,RealsetExport} from './calibration';

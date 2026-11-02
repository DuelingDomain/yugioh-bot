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

export {createFieldWatcher} from './field-watcher';
export type {FieldWatcher,FieldWatcherOptions,FieldEvent,FieldTiming,FieldTrack,FieldSnapshot,FieldMetrics,FieldBuffer,KnownFieldCard} from './field-watcher';
export {DEFAULT_FIELD_ORIENTATION,rotateFieldCalibration,mirrorFieldCalibration,orientFieldFromHands,createFieldCalibration,createTwoCardCalibration,fieldMatPoint,onMat,mapFieldZone,fieldOrientation,fieldZoneLocation,hasExtraMonsterZones} from './field-zones';
export type {FieldZone,FieldCalibration,FieldFormat,FieldOrientation,PlayerSide} from './field-zones';

export {createFieldIdentityGallery} from './field-gallery';
export type {FieldIdentityGallery,FieldIdentityEntry} from './field-gallery';

export {classifyFaceState,isLikelyFaceDown,createFaceStateHysteresis} from './face-state';
export type {FaceState,FaceStateResult,FaceStateEmbedding,FaceStateOptions} from './face-state';

export type {PrepareOptions, FractionalBox, ModelVariant} from './types';

export { createRecognizer } from './client';
export { relatedPriors, VoicePrior } from './context-prior';
export type { RelatedCards } from './context-prior';
export type { Recognizer, RecognizerConfig, AIReading } from './client';
export { yugioh } from './games/yugioh';
export type { GameProfile, ConfidenceThresholds, RecognitionTier, EmbeddingModelSpec, RecognizeOptions, RecognitionPriors, RecognitionResult, Candidate, IndexMeta, IndexEntry } from './types';

export { hitTestQuad } from './scene';
export type { DetectedQuad, DetectOptions } from './types';
export type { PeekOptions, PeekResult, ReadAllOptions, BoardResult, BoardCard, BoardSide } from './types';

export type { FeedbackSource } from './client';

export {createOwnFeedBuffer} from './frame-buffer';
export {fieldPacerDevice} from './field-pacer';
export {toRemoteRecognitionResult} from './remote-result';
export {catalogCardId,isPhysicalEntry,filterPhysicalIndex,PHYSICAL_INDEX_POLICY} from './physical-index';
export {replayTier} from './decision';
export type {RemoteRecognitionResult} from './remote-result';
export type {RecognitionEvidence} from './types';

export type {RealsetSample,RealsetExport} from './calibration';

export {createFieldWatcher,createHeldCardReader} from './field-watcher';
export type {HeldCardEvent,HeldCardTrack,FieldWatcher,FieldWatcherOptions,FieldEvent,FieldTiming,FieldTrack,FieldSnapshot,FieldDebug,FieldMetrics,FieldBuffer,KnownFieldCard} from './field-watcher';
export {FIELD_ZONE_PITCH,FIELD_ROW,normalizeZoneSpacing,fieldZoneLayout,DEFAULT_FIELD_ORIENTATION,rotateFieldCalibration,mirrorFieldCalibration,shiftFieldCalibrationRows,swapFieldCalibrationRows,orientFieldFromHands,createFieldCalibration,createTwoCardCalibration,fieldMatPoint,onMat,mapFieldZone,fieldOrientation,fieldZoneLocation,hasExtraMonsterZones,fieldZoneCells,fieldZoneAt,fieldZoneBounds,zoneCellAt,scaleZoneRect,unscaleZoneRect,FIELD_ZONE_LAYOUT,normalizeZones,FIELD_ZONE_IDS,MIN_ZONE_SIZE,fieldQuadPoint,fieldQuadTurn, fieldQuarterTurn,moveFieldQuad,turnFieldQuad,pinchFieldQuad,resizeFieldQuad,flattenFieldCalibration} from './field-zones';
export type {FieldHandle,FieldZone,ZoneRect,ZoneOverrides,FieldZoneCell,FieldCalibration,FieldFormat,FieldOrientation,PlayerSide} from './field-zones';

export {createFieldIdentityGallery} from './field-gallery';
export type {FieldIdentityGallery,FieldIdentityEntry} from './field-gallery';

export {classifyFaceState,isLikelyFaceDown,createFaceStateHysteresis} from './face-state';
export type {FaceState,FaceStateResult,FaceStateEmbedding,FaceStateOptions} from './face-state';

export type {PrepareOptions, FractionalBox, ModelVariant} from './types';

export type { BackendStatus, WebGpuDiagnostics } from './types';

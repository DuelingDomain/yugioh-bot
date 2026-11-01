import {indexVersion} from './learning';
import type {ConfidenceThresholds,GameProfile,LoadedIndex} from './types';
export interface ThresholdConfig {
  version:1;modelId:string;modelSha256:string;indexVersion:string;layoutKey:string;
  thresholds:ConfidenceThresholds;sampleCount:number;negativeCount:number;sureButWrong:0;safetyGap:number;
}
export function calibratedThresholds(value:unknown,profile:GameProfile,index:LoadedIndex):ConfidenceThresholds {
  const v=value as ThresholdConfig;
  if(!v || v.version!==1 || v.modelId!==profile.embedding.id || v.modelSha256!==profile.embedding.sha256 || v.indexVersion!==indexVersion(index.meta) || v.layoutKey!==index.meta.layoutKey || v.sureButWrong!==0 || !(v.sampleCount>v.negativeCount && v.negativeCount>0) || !(v.safetyGap>=.001 && v.safetyGap<=.1))throw new Error('Incompatible webcam threshold configuration');
  const t=v.thresholds;
  if(!t || ![t.score,t.margin,t.floor,t.cardBackMargin??.1].every(x=>Number.isFinite(x)&&x>=0&&x<=2) || t.floor>t.score || t.second!==undefined)throw new Error('Invalid webcam thresholds');
  return {...t};
}

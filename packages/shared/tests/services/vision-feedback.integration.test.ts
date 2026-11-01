import Database from 'better-sqlite3';
import sharp from 'sharp';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { migrate } from '../../src/db/schema.js';
import { createVisionFeedbackService } from '../../src/services/vision-feedback.js';
let db: Database.Database, directory: string, jpegBase64: string;
let now = 100_000;
const sample = (extra = {}) => ({ jpegBase64, embedding: [1,0], top5: [{cardId:'A',score:.91},{cardId:'B',score:.8}], chosenCardId:'B', tier:'sure', source:'pick', gameId:'yugioh', modelId:'model', modelSha256:'a'.repeat(64), indexVersion:'v1', layoutKey:'layout', space:'art-box', sharpness:42, frameClass:'Effect', ...extra });
const service = (extra = {}) => createVisionFeedbackService(db, {dataDir:directory, now:()=>now, ...extra});
beforeEach(async()=>{
  now=100_000;vi.stubEnv('REMOTE_VISION_FEEDBACK','1');vi.stubEnv('OWNER_USER_IDS','');
  db=new Database(':memory:');migrate(db);db.pragma('foreign_keys=on');
  db.exec("insert into users(id,username,display_name) values(1,'a','A'),(2,'b','B')");
  directory=mkdtempSync(join(tmpdir(),'vision-feedback-'));
  jpegBase64=(await sharp({create:{width:224,height:326,channels:3,background:'white'}}).jpeg().toBuffer()).toString('base64');
});
afterEach(()=>{db.close();rmSync(directory,{recursive:true,force:true});vi.unstubAllEnvs();});
it('defaults off, persists a single answered prompt, respects global off and permits deletion while off',async()=>{
  const s=service();expect(s.preference(1)).toMatchObject({enabled:false,askedAt:null});
  await expect(s.record(1,sample())).rejects.toThrow('consent_required');
  s.setPreference(1,true);expect(s.preference(1).askedAt).toBe(now);
  vi.stubEnv('REMOTE_VISION_FEEDBACK','0');await expect(s.record(1,sample())).rejects.toThrow('collection_disabled');
  s.setPreference(1,false);expect(s.deleteForUser(1)).toBe(0);
});
it('defaults owner feedback on and immediately approves correct and corrected samples without another user',async()=>{
  vi.stubEnv('OWNER_USER_IDS','1');
  const s=service();expect(s.preference(1)).toMatchObject({enabled:true,isAdmin:true,askedAt:null});
  expect(s.preference(2)).toMatchObject({enabled:false,isAdmin:false});
  const correct=await s.record(1,sample({chosenCardId:'A'}));
  expect(s.allSamples()[0]).toMatchObject({id:correct.id,review:'approved'});
  expect(s.learning().references).toHaveLength(1);
  expect(db.prepare('select reviewed_by,reviewed_at from vision_samples where id=?').get(correct.id)).toEqual({reviewed_by:1,reviewed_at:now});
  now+=2000;await s.record(1,sample());
  expect(s.learning().references).toHaveLength(2);
  s.setPreference(1,false);expect(s.preference(1).enabled).toBe(false);
  await expect(s.record(1,sample())).rejects.toThrow('consent_required');
  s.setPreference(1,true);vi.stubEnv('REMOTE_VISION_FEEDBACK','0');
  await expect(s.record(1,sample())).rejects.toThrow('collection_disabled');
});
it('approves an existing pending owner confirmation on retry while preserving explicit moderation rejection',async()=>{
  const s=service();s.setPreference(1,true);const saved=await s.record(1,sample());
  vi.stubEnv('OWNER_USER_IDS','1');await s.record(1,sample());
  expect(s.allSamples()[0].review).toBe('approved');
  s.review(saved.id,'rejected',1);await s.record(1,sample());
  expect(s.allSamples()[0].review).toBe('rejected');
  expect(s.learning().references).toHaveLength(0);
});
it('requires independent users or admin approval, rejects poisoned references and withdraws deleted evidence',async()=>{
  const s=service();s.setPreference(1,true);s.setPreference(2,true);
  const first=await s.record(1,sample());expect(s.learning().references).toHaveLength(0);
  now+=2000;await s.record(1,sample({sharpness:43}));expect(s.learning().references).toHaveLength(0);
  now+=2000;const second=await s.record(2,sample());expect(s.learning().references.length).toBeGreaterThan(0);
  expect(s.learning().confusions).toEqual([expect.objectContaining({a:'A',b:'B',users:2})]);
  s.review(second.id,'rejected',1);expect(s.learning().references).toHaveLength(0);
  s.review(first.id,'approved',1);expect(s.learning().references).toHaveLength(1);
  s.deleteSample(first.id);expect(s.learning().references).toHaveLength(0);
});
it('isolates model/index/space, rejects dissimilar evidence and reports sure-but-wrong by day and tier',async()=>{
  const s=service();s.setPreference(1,true);s.setPreference(2,true);
  await s.record(1,sample());now+=2000;await s.record(2,sample({embedding:[0,1]}));
  expect(s.learning().references).toHaveLength(0);
  expect(s.summary().accuracy[0]).toMatchObject({tier:'sure',total:2,top1:0,top5:2,sureWrong:2});
  now+=2000;await s.record(2,sample({indexVersion:'v2'}));expect(s.learning().references).toHaveLength(0);
});
it('deduplicates retries, bounds rate, rows and bytes, prunes retention and removes crop files',async()=>{
  const s=service({maxSamples:1,maxBytes:32*1024,retentionMs:5000});s.setPreference(1,true);s.setPreference(2,true);
  const a=await s.record(1,sample());expect((await s.record(1,sample())).id).toBe(a.id);
  await expect(s.record(1,sample({chosenCardId:'A'}))).rejects.toThrow('rate_limited');
  now+=2000;await s.record(2,sample());expect(s.summary().samples).toHaveLength(1);
  expect(readdirSync(join(directory,'vision-feedback'))).toHaveLength(1);
  now+=6000;s.prune();expect(s.summary().samples).toHaveLength(0);expect(readdirSync(join(directory,'vision-feedback'))).toHaveLength(0);
  const tiny=service({maxBytes:1});await expect(tiny.record(1,sample())).rejects.toThrow('storage_limit');
});
it('rejects invalid image/vector/metadata before writing and keeps ownership deletion scoped',async()=>{
  const s=service();s.setPreference(1,true);s.setPreference(2,true);
  for(const bad of [{embedding:[NaN,0]},{jpegBase64:'not jpeg'},{embedding:[0,0]},{source:'anything'},{top5:[]},{fullFrame:'no'}]) await expect(s.record(1,sample(bad))).rejects.toThrow('invalid_sample');
  await s.record(1,sample());now+=2000;await s.record(2,sample());
  expect(s.deleteForUser(1)).toBe(1);expect(s.summary().samples[0].userId).toBe(2);
  expect(s.learning().references).toHaveLength(0);
});
it('exports only approved labelled crops and gates metric or dataset regressions',async()=>{
  const {exportApprovedFeedback,regressionFailures}=await import('../../../../scripts/vision/feedback.js');
  const s=service();s.setPreference(1,true);const sampleId=(await s.record(1,sample())).id;
  const empty=await exportApprovedFeedback(s,join(directory,'empty-export'),[{cardId:'B'}]);expect(empty.approved).toBe(0);
  s.review(sampleId,'approved',2);const out=join(directory,'approved-export');expect((await exportApprovedFeedback(s,out,[{cardId:'B'}])).approved).toBe(1);
  const {readFileSync}=await import('node:fs');const list=JSON.parse(readFileSync(join(out,'list.json'),'utf8'));
  expect(list.pos[0]).toMatchObject({anchor:0,w:1,kind:'labeled'});expect(list.neg).toEqual([]);
  const baseline={datasetHash:'same',metrics:{total:2,top1:2,top5:2,sure:2,sureWrong:0,errors:0}};
  expect(regressionFailures(baseline,baseline)).toEqual([]);
  expect(regressionFailures(baseline,{...baseline,metrics:{...baseline.metrics,top1:1,sureWrong:1}})).toEqual(['Top-1 decreased','Sure-but-wrong increased']);
  expect(regressionFailures(baseline,{...baseline,datasetHash:'changed'})).toHaveLength(1);
});
it.each(['removed','anonymised'])('account deletion clears feedback rows and crops when the account is %s',async(mode)=>{
  const {deleteUserAccount}=await import('../../src/services/account-deletion.js');
  const s=service();s.setPreference(1,true);await s.record(1,sample());vi.stubEnv('DATA_DIR',directory);
  if(mode==='anonymised')db.exec(`insert into players(id,guild_id,user_id,display_name) values(1,'g',1,'A'),(2,'g',2,'B');insert into matches(guild_id,player_one_id,player_two_id,winner_id,reporter_id,status,source) values('g',1,2,1,1,'confirmed','manual')`);
  db.exec("create trigger reject_delete before insert on product_events when new.name='$delete_person' begin select raise(abort,'test rollback');end");
  expect(()=>deleteUserAccount(db,1)).toThrow('test rollback');expect(readdirSync(join(directory,'vision-feedback'))).toHaveLength(1);expect(s.allSamples()).toHaveLength(1);
  db.exec('drop trigger reject_delete');expect(deleteUserAccount(db,1).mode).toBe(mode);
  expect(s.allSamples()).toHaveLength(0);expect(readdirSync(join(directory,'vision-feedback'))).toHaveLength(0);expect(s.preference(1).enabled).toBe(false);
});

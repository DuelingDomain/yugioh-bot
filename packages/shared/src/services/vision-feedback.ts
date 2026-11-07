import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { isOwnerUser } from '../access/owner-access.js';

export const VISION_FEEDBACK_LIMITS = {maxSamples:5000,maxBytes:64*1024*1024,retentionMs:30*86400_000};
const id = z.string().min(1).max(64).regex(/^[\w:.-]+$/);
const schema = z.object({
  jpegBase64:z.string().min(4).max(44_000),
  embedding:z.array(z.number().finite().min(-1).max(1)).min(1).max(1024),
  top5:z.array(z.object({cardId:id,score:z.number().finite().min(-1).max(1)}).strict()).min(1).max(5),
  chosenCardId:id, tier:z.enum(['sure','not sure','low match']),source:z.enum(['pick','search','voice','ai']),
  frameClass:z.string().max(64).optional(),sharpness:z.number().finite().min(0).max(1e9),
  gameId:id,modelId:id,modelSha256:z.string().regex(/^[a-f0-9]{64}$/),indexVersion:z.string().min(1).max(512),
  layoutKey:z.string().min(1).max(8192),space:z.enum(['art-box','whole-card']),
}).strict();
export type VisionFeedbackInput = z.infer<typeof schema>;
export interface VisionSample extends Omit<VisionFeedbackInput,'jpegBase64'> {
  id:string;userId:number;createdAt:number;cropBytes:number;review:'pending'|'approved'|'rejected';
}
export interface VisionLearning {
  version:string;
  references:(Pick<VisionSample,'id'|'userId'|'chosenCardId'|'embedding'|'gameId'|'modelId'|'modelSha256'|'layoutKey'|'indexVersion'|'space'> & {supportUserIds:number[]})[];
  confusions:{a:string;b:string;users:number;count:number;gameId:string;modelId:string;modelSha256:string;indexVersion:string;space:string;layoutKey:string}[];
}
type Row = {id:string;user_id:number;created_at:number;crop_bytes:number;embedding_json:string;top5_json:string;chosen_card_id:string;tier:VisionSample['tier'];source:VisionSample['source'];frame_class:string|null;sharpness:number;game_id:string;model_id:string;model_sha256:string;index_version:string;layout_key:string;space:VisionSample['space'];review:VisionSample['review']};
const unpack=(r:Row):VisionSample=>({id:r.id,userId:r.user_id,createdAt:r.created_at,cropBytes:r.crop_bytes,embedding:JSON.parse(r.embedding_json),top5:JSON.parse(r.top5_json),chosenCardId:r.chosen_card_id,tier:r.tier,source:r.source,frameClass:r.frame_class??undefined,sharpness:r.sharpness,gameId:r.game_id,modelId:r.model_id,modelSha256:r.model_sha256,indexVersion:r.index_version,layoutKey:r.layout_key,space:r.space,review:r.review});
const identity=(s:VisionSample)=>JSON.stringify([s.gameId,s.modelId,s.modelSha256,s.indexVersion,s.layoutKey,s.space]);
const cosine=(a:number[],b:number[])=>a.length===b.length?a.reduce((sum,v,i)=>sum+v*b[i],0):-1;
const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');

export function createVisionFeedbackService(db:Database.Database, options:Partial<typeof VISION_FEEDBACK_LIMITS> & {dataDir?:string;now?:()=>number}={}) {
  const limits={maxSamples:options.maxSamples??VISION_FEEDBACK_LIMITS.maxSamples,maxBytes:options.maxBytes??VISION_FEEDBACK_LIMITS.maxBytes,retentionMs:options.retentionMs??VISION_FEEDBACK_LIMITS.retentionMs}, now=options.now??Date.now;
  const dataDir=resolve(options.dataDir??process.env.DATA_DIR??dirname(db.name===':memory:'?'data/bot.sqlite':db.name));
  const directory=join(dataDir,'vision-feedback');
  const path=(sampleId:string)=>{if(!/^[a-f0-9-]{36}$/.test(sampleId)) throw new Error('invalid_sample_id');return join(directory,`${sampleId}.jpg`);};
  const rows=()=>db.prepare<[],Row>('select * from vision_samples order by created_at desc,id').all().map(unpack);
  function remove(sampleId:string) {
    // Delete bytes first: failed filesystem deletion must remain discoverable/retryable.
    try {unlinkSync(path(sampleId));} catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    return db.prepare('delete from vision_samples where id=?').run(sampleId).changes;
  }
  function prune() {
    return db.transaction(()=>{
      for(const row of db.prepare<[number],{id:string}>('select id from vision_samples where created_at < ?').all(now()-limits.retentionMs)) remove(row.id);
      let {bytes,count}=db.prepare<[],{bytes:number;count:number}>('select coalesce(sum(crop_bytes),0) bytes,count(*) count from vision_samples').get()!;
      for(const row of db.prepare<[],{id:string;crop_bytes:number}>('select id,crop_bytes from vision_samples order by created_at,id').all()) {
        if(bytes<=limits.maxBytes && count<=limits.maxSamples)break;
        remove(row.id);bytes-=row.crop_bytes;count--;
      }
      // All file writes are inside this same SQLite writer lock. Crash or account-cascade
      // orphans cannot race another process's pending insert.
      const keep=new Set(db.prepare<[],{id:string}>('select id from vision_samples').all().map(r=>`${r.id}.jpg`));
      try {for(const file of readdirSync(directory)) if(/^[a-f0-9-]{36}\.jpg$/.test(file)&&!keep.has(file))unlinkSync(join(directory,file));}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    }).immediate();
  }
  function preference(userId:number) {
    const row=db.prepare<[number],{enabled:number;asked_at:number}>('select enabled,asked_at from vision_feedback_preferences where user_id=?').get(userId);
    const isAdmin=isOwnerUser(userId);
    return {enabled:row?row.enabled===1:isAdmin,isAdmin,askedAt:row?.asked_at??null,collectionEnabled:process.env.REMOTE_VISION_FEEDBACK==='1'};
  }
  function setPreference(userId:number,enabled:boolean) {
    db.prepare(`insert into vision_feedback_preferences(user_id,enabled,asked_at) values(?,?,?)
      on conflict(user_id) do update set enabled=excluded.enabled`).run(userId,enabled?1:0,now());
    return preference(userId);
  }
  async function record(userId:number,value:unknown) {
    const allowed=()=>{if(process.env.REMOTE_VISION_FEEDBACK!=='1')throw new Error('collection_disabled');if(!preference(userId).enabled)throw new Error('consent_required');};
    allowed();
    const parsed=schema.safeParse(value);if(!parsed.success)throw new Error('invalid_sample');
    const s=parsed.data,norm=Math.hypot(...s.embedding);
    if(Math.abs(norm-1)>.01 || new Set(s.top5.map(c=>c.cardId)).size!==s.top5.length)throw new Error('invalid_sample');
    const bytes=Buffer.from(s.jpegBase64,'base64');
    if(bytes.length>32768 || bytes.toString('base64')!==s.jpegBase64)throw new Error('invalid_sample');
    let crop:Buffer;
    try {
      const image=sharp(bytes,{limitInputPixels:224*400,failOn:'warning'}).timeout({seconds:1}),meta=await image.metadata();
      if(meta.format!=='jpeg'||!meta.width||!meta.height||meta.width>224||meta.width<32||meta.height>400||meta.height<32||meta.width/meta.height<.5||meta.width/meta.height>.9)throw new Error();
      crop=await image.rotate().resize({width:224,withoutEnlargement:true}).jpeg({quality:72}).toBuffer();
      if(crop.length>32768)throw new Error();
    }catch{throw new Error('invalid_sample');}
    const fingerprint=digest(JSON.stringify([digest(crop),s.chosenCardId,s.gameId,s.modelSha256,s.indexVersion,s.layoutKey,s.space]));
    return db.transaction(()=>{
      allowed();prune();
      // The authenticated account's server-side owner policy is the only approval authority.
      const admin=isOwnerUser(userId);
      const previous=db.prepare<[number,string],{id:string}>('select id from vision_samples where user_id=? and fingerprint=?').get(userId,fingerprint);
      if(previous){
        if(admin)db.prepare("update vision_samples set review='approved',reviewed_by=?,reviewed_at=? where id=? and review='pending'").run(userId,now(),previous.id);
        return previous;
      }
      if(admin)db.prepare('insert into vision_feedback_preferences(user_id,enabled,asked_at) values(?,1,?) on conflict(user_id) do nothing').run(userId,now());
      const t=now(),p=db.prepare<[number],{last_sample_at:number|null;window_at:number;attempts:number}>('select last_sample_at,window_at,attempts from vision_feedback_preferences where user_id=?').get(userId)!;
      if((p.last_sample_at!==null&&t-p.last_sample_at<1000)||(t-p.window_at<3600_000&&p.attempts>=60))throw new Error('rate_limited');
      if(crop.length>limits.maxBytes||limits.maxSamples<1)throw new Error('storage_limit');
      const sampleId=randomUUID();mkdirSync(directory,{recursive:true,mode:0o700});
      writeFileSync(path(sampleId),crop,{flag:'wx',mode:0o600});
      try {
        db.prepare(`insert into vision_samples(id,user_id,created_at,fingerprint,crop_bytes,embedding_json,top5_json,chosen_card_id,tier,source,frame_class,sharpness,game_id,model_id,model_sha256,index_version,layout_key,space)
          values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sampleId,userId,t,fingerprint,crop.length,JSON.stringify(s.embedding.map(v=>v/norm)),JSON.stringify(s.top5),s.chosenCardId,s.tier,s.source,s.frameClass??null,s.sharpness,s.gameId,s.modelId,s.modelSha256,s.indexVersion,s.layoutKey,s.space);
        if(admin)db.prepare("update vision_samples set review='approved',reviewed_by=?,reviewed_at=? where id=?").run(userId,t,sampleId);
        db.prepare('update vision_feedback_preferences set last_sample_at=?,window_at=?,attempts=? where user_id=?').run(t,t-p.window_at>=3600_000?t:p.window_at,t-p.window_at>=3600_000?1:p.attempts+1,userId);
        prune();return {id:sampleId};
      } catch(e){try{unlinkSync(path(sampleId));}catch{}throw e;}
    }).immediate();
  }
  function learning(excludeUserIds:number[]=[]) :VisionLearning {
    prune();
    const samples=rows().filter(s=>s.review!=='rejected'&&!excludeUserIds.includes(s.userId));
    const references:VisionLearning['references']=[],groups=new Map<string,VisionSample[]>();
    for(const s of samples){const key=identity(s);const g=groups.get(key)??[];g.push(s);groups.set(key,g);}
    const confusions:VisionLearning['confusions']=[];
    for(const group of groups.values()) {
      const perCard=new Map<string,VisionSample[]>();
      for(const s of group){const g=perCard.get(s.chosenCardId)??[];if(g.length<100)g.push(s);perCard.set(s.chosenCardId,g);}
      for(const s of group){
        if(references.length>=512)break;
        const supporters=(perCard.get(s.chosenCardId)??[]).filter(other=>other.userId!==s.userId&&cosine(s.embedding,other.embedding)>=.97);
        if(s.review!=='approved'&&!supporters.length)continue;
        references.push({id:s.id,userId:s.userId,chosenCardId:s.chosenCardId,embedding:s.embedding,gameId:s.gameId,modelId:s.modelId,modelSha256:s.modelSha256,layoutKey:s.layoutKey,indexVersion:s.indexVersion,space:s.space,supportUserIds:s.review==='approved'?[s.userId]:[...new Set([s.userId,...supporters.map(o=>o.userId)])]});
      }
      const pairs=new Map<string,{a:string;b:string;users:Set<number>;count:number}>();
      for(const s of group){const guess=s.top5[0]?.cardId;if(!guess||guess===s.chosenCardId)continue;const [a,b]=[guess,s.chosenCardId].sort(),key=JSON.stringify([a,b]),p=pairs.get(key)??{a,b,users:new Set<number>(),count:0};p.users.add(s.userId);p.count++;pairs.set(key,p);}
      for(const p of pairs.values())if(p.users.size>=2){const s=group[0];confusions.push({a:p.a,b:p.b,users:p.users.size,count:p.count,gameId:s.gameId,modelId:s.modelId,modelSha256:s.modelSha256,indexVersion:s.indexVersion,layoutKey:s.layoutKey,space:s.space});}
    }
    return {version:digest(JSON.stringify([references,confusions])),references,confusions:confusions.slice(0,256)};
  }
  function summary() {
    prune();const samples=rows(),daily=new Map<string,{day:string;tier:VisionSample['tier'];total:number;top1:number;top5:number;sureWrong:number}>();
    for(const s of samples.filter(s=>s.review!=='rejected')){const day=new Date(s.createdAt).toISOString().slice(0,10),key=`${day}:${s.tier}`,m=daily.get(key)??{day,tier:s.tier,total:0,top1:0,top5:0,sureWrong:0};m.total++;if(s.top5[0]?.cardId===s.chosenCardId)m.top1++;else if(s.tier==='sure')m.sureWrong++;if(s.top5.some(c=>c.cardId===s.chosenCardId))m.top5++;daily.set(key,m);}
    const learned=learning();return {collectionEnabled:process.env.REMOTE_VISION_FEEDBACK==='1',samples:samples.slice(0,100).map(({embedding:_,layoutKey:__,...s})=>s),accuracy:[...daily.values()],confusions:learned.confusions,learnedCount:learned.references.length,total:samples.length,bytes:samples.reduce((n,s)=>n+s.cropBytes,0),limits};
  }
  return {preference,setPreference,record,prune,learning,summary,
    markAsked:(userId:number)=>{if(isOwnerUser(userId))return {...preference(userId),prompted:false};const changed=db.prepare('insert into vision_feedback_preferences(user_id,enabled,asked_at) values(?,0,?) on conflict(user_id) do nothing').run(userId,now()).changes;return {...preference(userId),prompted:changed===1};},
    allSamples:()=>{prune();return rows();},
    crop:(sampleId:string)=>db.prepare('select 1 from vision_samples where id=?').get(sampleId)?readFileSync(path(sampleId)):null,
    review:(sampleId:string,status:'approved'|'rejected',actorId:number)=>db.prepare('update vision_samples set review=?,reviewed_by=?,reviewed_at=? where id=?').run(status,actorId,now(),sampleId).changes,
    deleteSample:(sampleId:string)=>db.transaction(()=>remove(sampleId)).immediate(),
    deleteForUser:(userId:number)=>db.transaction(()=>{const ids=db.prepare<[number],{id:string}>('select id from vision_samples where user_id=?').all(userId);for(const s of ids)remove(s.id);return ids.length;}).immediate(),
  };
}

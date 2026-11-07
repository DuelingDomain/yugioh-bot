/** Paired integration/benchmark. Run under Node 22 --expose-gc --import tsx.
 * Args: source-root, output-directory, label, catalog-directory, measure, [legacy-seed.sqlite].
 * Each service operation constructs a fresh instance, as the web route does.
 * Only the supplied temporary output directory is written.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadavg, cpus } from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

async function main() {
  const [source,out,label,catalogDirectory]=process.argv.slice(2);
  assert(source && out && label && catalogDirectory);
  const path=join(out,label+'.sqlite');
  assert(process.argv[6] === 'verify' || !existsSync(path), 'Choose a fresh temporary output directory');
  mkdirSync(out,{recursive:true});
  const data=join(out,'duel-engine'); mkdirSync(data,{recursive:true});
  copyFileSync(join(catalogDirectory,'cards.cdb'),join(data,'cards.cdb'));
  writeFileSync(join(data,'strings.conf'),'');
  process.env.DUEL_DATA_DIR=data;
  const moduleAt=(path:string) => import(pathToFileURL(resolve(source,'packages/shared',path)).href);
  const {migrate}=await moduleAt('src/db/schema.ts');
  const {createRemoteDuelService}=await moduleAt('src/services/remote-duels.ts');
  const {createSavedDeckService}=await moduleAt('src/services/saved-decks.ts');
  const {seedUser}=await moduleAt('tests/helpers/identity.ts');
  const isNew=label!=='old';
  const storage=isNew ? await moduleAt('src/remote/storage.ts') : null;
  const seed=process.argv[6] === 'measure' ? process.argv[7] : undefined;
  if(seed) copyFileSync(seed,path);
  const db=new Database(path);
  const configure=() => {db.pragma('foreign_keys=ON'); db.pragma('journal_mode=WAL');db.pragma('synchronous=NORMAL');db.pragma('busy_timeout=5000');};
  if (process.argv[6] === 'verify') {
    configure();
    const row=db.prepare('select slug,state_json from remote_tables limit 1').get() as any;
    const users=(db.prepare("select id from users where username in ('fixture:a','fixture:b') order by id").all() as any[]).map(row=>row.id);
    const service=()=>createRemoteDuelService(db,{dataDirectory:data});
    const views=()=>[service().get(row.slug,'g',users[0]),service().get(row.slug,'g',users[1]),service().spectatorSnapshot(row.slug,'g')];
    const expected=JSON.parse(readFileSync(join(out,label+'-verify.json'),'utf8'));
    assert.deepEqual(JSON.parse(JSON.stringify(views())),expected);
    const decoded=isNew?storage.readRemoteState(db,row.state_json):JSON.parse(row.state_json);
    assert(decoded.undo); delete decoded.undoHistory;
    db.prepare('update remote_tables set state_json=? where slug=?').run(JSON.stringify(decoded),row.slug);
    assert.deepEqual(JSON.parse(JSON.stringify(views())),expected);
    db.close(); console.log('Cold process reconnect and forced full replay passed: '+label); return;
  }
  configure(); migrate(db);
  const users=['a','b','spectator'].map(key=>seedUser(db,key).userId);
  const service=()=>createRemoteDuelService(db,{dataDirectory:data});
  let room:any, slug:string, index=0;
  let main:number[]=[],extra:number[]=[];
  if(seed) {
    const row=db.prepare('select slug,last_seq from remote_tables limit 1').get() as any;
    slug=row.slug; room={lastSeq:row.last_seq}; index=148;
  } else {
    const cat=new Database(join(data,'cards.cdb'),{readonly:true});
    const rows=cat.prepare('select id,type from datas where ot&1!=0 and alias=0 and type&16384=0 and id<100000000 order by id').all() as {id:number;type:number}[];
    cat.close();
    const extraMask=0x40|0x2000|0x800000|0x4000000;
    main=rows.filter(r=>!(r.type&extraMask)).slice(0,40).map(r=>r.id);
    extra=rows.filter(r=>r.type&extraMask).slice(0,30).map(r=>r.id);
    assert.equal(main.length,40); assert.equal(extra.length,30);
    room=service().create({guildId:'g',userId:users[0],displayName:'A',gameId:'ygo',seatCount:2,bestOf:3,visibility:'public',rules:{banlist:'none'},showCardsSetFromDeck:false},1000);
    slug=room.slug;
    service().join(slug,'g',users[1],'B',undefined,1001);
    const decks=createSavedDeckService(db);
    for (let seat=0;seat<2;seat++) {
      const saved=decks.create('g',users[seat],{name:'Measured deck '+seat,mode:'normal',deck:{main:main.slice(seat*20,seat*20+20).flatMap(code=>[code,code]),extra:extra.slice(seat*15,seat*15+15),side:[]}});
      service().selectDeck(slug,'g',users[seat],{savedDeckId:saved.id},1002);
      service().ready(slug,'g',users[seat],true,1003);
    }
    room=service().start(slug,'g',users[0],1004);
  }
  const act=(proposal:any,seat:number,timed=false) => {
    const t=performance.now();
    room=service().act(slug,'g',users[seat],{baseSeq:room.lastSeq,action:{actorSeat:seat,idempotencyKey:'action-'+index,...proposal}},2000+index++);
    return timed ? performance.now()-t : 0;
  };
  if(!seed) for (let seat=0;seat<2;seat++) for(let n=0;n<14;n++) {
    const zone=n<3?'monster':n<6?'spell-trap':n<11?'graveyard':n<13?'banished':'extra';
    act({type:'twin.place',seat,zone,card:{ref:`s${seat}-${n}`,cardId:n===13?extra[seat*15]:main[seat*20+n],faceUp:n<3||n>=6&&n<13, ...((n<6)?{slot:n%3+1}:{})}},seat);
  }
  function proposal(step:number) {
    const within=step%40, seat=Math.floor(step/40)%2;
    if ([8,18,28].includes(within)) return {seat,action:{type:'hand.count',value:within===18?6:5}};
    if ([9,19,29].includes(within)) return {seat,action:{type:'undo',targetActionId:'action-'+(index-1)}};
    if (within===36) return {seat,action:{type:'phase.set',phase:'main2'}};
    if (within===37||within===38) return {seat,action:{type:'lp.change',seat,delta:within===37?-100:100,reason:'effect'}};
    if (within===39) return {seat,action:{type:'turn.end'}};
    return {seat,action:{type:'twin.flip',seat,cardRef:`s${seat}-${3+within%3}`,faceUp:within%2===0}};
  }
  if(!seed) for(let i=0;i<120;i++){const p=proposal(i);act(p.action,p.seat);}
  db.pragma('wal_checkpoint(TRUNCATE)');
  const seedSize=statSync(path).size;
  copyFileSync(path,join(out,'seed.sqlite'));
  const io=()=>Number(/write_bytes: (\d+)/.exec(readFileSync('/proc/self/io','utf8'))![1]);
  const wal=()=>{const b=readFileSync(path+'-shm');return {frames:b.readUInt32LE(16),salt:b.subarray(32,40).toString('hex')};};
  const canonical=(value:any):string=>JSON.stringify(normalize(JSON.parse(JSON.stringify(value))));
  function normalize(value:any):any {
    if(Array.isArray(value))return value.map(normalize);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
    return value===slug?'ROOM':value;
  }
  const digest=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
  const times:number[]=[],gets:number[][]=[[],[],[]],ws:number[]=[];
  const hashes:string[]=[], bodies:number[][]=[];
  const startLoad=loadavg(); const startCpu=process.cpuUsage();
  global.gc?.(); const startMemory=process.memoryUsage(); const startWrites=io(); let walBytes=0, peakRSS=startMemory.rss;
  const getTimed=(f:()=>any,into:number[])=>{const t=performance.now(),value=f();into.push(performance.now()-t);return value;};
  for(let i=0;i<1000;i++) {
    const p=proposal(i+120), before=wal(),seq=room.lastSeq;
    times.push(act(p.action,p.seat,true)); assert.equal(room.lastSeq,seq+1);
    const after=wal(); walBytes+= (after.salt===before.salt ? after.frames-before.frames : after.frames)*4120;
    const a=getTimed(()=>service().get(slug,'g',users[0]),gets[0]);
    const b=getTimed(()=>service().get(slug,'g',users[1]),gets[1]);
    const t=performance.now();
    const snapshots=[service().snapshot(slug,'g'),service().snapshot(slug,'g',users[0]),service().snapshot(slug,'g',users[1]),service().spectatorSnapshot(slug,'g')];
    ws.push(performance.now()-t);
    const spectator=getTimed(()=>service().spectate(slug,'g',users[2],2000+index),gets[2]);
    hashes.push(digest([room,a,b,spectator,...snapshots]));
    bodies.push([a,b,spectator].map(v=>Buffer.byteLength(JSON.stringify(v))));
    peakRSS=Math.max(peakRSS,process.memoryUsage().rss);
    if((i+1)%250===0) console.log(label+': '+(i+1)+' actions');
  }
  const writes=io()-startWrites; global.gc?.(); const finalMemory=process.memoryUsage();
  const endLoad=loadavg(), cpu=process.cpuUsage(startCpu);
  const expected=[service().get(slug,'g',users[0]),service().get(slug,'g',users[1]),service().spectatorSnapshot(slug,'g')];
  writeFileSync(join(out,label+'-verify.json'),JSON.stringify(expected));
  db.pragma('wal_checkpoint(TRUNCATE)'); const finalSize=statSync(path).size;
  const stateBytes=(db.prepare('select length(cast(state_json as blob)) n from remote_tables where slug=?').get(slug) as any).n;
  db.close();
  execFileSync(process.execPath,['--import','tsx',process.argv[1],source,out,label,catalogDirectory,'verify'],{stdio:'inherit'});
  const summary=(v:number[])=>{const sorted=[...v].sort((a,b)=>a-b);return {mean:v.reduce((a,b)=>a+b,0)/v.length,p50:sorted[Math.floor(v.length*.5)],p95:sorted[Math.floor(v.length*.95)]};};
  const result={label,host:cpus()[0].model,node:process.version,load:{start:startLoad,end:endLoad},cpu,actions:1000,
    act:summary(times),get:gets.map(summary),ws:summary(ws),walBytesPerAction:walBytes/1000,writeBytesPerAction:writes/1000,
    growth:finalSize-seedSize,finalSize,stateBytes,memory:{start:startMemory,final:finalMemory,peakRSS},cache:storage?.remoteValueCacheStats(),
    bodyBytes:[0,1,2].map(n=>summary(bodies.map(b=>b[n]))),hash:createHash('sha256').update(hashes.join('\n')).digest('hex'),restart:true,replay:true};
  writeFileSync(join(out,label+'-hashes.json'),JSON.stringify(hashes));
  writeFileSync(join(out,label+'-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import Database from 'better-sqlite3';
import {afterEach,expect,it,vi} from 'vitest';
import {migrate} from '@yugidraft/shared/db';
import {seedIdentity} from '../../shared/tests/helpers/identity';
import {tapRoom} from './tap-room-fixture';
const state=vi.hoisted(()=>({db:null as Database.Database|null,auth:vi.fn()}));
vi.mock('@/lib/session-identity',async()=>{const {sessionFixture}=await import('./fixtures/session');return sessionFixture(state.auth);});
vi.mock('@/lib/db',()=>({getDb:()=>state.db!}));
afterEach(()=>{state.db?.close();state.db=null;vi.unstubAllEnvs();});
it('the runtime list defaults closed, ignores wildcard and grants only the listed seated user',async()=>{
 const {remoteUnsureNamesEnabledFor,remoteRoomForViewer}=await import('../src/lib/remote-duels');
 vi.stubEnv('REMOTE_DUELS','1');vi.stubEnv('REMOTE_DUELS_USERS','*');
 for(const value of ['', '*','0101','101x','102']){vi.stubEnv('REMOTE_UNSURE_NAMES_USERS',value);expect(remoteUnsureNamesEnabledFor(101)).toBe(false);}
 vi.stubEnv('REMOTE_UNSURE_NAMES_USERS',' 101 , * ');
 expect(remoteRoomForViewer(tapRoom(),101).unsureNamesEnabled).toBe(true);
 expect(remoteRoomForViewer(tapRoom(),102).unsureNamesEnabled).toBe(false);
 expect(remoteRoomForViewer({...tapRoom(),spectator:true},101).unsureNamesEnabled).toBe(false);
 vi.stubEnv('REMOTE_DUELS','0');expect(remoteUnsureNamesEnabledFor(101)).toBe(false);
});
it('an unlisted client cannot submit an unsure placement to the web action endpoint',async()=>{
 state.db=new Database(':memory:');migrate(state.db);seedIdentity(state.db,{guildId:'unsure',userId:101,playerId:1,name:'Player'});
 state.auth.mockResolvedValue({user:{id:'101',name:'Player'}});
 vi.stubEnv('REMOTE_DUELS','1');vi.stubEnv('REMOTE_DUELS_USERS','101');vi.stubEnv('REMOTE_UNSURE_NAMES_USERS','');vi.stubEnv('DISCORD_GUILD_ID','unsure');
 const {remoteMutation}=await import('../src/lib/remote-duels');
 const response=await remoteMutation(new Request('http://localhost/api/remote/table/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseSeq:0,action:{type:'twin.place',idempotencyKey:'unsure',actorSeat:0,seat:0,zone:'monster',source:'auto',card:{ref:'paper',cardId:100,faceUp:true,position:'attack',nameCandidates:[{cardId:100,name:'A',score:.7},{cardId:101,name:'B',score:.5}]}}})}),{params:Promise.resolve({slug:'table'})},'actions');
 expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'Unsure names are not enabled'});
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { recognizeLocalCard } from "../src/components/remote/recognize-card";

const ocr = { text: "Dark Magician\n46986414", terminate: vi.fn(), post: vi.fn(), fail: false };
const canvas = { toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["local frame"])) } as HTMLCanvasElement;
beforeEach(() => {
  ocr.fail = false; ocr.text = "Dark Magician\n46986414";
  vi.stubGlobal("Worker", class {
    onmessage: ((event: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
    terminate = ocr.terminate;
    postMessage(value: unknown) { ocr.post(value); queueMicrotask(() => { if (ocr.fail) this.onerror?.(); else this.onmessage?.({ data: { text: ocr.text } }); }); }
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("reads a local frame and sends only the public passcode to the existing catalog", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ cards: [{ id: 46986414, name: "Dark Magician" }] })); vi.stubGlobal("fetch", fetcher);
  expect(await recognizeLocalCard(canvas, new AbortController().signal)).toEqual([{ id: 46986414, name: "Dark Magician" }]);
  expect(ocr.post).toHaveBeenCalledWith({ image: expect.any(Blob) });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ customCardIds: [46986414] });
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("falls back to a read name and always terminates OCR after lookup failure", async () => {
  ocr.text = "Blue Eyes White Dragon";
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Catalog offline" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await expect(recognizeLocalCard(canvas, new AbortController().signal)).rejects.toThrow("Catalog offline");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ fuzzyName: "Blue Eyes White Dragon", includeExtra: true });
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("reports no match without a catalog request for a blank frame", async () => {
  ocr.text = ""; const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await recognizeLocalCard(canvas, new AbortController().signal)).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled(); expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("cancels an in-flight scan and terminates the worker", async () => {
  const abort = new AbortController(); ocr.post.mockImplementationOnce(() => abort.abort());
  await expect(recognizeLocalCard(canvas, abort.signal)).rejects.toThrow(/cancelled/i);
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("terminates its host even if startup fails before any OCR result", async () => {
  ocr.fail = true;
  await expect(recognizeLocalCard(canvas, new AbortController().signal)).rejects.toThrow(/could not start/i);
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("releases child workers on a language-load error before Tesseract initialization resolves", async () => {
  const terminated = vi.fn(); const postMessage = vi.fn(); const close = vi.fn();
  const scope = { Worker: class { terminate = terminated; }, postMessage, close, addEventListener: vi.fn(), onmessage: null as null | ((event: unknown) => Promise<void>) };
  runInNewContext(readFileSync(new URL("../public/remote-ocr-worker.js", import.meta.url), "utf8"), {
    self: scope, importScripts: () => {}, Tesseract: { createWorker: async (_lang: string, _mode: number, options: { errorHandler: () => void }) => {
      new scope.Worker(); options.errorHandler(); return new Promise(() => {});
    } },
  });
  void scope.onmessage!({ data: { image: "frame" } });
  expect(terminated).toHaveBeenCalledOnce(); expect(postMessage).toHaveBeenCalledWith({ error: expect.any(String) }); expect(close).toHaveBeenCalledOnce();
});

// Media transport uses the same browser-safe recognition contract as the WS relay.
it("marks missing frames frozen at three seconds and recovers on the next frame", async () => {
  const { FrameHealth } = await import("../src/lib/remote/video-protocol");
  const health = new FrameHealth(100);
  expect(health.frozen(3099)).toBe(false);
  expect(health.frozen(3100)).toBe(true);
  health.frame(3200);
  expect(health.frozen(3201)).toBe(false);
});

it("binds media to authenticated seat metadata rather than names or track labels", async () => {
  const { participantSeat } = await import("../src/lib/remote/video-protocol");
  const members = [{ seat: 1, userId: 12 }];
  const metadata = JSON.stringify({ guildId: "g", tableId: "t", userId: 12, seat: 1 });
  expect(participantSeat("remote-user-12", metadata, "g", "t", members)).toBe(1);
  expect(participantSeat("forged", metadata, "g", "t", members)).toBeUndefined();
  expect(participantSeat("remote-user-12", metadata, "other", "t", members)).toBeUndefined();
  expect(participantSeat("remote-user-12", metadata, "g", "t", [])).toBeUndefined();
});

it("routes requests only to the raw feed owner and accepts one correlated bounded result", async () => {
  const { RecognitionChannel } = await import("../src/lib/remote/video-protocol");
  const sends: { message: unknown; destination?: number }[] = [];
  const result = vi.fn(); const recognize = vi.fn(async () => ({ candidates: [{ cardId: 1, name: "Card", score: 0.9 }], tier: "sure" as const, faceDown: false, covered: false }));
  let now = 0;
  const channel = new RecognitionChannel(1, async (message, destination) => { sends.push({ message, destination }); }, recognize, result, () => now);
  const request = { type: "recognition.request", requestId: "one", feedOwnerSeat: 1, x: 0.4, y: 0.5 } as const;
  await channel.receive(0, request);
  expect(recognize).toHaveBeenCalledWith(request);
  expect(sends[0]).toEqual({ message: { type: "recognition.result", requestId: "one", candidates: [{ cardId: 1, name: "Card", score: 0.9 }], tier: "sure", faceDown: false, covered: false }, destination: undefined });
  await channel.receive(1, sends[0].message);
  expect(result).toHaveBeenCalledTimes(1);
  now = 101; await channel.receive(1, sends[0].message);
  expect(result).toHaveBeenCalledTimes(1);
  await channel.receive(0, { ...request, requestId: "bad", x: 2 });
  expect(recognize).toHaveBeenCalledTimes(1);
  now = 202; await channel.request(0, 0.2, 0.3, "outgoing");
  expect(sends.at(-1)?.destination).toBe(0);
  await channel.receive(2, { type: "recognition.result", requestId: "outgoing", candidates: [], tier: "sure", faceDown: false, covered: false });
  expect(result).toHaveBeenCalledTimes(1);
  now = 10_203; await channel.receive(0, { type: "recognition.result", requestId: "outgoing", candidates: [], tier: "sure", faceDown: false, covered: false });
  expect(result).toHaveBeenCalledTimes(1);
  channel.close();
});

it("announces only correlation metadata, targets the owner, and broadcasts suggestions to every seat", async () => {
  const { RecognitionChannel } = await import("../src/lib/remote/video-protocol");
  const results = [vi.fn(), vi.fn(), vi.fn()]; const recognizers = [vi.fn(async () => ({ candidates: [], tier: "low match" as const, faceDown: false, covered: false })), vi.fn(async () => ({ candidates: [{ cardId: 2, name: "Card two", score: 1 }], tier: "sure" as const, faceDown: false, covered: false })), vi.fn(async () => ({ candidates: [], tier: "low match" as const, faceDown: false, covered: false }))];
  const queue: (() => Promise<void>)[] = [];
  const channels: InstanceType<typeof RecognitionChannel>[] = [];
  for (let seat = 0; seat < 3; seat++) channels.push(new RecognitionChannel(seat, async (message, destination, announcement) => {
    for (let receiver = 0; receiver < 3; receiver++) {
      if (receiver === seat || (destination !== undefined && receiver !== destination)) continue;
      queue.push(async () => {
        if (announcement && message.type === "recognition.request") channels[receiver].announce(seat, message.requestId, message.feedOwnerSeat);
        else await channels[receiver].receive(seat, message);
      });
    }
  }, recognizers[seat], results[seat]));
  await channels[0].request(1, 0.2, 0.8, "shared");
  while (queue.length) await queue.shift()!();
  expect(recognizers[0]).not.toHaveBeenCalled(); expect(recognizers[2]).not.toHaveBeenCalled();
  expect(recognizers[1]).toHaveBeenCalledOnce();
  for (const result of results) expect(result).toHaveBeenCalledWith({ type: "recognition.result", requestId: "shared", candidates: [{ cardId: 2, name: "Card two", score: 1 }], tier: "sure", faceDown: false, covered: false }, 1);
  channels.forEach(channel => channel.close());
});

it("auto placement records source before placing, so Undo targets the added twin", async () => {
  const { fieldPlacementProposals } = await import("../src/lib/remote/field-proposals");
  const track = {id:"physical-1",zone:"M3",position:"defense",faceDown:false} as import("@yugidraft/vision").FieldTrack;
  const proposals = fieldPlacementProposals({track,seat:0,cardId:46986414,name:"Dark Magician"});
  expect(proposals.map(p=>p.type)).toEqual(["card.identified","twin.place"]);
  expect(proposals[0]).toMatchObject({source:"auto",cardId:46986414});
  expect(proposals[1]).toMatchObject({zone:"monster",card:{ref:"physical-1",slot:3,position:"defense"}});
});
it("automatic face-down placement sends no identity and an existing physical ref is never placed twice", async () => {
  const { fieldPlacementProposals } = await import("../src/lib/remote/field-proposals");
  const track = {id:"physical-1",zone:"S2",position:"attack",faceDown:true} as import("@yugidraft/vision").FieldTrack;
  expect(fieldPlacementProposals({track,seat:0,cardId:46986414,name:"Secret"})).toEqual([{type:"twin.place",actorSeat:0,seat:0,zone:"spell-trap",card:{ref:"physical-1",slot:2,faceUp:false,position:"attack"}}]);
  track.faceDown=false;
  expect(fieldPlacementProposals({track,seat:0,cardId:46986414,name:"Known",existing:true})).toHaveLength(1);
});

it("hit-tests owner and observer tracked copies locally and replaces moved/expired snapshots",async()=>{
  const {FieldTrackCache}=await import('../src/lib/remote/field-track-cache');let now=0;
  const owner=new FieldTrackCache(()=>now),observer=new FieldTrackCache(()=>now);
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  const card={ref:'physical-a',cardId:46986414,name:'Dark Magician',quad};
  const packet={type:'field.tracks',cards:[card,{...card,ref:'physical-b',quad:quad.map(p=>({...p,x:p.x+.4}))}]};
  for(const cache of [owner,observer]){expect(cache.receive(1,packet)).toBe(true);expect(cache.hit(1,.3,.3)?.ref).toBe('physical-a');expect(cache.hit(1,.7,.3)?.ref).toBe('physical-b');expect(cache.hit(0,.3,.3)).toBeUndefined();}
  observer.receive(1,{...packet,cards:[{...card,quad:quad.map(p=>({...p,y:p.y+.4}))}]});
  expect(observer.hit(1,.3,.3)).toBeUndefined();expect(observer.hit(1,.3,.7)?.cardId).toBe(46986414);
  now=3001;expect(owner.hit(1,.3,.3)).toBeUndefined();
  observer.receive(1,packet);observer.clear(1);expect(observer.hit(1,.3,.3)).toBeUndefined();
});
it("rejects invalid geometry/pixels and exports only safe visible public tracks",async()=>{
  const {FieldTrackCache,fieldTrackMessage}=await import('../src/lib/remote/field-track-cache');
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}],cache=new FieldTrackCache();
  const track={id:'physical',cardId:'46986414',state:'identified',visible:true,faceDown:false,removed:false,zone:'M2',card:{kind:'face-up',confidence:.9,partial:false,quad}} as any;
  const entries=new Map([['46986414',{cardId:'46986414',passcode:46986414,name:'Dark Magician'}]]);
  const project=(tracks:any[],status='watching')=>fieldTrackMessage({status,tracks} as any,entries);
  expect(project([track]).cards).toEqual([{ref:'physical',cardId:46986414,name:'Dark Magician',quad}]);
  for(const patch of [{visible:false},{faceDown:true},{removed:true},{state:'prompt'},{zone:'DECK'},{card:{...track.card,covered:true}},{card:{...track.card,kind:'face-down'}}])expect(project([{...track,...patch}]).cards).toEqual([]);
  expect(project([track],'stopped').cards).toEqual([]);
  expect(cache.receive(0,{...project([track]),jpeg:'private'})).toBe(false);
  expect(cache.receive(0,{type:'field.tracks',cards:[{ref:'x',cardId:1,quad:quad.map(p=>({...p,x:2}))}]})).toBe(false);
  expect(cache.receive(0,{type:'field.tracks',cards:[{ref:'x',cardId:1,quad:[quad[0],quad[0],quad[0],quad[0]]}]})).toBe(false);
});
it("automatic placement preserves calibrated main, spell and EMZ slots and DEF orientation",async()=>{
  const {fieldPlacementProposals}=await import('../src/lib/remote/field-proposals');
  for(const [zone,expected,slot] of [['M4','monster',4],['S3','spell-trap',3],['EMZ1','extra-monster',1],['EMZ2','extra-monster',2]] as const){
    const track={id:'physical',zone,position:'defense',faceDown:false} as import('@yugidraft/vision').FieldTrack;
    expect(fieldPlacementProposals({track,seat:1,cardId:46986414,name:'Dark Magician'})[1]).toMatchObject({actorSeat:1,seat:1,zone:expected,card:{ref:'physical',slot,position:'defense',faceUp:true}});
  }
});
it('a corrected public physical ref replaces the watcher identity in every exported snapshot',async()=>{
  const {fieldTrackMessage}=await import('../src/lib/remote/field-track-cache');
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  const snapshot={status:'watching',tracks:[{id:'same-ref',cardId:'1',state:'identified',visible:true,faceDown:false,removed:false,zone:'M2',card:{kind:'face-up',confidence:.9,quad}}]} as any;
  const entries=new Map([['1',{cardId:'1',passcode:1,name:'Old'}],['2',{cardId:'2',passcode:2,name:'Corrected'}]]);
  expect(fieldTrackMessage(snapshot,entries,[{id:'same-ref',zone:'M2',cardId:'2'}]).cards[0]).toMatchObject({ref:'same-ref',cardId:2,name:'Corrected'});
  expect(fieldTrackMessage(snapshot,entries,[{id:'same-ref',zone:'M2',faceDown:true}]).cards).toEqual([]);
});
it('track snapshots use the canonical catalog ID for Tokens and alternate image passcodes',async()=>{
  const {fieldTrackMessage}=await import('../src/lib/remote/field-track-cache');
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  for(const passcode of [0,123]){
    const snapshot={status:'watching',tracks:[{id:'token',cardId:'100000001',state:'identified',visible:true,faceDown:false,removed:false,zone:'M2',card:{kind:'face-up',confidence:.9,quad}}]} as any;
    expect(fieldTrackMessage(snapshot,new Map([['100000001',{cardId:'100000001',passcode,name:'Token'}]])).cards[0].cardId).toBe(100000001);
  }
});
it('Wrong card reacquires the same physical ref or rereads its bound frozen pixels',async()=>{
  const {trackedRereadTarget}=await import('../src/lib/remote/field-track-cache');
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  const replacement={ref:'B',cardId:2,quad},moved={ref:'A',cardId:1,quad:quad.map(p=>({...p,x:p.x+.4}))};
  expect(trackedRereadTarget('A',[replacement,moved])?.x).toBeCloseTo(.7);expect(trackedRereadTarget('A',[replacement,moved])?.y).toBeCloseTo(.35);
  expect(trackedRereadTarget('A',[replacement])).toBeUndefined();
  const frame={} as HTMLCanvasElement;
  expect(trackedRereadTarget('A',[replacement],{x:.3,y:.35,frame})).toEqual({x:.3,y:.35,frames:[frame]});
});

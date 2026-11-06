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

it('catalog display lookups opt in to full Extra Deck card facts',async()=>{
  const {loadCards,cardInfo}=await import('../src/components/remote/ui/catalog');
  const card={id:44508094,name:'Stardust Dragon',type:'Dragon / Synchro Effect Monster',frameType:'synchro',race:'Dragon',effectText:'Synchro fixture'};
  const fetcher=vi.fn().mockResolvedValue(Response.json({cards:[card]}));vi.stubGlobal('fetch',fetcher);await loadCards([44508094]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({lookupIds:[44508094]});expect(cardInfo(44508094)).toMatchObject(card);
});

it.each(['fetch','response body'] as const)('a hung catalog %s releases the shared action queue after ten seconds',async stage=>{
  vi.useFakeTimers();
  try {
    const {loadCards,cardInfo}=await import('../src/components/remote/ui/catalog'),{createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
    const id=stage==='fetch'?920000201:920000202,never=new Promise<never>(()=>{});let signal:AbortSignal|undefined,finished=false;
    const response=Response.json({cards:[]});response.json=()=>never;
    const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{signal=options.signal??undefined;return stage==='fetch'?never:response;});vi.stubGlobal('fetch',fetcher);
    const room={lastSeq:0} as any,post=vi.fn(async()=>room),queue=createRoomMutationQueue(()=>room,post);
    const metadata=queue.transaction(async(_room,act)=>{await loadCards([id]);finished=true;if(cardInfo(id))await act({type:'phase.advance',actorSeat:0});});
    const manual=queue.action({type:'phase.advance',actorSeat:0});
    await vi.advanceTimersByTimeAsync(9_999);expect(fetcher).toHaveBeenCalledOnce();expect(finished).toBe(false);expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(finished).toBe(true);expect(post).toHaveBeenCalledExactlyOnceWith({type:'phase.advance',actorSeat:0},undefined);await Promise.all([metadata,manual]);expect(signal?.aborted).toBe(true);expect(cardInfo(id)).toBeUndefined();
    fetcher.mockResolvedValueOnce(Response.json({cards:[{id,name:'Recovered catalog fixture',type:'Trap Card',frameType:'trap',effectText:''}]}));await loadCards([id]);expect(cardInfo(id)).toMatchObject({id,type:'Trap Card'});expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{vi.useRealTimers();}
});

it("reads a local frame and sends only the public passcode to the existing catalog", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ cards: [{ id: 46986414, name: "Dark Magician" }] })); vi.stubGlobal("fetch", fetcher);
  expect(await recognizeLocalCard(canvas, new AbortController().signal)).toEqual([{ id: 46986414, name: "Dark Magician" }]);
  expect(ocr.post).toHaveBeenCalledWith({ image: expect.any(Blob) });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ lookupIds: [46986414] });
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

it("parses activation with a named source and activation after identifying a card", async()=>{
  const {interpret,suggestCommands,trySaying}=await import("../src/components/remote/ui/grammar");
  const {ygoModule,remoteActionSchema}=await import("@yugidraft/shared/remote");
  let state=ygoModule.initialState({seatCount:2});
  for (const [index,name] of ["Trap Tracks","See You Later!","There Can Be Only One"].entries()) {
    state=ygoModule.reduce(state,remoteActionSchema.parse({type:"twin.place",actorSeat:0,seat:0,zone:"spell-trap",at:1000,
      idempotencyKey:`voice-fixture-${index}`,card:{ref:`source-${index}`,name,...(index===0 ? {cardId:70825459} : {}),slot:index+1,faceUp:true}}));
  }
  state=ygoModule.reduce(state,remoteActionSchema.parse({type:"card.identified",actorSeat:0,seat:0,cardRef:"source-0",cardId:70825459,name:"Trap Tracks",source:"voice",at:1001,idempotencyKey:"voice-fixture-identify"}));
  const ctx={state,players:[{seat:0,displayName:"Alice"}],me:0,trayOpen:false};
  expect(interpret("I activate Trap Tracks",ctx)).toMatchObject({kind:"effect",proposal:{type:"effect.activated",source:{name:"Trap Tracks"}}});
  expect(interpret("activate",ctx)).toMatchObject({kind:"effect",proposal:{source:{cardId:70825459}}});
  for (const text of ["effect","activate effect","Trap Tracks effect"]) {
    expect(interpret(text,ctx),text).toMatchObject({kind:"effect",proposal:{source:{cardId:70825459,cardRef:"source-0"}}});
  }
  expect(interpret("that effect is good",ctx)).toEqual({kind:"none"});
  expect(suggestCommands("that effect is good",ctx)).toEqual([]);
  // Fixed transcript corpus. Also used for the before/after report.
  const phrases: [string, string, string][] = [
    ["standby phase", "draw", "phase:standby"],
    ["stand by phase", "draw", "phase:standby"],
    ["stamby phase", "draw", "phase:standby"],
    ["stand bye phase", "draw", "phase:standby"],
    ["sandby phase", "draw", "phase:standby"],
    ["standby face", "draw", "phase:standby"],
    ["standby faze", "draw", "phase:standby"],
    ["standby fase", "draw", "phase:standby"],
    ["Moving to stand by phase.", "draw", "phase:standby"],
    ["Moving to Standby Phase", "draw", "phase:standby"],
    ["main phase two", "battle", "phase:main2"],
    ["main 2", "battle", "phase:main2"],
    ["mane phase", "standby", "phase:main1"],
    ["main face", "standby", "phase:main1"],
    ["main phase to", "battle", "phase:main2"],
    ["main phase too", "battle", "phase:main2"],
    ["main phase one", "standby", "phase:main1"],
    ["main phase won", "standby", "phase:main1"],
    ["main 1 phase", "standby", "phase:main1"],
    ["second main phase", "battle", "phase:main2"],
    ["main phase", "standby", "phase:main1"],
    ["main phase", "battle", "phase:main2"],
    ["battle phase", "main1", "phase:battle"],
    ["battle face", "main1", "phase:battle"],
    ["bottle phase", "main1", "phase:battle"],
    ["Go to battle fays", "main1", "phase:battle"],
    ["battel phase", "main1", "phase:battle"],
    ["go to battle", "main1", "phase:battle"],
    ["enter battle", "main1", "phase:battle"],
    ["battle step", "main1", "phase:battle"],
    ["end phase", "main2", "phase:end"],
    ["and phase", "main2", "phase:end"],
    ["in phase", "main2", "phase:end"],
    ["end face", "main2", "phase:end"],
    ["end fase", "main2", "phase:end"],
    ["draw phase", "end", "phase:draw"],
    ["drop phase", "end", "phase:draw"],
    ["draw face", "end", "phase:draw"],
    ["drow phase", "end", "phase:draw"],
    ["Please, go to the main phase!", "standby", "phase:main1"],
    ["set phase to main two", "battle", "phase:main2"],
    ["phase battle", "main1", "phase:battle"],
    ["end turn", "main2", "turn"],
    ["pass", "main2", "turn"],
    ["pass my turn", "main2", "turn"],
    ["next phase", "draw", "phase:standby"],
    ["next phase", "standby", "phase:main1"],
    ["next phase", "main1", "phase:battle"],
    ["next phase", "battle", "phase:main2"],
    ["next phase", "main2", "phase:end"],
    ["next phase", "end", "turn"],
    ["go back a phase", "main2", "phase:battle"],
    ["back to main phase one", "main2", "phase:main1"],
    ["undo", "main2", "undo"],
    ["chain", "main1", "wake"],
    ["set", "main1", "move"],
    ["graveyard", "main1", "move"],
    ["GY", "main1", "move"],
    ["banish Dark Magician", "main1", "move"],
    ["I activate Trap Tracks", "main1", "effect"],
    ["LP minus 1000", "main1", "lp:0:-1000"],
    ["life points plus 1000", "main1", "lp:0:1000"],
    ["my life points minus one thousand", "main1", "lp:0:-1000"],
    ["and my turn", "main2", "turn"],
    ["in turn", "main2", "turn"],
    ["Intern", "main2", "none"],
    ["bottle fase", "main1", "phase:battle"],
    ["stndby phase", "draw", "phase:standby"],
    ["mian phase", "standby", "phase:main1"],
    ["main fase", "battle", "phase:main2"],
    ["draw faze", "end", "phase:draw"],
    ["Um and now like I've placed uh Treasure of the Kings in the monster in the spell tr um in the field zone, and...", "main1", "quiet"],
    ["Um I put this in the monster zone two and now I think we can continue", "main1", "quiet"],
    ["I activate this because I think it can help with the battle phase later", "main1", "quiet"],
    ["And now I've placed Treasures of the Kings in the field zone", "main1", "quiet"],
    ["Like I said we should check the main phase rules after this game", "main1", "quiet"],
    ["Do you think I should set this in trap zone one or keep it", "main1", "quiet"],
    ["I was talking about the battle phase and the monster zone two", "main1", "quiet"],
    ["Um battle phase", "main1", "phase:battle"],
    ["uh standby", "draw", "phase:standby"],
    ["okay main phase two", "battle", "phase:main2"],
    ["so, end phase", "main2", "phase:end"],
    ["alright, draw phase", "end", "phase:draw"],
    ["and, battle phase", "main1", "phase:battle"],
    ["Um, uh, okay, so, alright, and, battle phase", "main1", "phase:battle"],
    ["um, and phase", "main2", "phase:end"],
    ["okay, and my turn", "main2", "turn"],
    ["okay, The main phase is next", "main1", "quiet"],
    ["so, main phase rules", "main1", "quiet"],
    ["battle um phase", "main1", "quiet"],
    ["Thanks for the game", "main1", "quiet"],
    ["The main phase is next", "main1", "quiet"],
    ["don't end turn", "main1", "quiet"],
    ["next phase later", "main1", "quiet"],
    ["Main phase rules are confusing", "main1", "quiet"],
    ["I activate this card every time my opponent starts talking about the next battle phase", "main1", "quiet"],
    ["We discussed monster zone two", "main1", "quiet"],
    ["I activate See You Later!", "main1", "effect"],
    ["I activate Trap Tracks when you summon a monster", "main1", "quiet"],
    ["I activate this card all the time during our games", "main1", "quiet"],
    ["I activate Trap Tracks and talk about the next battle phase", "main1", "quiet"],
    ["Main phase rules", "main1", "quiet"],
    ["main deck", "main1", "quiet"],
    ["I put like Trap Tracks in field zone", "main1", "quiet"],
  ];
  const label = (intent: ReturnType<typeof interpret>) => intent.kind === "phase" ? `phase:${intent.phase}` : intent.kind === "lp" ? `lp:${intent.seat}:${intent.delta}` : intent.kind;
  const rows = phrases.map(([text, phase, expected]) => {
    const context={...ctx,state:{...state,turn:2,phase,battleEntered:undefined}};
    const intent=interpret(text,context);
    const actual=expected === "quiet" ? (intent.kind === "none" && suggestCommands(text,context).length === 0 ? "quiet" : `${label(intent)}; suggestions=${suggestCommands(text,context).length}`) : label(intent);
    return {text,phase,expected,actual,pass:actual===expected};
  });
  expect(rows.filter(row=>!row.pass)).toEqual([]);
  for (const text of ["main deck", "battle damage", "don't end turn", "the main phase is next", "battle phase or end phase", "main phase three", "phase", "end phase dragon", "draw face down", "activate Battle Fader", "summon", "normal summon", "tribute", "special summon", "link", "xyz", "synchro", "fusion", "attach", "detach", "negate", "sandwich phase", "next phase later"]) {
    expect(interpret(text,ctx).kind,text).not.toBe("phase");
    expect(interpret(text,ctx).kind,text).not.toBe("turn");
  }
  expect(interpret("next phase",{...ctx,state:{...state,phase:"main1"}})).toEqual({kind:"phase",phase:"main2"});
  expect(interpret("main phase",{...ctx,state:{...state,phase:"main1",battleEntered:true}})).toEqual({kind:"phase",phase:"main2"});
  expect(interpret("next phase",{...ctx,state:{...state,seatCount:4,startedSeats:[0],phase:"main1"}})).toEqual({kind:"phase",phase:"main2"});
  expect(interpret("stamby phase",{...ctx,trayOpen:true})).toEqual({kind:"phase",phase:"standby"});
  expect(interpret("back to end phase",ctx).kind).toBe("none");
  const real={...ctx,cardNames:["Treasures of the Kings","Trap Tracks"]};
  const suggestions=suggestCommands("set in field",real);
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.join(" ")).not.toMatch(/Dark Magician|Blue.Eyes|Imran/);
  expect(trySaying(ctx.players,0,real.cardNames).join(" ")).toContain("Treasures of the Kings");
  expect(trySaying(ctx.players,0).join(" ")).not.toMatch(/Dark Magician|Blue.Eyes|Imran/);
  expect(interpret("See You Later!",{...ctx,trayOpen:true}).kind).toBe("name");
  expect(interpret("I activate There Can Be Only One",ctx).kind).toBe("effect");
  expect(interpret("You're Finished!",{...ctx,trayOpen:true,cardNames:["You're Finished!"]}).kind).toBe("name");
  expect(interpret("And the Band Played On",{...ctx,trayOpen:true,cardNames:["And the Band Played On"]})).toEqual({kind:"name",name:"And the Band Played On"});
  expect(interpret("um, And the Band Played On",{...ctx,trayOpen:true,cardNames:["And the Band Played On"]})).toEqual({kind:"name",name:"And the Band Played On"});
  const {voiceCardNames}=await import("../src/components/remote/ui/model");
  const voiceRoom={state:{...state,seats:[{...state.seats[0],twin:[{ref:"new",name:"New board card"},{ref:"old",cardId:2}]}],undoHistory:[{cards:["0:old"]},{cards:["0:new"]}]},seats:[{seat:0,deck:{deck:{main:[3],extra:[],side:[]}}}]} as any;
  expect(voiceCardNames(voiceRoom,id=>({name:id===2?"Old board card":"Deck card"}))).toEqual(["Trap Tracks","New board card","Old board card","Deck card"]);
  const {speechHotwords,SttClient}=await import("../src/components/remote/ui/stt-client");
  const hints=speechHotwords(["Recent Card", "Recent Card", "Older Card", ...Array.from({length:100},(_,i)=>`Deck card number ${i}`)]);
  expect(hints).toContain("standby phase"); expect(hints).toContain("XYZ summon");
  expect(hints.filter(word=>word==="Recent Card")).toHaveLength(1);
  expect(hints.indexOf("Recent Card")).toBeLessThan(hints.indexOf("Older Card"));
  expect(hints.join(", ").length).toBeLessThanOrEqual(600);
  expect(speechHotwords(["bad\nname", "", "a".repeat(121)])).not.toContain("bad\nname");
  const sent:string[]=[];
  vi.stubGlobal("WebSocket",class {
    onmessage:((event:{data:string})=>void)|null=null;
    constructor(){queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:"ready"})}));}
    send(data:string){sent.push(data);}
    close(){}
  });
  const client=new SttClient({});
  expect(await client.start(["New board card"])).toBeTruthy();
  expect(JSON.parse(sent[0])).toMatchObject({type:"start",hotwords:speechHotwords(["New board card"])});
  client.close();
  const {createElement}=await import("react");
  const {renderToStaticMarkup}=await import("react-dom/server");
  const {VoxSection}=await import("../src/components/remote/ui/dock");
  const dock={transcript:{text:phrases.find(row=>row[2]==="quiet")![0],live:false,result:"Not understood",ignored:true},samples:[],proposal:null,onConfirm:()=>{},onCancel:()=>{},onSample:()=>{}};
  const chatterDock=renderToStaticMarkup(createElement(VoxSection,dock));
  expect(chatterDock).not.toContain("Did you mean"); expect(chatterDock).not.toContain("voice-suggestions");
  const proposalDock=renderToStaticMarkup(createElement(VoxSection,{...dock,transcript:{text:"LP minus 1000",live:false,result:"Needs a confirm",ignored:false},proposal:{id:1,title:"Alice −1000 LP",sub:"8000 to 7000",confirmLabel:"Apply"}}));
  expect(proposalDock).toContain("LP minus 1000"); expect(proposalDock).toContain("Alice −1000 LP");
});

it("new automatic placement records identity atomically with the twin for one Undo", async () => {
  const { fieldPlacementProposals, fieldReadingPlaceholder,rememberFieldObservation,observedFieldZone } = await import("../src/lib/remote/field-proposals");
  rememberFieldObservation('manual-room',0,'manual-ref','M3');
  expect(observedFieldZone('manual-room',0,'manual-ref')).toBe('M3');
  expect(observedFieldZone('another-room',0,'manual-ref')).toBeUndefined();
  expect(observedFieldZone('manual-room',1,'manual-ref')).toBeUndefined();
  const reading={ref:'fw-reader-1',zone:'monster',slot:3,faceUp:true,position:'attack'} as any;
  expect(fieldReadingPlaceholder([reading],'M3')).toBe(reading);
  for(const twin of [{...reading,faceUp:false},{...reading,cardId:46986414},{...reading,name:'Known'}, {...reading,ref:'manual'}, {...reading,slot:4}])expect(fieldReadingPlaceholder([twin],'M3')).toBeUndefined();
  expect(fieldReadingPlaceholder([{...reading,zone:'deck'}],'DECK')).toBeUndefined();
  const track = {id:"physical-1",zone:"M3",position:"defense",faceDown:false} as import("@yugidraft/vision").FieldTrack;
  const proposals = fieldPlacementProposals({track:{...track,bestMatch:true},seat:0,cardId:46986414,name:"Dark Magician"});
  expect(proposals[0]).toMatchObject({card:{bestMatch:true}});
  expect(proposals.map(p=>p.type)).toEqual(["twin.place"]);
  expect(proposals[0]).toMatchObject({source:"auto",zone:"monster",card:{ref:"physical-1",slot:3,position:"defense"}});
  const {ygoModule}=await import('@yugidraft/shared/remote');
  const placed=ygoModule.reduce(ygoModule.initialState({seatCount:2}),{...proposals[0],idempotencyKey:'best-match'} as any);
  expect(placed.seats[0].twin[0].bestMatch).toBe(true);
  const corrected=ygoModule.reduce(placed,{type:'card.identified',actorSeat:0,seat:0,cardRef:'physical-1',cardId:89631139,name:'Blue-Eyes White Dragon',source:'click',idempotencyKey:'explicit-correction'});
  expect(corrected.seats[0].twin[0]).toMatchObject({ref:'physical-1',cardId:89631139});expect(corrected.seats[0].twin[0].bestMatch).toBeUndefined();
});
it("automatic face-down placement sends no identity and an existing physical ref is never placed twice", async () => {
  const { fieldPlacementProposals } = await import("../src/lib/remote/field-proposals");
  const track = {id:"physical-1",zone:"S2",position:"attack",faceDown:true} as import("@yugidraft/vision").FieldTrack;
  expect(fieldPlacementProposals({track,seat:0,cardId:46986414,name:"Secret"})).toEqual([{type:"twin.place",source:"auto",actorSeat:0,seat:0,zone:"spell-trap",card:{ref:"physical-1",slot:2,faceUp:false,position:"attack"}}]);
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
  const project=(tracks:any[],status='watching')=>fieldTrackMessage({status,tracks} as any,entries,[{id:'physical',zone:'M2',cardId:'46986414'}]);
  expect(project([track]).cards).toEqual([{ref:'physical',cardId:46986414,name:'Dark Magician',quad}]);
  expect(project([track],'busy').cards).toEqual(project([track]).cards);
  expect(project([{...track,visible:false}],'busy').cards).toEqual([]);
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
    expect(fieldPlacementProposals({track,seat:1,cardId:46986414,name:'Dark Magician'})[0]).toMatchObject({actorSeat:1,seat:1,zone:expected,card:{ref:'physical',slot,position:'defense',faceUp:true}});
  }
});

it('departures leave field zones once with a named atomic move and retain physical refs for destinations',async()=>{
  const {fieldDepartureProposal}=await import('../src/lib/remote/field-proposals');
  const {describeEvent}=await import('../src/components/remote/ui/describe');
  const card={ref:'physical',cardId:101,name:'Varudras',zone:'extra-monster',slot:2,faceUp:true,position:'defense'} as const;
  const proposal=fieldDepartureProposal(card,0);
  expect(proposal).toEqual({type:'twin.move',actorSeat:0,seat:0,cardRef:'physical',zone:'hand',source:'auto',name:'Varudras'});
  expect(describeEvent({actorSeat:0,action:proposal} as any,()=> 'Alice',()=>undefined)?.text).toContain('Varudras left the field');
  expect(fieldDepartureProposal({...card,zone:'spell-trap'},0)?.zone).toBe('hand');
  for(const zone of ['graveyard','banished'])expect(fieldDepartureProposal({...card,zone},0)).toMatchObject({cardRef:'physical',zone:'hand',faceUp:false});
  for(const zone of ['hand','extra','deck'])expect(fieldDepartureProposal({...card,zone},0)).toBeUndefined();
  expect(fieldDepartureProposal(card,0,'extra')).toMatchObject({zone:'extra',faceUp:false});
  expect(fieldDepartureProposal({...card,faceUp:false},0)?.name).toBeUndefined();
  // Review r1: Rank-Up (an Xyz with materials under the new Xyz) is a summon; its materials are not counted alone.
  // A vanished card counts only while it is still out of view in the hand; Link takes the newest, up to its rating.
  const {fieldSummonMaterials}=await import('../src/lib/remote/field-summons');
  const m=(ref:string,zone:string,extra={})=>({ref,cardId:1,zone,faceUp:true,position:'attack',...extra}) as any;
  const xyz=[m('x','monster',{slot:3,materials:['p','q']}),m('p','material',{materialOf:'x'}),m('q','material',{materialOf:'x'})];
  expect(fieldSummonMaterials({kind:'xyz',covered:['x','p','q'],vanished:[],firstSeen:0,twins:xyz,removed:()=>true,now:0})).toEqual(['x']);
  const left=[m('a','hand',{departedFrom:{zone:'monster',at:1}}),m('b','hand',{departedFrom:{zone:'monster',at:2}}),m('c','hand')];
  const vanished=[{ref:'a',at:1000},{ref:'b',at:2000},{ref:'c',at:2500}];
  expect(fieldSummonMaterials({kind:'link',rating:1,covered:[],vanished,firstSeen:3000,twins:left,removed:()=>true,now:0})).toEqual(['b']);
  expect(fieldSummonMaterials({kind:'synchro',covered:[],vanished,firstSeen:3000,twins:left,removed:ref=>ref!=='a',now:0})).toBeUndefined();
  expect(fieldSummonMaterials({kind:'synchro',covered:[],vanished,firstSeen:3000,twins:left,removed:()=>true,now:0})).toEqual(['a','b']);
  // Review r2 N1: two monsters vanish and a Link-2 is placed 1 s later, inside the 2 s departure wait. Both are still on the
  // field in the twin (not in the hand yet): they are its materials, so none of them ever counts as a card in hand.
  const waiting=[m('a','monster',{slot:1}),m('b','monster',{slot:2}),m('c','monster',{slot:3})],pending=[{ref:'a',at:1000},{ref:'b',at:1200}];
  expect(fieldSummonMaterials({kind:'link',rating:2,covered:[],vanished:[],pending,firstSeen:2000,twins:waiting,removed:ref=>ref!=='c',now:0})).toEqual(['a','b']);
  expect(fieldSummonMaterials({kind:'link',rating:2,covered:[],vanished:[],pending,firstSeen:2000,twins:waiting,removed:ref=>ref==='a',now:0})).toEqual(['a']);
  expect(fieldSummonMaterials({kind:'synchro',covered:[],vanished:[],pending:[pending[0]],firstSeen:2000,twins:waiting,removed:()=>true,now:0})).toBeUndefined();
  // Review r2 N3: Q on P, the 5 s default sent P to the hand, then the Xyz came: P (just left, 30 s) and Q are its materials.
  const held=[m('p','hand',{departedFrom:{zone:'monster',slot:3,at:10_000,auto:true}}),m('q','monster',{slot:3})];
  expect(fieldSummonMaterials({kind:'xyz',covered:['p','q'],vanished:[],firstSeen:0,twins:held,removed:()=>false,now:25_000})).toEqual(['p','q']);
  expect(fieldSummonMaterials({kind:'xyz',covered:['p','q'],vanished:[],firstSeen:0,twins:held,removed:()=>false,now:45_000})).toBeUndefined();
  // Review r2 N2: the stack default runs only if the camera still sees the same stack when the 5 s hold ends.
  const {heldStackStillStacked}=await import('../src/lib/remote/field-summons');
  const below=m('p','monster',{slot:3}),stack={mover:{visible:true,removed:false,zone:'M3'},zone:'M3',under:['p'],below,location:{zone:'monster',slot:3}};
  expect(heldStackStillStacked(stack)).toBe(true);
  expect(heldStackStillStacked({...stack,mover:{...stack.mover,zone:'M4'}})).toBe(false);
  expect(heldStackStillStacked({...stack,under:[]})).toBe(false);
  expect(heldStackStillStacked({...stack,mover:{...stack.mover,under:'xyz'}})).toBe(false);
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
    expect(fieldTrackMessage(snapshot,new Map([['100000001',{cardId:'100000001',passcode,name:'Token'}]]),[{id:'token',zone:'M2',cardId:'100000001'}]).cards[0].cardId).toBe(100000001);
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

it('GY and banished arrivals place either face; private piles and absent twins never broadcast after Undo',async()=>{
 const {fieldPlacementProposals}=await import('../src/lib/remote/field-proposals');
 const {fieldTrackMessage}=await import('../src/lib/remote/field-track-cache');
 for(const zone of ['DECK','EXTRA'])for(const faceDown of [false,true])expect(fieldPlacementProposals({track:{id:'a',zone,faceDown,position:'attack'} as any,seat:0,cardId:1})).toEqual([]);
 for(const [zone,destination] of [['GY','graveyard'],['BANISHED','banished']])for(const faceDown of [false,true]){
   const proposals=fieldPlacementProposals({track:{id:'a',zone,faceDown,position:'attack'} as any,seat:0,cardId:1});
   expect(proposals).toMatchObject([{type:'twin.place',source:'auto',zone:destination,card:{ref:'a',faceUp:!faceDown}}]);
   expect((proposals[0] as any).card.cardId).toBe(faceDown?undefined:1);
 }
 const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
 const snapshot={status:'watching',tracks:[{id:'a',cardId:'1',state:'identified',visible:true,faceDown:false,zone:'M2',card:{kind:'face-up',quad}}]} as any;
 const entries=new Map([['1',{cardId:'1',passcode:1,name:'A'}]]);
 expect(fieldTrackMessage(snapshot,entries,[]).cards).toEqual([]);
 expect(fieldTrackMessage(snapshot,entries,[{id:'a',zone:'DECK',cardId:'1'}]).cards).toEqual([]);
});
it('review S5: cached receiver checks present public face-up twin and uses its corrected identity',async()=>{
 const {publicTrackedTwin}=await import('../src/lib/remote/field-track-cache');
 const cached={ref:'a',cardId:1,name:'Stale',quad:[]} as any;
 const twin={ref:'a',cardId:2,name:'Correct',faceUp:true,zone:'monster'} as any;
 expect(publicTrackedTwin(cached,[twin])).toEqual({ref:'a',cardId:2,name:'Correct'});
 for(const twins of [[],[{...twin,faceUp:false}],[{...twin,zone:'hand'}],[{...twin,zone:'deck'}],[{...twin,cardId:undefined}]])expect(publicTrackedTwin(cached,twins)).toBeUndefined();
});
it('review B3: manual and watcher transactions serialize copy checks against returned state before render',async()=>{
 const {createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
 for(const [first,second] of [['manual','watcher'],['watcher','manual']]){
 const stale={lastSeq:0,state:{seats:[{twin:[]}]}} as any;
 let server=stale;const posts:string[]=[];
 const queue=createRoomMutationQueue(()=>stale,async proposal=>{await Promise.resolve();posts.push(proposal.type);server={lastSeq:server.lastSeq+1,state:{seats:[{twin:[...(server.state.seats[0].twin),{ref:(proposal as any).card.ref,cardId:1}]}]}};return server;});
 const place=(ref:string)=>queue.transaction(async(room,act)=>{if(room.state.seats[0].twin.some(c=>c.cardId===1))return room;return act({type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref,cardId:1,faceUp:true,position:'attack'}});});
 await Promise.all([place(first),place(second)]);
 expect(posts).toEqual(['twin.place']);expect(server.state.seats[0].twin).toHaveLength(1);
 await queue.transaction(async(room)=>{expect(room.lastSeq).toBe(1);});
 }
});

it('queued phone retries preserve the caller idempotency key through action and transaction',async()=>{
 const {createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
 const room={lastSeq:0} as any,post=vi.fn(async()=>room);
 const queue=createRoomMutationQueue(()=>room,post);
 const proposal={type:'card.identified',actorSeat:0,seat:0,cardId:46986414,source:'camera'} as any;
 const key='phone-scan-physical-1';
 await queue.action(proposal,key);
 await queue.action(proposal,key);
 await queue.transaction(async(_,act)=>act(proposal,'phone-transaction-1'));
 expect(post.mock.calls).toEqual([[proposal,key],[proposal,key],[proposal,'phone-transaction-1']]);
});

it('queued evidence cannot apply or confirm an old name over replacement pixels',async()=>{
 const {fieldEvidenceMatches}=await import('../src/lib/remote/field-proposals');
 const {createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
 const event={type:'placed',track:{id:'physical',cardId:'A',state:'identified',visible:true,removed:false,revision:0}} as any;
 let current={...event.track},release!:()=>void;const blocker=new Promise<void>(done=>{release=done;});const posts:any[]=[];
 const queue=createRoomMutationQueue(()=>({lastSeq:0} as any),async proposal=>{posts.push(proposal);return null;});
 const slow=queue.transaction(async()=>{await blocker;});
 const placement=queue.transaction(async(_,act)=>{if(fieldEvidenceMatches(event,current))await act({type:'twin.place'} as any);});
 current={...current,revision:1,state:'candidate',cardId:undefined,visible:false};release();await Promise.all([slow,placement]);expect(posts).toEqual([]);
 for(const track of [undefined,{...event.track,visible:false},{...event.track,removed:true},{...event.track,revision:1},{...event.track,cardId:'B'}])expect(fieldEvidenceMatches(event,track)).toBe(false);
 expect(fieldEvidenceMatches(event,{...event.track,zone:'M4'})).toBe(true);
 expect(fieldEvidenceMatches({...event,type:'prompt'},{...event.track,state:'prompt'})).toBe(true);
});

it('a replacement during the placement HTTP request rolls back the new twin and never confirms its name',async()=>{
 const {applyVerifiedFieldMutation}=await import('../src/lib/remote/field-proposals');
 const event={type:'placed',track:{id:'a',cardId:'A',state:'identified',visible:true,revision:0}} as any;
 let current={...event.track},placementId:string|undefined;const actions:any[]=[];
 const act=async(proposal:any,actionId?:string)=>{actions.push(proposal);if(proposal.type==='twin.place'){placementId=actionId;current={...current,revision:1,state:'candidate',cardId:undefined,visible:false};return {state:{undo:{actionId}}} as any;}return {state:{undo:null}} as any;};
 const result=await applyVerifiedFieldMutation(event,()=>current,act,{type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref:'a',cardId:1,faceUp:true}} as any);
 expect(result).toBeNull();expect(actions.map(a=>a.type)).toEqual(['twin.place','undo']);expect(placementId).toBeTruthy();expect(actions[1].targetActionId).toBe(placementId);
});

it('failed compensating Undo exposes a recoverable stale-placement error with the exact created ref',async()=>{
 const {applyVerifiedFieldMutation,StaleFieldPlacementError}=await import('../src/lib/remote/field-proposals');
 for(const networkFailure of [false,true]){
 const event={type:'placed',track:{id:'a',cardId:'A',state:'identified',visible:true,revision:0}} as any;let current={...event.track};
 const proposal={type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref:'a',cardId:1,faceUp:true}} as any;
 const result=applyVerifiedFieldMutation(event,()=>current,async action=>{if(action.type==='undo'){if(networkFailure)throw Error('offline');return null;}current={...current,visible:false,revision:1};return {state:{undo:{actionId:'superseded'}}} as any;},proposal);
 const error=await result.catch(error=>error);expect(error).toBeInstanceOf(StaleFieldPlacementError);expect(error.placement.card.ref).toBe('a');expect(error.message).toContain('Remove the stale placement');
 }
});

it('field legality: a normal Trap seen in M4 goes to S4 (legal by type), no Check zone',async()=>{
 const {projectFieldZone,hardFieldZone}=await import('../src/lib/remote/field-legality');
 // Owner, Infinite Impermanence in a Monster Zone: a Trap without Trap Monster facts goes to the same column's S/T zone.
 const result=projectFieldZone({zone:'M4',facts:{type:'Trap Card',frameType:'normal',race:'Normal'},twins:[]});
 expect(result).toEqual({zone:'S4',label:'Spell/Trap Zone 4',moved:'Trap → S4'});
 expect(projectFieldZone({zone:'M3',facts:{type:'Spell Card',race:'Quick-Play'},twins:[{ref:'busy',zone:'spell-trap',slot:3}]}).zone).toBe('S2');
 expect(hardFieldZone({type:'Trap Card'},'M3',[],'self')).toBe('S3');
 expect(projectFieldZone({zone:'EMZ1',facts:{type:'Trap Card'},twins:[]}).zone).toBe('S2');
});
it('field legality: occupied Spell/Trap columns (also a Trap Monster zone) use the nearest free column with lower-column ties',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 const twins=[{ref:'occupied',zone:'spell-trap',slot:3}];
 expect(projectFieldZone({zone:'S3',facts:{type:'Spell Card'},twins}).zone).toBe('S2');
 expect(projectFieldZone({zone:'S3',facts:{type:'Spell Card'},twins:[...twins,{ref:'left',zone:'spell-trap',slot:2}]}).zone).toBe('S4');
 expect(projectFieldZone({zone:'S3',facts:{type:'Spell Card'},twins:[{ref:'apophis',zone:'monster',slot:3,trapZone:3}]}).zone).toBe('S2');
});
it('field legality: a full row abstains instead of overwriting a twin',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const [type,zone,seen] of [['Spell Card','spell-trap','S3'],['Normal Monster','monster','M3']] as const){
  const result=projectFieldZone({zone:seen,facts:{type},twins:[1,2,3,4,5].map(slot=>({ref:String(slot),zone,slot}))});
  expect(result.zone).toBeUndefined();expect(result.reason).toMatch(/no free|full/i);
 }
});
it('field legality: Field Spells move to a free Field Spell Zone (hard rule) and otherwise stay with Check zone',async()=>{
 const {projectFieldZone,hardFieldZone}=await import('../src/lib/remote/field-legality');
 for(const facts of [{type:'Field Spell'},{type:'Spell Card',race:'Field'}]){
  expect(projectFieldZone({zone:'M4',facts,twins:[]})).toEqual({zone:'FIELD',label:'Field Spell Zone',moved:'Field Spell → Field Zone'});
  expect(hardFieldZone(facts,'S1',[],'self')).toBe('FIELD');
  const blocked=projectFieldZone({zone:'S4',facts,twins:[{ref:'field',zone:'field'}]});
  expect(blocked.zone).toBe('S4');expect(blocked.check).toMatch(/Field Spell Zone/i);
 }
 expect(hardFieldZone({type:'Link Monster',frameType:'link'},'S2',[],'self')).toBe('M2');
 expect(hardFieldZone({type:'Effect Monster'},'S2',[],'self')).toBe('M2');
 expect(hardFieldZone({type:'Union Effect Monster'},'S2',[],'self')).toBeUndefined();
});
it('field legality: Main Deck monsters in the extra row go to the same column\'s Main Monster Zone; Pendulums are plausible',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const type of ['Normal Monster','Ritual Effect Monster','Spellcaster / Normal Monster']){
  expect(projectFieldZone({zone:'EMZ1',facts:{type,frameType:'fusion'},twins:[]})).toEqual({zone:'M2',label:'Main Monster Zone 2',moved:'Monster → M2'});
 }
 expect(projectFieldZone({zone:'EMZ2',facts:{type:'Pendulum Effect Monster'},twins:[]})).toEqual({zone:'EMZ2',label:'Extra Monster Zone, right'});
});
it('field legality: genuine Extra Deck monsters including Pendulums can retain a free extra zone',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const type of ['Fusion Monster','Synchro Tuner Monster','Xyz Effect Monster','Link Monster','Pendulum Effect Fusion Monster','Synchro Pendulum Effect Monster','Xyz Pendulum Effect Monster']){
  expect(projectFieldZone({zone:'EMZ1',facts:{type,frameType:'normal'},twins:[]}).zone).toBe('EMZ1');
  expect(projectFieldZone({zone:'EMZ2',facts:{type},twins:[],format:'domain'}).zone).toBe('EMZ2');
 }
});
it('field legality: unavailable extra zones fall back to a free aligned main monster column',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 const facts={type:'Fusion Monster'};
 for(const format of ['genesys','genesys-domain'] as const)expect(projectFieldZone({zone:'EMZ1',facts,twins:[],format}).zone).toBe('M2');
 expect(projectFieldZone({zone:'EMZ2',facts,twins:[{ref:'extra',zone:'extra-monster',slot:2},{ref:'main',zone:'monster',slot:4}]}).zone).toBe('M3');
});
it('field legality: only exception monsters stay in Spell/Trap zones (Artifact Set, Union/Equip); Ghost Belle goes to M2',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 const belle=projectFieldZone({zone:'S2',facts:{type:'Effect Monster',effectText:'(Quick Effect): You can discard this card; negate the activation.'},twins:[]});
 expect(belle).toEqual({zone:'M2',label:'Main Monster Zone 2',moved:'Monster → M2'});
 expect(projectFieldZone({zone:'S3',facts:{type:'Effect Monster',effectText:'You can Set this card from your hand to your Spell & Trap Zone as a Spell.'},twins:[]})).toEqual({zone:'S3',label:'Spell/Trap Zone 3'});
 expect(projectFieldZone({zone:'S2',facts:{type:'Union Effect Monster'},twins:[]}).check).toBeUndefined();
 expect(projectFieldZone({zone:'S2',facts:{type:'Effect Monster'},twins:[],equipSource:true}).check).toBeUndefined();
 expect(projectFieldZone({zone:'S2',facts:{type:'Link Monster',frameType:'link'},twins:[]}).zone).toBe('M2');
});
it('field legality: Pendulum monsters keep outer spell/trap columns as scales; inner columns are marked',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 const facts={type:'Pendulum Effect Monster'};
 for(const zone of ['S1','S5'] as const)expect(projectFieldZone({zone,facts,twins:[]})).toEqual({zone,label:`Spell/Trap Zone ${zone[1]}`});
 for(const zone of ['S2','S3','S4'] as const){const inner=projectFieldZone({zone,facts,twins:[]});expect(inner.zone).toBe(zone);expect(inner.check).toMatch(/1.*5/);}
});
it('field legality: Trap Monsters stay in the Monster Zone (type or Special Summon text)',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 expect(projectFieldZone({zone:'M4',facts:{type:'Trap Monster',frameType:'effect'},twins:[]})).toEqual({zone:'M4',label:'Main Monster Zone 4'});
 expect(projectFieldZone({zone:'M3',facts:{type:'Trap Card',effectText:'Special Summon this card as a Normal Monster (Reptile/EARTH/Level 4/ATK 1600/DEF 1800). (This card is also still a Trap.)'},twins:[]})).toEqual({zone:'M3',label:'Main Monster Zone 3'});
});
it('field legality: missing or unrecognized full types abstain without trusting frames',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const facts of [undefined,{type:''},{type:'Unknown',frameType:'spell'},{type:'Skill Card',frameType:'effect'}]){
  const result=projectFieldZone({zone:'M4',facts,twins:[]});
  expect(result.zone).toBeUndefined();expect(result.label).toBe('Main Monster Zone 4');expect(result.reason).toMatch(/type.*unknown|unknown.*type/i);
 }
});
it('field legality: occupancy excludes the current physical ref and ignores unspecified row slots',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 const twins=[{ref:'self',zone:'spell-trap',slot:4},{ref:'legacy',zone:'spell-trap'}];
 expect(projectFieldZone({zone:'S4',facts:{type:'Trap Card'},twins,ref:'self'}).zone).toBe('S4');
 expect(projectFieldZone({zone:'S4',facts:{type:'Trap Card'},twins}).zone).toBe('S3');
 expect(projectFieldZone({zone:'M2',facts:{type:'Spell Card',race:'Field'},twins:[{ref:'self',zone:'field'}],ref:'self'}).zone).toBe('FIELD');
});
it('field legality: face-down geometry can be retained without catalog facts',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 expect(projectFieldZone({zone:'S4',faceDown:true,twins:[]})).toEqual({zone:'S4',label:'Spell/Trap Zone 4'});
 expect(projectFieldZone({zone:'M2',faceDown:true,twins:[{ref:'busy',zone:'monster',slot:2}]}).zone).toBe('M1');
});
it('field legality: face-down extra-row observations use aligned main zones in every format',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const format of ['normal','domain','genesys','genesys-domain'] as const){
  expect(projectFieldZone({zone:'EMZ1',faceDown:true,format,twins:[]}).zone).toBe('M2');
  expect(projectFieldZone({zone:'EMZ2',faceDown:true,format,twins:[]}).zone).toBe('M4');
 }
 expect(projectFieldZone({zone:'EMZ2',faceDown:true,twins:[{ref:'busy',zone:'monster',slot:4}]}).zone).toBe('M3');
});
it('field legality: nullable catalog race does not invent a Field Spell subtype',async()=>{
 const {projectFieldZone,manualFieldZoneWarning}=await import('../src/lib/remote/field-legality');
 const facts:import('../src/lib/remote/field-legality').FieldZoneFacts={type:'Spell Card',race:null};
 expect(projectFieldZone({zone:'S4',facts,twins:[]}).zone).toBe('S4');
 expect(manualFieldZoneWarning(facts,'spell-trap',4)).toBeUndefined();
 // ... and an unknown subtype is never "Check zone?" in FIELD.
 const {fieldZoneCheck,cardTypeLine,hardFieldZone}=await import('../src/lib/remote/field-legality');
 expect(fieldZoneCheck(facts,'field')).toBeUndefined();
 // Owner, Treasures of the Kings: our catalog row has no subtype; the engine cards.cdb type bits (Spell|Field) are
 // the first source, so it is a Field Spell: S1 goes to FIELD at once, FIELD gets no mark, the inspector says "Field Spell".
 const {applyEngineCardFacts}=await import('../../shared/src/services/engine-card-facts');
 const treasures=applyEngineCardFacts({type:'Spell Card',frameType:'spell',race:undefined as string|undefined,effectText:'This card\'s name becomes "Temple of the Kings" while in the Field Zone.'},{type:0x80002,level:0,def:0});
 expect(treasures.race).toBe('Field');expect(hardFieldZone(treasures,'S1',[],'self')).toBe('FIELD');
 expect(fieldZoneCheck(treasures,'field')).toBeUndefined();expect(cardTypeLine(treasures)).toBe('Field Spell');
 // Other type lines from the same resolver: a Quick-Play Spell, a Trap Monster (a Trap with a Level), a Link Monster.
 expect(cardTypeLine(applyEngineCardFacts({type:'Spell Card',frameType:'spell'},{type:0x10002,level:0,def:0}))).toBe('Quick-Play Spell');
 const apophis=applyEngineCardFacts({type:'Trap Card',frameType:'trap',effectText:'Fixture'},{type:0x20004,level:4,def:1400});
 expect(cardTypeLine(apophis)).toBe('Continuous Trap · Trap Monster');expect(fieldZoneCheck(apophis,'monster',3)).toBeUndefined();
 expect(cardTypeLine(applyEngineCardFacts({type:'Link Monster',frameType:'link'},{type:0x4000021,level:2,def:0x28}))).toBe('Link-2 Monster');
});
it('field legality: pile observations remain unchanged for adapter policy',async()=>{
 const {projectFieldZone}=await import('../src/lib/remote/field-legality');
 for(const zone of ['GY','BANISHED','DECK','EXTRA'] as const)expect(projectFieldZone({zone,twins:[]}).zone).toBe(zone);
});
it('field legality: readable labels cover all geometric zone types',async()=>{
 const {fieldZoneLabel}=await import('../src/lib/remote/field-legality');
 for(const [zone,label] of [['M2','Main Monster Zone 2'],['S5','Spell/Trap Zone 5'],['EMZ1','Extra Monster Zone, left'],['EMZ2','Extra Monster Zone, right'],['FIELD','Field Spell Zone'],['GY','Graveyard'],['BANISHED','Banished cards'],['DECK','Deck'],['EXTRA','Extra Deck']] as const)expect(fieldZoneLabel(zone)).toBe(label);
});
it('field legality: manual move warnings identify incompatible public field destinations',async()=>{
 const {manualFieldZoneWarning}=await import('../src/lib/remote/field-legality');
 expect(manualFieldZoneWarning({type:'Spell Card'},'monster',4)).toMatch(/Spell.*Monster/i);
 expect(manualFieldZoneWarning({type:'Normal Monster',frameType:'fusion'},'extra-monster',1)).toMatch(/Fusion.*Synchro.*Xyz.*Link/i);
 expect(manualFieldZoneWarning({type:'Normal Monster'},'spell-trap',4)).toMatch(/Monster.*Spell\/Trap/i);
 expect(manualFieldZoneWarning({type:'Spell Card',race:'Field'},'spell-trap',3)).toMatch(/Field Spell Zone/i);
 expect(manualFieldZoneWarning({type:'Trap Card'},'field')).toMatch(/Field Spell Zone/i);
 expect(manualFieldZoneWarning(undefined,'monster',2)).toMatch(/type.*unknown|unknown.*type/i);
});
it('field legality: manual moves allow compatible types, Trap Monsters, and specified outer Pendulum scales',async()=>{
 const {manualFieldZoneWarning}=await import('../src/lib/remote/field-legality');
 for(const [type,zone,slot] of [['Spellcaster / Normal Monster','monster',4],['Fusion Monster','extra-monster',1],['Trap Card','spell-trap',3],['Trap Monster','monster',2],['Pendulum Effect Monster','spell-trap',1],['Pendulum Effect Monster','spell-trap',5]] as const)expect(manualFieldZoneWarning({type},zone,slot)).toBeUndefined();
 for(const slot of [undefined,2,3,4])expect(manualFieldZoneWarning({type:'Pendulum Effect Monster'},'spell-trap',slot)).toMatch(/1.*5/i);
 expect(manualFieldZoneWarning({type:'Spell Card',race:'Field'},'field')).toBeUndefined();
});
it('field legality: manual pile destinations always remain available',async()=>{
 const {manualFieldZoneWarning}=await import('../src/lib/remote/field-legality');
 for(const zone of ['graveyard','banished','deck','extra','hand','hand-reveal','GY','BANISHED','DECK','EXTRA'])expect(manualFieldZoneWarning(undefined,zone)).toBeUndefined();
});

it('back cache notifies immediately, returns stable snapshots and expires with one timer',async()=>{
 vi.useFakeTimers();let now=0;
 try{
  const {FieldTrackCache}=await import('../src/lib/remote/field-track-cache'),cache=new FieldTrackCache(()=>now),changed=vi.fn();
  const stop=cache.subscribe(changed),empty=cache.backs(0);expect(cache.backs(0)).toBe(empty);expect(vi.getTimerCount()).toBe(0);
  const quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  cache.receive(0,{type:'field.tracks',cards:[],backs:[{ref:'set',zone:'M2',quad}]});
  expect(changed).toHaveBeenCalledOnce();expect(cache.backs(0)).toBe(cache.backs(0));expect(vi.getTimerCount()).toBe(1);
  now=3001;await vi.advanceTimersByTimeAsync(3001);expect(cache.backs(0)).toBe(empty);expect(changed).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);stop();
 }finally{vi.useRealTimers();}
});

it.each(['twin.flip','card.identified'] as const)('a replacement during %s undoes its stale identity',async type=>{
 const {applyVerifiedFieldMutation}=await import('../src/lib/remote/field-proposals');
 const track={id:'set',revision:0,state:'identified',faceDown:false,visible:true,removed:false,cardId:'46986414'} as any;
 const event={type:'placed',track:{...track},source:'auto'} as any;
 const act=vi.fn(async(proposal:any,id?:string)=>{if(proposal.type===type)track.revision++;return {lastSeq:1,state:{undo:{actionId:id}}} as any;});
 expect(await applyVerifiedFieldMutation(event,()=>track,act,type==='twin.flip'?{type,actorSeat:0,seat:0,cardRef:'set',faceUp:true,cardId:46986414}:{type,actorSeat:0,seat:0,cardRef:'set',cardId:46986414,source:'auto'})).toBeNull();
 expect(act.mock.calls.map(([proposal])=>proposal.type)).toEqual([type,'undo']);
});

it('owner M3: stale revealed occupants yield to a fresh top match but visible quads keep their refs',async()=>{
 const {staleFieldOccupant}=await import('../src/lib/remote/field-proposals');
 const twins=[{ref:'mark',zone:'monster',slot:3,faceUp:false,publicIdentity:true},{ref:'fenrir',zone:'monster',slot:2,faceUp:true}] as any;
 expect(staleFieldOccupant(twins,[],'M3','kusanagi')?.ref).toBe('mark');
 const backing={id:'mark',zone:'M3',visible:true,removed:false,lastSeen:performance.now()} as any;
 expect(staleFieldOccupant(twins,[backing],'M3','kusanagi')).toBeUndefined();
 expect(staleFieldOccupant(twins,[{...backing,visible:false}],'M3','kusanagi')).toBeUndefined();
 expect(staleFieldOccupant(twins,[{...backing,visible:false,removed:true}],'M3','kusanagi')?.ref).toBe('mark');
 expect(staleFieldOccupant(twins,[{...backing,zone:'M4'}],'M3','kusanagi')).toBeUndefined();
 expect(staleFieldOccupant(twins,[backing,{id:'kusanagi',lastSeen:backing.lastSeen+33} as any],'M3','kusanagi')).toBeUndefined();
 expect(staleFieldOccupant(twins,[{...backing,visible:false},{id:'kusanagi',zone:'M3',lastSeen:backing.lastSeen+33,visible:true,removed:false} as any],'M3','kusanagi')?.ref).toBe('mark');
});
it('owner M3: candidate choices follow the physical row without projecting spells into S3',async()=>{
 const {fieldCandidateFitsZone}=await import('../src/lib/remote/field-legality');
 expect(fieldCandidateFitsZone('M3',{type:'Effect Monster'})).toBe(true);
 for(const type of ['Spell Card','Trap Card'])expect(fieldCandidateFitsZone('M3',{type})).toBe(false);
 expect(fieldCandidateFitsZone('S3',{type:'Effect Monster'})).toBe(false);
 expect(fieldCandidateFitsZone('S3',{type:'Spell Card'})).toBe(true);
 expect(fieldCandidateFitsZone('M3',undefined)).toBe(false);
 expect(fieldCandidateFitsZone('S3',{type:'Spell Card',race:'Field'})).toBe(false);
 expect(fieldCandidateFitsZone('FIELD',{type:'Spell Card',race:'Field'})).toBe(true);
});
it('the board follows a resting track of the other face with one flip; a weak or moving track does not speak',async()=>{
 const {fieldFaceProposal,fieldFaceWitness}=await import('../src/lib/remote/field-proposals');
 const at=10_000,down={state:'identified',zone:'S4',faceDown:true,position:'attack',removed:false,visible:false,lastSeen:at-100,restSince:at-700} as any;
 expect(fieldFaceWitness(down,at)).toBe(true);
 for(const other of [{restSince:undefined},{removed:true},{under:'top'},{zone:'GY'},{state:'candidate'},{lastSeen:at-2000},{faceDown:false}])expect(fieldFaceWitness({...down,...other},at)).toBe(false);
 expect(fieldFaceProposal({ref:'apophis',zone:'spell-trap',faceUp:true},down,0)).toEqual({type:'twin.flip',source:'auto',actorSeat:0,seat:0,cardRef:'apophis',faceUp:false,position:'attack'});
 expect(fieldFaceProposal({ref:'set',zone:'monster',faceUp:true},down,0)?.position).toBe('defense');
 expect(fieldFaceProposal({ref:'apophis',zone:'spell-trap',faceUp:false},down,0)).toBeUndefined();
 const up={...down,faceDown:false,cardId:'a'};
 expect(fieldFaceProposal({ref:'apophis',zone:'spell-trap',faceUp:false},up,0)).toBeUndefined();
 expect(fieldFaceProposal({ref:'apophis',zone:'spell-trap',faceUp:false},up,0,{cardId:89194033,name:'Apophis'})).toMatchObject({faceUp:true,cardId:89194033,name:'Apophis',source:'auto'});
});
it('camera writes retry with the same action key and expose a final failure',async()=>{
 const {retryFieldMutation}=await import('../src/lib/remote/field-proposals');
 const proposal={type:'twin.flip',actorSeat:0,seat:0,cardRef:'mark',faceUp:true} as const,room={lastSeq:2} as any;
 const failed=vi.fn(),post=vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(room);
 expect(await retryFieldMutation(post,proposal,'flip-key',()=>true,failed)).toBe(room);
 expect(post.mock.calls).toEqual([[proposal,'flip-key'],[proposal,'flip-key']]);expect(failed).toHaveBeenCalledOnce();
 post.mockReset().mockResolvedValue(null);
 await expect(retryFieldMutation(post,proposal,'flip-key',()=>true,failed)).rejects.toThrow(/save/i);
 post.mockClear();expect(await retryFieldMutation(post,proposal,'stale-key',()=>false,failed)).toBeNull();expect(post).not.toHaveBeenCalled();
});

it('zoneSpacing widens cells and shares centre assignment through persistence, orientation and transport',async()=>{
 const {fieldGridCells,straddledZones}=await import('../src/lib/remote/zone-grid');
 const {createFieldCalibration,fieldMatPoint,fieldZoneAt,mapFieldZone,onMat,zoneCellAt,FIELD_ZONE_PITCH,rotateFieldCalibration,mirrorFieldCalibration}=await import('@yugidraft/vision');
 const {remoteFieldTracksSchema}=await import('@yugidraft/shared/remote');
 const {FieldTrackCache}=await import('../src/lib/remote/field-track-cache');
 const points=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
 for(const spacing of [.85,1,1.4])for(const playerSide of ['bottom','top','left','right'] as const){
  const calibration=createFieldCalibration(points,{playerSide,mirrored:false},spacing);
  const cells=fieldGridCells('normal',spacing),main=cells.filter(c=>/^M/.test(c.zone));
  expect(calibration.zoneSpacing).toBe(spacing);
  // Every zone is one slot of the same size, and EMZ sits right above M2 and M4.
  for(const c of cells){expect(c.w).toBeCloseTo(main[0].w);expect(c.h).toBeCloseTo(main[0].h);}
  expect(cells.find(c=>c.zone==='EMZ1')!.x).toBeCloseTo(main[1].x);expect(cells.find(c=>c.zone==='EMZ2')!.x).toBeCloseTo(main[3].x);
  expect(main[2].w).toBeCloseTo(FIELD_ZONE_PITCH*spacing);expect(main[3].x-main[2].x).toBeCloseTo(main[2].w);
  for(const cell of main.slice(1,4)){
   const x=cell.x+cell.w/2,y=cell.y+cell.h/2,hw=.4*cell.w,hh=.4*cell.h,quad=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([dx,dy])=>fieldMatPoint({x:x+dx,y:y+dy},calibration));
   expect(mapFieldZone({quad,kind:'face-down',confidence:.9,partial:false},calibration).zone).toBe(cell.zone);
   expect(straddledZones(quad,calibration,cells)).toBeNull();
  }
  // Edited zones: M3 reaches over the right half of M2, and DECK moves off the mat. Assignment, the cells and the straddle check agree.
  const base=fieldGridCells('normal',1),m3=base.find(c=>c.zone==='M3')!,zones={M3:{x:m3.x-.5*m3.w,y:m3.y,w:1.5*m3.w,h:m3.h},DECK:{x:1.05,y:.56,w:.14,h:.44}};
  const edited=createFieldCalibration(points,{playerSide,mirrored:false},spacing,zones),editedCells=fieldGridCells('normal',edited);
  const read=(x:number,y:number,half:number)=>{const quad=[[-half,-.1],[half,-.1],[half,.1],[-half,.1]].map(([dx,dy])=>fieldMatPoint({x:x+dx,y:y+dy},edited));return {quad,kind:'face-down' as const,confidence:.9,partial:false};};
  // Overrides are stored at spacing 1 and follow the spacing like the other zones.
  const editedM3=editedCells.find(c=>c.zone==='M3')!;expect(editedM3.w).toBeCloseTo(zones.M3.w*spacing);expect(editedM3.x).toBeCloseTo(.5+(zones.M3.x-.5)*spacing);
  const m2=editedCells.find(c=>c.zone==='M2')!,deck=editedCells.find(c=>c.zone==='DECK')!,overlap=read(m2.x+.75*m2.w,m2.y+m2.h/2,.2*m2.w);
  expect(zoneCellAt(onMat({x:overlap.quad.reduce((t,p)=>t+p.x,0)/4,y:overlap.quad.reduce((t,p)=>t+p.y,0)/4},edited),editedCells)?.zone).toBe(mapFieldZone(overlap,edited).zone);
  expect(fieldZoneAt(onMat({x:overlap.quad.reduce((t,p)=>t+p.x,0)/4,y:overlap.quad.reduce((t,p)=>t+p.y,0)/4},edited),edited,'normal')).toBe('M2');expect(straddledZones(overlap.quad,edited,editedCells)).toBeNull();
  expect(mapFieldZone(read(deck.x+deck.w/2,deck.y+deck.h/2,.04),edited).zone).toBe('DECK');expect(mapFieldZone(read(.5+(.92-.5)*spacing,deck.y+deck.h/2,.04),edited).zone).not.toBe('DECK');
  expect(rotateFieldCalibration(calibration,180).zoneSpacing).toBe(spacing);expect(mirrorFieldCalibration(calibration).zoneSpacing).toBe(spacing);
  const message={type:'field.tracks',cards:[],calibration};expect(remoteFieldTracksSchema.safeParse(message).success).toBe(true);
  const cache=new FieldTrackCache();expect(cache.receive(0,message)).toBe(true);/* Legacy spacing from an old client is flattened to the whole-field fit on receipt. */expect(cache.calibration(0)?.zoneSpacing).toBe(1);expect(cache.calibration(0)?.zones).toBeUndefined();
 }
 expect(createFieldCalibration(points).zoneSpacing).toBe(1);
});

 it('serializes overlapping writes inside one transaction before choosing the next base sequence',async()=>{
 const {createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
 let room={lastSeq:0} as any,active=0,maxActive=0;const bases:number[]=[];
 const queue=createRoomMutationQueue(()=>room,async()=>{
  const base=room.lastSeq;bases.push(base);maxActive=Math.max(maxActive,++active);
  await new Promise(resolve=>setTimeout(resolve,10));
  room={lastSeq:base+1};active--;return room;
 });
 await queue.transaction(async(_,act)=>{await Promise.all([
  act({type:'phase.advance',actorSeat:0},'placeholder'),
  act({type:'phase.advance',actorSeat:0},'reveal'),
 ]);});
 expect(maxActive).toBe(1);expect(bases).toEqual([0,1]);expect(room.lastSeq).toBe(2);
});


it('one physical pile arrival stays one entry across 21 scans; a second field departure stays distinct',async()=>{
  const {ygoModule}=await import('../../shared/src/remote/games/ygo');
  const {remoteActionSchema}=await import('../../shared/src/remote/actions');
  let state=ygoModule.initialState({seatCount:2}),serial=0;
  const act=(input:Record<string,unknown>,context?:any)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,...(input.type==='undo'?{}:{seat:0}),at:++serial,idempotencyKey:`pile-scan-${serial}`,...input}),context);
  const card={cardId:100,name:'The Man with the Mark',faceUp:true};
  act({type:'twin.place',zone:'monster',card:{...card,ref:'physical-one',slot:3}});
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'arrival'}});
  const arrivalUndo=state.undo?.actionId;
  for(let i=0;i<21;i++)act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:`rescan-${i}`}});
  expect(state.seats[0].twin).toEqual([expect.objectContaining({ref:'physical-one',zone:'graveyard'})]);
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'physical-one'}});
  expect(state.undo?.actionId).toBe(arrivalUndo);
  act({type:'twin.place',zone:'monster',anotherCopy:true,card:{...card,ref:'physical-two',slot:4}});
  act({type:'twin.move',source:'auto',cardRef:'physical-two',zone:'hand'});
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'second-arrival'}});
  expect(state.seats[0].twin.filter(c=>c.zone==='graveyard').map(c=>c.ref)).toEqual(['physical-one','physical-two']);
  act({type:'twin.place',source:'auto',zone:'banished',card:{...card,ref:'banished-top'}});
  act({type:'twin.place',source:'auto',zone:'banished',card:{...card,ref:'banished-rescan'}});
  expect(state.seats[0].twin.filter(c=>c.zone==='banished')).toHaveLength(1);
  // Historical events keep their accepted copy semantics; new events record the guard.
  act({type:'twin.place',source:'auto',zone:'banished',card:{...card,ref:'legacy-copy'}},{replay:true,twinPlacementGuard:3});
  expect(state.seats[0].twin.filter(c=>c.zone==='banished')).toHaveLength(2);
  act({type:'twin.place',source:'auto',zone:'banished',card:{...card,ref:'guarded-replay'}},{replay:true,twinPlacementGuard:3,pileArrivalGuard:1});
  expect(state.seats[0].twin.filter(c=>c.zone==='banished')).toHaveLength(2);
  act({type:'twin.remove',cardRef:'legacy-copy'});
  expect(state.seats[0].twin.filter(c=>c.zone==='banished')).toHaveLength(1);
  act({type:'undo',targetActionId:state.undo!.actionId});
  expect(state.seats[0].twin.filter(c=>c.zone==='banished')).toHaveLength(2);
});

// Native-frame replay for the owner regressions. Only the detector/read is fake.
async function ownerFieldRig(){
  const {createFieldWatcher,createFieldCalibration,yugioh}=await import('@yugidraft/vision');
  const quad=(x=.47,y=.30,down=false)=>({kind:down?'face-down' as const:'face-up' as const,confidence:.95,partial:false,quad:[{x,y},{x:x+.06,y},{x:x+.06,y:y+.156},{x,y:y+.156}]});
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const x=px/width,y=py/height;
    const rgb=x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    data.set([...rgb,255],(py*width+px)*4);
  }
  const front={width,height,data},back={width,height,data:new Uint8ClampedArray(data.length).fill(240)};
  const frame={width:160,height:90,data:new Uint8ClampedArray(160*90*4)} as ImageData;
  const spot=(c:{quad:{x:number;y:number}[]})=>`${c.quad[0].x}/${c.quad[0].y}`;
  const state={at:0,outlines:[quad()],absent:false,occluded:false,motion:0,extraMotion:0,halo:.45,down:false,reads:0,readWait:undefined as Promise<void>|undefined,tier:'sure' as import('@yugidraft/vision').RecognitionTier,identity:'100',embedding:[1,0],known:[] as import('@yugidraft/vision').KnownFieldCard[],events:[] as import('@yugidraft/vision').FieldEvent[],empty:new Set<string>(),faces:new Map<string,{id:string;look:number[];embedding:number[]}>()};
  const watcher=createFieldWatcher({profile:yugioh,calibration:createFieldCalibration([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]),now:()=>state.at,hidden:()=>false,clone:async f=>f,
    getKnownCards:()=>state.known,getPriors:()=>({decklist:['100']}),buffer:{sample:async()=>({frame,at:state.at})},
    recognizer:{detectCards:async()=>structuredClone(state.outlines),recognize:async(_frames,opts)=>{state.reads++;if(state.readWait)await state.readWait;const face=opts?.card&&state.faces.get(spot(opts.card));return {candidates:[{cardId:face?.id??state.identity,score:.95}],tier:state.tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},identityEmbedding:{space:'art-box',values:face?.embedding??state.embedding.slice()},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:1},backend:'wasm'};}},
    analyze:()=>({crop:c=>state.down||c.kind==='face-down'?back:front,motion:c=>c.quad[0].x>.83?state.motion:c.quad[0].x<.16?state.extraMotion:0,occluded:c=>c.quad[0].x<.9&&state.occluded,sharpness:()=>20,
      appearance:c=>state.empty.has(spot(c))||state.absent&&c.quad[0].x===.47?Array(12).fill(.2):state.faces.get(spot(c))?.look??Array.from({length:12},(_,i)=>i%2?.6:.2),halo:()=>Array(192).fill(state.halo)}),
  });
  watcher.subscribe(e=>{state.events.push(e);if(e.type==='placed')watcher.confirm(e.track.id,e.track.cardId,e.track.id,false);});
  return {state,watcher,quad,async tick(count=1,ms=100){for(let i=0;i<count;i++){state.at+=ms;await watcher.tick();await Promise.resolve();}},dispose:()=>watcher.dispose()};
}

it('a flip beside a column boundary retains its settled zone through both face gates',async()=>{
  const r=await ownerFieldRig();
  try{
    r.state.outlines=[r.quad(.536)];await r.tick(8);
    const first=r.state.events.find(e=>e.type==='placed')!;expect(first.track.zone).toBe('M3');
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100'}];
    r.state.down=true;r.state.outlines=[r.quad(.541,.30,true)];await r.tick(8);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({zone:'M3',faceDown:true});
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100',faceDown:true}];
    r.state.down=false;r.state.outlines=[r.quad(.539)];await r.tick(10);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({zone:'M3',faceDown:false});
    expect(r.state.events.filter(e=>e.type==='moved'&&e.track.zone!=='M3')).toEqual([]);
  }finally{r.dispose();}
});

it('a pending identity transfer cannot send the source card to hand',async()=>{
  const r=await ownerFieldRig();let release:()=>void=()=>{};
  try{
    await r.tick(8);const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100'}];
    r.state.readWait=new Promise<void>(resolve=>{release=resolve;});
    r.state.empty.add('0.47/0.3');r.state.halo=.2;
    r.state.faces.set('0.7/0.3',{id:'100',look:Array.from({length:12},(_,i)=>i%2?.1:.9),embedding:[1,0]});r.state.outlines=[r.quad(.70)];
    await r.tick(8);
    expect(r.state.events.filter(e=>e.type==='removed')).toEqual([]);
    release();await r.tick(12);
    expect(r.state.events.filter(e=>e.type==='moved').at(-1)?.track).toMatchObject({id:first.track.id,removed:false});
  }finally{release();r.dispose();}
});

it('a low-confidence reveal keeps a usable identity prompt for the same Set ref',async()=>{
  const r=await ownerFieldRig();
  try{
    r.state.down=true;r.state.outlines=[r.quad(.47,.30,true)];await r.tick(8);
    const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:first.track.id,zone:'M3',faceDown:true}];
    r.state.down=false;r.state.tier='low match';r.state.outlines=[r.quad()];await r.tick(12);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({state:'prompt',zone:'M3',faceDown:false,visible:true});
    expect(r.state.events.filter(e=>e.type==='prompt')).toEqual([expect.objectContaining({track:expect.objectContaining({id:first.track.id}),reason:'uncertain'})]);
  }finally{r.dispose();}
});

it.each([undefined,'DECK','EXTRA'] as const)('a clear field departure clears an old hand halo and detects private destination=%s',async destination=>{
  const r=await ownerFieldRig();
  try{
    const pile=destination?r.quad(destination==='DECK'?.93:.03,.7,true):undefined;
    if(pile)r.state.outlines.push(pile);
    await r.tick(8);const first=r.state.events.find(e=>e.type==='placed')!;expect(first.track.zone).toBe('M3');
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100'}];
    r.state.occluded=true;r.state.absent=true;r.state.outlines=pile?[pile]:[];r.state.motion=destination==='DECK'?.2:0;r.state.extraMotion=destination==='EXTRA'?.2:0;
    await r.tick(4);expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(0);
    r.state.occluded=false;r.state.motion=0;r.state.extraMotion=0;r.state.halo=.2;await r.tick(8);
    const removed=r.state.events.filter(e=>e.type==='removed');expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({track:{id:first.track.id,removed:true},...(destination?{destination}:{})});
    const {fieldDepartureProposal}=await import('../src/lib/remote/field-proposals');
    const {describeEvent}=await import('../src/components/remote/ui/describe');
    const proposal=fieldDepartureProposal({ref:first.track.id,zone:'monster',slot:3,cardId:100,name:'Kashtira Fenrir',faceUp:true,position:'attack'},0,destination==='DECK'?'deck':destination==='EXTRA'?'extra':undefined)!;
    expect(proposal.zone).toBe(destination==='DECK'?'deck':destination==='EXTRA'?'extra':'hand');
    if(destination)expect(proposal.faceUp).toBe(false);
    if(destination==='DECK')expect(describeEvent({actorSeat:0,action:proposal} as any,()=> 'Alice',()=>undefined)?.text).toContain('returned to Deck');
    await r.tick(5);expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(1);
  }finally{r.dispose();}
});

it.each(['DECK','HAND'] as const)('a known card returns from %s to M4 after the move window without a new identity guess',async zone=>{
  const r=await ownerFieldRig();
  try{
    r.state.tier='not sure';await r.tick(8);
    const first=r.state.events.find(e=>e.type==='placed')!;expect(first.track.cardId).toBe('100');
    r.state.known=[{id:first.track.id,zone,cardId:'100',faceDown:true}];
    r.state.absent=true;r.state.outlines=[];r.state.halo=.2;await r.tick(35);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)?.removed).toBe(true);
    r.state.identity='999';r.state.tier='sure';r.state.outlines=[r.quad(.634)];await r.tick(12);
    const returned=r.state.events.filter(e=>['placed','moved'].includes(e.type)&&e.track.zone==='M4');
    expect(returned).toHaveLength(1);expect(returned[0].track).toMatchObject({id:first.track.id,cardId:'100',zone:'M4'});
    expect(r.state.events.filter(e=>e.type==='prompt')).toHaveLength(0);
    // A hidden origin is moved and revealed with one atomic placement.
    const {fieldPlacementProposals}=await import('../src/lib/remote/field-proposals');
    const proposal=fieldPlacementProposals({track:returned[0].track,seat:0,cardId:100,name:'Kashtira Fenrir',fromRef:first.track.id})[0];
    const {ygoModule}=await import('../../shared/src/remote/games/ygo');const {remoteActionSchema}=await import('../../shared/src/remote/actions');
    let state=ygoModule.initialState({seatCount:2});state.seats[0].twin=[{ref:first.track.id,zone:zone==='DECK'?'deck':'hand',cardId:100,name:'Kashtira Fenrir',faceUp:false,position:'attack'}];
    state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,actorSeat:0,at:1,idempotencyKey:'known-return'}));
    expect(state.seats[0].twin).toEqual([expect.objectContaining({ref:first.track.id,zone:'monster',slot:4,cardId:100,faceUp:true})]);
    expect(state.twinConfirmation).toBeUndefined();
  }finally{r.dispose();}
});


it('gallery preference resolves only matching embeddings and never publishes a private hand reference',async()=>{
  const {createFieldIdentityGallery}=await import('@yugidraft/vision');
  const gallery=createFieldIdentityGallery([{cardId:'deck',embedding:{space:'art-box',values:[1,0]}},{cardId:'recent',embedding:{space:'art-box',values:[.8,.6]}}]);
  const embedding={space:'art-box' as const,values:[.95,.31]};
  expect(gallery.resolve(embedding)).toEqual({kind:'hold'});
  expect(gallery.resolve(embedding,['recent','deck'])).toEqual({kind:'match',cardId:'recent'});
  expect(gallery.resolve({space:'art-box',values:[0,-1]},['recent'])).toEqual({kind:'new'});
  const {fieldTrackMessage}=await import('../src/lib/remote/field-track-cache');
  const quad=[{x:0,y:0},{x:.1,y:0},{x:.1,y:.2},{x:0,y:.2}];
  const track={id:'private',cardId:'100',state:'identified',visible:true,removed:false,faceDown:false,zone:'M4',card:{kind:'face-up',quad}} as any;
  expect(fieldTrackMessage({status:'watching',tracks:[track]} as any,new Map([['100',{cardId:'100',passcode:100,name:'Fenrir'}]]),[{id:'private',zone:'HAND',cardId:'100'}]).cards).toEqual([]);
});

it('a resting hand cannot turn a known front into Set; only fresh clear samples can flip or reveal it',async()=>{
  const r=await ownerFieldRig();
  try{
    await r.tick(8);const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100'}];const reads=r.state.reads;
    r.state.occluded=true;r.state.down=true;r.state.outlines=[r.quad(.47,.30,true)];await r.tick(8);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({faceDown:false,cardId:'100'});
    expect(r.state.events.filter(e=>e.type==='flipped')).toHaveLength(0);expect(r.state.reads).toBe(reads);
    r.state.occluded=false;await r.tick();expect(r.state.events.filter(e=>e.type==='flipped')).toHaveLength(0);
    await r.tick(5);expect(r.state.events.filter(e=>e.type==='flipped'&&e.track.faceDown)).toHaveLength(1);
    r.state.known=[{id:first.track.id,zone:'M3',cardId:'100',faceDown:true}];
    r.state.occluded=true;r.state.down=false;r.state.outlines=[r.quad()];await r.tick(6);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)?.faceDown).toBe(true);expect(r.state.reads).toBe(reads);
    r.state.occluded=false;await r.tick(8);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({faceDown:false,cardId:'100'});
    expect(r.state.events.filter(e=>e.type==='prompt')).toHaveLength(0);
  }finally{r.dispose();}
});

it('the hand mask separates warm card artwork from skin crossing the sleeve edge',async()=>{
  const {createFieldAnalyzer}=await import('../../vision/src/field-motion');
  const quad={kind:'face-up' as const,confidence:.95,partial:false,quad:[{x:.3,y:.15},{x:.7,y:.15},{x:.7,y:.85},{x:.3,y:.85}]};
  const frame=(hand:boolean)=>{
    const width=200,height=160,data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const artwork=x>65&&x<135&&y>30&&y<130,arm=hand&&x>105&&x<130;
      data.set([...(artwork||arm?[190,130,95]:[30,35,40]),255],(y*width+x)*4);
    }
    return {width,height,data} as ImageData;
  };
  expect(createFieldAnalyzer()(frame(false)).occluded?.(quad)).toBe(false);
  expect(createFieldAnalyzer()(frame(true)).occluded?.(quad)).toBe(true);
});

it.each([false,true])('a pile rescan cannot consume a still-present field copy (copy proof=%s)',async proof=>{
  const {ygoModule}=await import('../../shared/src/remote/games/ygo');const {remoteActionSchema}=await import('../../shared/src/remote/actions');
  let state=ygoModule.initialState({seatCount:2}),serial=0;
  const act=(input:Record<string,unknown>,context?:any)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,seat:0,at:++serial,idempotencyKey:`pile-live-${serial}`,...input}),context);
  const card={cardId:100,name:'The Man with the Mark',faceUp:true};
  act({type:'twin.place',zone:'graveyard',card:{...card,ref:'pile-one'}});
  act({type:'twin.place',zone:'monster',anotherCopy:true,card:{...card,ref:'still-on-field',slot:3}});
  const before=structuredClone(state);
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'top-rescan'},...(proof?{copyProof:{simultaneousQuads:2,at:3}}:{})});
  expect(state.seats[0].twin).toEqual(before.seats[0].twin);expect(state.undo?.actionId).toBe(before.undo?.actionId);
  // Version 1 replay retains its accepted behavior; version 2 guards new events.
  state=structuredClone(before);
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'v1-rescan'}},{replay:true,twinPlacementGuard:3,pileArrivalGuard:1});
  expect(state.seats[0].twin.filter(c=>c.zone==='graveyard')).toHaveLength(2);
  state=structuredClone(before);
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'v2-rescan'}},{replay:true,twinPlacementGuard:3,pileArrivalGuard:2});
  expect(state.seats[0].twin).toEqual(before.seats[0].twin);
  // Naming the actual physical field ref supplies its origin and permits arrival.
  act({type:'twin.place',source:'auto',zone:'graveyard',card:{...card,ref:'still-on-field'}});
  expect(state.seats[0].twin.filter(c=>c.zone==='graveyard')).toHaveLength(2);
});

it.each(['GY','BANISHED'] as const)('a clear %s lift leaves the pile once and stays private in hand',async zone=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,y)];await r.tick(10);
    const first=r.state.events.find(e=>e.type==='placed')!;expect(first.track.zone).toBe(zone);
    r.state.known=[{id:first.track.id,zone,cardId:'100'}];
    r.state.motion=.2;await r.tick(2);r.state.empty.add(`0.9/${y}`);r.state.outlines=[];r.state.motion=0;r.state.halo=.2;await r.tick(10);
    const removed=r.state.events.filter(e=>e.type==='removed');expect(removed).toHaveLength(1);
    const {fieldDepartureProposal}=await import('../src/lib/remote/field-proposals');
    const {ygoModule}=await import('../../shared/src/remote/games/ygo');const {remoteActionSchema}=await import('../../shared/src/remote/actions');
    const pile=zone==='GY'?'graveyard':'banished';let state=ygoModule.initialState({seatCount:2});
    state.seats[0].twin=[{ref:'below',zone:pile,cardId:200,faceUp:true,position:'attack'},{ref:first.track.id,zone:pile,cardId:100,name:'Fenrir',faceUp:true,position:'attack'}];
    const proposal=fieldDepartureProposal(state.seats[0].twin[1],0)!;expect(proposal).toMatchObject({zone:'hand',faceUp:false});
    state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,at:1,idempotencyKey:'pile-lift'}));
    expect(state.seats[0].twin.filter(c=>c.zone===pile).map(c=>c.ref)).toEqual(['below']);
    const {projectRemoteState}=await import('../../shared/src/remote/privacy');
    expect(projectRemoteState(state,new Set([1])).seats[0].twin.find(c=>c.ref===first.track.id)?.cardId).toBeUndefined();
    await r.tick(10);expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(1);
  }finally{r.dispose();}
});

it.each(['GY','BANISHED'] as const)('a changed %s top reveals a known lower member and removes the taken top',async zone=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,y)];await r.tick(10);const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:'bottom',zone,cardId:'300'},{id:'below',zone,cardId:'200'},{id:first.track.id,zone,cardId:'100'}];
    r.state.motion=.2;await r.tick(2);r.state.motion=0;
    r.state.faces.set(`0.9/${y}`,{id:'200',look:Array.from({length:12},(_,i)=>i%2?.1:.8),embedding:[0,1]});
    await r.tick(18);
    expect(r.state.events.filter(e=>e.type==='removed')).toEqual([expect.objectContaining({track:expect.objectContaining({id:first.track.id,removed:true})})]);
    const revealed=r.state.events.filter(e=>['placed','moved'].includes(e.type)&&e.track.cardId==='200');
    expect(revealed).toHaveLength(1);expect(revealed[0].track.id).toBe('below');
    await r.tick(12);expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(1);
  }finally{r.dispose();}
});

for(const origin of ['GY','BANISHED'] as const)it.each([
  ['M4',.634,.3],['S2',.34,.68],['FIELD',.03,.3],['EMZ1',.34,.02],
  [origin==='GY'?'BANISHED':'GY',.9,origin==='GY'?.02:.3],
] as const)('a touched '+origin+' member moves to %s with one physical ref',async(zone,x,y)=>{
  const r=await ownerFieldRig(),pileY=origin==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,pileY)];r.state.identity='200';r.state.embedding=[0,1];await r.tick(10);
    const top=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:'member',zone:origin,cardId:'100'},{id:top.track.id,zone:origin,cardId:'200'}];
    r.state.motion=.2;await r.tick(2);r.state.motion=0;
    r.state.faces.set(`${x}/${y}`,{id:'100',look:Array.from({length:12},(_,i)=>i%2?.1:.8),embedding:[1,0]});
    r.state.outlines.push(r.quad(x,y));await r.tick(18);
    const returned=r.state.events.filter(e=>['placed','moved'].includes(e.type)&&e.track.zone===zone&&e.track.cardId==='100');
    expect(returned).toHaveLength(1);expect(returned[0]).toMatchObject({fromRef:'member',track:{id:'member'}});
    const {fieldPlacementProposals}=await import('../src/lib/remote/field-proposals');
    const {ygoModule}=await import('../../shared/src/remote/games/ygo');const {remoteActionSchema}=await import('../../shared/src/remote/actions');
    let state=ygoModule.initialState({seatCount:2});const pile=origin==='GY'?'graveyard':'banished';
    state.seats[0].twin=[{ref:'bottom',zone:pile,cardId:300,faceUp:true,position:'attack'},{ref:'member',zone:pile,cardId:100,name:'Fenrir',faceUp:true,position:'attack'},{ref:top.track.id,zone:pile,cardId:200,faceUp:true,position:'attack'}];
    const proposal=fieldPlacementProposals({track:returned[0].track,seat:0,cardId:100,name:'Fenrir',fromRef:(returned[0] as any).fromRef})[0];
    state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,at:1,idempotencyKey:'pile-return'}));
    expect(state.seats[0].twin.filter(c=>c.zone===pile).map(c=>c.ref)).toEqual(['bottom',top.track.id]);
    expect(state.seats[0].twin).toHaveLength(3);expect(state.twinConfirmation).toBeUndefined();
  }finally{r.dispose();}
});

it.each([['GY',false],['GY',true],['BANISHED',false],['BANISHED',true]] as const)('X still on %s proves a separate field copy after a pile touch (lower X=%s)',async(zone,lower)=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,y)];await r.tick(10);const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[...(lower?[{id:'lower-copy',zone,cardId:'100'}]:[]),{id:first.track.id,zone,cardId:'100'}];r.state.motion=.2;await r.tick(2);r.state.motion=0;
    r.state.outlines.push(r.quad(.634));await r.tick(15);
    const placed=r.state.events.find(e=>e.type==='placed'&&e.track.zone==='M4')!;
    expect(placed.track.id).not.toBe(first.track.id);expect((placed as any).fromRef).toBeUndefined();
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id===first.track.id)).toMatchObject({zone,removed:false,visible:true});
    expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(0);
  }finally{r.dispose();}
});

it.each(['GY','BANISHED'] as const)('a real %s arrival keeps its lower history; taking it later restores the old ref',async zone=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02,look=Array.from({length:12},(_,i)=>i%2?.1:.8);
  try{
    r.state.outlines=[r.quad(.9,y)];await r.tick(10);const below=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:below.track.id,zone,cardId:'100'}];
    r.state.motion=.2;await r.tick(2);r.state.motion=0;
    r.state.faces.set(`0.9/${y}`,{id:'200',look,embedding:[0,1]});await r.tick(18);
    expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(0);
    const top=r.state.events.find(e=>e.type==='placed'&&e.track.cardId==='200')!;expect(top).toBeDefined();
    r.state.known.push({id:top.track.id,zone,cardId:'200'});await r.tick(100);
    r.state.motion=.2;await r.tick(2);r.state.motion=0;r.state.faces.delete(`0.9/${y}`);await r.tick(18);
    const revealed=r.state.events.filter(e=>['placed','moved'].includes(e.type)&&e.track.cardId==='100');
    expect(revealed).toHaveLength(2);expect(revealed.at(-1)?.track.id).toBe(below.track.id);
    expect(r.state.events.filter(e=>e.type==='removed').map(e=>e.track.id)).toEqual([top.track.id]);
  }finally{r.dispose();}
});

it.each(['GY','BANISHED'] as const)('a detector miss cannot take X from an unchanged %s top',async zone=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,y)];await r.tick(10);const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:first.track.id,zone,cardId:'100'}];r.state.motion=.2;await r.tick(2);r.state.motion=0;
    // The old pile pixels still show X; only its detector outline is missing.
    r.state.outlines=[r.quad(.634)];await r.tick(15);
    const placed=r.state.events.find(e=>e.type==='placed'&&e.track.zone==='M4')!;
    expect(placed).toBeDefined();expect(placed.track.id).not.toBe(first.track.id);expect(placed.fromRef).toBeUndefined();
    expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(0);
  }finally{r.dispose();}
});

it.each(['GY','BANISHED'] as const)('a field read before the %s top read after restart cannot consume that pile',async zone=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.known=[{id:'known-top',zone,cardId:'100'}];r.state.outlines=[r.quad(.634),r.quad(.9,y)];
    r.state.motion=.2;await r.tick(2);r.state.motion=0;await r.tick(20);
    const placed=r.state.events.find(e=>e.type==='placed'&&e.track.zone==='M4');
    expect(placed).toBeDefined();expect(placed?.track.id).not.toBe('known-top');expect(placed?.fromRef).toBeUndefined();
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='known-top')).toMatchObject({zone,visible:true,removed:false});
  }finally{r.dispose();}
});

// Owner 2026-11-04: a card brought back from an empty GY showed twice (M5 and GY, both "2×"). The pile cell that shows
// the empty mat is exit evidence by itself: the field card is the pile card moving, with no hand-touch timing and no prompt.
it.each(['GY','BANISHED'] as const)('a card that shows on the field while its %s cell shows the empty mat moves from that pile',async zone=>{
  const r=await ownerFieldRig();
  try{
    const {fieldZoneCells,fieldMatPoint,createFieldCalibration}=await import('@yugidraft/vision');
    const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]),cell=fieldZoneCells(undefined,calibration.zoneSpacing,calibration.zones).find(c=>c.zone===zone)!;
    const corner=fieldMatPoint({x:cell.x,y:cell.y},calibration);
    r.state.known=[{id:'pile-x',zone,cardId:'100'}];r.state.empty.add(`${corner.x}/${corner.y}`);r.state.halo=.2;
    r.state.outlines=[r.quad(.634)];await r.tick(20);
    expect(r.watcher.getSnapshot().pileClearSince?.[zone]).toBeDefined();
    const moved=r.state.events.filter(e=>['placed','moved'].includes(e.type)&&e.track.zone==='M4');
    expect(moved).toHaveLength(1);expect(moved[0]).toMatchObject({fromRef:'pile-x',track:{id:'pile-x',cardId:'100'}});
  }finally{r.dispose();}
});

for(const zone of ['GY','BANISHED'] as const)it.each([undefined,'DECK','EXTRA'] as const)('lifting two '+zone+' cards reveals the lower member and detects destination=%s',async destination=>{
  const r=await ownerFieldRig(),y=zone==='GY'?.3:.02;
  try{
    r.state.outlines=[r.quad(.9,y),...(destination?[r.quad(destination==='DECK'?.93:.03,.7,true)]:[])];await r.tick(10);
    const first=r.state.events.find(e=>e.type==='placed')!;
    r.state.known=[{id:'bottom',zone,cardId:'300'},{id:'middle',zone,cardId:'200'},{id:first.track.id,zone,cardId:'100'}];
    r.state.motion=.2;r.state.extraMotion=destination==='EXTRA'?.2:0;await r.tick(2);r.state.motion=0;r.state.extraMotion=0;
    r.state.faces.set(`0.9/${y}`,{id:'300',look:Array.from({length:12},(_,i)=>i%2?.1:.8),embedding:[0,1]});await r.tick(18);
    const removed=r.state.events.filter(e=>e.type==='removed');
    expect(removed.map(e=>e.track.id).sort()).toEqual([first.track.id,'middle'].sort());
    for(const event of removed)expect(event.destination).toBe(destination);
    expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='bottom')).toMatchObject({zone,cardId:'300',removed:false});
    await r.tick(10);expect(r.state.events.filter(e=>e.type==='removed')).toHaveLength(2);
  }finally{r.dispose();}
});

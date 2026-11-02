// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedQuad, RecognitionResult } from "@yugidraft/vision";

const state = vi.hoisted(() => ({
  initialSource: null as "photo" | "camera" | null, feedHub: null as any, feedDetect: vi.fn(), fieldWatch:null as any, roomHook:null as any,
  createRecognizer: vi.fn(), recognize: vi.fn(), detectCards: vi.fn(), dispose: vi.fn(), askAI: vi.fn(), recordFeedback:vi.fn(),
  hitTestQuad: vi.fn(), snapshot: vi.fn(), loadPhoto: vi.fn(), startCamera: vi.fn(), stop: vi.fn(),
}));

vi.mock("@yugidraft/vision", async importOriginal => ({
  ...await importOriginal<typeof import("@yugidraft/vision")>(),
  createRecognizer: state.createRecognizer,
  hitTestQuad: state.hitTestQuad,
  isPhysicalEntry: () => true,
  yugioh: { id: "yugioh", metaUrl: "/test/vision-meta.json", embedding: { id: "test-model" }, cardBack: { cardId: "card-back", imageUrl: "/test/back.jpg" } },
}));
vi.mock("../app/dev/vision-lab/use-vision-source", async () => {
  const { useRef, useState } = await import("react");
  return {
    useVisionSource: (onReset: () => void) => {
      const [source, setSource] = useState(state.initialSource);
      const videoRef = useRef<HTMLVideoElement>(null);
      return {
        source, videoRef, photoUrl: source === "photo" ? "blob:test-photo" : null,
        preparing: false, frameCount: source ? 1 : 0,
        dimensions: source ? { width: 640, height: 480 } : { width: 0, height: 0 }, error: null,
        snapshot: state.snapshot,
        loadPhoto: async (file: File) => { onReset(); state.loadPhoto(file); setSource("photo"); },
        startCamera: async () => { onReset(); state.startCamera(); setSource("camera"); },
        stop: () => { onReset(); state.stop(); setSource(null); },
      };
    },
  };
});

import { VisionLab } from "../app/dev/vision-lab/vision-lab";

const quads: DetectedQuad[] = [
  { quad: [{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .9 }, { x: .1, y: .9 }], kind: "face-up", confidence: .95, partial: false },
  { quad: [{ x: .6, y: .2 }, { x: .9, y: .2 }, { x: .9, y: .8 }, { x: .6, y: .8 }], kind: "face-down", confidence: .87, partial: true },
];
const cards = [
  { cardId: "46986414", passcode: 46986414, name: "Dark Magician" },
  { cardId: "89631139", passcode: 89631139, name: "Blue-Eyes White Dragon" },
  { cardId: "83764718", passcode: 83764718, name: "Monster Reborn" },
  { cardId: "55144522", passcode: 55144522, name: "Pot of Greed" },
  { cardId: "12580477", passcode: 12580477, name: "Raigeki" },
];
const zoneEntries=[
  {cardId:'41420027',passcode:41420027,name:'Solemn Judgment'},
  {cardId:'76375913',passcode:76375913,name:'Mystic Mine'},
  {cardId:'23995346',passcode:23995346,name:'Blue-Eyes Ultimate Dragon'},
  {cardId:'16178681',passcode:16178681,name:'Odd-Eyes Pendulum Dragon'},
  {cardId:'900000101',passcode:900000101,name:'Extra Deck Pendulum fixture'},
  {cardId:'900000102',passcode:900000102,name:'Unknown full type fixture'},
];
const catalogFacts=[
  ...cards.map((card,i)=>({id:card.passcode,name:card.name,type:i<2?(i?'Dragon / Normal Monster':'Spellcaster / Normal Monster'):'Spell Card',frameType:i<2?'normal':'spell',effectText:'Fixture card text'})),
  ...zoneEntries.slice(0,-1).map((card,i)=>({id:card.passcode,name:card.name,type:['Trap Card','Spell Card','Dragon / Fusion Monster','Dragon / Pendulum Effect Monster','Dragon / Xyz Pendulum Effect Monster'][i],frameType:['trap','spell','fusion','effect_pendulum','xyz_pendulum'][i],...(i===1?{race:'Field'}:{}),effectText:'Fixture card text'})),
];
const result: RecognitionResult = {
  candidates: cards.map((card, i) => ({ cardId: card.cardId, score: .9 - i * .05 })), tier: "not sure", backend: "wasm", cropJpeg: "test-crop-only",
  quality: { sharpness: 123.45, detected: true, cornersFound: true, framesUsed: 1, selectedFrameIndices: [0], fallback: false },
  timingsMs: { sharpness: 1, detect: 2, warp: 3, embed: 4, search: 5, total: 15 },
};
type TestBitmap = ImageBitmap & { close: ReturnType<typeof vi.fn>; label: string };
const bitmap = (label: string): TestBitmap => ({ label, width: 640, height: 480, close: vi.fn() }) as unknown as TestBitmap;
const snapshots: TestBitmap[] = [];
const clones: TestBitmap[] = [];
const createBitmap = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const fetcher = vi.fn();
const previewName = "Recognize a card: click its center in the image, or press Enter to use the image center";
const preview = () => screen.getByRole("button", { name: previewName });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.fieldWatch=null;state.roomHook=null;
  state.initialSource = "photo";
  snapshots.length = 0; clones.length = 0;
  state.createRecognizer.mockImplementation(() => ({ recognize: state.recognize, detectCards: state.detectCards, dispose: state.dispose, askAI: state.askAI,recordFeedback:state.recordFeedback }));
  state.recognize.mockResolvedValue(result);state.recordFeedback.mockResolvedValue({id:"sample"});
  state.detectCards.mockResolvedValue(quads);
  state.hitTestQuad.mockReturnValue(1);
  state.snapshot.mockImplementation(async () => {
    const frame = bitmap(`snapshot-${snapshots.length}`); snapshots.push(frame); return [frame];
  });
  createBitmap.mockReset().mockImplementation(async () => {
    const clone = bitmap(`clone-${clones.length}`); clones.push(clone); return clone;
  });
  createObjectURL.mockReturnValue("blob:test-frozen");
  const OriginalURL = URL;
  vi.stubGlobal("URL", class extends OriginalURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.stubGlobal("createImageBitmap", createBitmap);
  fetcher.mockReset().mockImplementation(async (url,init) => {
    if(String(url).endsWith('/api/cards/resolve')){const ids=JSON.parse(init.body).customCardIds??[];return Response.json({cards:catalogFacts.filter(card=>ids.includes(card.id))});}
    return Response.json(String(url).includes("remote-vision/feedback")?{enabled:false,askedAt:1,collectionEnabled:true}:{entries:cards});
  });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["fixture"], { type: "image/jpeg" })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderLab() {
  render(<VisionLab />);
  // Wait for metadata so the assertions exercise named candidates, not placeholder IDs.
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => undefined);
  vi.spyOn(preview(), "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON: () => ({}) });
}
async function recognizeCenter() {
  fireEvent.click(screen.getByRole("button", { name: "Recognize center card" }));
  const dialog=await screen.findByRole("dialog", { name: "Card matches" });
  await waitFor(()=>expect(dialog).toHaveAttribute('aria-busy','false'));
  return dialog;
}
async function freeze() {
  fireEvent.click(screen.getByRole("button", { name: "Freeze & outline cards" }));
  await screen.findByRole("button", { name: "Read card 1" });
}

describe("vision lab source and selected cards", () => {
  it("enables recognition after a photo loads without loading models automatically", async () => {
    state.initialSource = null;
    await renderLab();
    expect(screen.getByRole("button", { name: "Recognize center card" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Freeze & outline cards" })).toBeDisabled();
    const file = new File(["test image"], "cards.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Upload a card photo"), { target: { files: [file] } });
    expect(state.loadPhoto).toHaveBeenCalledWith(file);
    expect(await screen.findByText("Uploaded photo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Recognize center card" })).toBeEnabled();
    expect(screen.getByRole("img", { name: "Uploaded card photo" })).toHaveAttribute("src", "blob:test-photo");
    expect(state.createRecognizer).not.toHaveBeenCalled();
    expect(state.askAI).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(c=>c[0]==="/test/vision-meta.json")).toBe(true);
  });

  it("freezes a source and exposes each detected quad as a gold-outline card control", async () => {
    await renderLab(); await freeze();
    expect(state.detectCards).toHaveBeenCalledWith(clones[1]);
    expect(state.recognize).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Detected card outlines")).toHaveAttribute("viewBox", "0 0 640 480");
    expect(screen.getByRole("button", { name: "Read card 1" })).toHaveAttribute("points", "64,48 256,48 256,432 64,432");
    expect(screen.getByRole("button", { name: "Read card 2 (face down) (partial)" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText(/2 detected cards · gold outlines/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    expect(clones[1].close).toHaveBeenCalledTimes(1);
    expect(snapshots[0].close).toHaveBeenCalledTimes(1);
    expect(clones[0].close).not.toHaveBeenCalled();
  });

  it("preserves the exact pointer-selected quad through the primary recognition rerun", async () => {
    await renderLab(); await freeze();
    fireEvent.click(preview(), { detail: 1, clientX: 450, clientY: 240 });
    await screen.findByRole("dialog", { name: "Card matches" });
    expect(state.hitTestQuad).toHaveBeenCalledWith(quads, { x: 450 / 640, y: .5 }, { width: 640, height: 480 });
    expect(state.recognize.mock.calls[0][1]).toEqual({ clickPoint: { x: 450 / 640, y: .5 }, k: 5, includeCrop: true, deferAICrop:true, includeFeedback:false, includeRaw:false, earlyExit:true, card: quads[1] });
    expect(state.recognize.mock.calls[0][1].card).toBe(quads[1]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Recognize selected card" }));
    await waitFor(() => expect(state.recognize).toHaveBeenCalledTimes(2));
    expect(state.recognize.mock.calls[1][1].card).toBe(quads[1]);
    expect(state.recognize.mock.calls[1][1].clickPoint).toEqual({ x: 450 / 640, y: .5 });
  });

  it("lets an outline keyboard activation select its own exact quad once", async () => {
    await renderLab(); await freeze();
    fireEvent.keyDown(screen.getByRole("button", { name: "Read card 1" }), { key: "Enter" });
    await screen.findByRole("dialog", { name: "Card matches" });
    expect(state.recognize).toHaveBeenCalledTimes(1);
    expect(state.recognize.mock.calls[0][1].card).toBe(quads[0]);
    expect(state.recognize.mock.calls[0][1].clickPoint).toEqual({ x: .25, y: .5 });
    expect(state.hitTestQuad).not.toHaveBeenCalled();
  });
});

describe('live card inspection and owner capture',()=>{
  it('opens a loading popup immediately, keeps the camera live, and flashes the detected card',async()=>{
    state.initialSource='camera';const pending=deferred<RecognitionResult>();state.recognize.mockReturnValueOnce(pending.promise);
    await renderLab();fireEvent.click(preview(),{detail:1,clientX:160,clientY:240});
    const dialog=screen.getByRole('dialog',{name:'Card matches'});
    expect(dialog).toHaveAttribute('aria-busy','true');expect(within(dialog).getByText('Reading card…')).toBeVisible();
    expect(document.querySelector('video')).not.toHaveAttribute('hidden');
    expect(screen.getByRole('button',{name:'Freeze & outline cards'})).toBeInTheDocument();
    await waitFor(()=>expect(state.recognize).toHaveBeenCalled());
    expect(state.recognize.mock.calls[0][1]).toMatchObject({clickPoint:{x:.25,y:.5},maxFrames:1,deferAICrop:true});
    await act(async()=>{pending.resolve({...result,detectedCard:quads[0]});await pending.promise;});
    expect(screen.getByLabelText('Selected card outline').querySelector('polygon')).toHaveAttribute('points','64,48 256,48 256,432 64,432');
    expect(state.detectCards).not.toHaveBeenCalled();expect(state.stop).not.toHaveBeenCalled();
    expect(snapshots[0].close).toHaveBeenCalledTimes(1);
  });
  it('shows a full-size route image, complete text and stats, and top-five pick buttons when unsure',async()=>{
    fetcher.mockImplementation(async(url)=>Response.json(String(url).includes('/api/cards/resolve')?{cards:[{id:46986414,name:'Dark Magician',effectText:'The ultimate wizard in terms of attack and defense.\nFull card text stays readable.',type:'Normal Monster',attribute:'DARK',level:7,atk:2500,def:2100}]}:String(url).includes('feedback')?{enabled:false,askedAt:1,collectionEnabled:true}:{entries:cards}));
    await renderLab();const dialog=await recognizeCenter();
    const image=within(dialog).getByRole('img',{name:'Dark Magician'});
    expect(image).toHaveAttribute('src','/api/cards/46986414/image');expect(image).toHaveAttribute('width','360');
    expect(await within(dialog).findByText(/Full card text stays readable/)).toBeVisible();
    expect(within(dialog).getByText('ATK 2500')).toBeVisible();expect(within(dialog).getByText('DEF 2100')).toBeVisible();
    expect(within(dialog).getByText('Level 7')).toBeVisible();expect(within(dialog).getByText('not sure')).toBeVisible();
    expect(within(dialog).getAllByRole('button',{name:/Pick match/})).toHaveLength(5);
  });
  it('lets an owner confirm a correct sure top-1 without a consent prompt, then pause capture with the toggle',async()=>{
    const feedback={embedding:[1,0],gameId:'yugioh',modelId:'m',modelSha256:'a'.repeat(64),indexVersion:'v1',layoutKey:'l',space:'art-box' as const,deltaVersion:'v'};
    state.recognize.mockResolvedValue({...result,tier:'sure',feedback});
    fetcher.mockImplementation(async(url,init)=>Response.json(String(url).includes('feedback')?{enabled:init?.method==='PATCH'?JSON.parse(init.body).enabled:true,isAdmin:true,askedAt:null,collectionEnabled:true}:{entries:cards}));
    await renderLab();expect(screen.getByRole('checkbox',{name:'Save to training set'})).toBeChecked();
    expect(screen.getByText('Saving to training set')).toBeVisible();expect(screen.queryByRole('button',{name:'No thanks'})).toBeNull();
    expect(fetcher.mock.calls.some(([,init])=>init?.method==='PATCH')).toBe(false);
    const dialog=await recognizeCenter();expect(state.recognize.mock.calls[0][1].includeFeedback).toBe(true);
    expect(within(dialog).queryByRole('button',{name:/Pick match/})).toBeNull();
    fireEvent.click(within(dialog).getByRole('button',{name:'Confirm'}));
    expect(state.recordFeedback).toHaveBeenCalledWith(expect.objectContaining({feedback}),'46986414','pick');
    await screen.findByText('Recognition sample saved.');
    fireEvent.click(screen.getByRole('checkbox',{name:'Save to training set'}));
    await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Save to training set'})).not.toBeChecked());
    await recognizeCenter();fireEvent.keyDown(window,{key:'2'});expect(state.recordFeedback).toHaveBeenCalledTimes(1);
  });
  it('does not reopen a dismissed loading popup or display stale results after Stop',async()=>{
    const pending=deferred<RecognitionResult>();state.recognize.mockReturnValueOnce(pending.promise);
    await renderLab();fireEvent.click(screen.getByRole('button',{name:'Recognize center card'}));
    expect(screen.getByRole('dialog',{name:'Card matches'})).toBeVisible();
    await waitFor(()=>expect(state.recognize).toHaveBeenCalled());fireEvent.keyDown(window,{key:'Escape'});
    await act(async()=>{pending.resolve(result);await pending.promise;});expect(screen.queryByRole('dialog')).toBeNull();
    const stopped=deferred<RecognitionResult>();state.recognize.mockReturnValueOnce(stopped.promise);
    fireEvent.click(screen.getByRole('button',{name:'Recognize center card'}));await waitFor(()=>expect(state.recognize).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button',{name:'Stop'}));await act(async()=>{stopped.resolve(result);await stopped.promise;});
    expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByText('No card recognized yet')).toBeVisible();
  });
  it('ignores live-camera letterboxing and reports a click with no detected card without saving a fallback',async()=>{
    state.initialSource='camera';await renderLab();
    vi.mocked(preview().getBoundingClientRect).mockReturnValue({x:0,y:0,top:0,left:0,right:800,bottom:480,width:800,height:480,toJSON:()=>({})});
    fireEvent.click(preview(),{detail:1,clientX:30,clientY:240});expect(state.snapshot).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(preview(),{detail:1,clientX:240,clientY:240});
    const dialog=await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No card detected under this click.')).toBeVisible();
    expect(state.recognize.mock.calls[0][1].clickPoint).toEqual({x:.25,y:.5});
    expect(within(dialog).queryByRole('button',{name:'Confirm'})).toBeNull();expect(state.recordFeedback).not.toHaveBeenCalled();
    expect(document.querySelector('video')).not.toHaveAttribute('hidden');
  });
  it('keeps confirmation available when full card text cannot load and aborts details on dismissal',async()=>{
    const pending=deferred<Response>();let signal:AbortSignal|undefined;
    fetcher.mockImplementation(async(url,init)=>{
      if(String(url).includes('/api/cards/resolve')){signal=init.signal;return pending.promise;}
      return Response.json(String(url).includes('feedback')?{enabled:false,askedAt:1,collectionEnabled:true}:{entries:cards});
    });
    await renderLab();const dialog=await recognizeCenter();expect(within(dialog).getByRole('button',{name:'Confirm'})).toBeEnabled();
    fireEvent.keyDown(window,{key:'Escape'});expect(signal?.aborted).toBe(true);
    await act(async()=>{pending.resolve(Response.json({cards:[]}));await pending.promise;});expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('pauses capture immediately while the owner preference request is still in flight',async()=>{
    const pending=deferred<Response>();
    state.recognize.mockResolvedValue({...result,feedback:{embedding:[1,0]}});
    fetcher.mockImplementation(async(url,init)=>{
      if(String(url).includes('feedback'))return init?.method==='PATCH'?pending.promise:Response.json({enabled:true,isAdmin:true,askedAt:1,collectionEnabled:true});
      return Response.json({entries:cards});
    });
    await renderLab();const dialog=await recognizeCenter();
    fireEvent.click(screen.getByRole('checkbox',{name:'Save to training set'}));fireEvent.click(within(dialog).getByRole('button',{name:'Confirm'}));
    expect(state.recordFeedback).not.toHaveBeenCalled();
    await act(async()=>{pending.resolve(Response.json({enabled:false,isAdmin:true,askedAt:1,collectionEnabled:true}));await pending.promise;});
  });
  it('waits for the owner preference before preparing a read so an early confirmation retains evidence',async()=>{
    const pending=deferred<Response>();
    fetcher.mockImplementation(async(url)=>String(url).includes('feedback')?pending.promise:Response.json({entries:cards}));
    await renderLab();expect(screen.getByRole('button',{name:'Recognize center card'})).toBeDisabled();
    fireEvent.click(preview(),{detail:1,clientX:160,clientY:240});expect(state.recognize).not.toHaveBeenCalled();
    await act(async()=>{pending.resolve(Response.json({enabled:true,isAdmin:true,askedAt:null,collectionEnabled:true}));await pending.promise;});
    await recognizeCenter();expect(state.recognize.mock.calls[0][1].includeFeedback).toBe(true);
  });
  it('allows local recognition in the public lab when no authenticated feedback preference is available',async()=>{
    fetcher.mockImplementation(async(url)=>String(url).includes('feedback')?Response.json({error:'unauthorized'},{status:401}):Response.json({entries:cards}));
    await renderLab();await recognizeCenter();expect(state.recognize.mock.calls[0][1].includeFeedback).toBe(false);
  });
});

describe("vision lab match keyboard controls", () => {
  it("confirms the numbered candidate, closes the popover, and restores preview focus", async () => {
    await renderLab(); const dialog = await recognizeCenter();
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.queryByRole("dialog", { name: "Card matches" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Confirmed: Blue-Eyes White Dragon");
    expect(preview()).toHaveFocus();
    expect(screen.getByRole("button", { name: "Export 1 confirmation" })).toBeEnabled();
  });

  it("moves through popover buttons with arrows and restores preview focus on Escape", async () => {
    await renderLab(); const dialog = await recognizeCenter();
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Card matches" })).not.toBeInTheDocument();
    expect(preview()).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }])("preserves modified or composing shortcuts: %j", async (modifier) => {
    await renderLab(); const dialog = await recognizeCenter();
    for (const key of ["2", "ArrowDown", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, ...modifier, bubbles: true, cancelable: true });
      fireEvent(window, event);
      expect(event.defaultPrevented).toBe(false);
      expect(dialog).toHaveFocus();
      expect(dialog).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    }
  });

  it("preserves digits typed into correction search", async () => {
    await renderLab(); const dialog = await recognizeCenter();
    const search = screen.getByRole("searchbox", { name: "Wrong card? Find it by name or passcode" });
    search.focus();
    const event = new KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true });
    fireEvent(search, event);
    expect(event.defaultPrevented).toBe(false);
    expect(search).toHaveFocus(); expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("vision lab bitmap ownership", () => {
  it.each(["frozen", "detection"] as const)("closes a delayed %s clone after Stop without calling a disposed recognizer", async (stage) => {
    await renderLab(); await recognizeCenter();
    fireEvent.keyDown(window, { key: "Escape" });
    const pendingClone = deferred<ImageBitmap>();
    const delayed = bitmap(`delayed-${stage}`);
    const frozen = bitmap("frozen");
    if (stage === "detection") createBitmap.mockResolvedValueOnce(frozen);
    createBitmap.mockImplementationOnce(() => pendingClone.promise);
    fireEvent.click(screen.getByRole("button", { name: "Freeze & outline cards" }));
    await waitFor(() => expect(createBitmap).toHaveBeenCalledTimes(stage === "detection" ? 2 : 1));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(state.dispose).toHaveBeenCalledTimes(1);
    await act(async () => { pendingClone.resolve(delayed); await pendingClone.promise; });
    await waitFor(() => expect(delayed.close).toHaveBeenCalledTimes(1));
    expect(state.detectCards).not.toHaveBeenCalled();
    expect(state.createRecognizer).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Detected card outlines")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Freeze & outline cards" })).toBeDisabled();
    expect(snapshots[1].close).toHaveBeenCalledTimes(1);
    if (stage === "detection") expect(frozen.close).toHaveBeenCalledTimes(1);
  });

  it("closes the detection clone, frozen frame, and snapshot if recognizer initialization fails", async () => {
    state.createRecognizer.mockImplementationOnce(() => { throw new Error("Model initialization failed"); });
    await renderLab();
    fireEvent.click(screen.getByRole("button", { name: "Freeze & outline cards" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model initialization failed");
    expect(clones).toHaveLength(2);
    expect(clones[0].close).toHaveBeenCalledTimes(1);
    expect(clones[1].close).toHaveBeenCalledTimes(1);
    expect(snapshots[0].close).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-frozen");
    expect(state.detectCards).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Detected card outlines")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Freeze & outline cards" })).toBeEnabled();
  });
});

 it('records an opted-in search correction with its recognition evidence, and leaves default-off confirmations local',async()=>{
  const feedback={embedding:[1,0],gameId:'yugioh',modelId:'m',modelSha256:'a'.repeat(64),indexVersion:'v1',layoutKey:'l',space:'art-box' as const,deltaVersion:'v'};
  state.recognize.mockResolvedValue({...result,feedback});
  await renderLab();await recognizeCenter();
  fireEvent.click(screen.getAllByRole('button',{name:'Confirm match 1: Dark Magician'})[0]);
  expect(state.recordFeedback).not.toHaveBeenCalled();
  cleanup();
  fetcher.mockImplementation(async(url)=>Response.json(String(url).includes('remote-vision/feedback')?{enabled:true,askedAt:1,collectionEnabled:true}:{entries:cards}));
  render(<VisionLab/>);await act(async()=>undefined);await recognizeCenter();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Monster'}});
  fireEvent.click(screen.getByRole('button',{name:'Monster Reborn'}));
  expect(state.recordFeedback).toHaveBeenCalledWith(expect.objectContaining({feedback}),'83764718','search');
  await screen.findByText('Recognition sample saved.');
 });
it('shows the default-off consent prompt once under React StrictMode',async()=>{
  let asked=false;
  fetcher.mockImplementation(async(url,init)=>{
    if(!String(url).includes('/api/remote-vision/feedback'))return Response.json({entries:cards});
    if(init?.method==='PATCH'){const body=JSON.parse(init.body);if(body.asked){const prompted=!asked;asked=true;return Response.json({enabled:false,askedAt:1,collectionEnabled:true,prompted});}return Response.json({enabled:body.enabled,askedAt:1,collectionEnabled:true});}
    return Response.json({enabled:false,askedAt:asked?1:null,collectionEnabled:true});
  });
  render(<React.StrictMode><VisionLab/></React.StrictMode>);
  await screen.findByRole('button',{name:'No thanks'});
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==='PATCH'&&JSON.parse(init.body).asked)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'No thanks'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'No thanks'})).toBeNull());expect(state.recordFeedback).not.toHaveBeenCalled();
});


// Field watcher lifecycle shares this existing browser test file.
import { useFieldWatcher } from "../src/lib/remote/use-field-watcher";
import { FieldCalibrationControl } from "../src/components/remote/field-calibration";

describe('field calibration modal',()=>{
  it('escapes feed containment, traps focus, closes with Escape and restores its opener',()=>{
    function CalibrationHarness(){
      const [open,setOpen]=React.useState(false);
      return <div data-testid="small-calibration-feed"><button type="button" onClick={()=>setOpen(true)}>Calibrate zones</button>{open?<FieldCalibrationControl video={null} onSave={()=>setOpen(false)} onCancel={()=>setOpen(false)}/>:null}</div>;
    }
    render(<CalibrationHarness/>);
    const opener=screen.getByRole('button',{name:'Calibrate zones'});opener.focus();fireEvent.click(opener);
    const modal=screen.getByRole('dialog',{name:'Calibrate field zones'});
    expect(screen.getByTestId('small-calibration-feed')).not.toContainElement(modal);
    expect(modal).toHaveAttribute('aria-modal','true');expect(modal).toHaveFocus();
    const cancel=within(modal).getByRole('button',{name:'Cancel calibration'});
    cancel.focus();fireEvent.keyDown(cancel,{key:'Tab'});expect(cancel).toHaveFocus();
    modal.focus();fireEvent.keyDown(modal,{key:'Tab',shiftKey:true});expect(cancel).toHaveFocus();
    fireEvent.keyDown(modal,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(opener).toHaveFocus();
  });
});

describe('field watcher presentation',()=>{
  it('uses feed toolbar slots and shows one announced body prompt with a readable zone',async()=>{
    const {FieldWatcherUI}=await import('../src/components/remote/field-watcher-ui');
    const host=document.createElement('div');host.innerHTML='<span data-field-watcher-status-slot></span><div data-feed-toolbar><span data-field-watcher-controls></span></div>';document.body.append(host);
    const choose=vi.fn(),dismiss=vi.fn(),enable=vi.fn(),calibrate=vi.fn();
    const prompts=[{id:'first',zone:'M2',candidates:[{id:'46986414',label:'Dark Magician'}]},{id:'second',zone:'S4',candidates:[{id:'83764718',label:'Monster Reborn'}]},{id:'third',zone:'EMZ1',candidates:[]}];
    try{
      render(<FieldWatcherUI host={host} enabled statusLabel="Watching field" calibrated={false} calibrationDisabled={false} onEnabledChange={enable} onCalibrate={calibrate} prompts={prompts} pending={false} onChoose={choose} onDismiss={dismiss}/>);
      expect(host.querySelector('[data-field-watcher-controls]')).toContainElement(screen.getByRole('checkbox',{name:'Auto-detect cards'}));
      expect(host.querySelector('[data-field-watcher-status-slot]')).toContainElement(screen.getByTestId('field-watcher-status'));
      expect(screen.getAllByTestId('field-watcher-prompt')).toHaveLength(1);
      const prompt=screen.getByTestId('field-watcher-prompt');expect(host).not.toContainElement(prompt);
      expect(prompt).toHaveAccessibleDescription(/Main Monster Zone 2/);expect(within(prompt).getByText('+2 more')).toBeVisible();
      expect(screen.getByRole('status',{name:'Card detection updates'})).toHaveTextContent('New card needs a choice');
      expect(screen.queryByRole('button',{name:'Monster Reborn'})).toBeNull();
      fireEvent.click(within(prompt).getByRole('button',{name:'Dark Magician'}));expect(choose).toHaveBeenCalledWith('first','46986414');
      fireEvent.click(within(prompt).getByRole('button',{name:'Dismiss'}));expect(dismiss).toHaveBeenCalledWith('first');
      fireEvent.click(screen.getByRole('checkbox',{name:'Auto-detect cards'}));expect(enable).toHaveBeenCalledWith(false);
      fireEvent.click(screen.getByRole('button',{name:'Calibrate zones'}));expect(calibrate).toHaveBeenCalledOnce();
    }finally{host.remove();}
  });
  it('keeps prompt choices and dismissal disabled while an action is pending',async()=>{
    const {FieldWatcherUI}=await import('../src/components/remote/field-watcher-ui');
    const host=document.createElement('div');host.innerHTML='<span data-field-watcher-status-slot></span><div data-feed-toolbar><span data-field-watcher-controls></span></div>';document.body.append(host);
    try{
      render(<FieldWatcherUI host={host} enabled statusLabel="Watching field" calibrated calibrationDisabled onEnabledChange={()=>{}} onCalibrate={()=>{}} prompts={[{id:'first',zone:'GY',candidates:[{id:'46986414',label:'Dark Magician'}]}]} pending onChoose={()=>{}} onDismiss={()=>{}}/>);
      expect(screen.getByRole('button',{name:'Recalibrate'})).toBeDisabled();
      const prompt=screen.getByTestId('field-watcher-prompt');expect(prompt).toHaveAttribute('aria-busy','true');
      for(const button of within(prompt).getAllByRole('button'))expect(button).toBeDisabled();
    }finally{host.remove();}
  });
  it('keeps a measured bottom-edge prompt inside the viewport when its feed is only 96 pixels tall',async()=>{
    const {FieldWatcherUI}=await import('../src/components/remote/field-watcher-ui');
    vi.stubGlobal('innerWidth',640);vi.stubGlobal('innerHeight',400);
    const host=document.createElement('div');document.body.append(host);
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
      const bounds=this.dataset.testid==='field-watcher-prompt'?{left:0,top:0,width:300,height:330}:{left:20,top:80,width:240,height:96};
      return {...bounds,x:bounds.left,y:bounds.top,right:bounds.left+bounds.width,bottom:bounds.top+bounds.height,toJSON:()=>({})};
    });
    try{
      render(<FieldWatcherUI host={host} enabled statusLabel="Watching field" calibrated calibrationDisabled={false} onEnabledChange={()=>{}} onCalibrate={()=>{}} prompts={[{id:'bottom',zone:'S5',quad:[{x:.8,y:.7},{x:.9,y:.7},{x:.9,y:.99},{x:.8,y:.99}],candidates:cards.map(card=>({id:card.cardId,label:card.name}))}]} pending={false} onChoose={()=>{}} onDismiss={()=>{}}/>);
      const prompt=screen.getByTestId('field-watcher-prompt'),top=Number.parseFloat(prompt.style.top),left=Number.parseFloat(prompt.style.left);
      expect(host).not.toContainElement(prompt);expect(top).toBeGreaterThanOrEqual(8);expect(top+330).toBeLessThanOrEqual(392);
      expect(left).toBeGreaterThanOrEqual(8);expect(left+300).toBeLessThanOrEqual(632);
      expect(within(prompt).getAllByRole('button')).toHaveLength(6);
    }finally{host.remove();}
  });
  it('places destination and Undo notices above the existing feed toolbar in the body layer',async()=>{
    const {FieldWatcherUI}=await import('../src/components/remote/field-watcher-ui');
    const host=document.createElement('div');host.innerHTML='<div data-feed-toolbar></div>';document.body.append(host);
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
      const bounds=this.dataset.testid==='departure-ui'?{left:0,top:0,width:300,height:72}:this.hasAttribute('data-feed-toolbar')?{left:20,top:300,width:400,height:26}:{left:20,top:60,width:400,height:280};
      return {...bounds,x:bounds.left,y:bounds.top,right:bounds.left+bounds.width,bottom:bounds.top+bounds.height,toJSON:()=>({})};
    });
    try{
      render(<FieldWatcherUI host={host} enabled statusLabel="Watching field" calibrated calibrationDisabled={false} onEnabledChange={()=>{}} onCalibrate={()=>{}} prompts={[]} pending={false} onChoose={()=>{}} onDismiss={()=>{}} noticeTestId="departure-ui" notice={<>Card left the field <button type="button">GY</button><button type="button">Undo</button></>}/>);
      const notice=screen.getByTestId('departure-ui');expect(host).not.toContainElement(notice);
      expect(Number.parseFloat(notice.style.top)+72).toBeLessThanOrEqual(292);
      expect(within(notice).getByRole('button',{name:'Undo'})).toBeEnabled();
    }finally{host.remove();}
  });
});
it('keeps Ask AI available when the large source crop is deferred in the worker',async()=>{
  state.recognize.mockResolvedValue({...result,aiCropJpeg:undefined,aiCropToken:'scoped-crop-1'});
  state.askAI.mockResolvedValue({name:null,match:null});await renderLab();await recognizeCenter();
  expect(screen.getByRole('button',{name:'Ask AI'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Ask AI'}));
  await waitFor(()=>expect(state.askAI).toHaveBeenCalledWith(expect.objectContaining({aiCropToken:'scoped-crop-1'}),expect.any(Object)));
});
it('desktop outlined clicks read the exact held frame once without resampling or redetecting',async()=>{
  const {readCard,disposeRecognizer}=await import('../src/components/remote/ui/recognizer');
  const first=document.createElement('canvas'),second=document.createElement('canvas');first.width=second.width=640;first.height=second.height=480;
  try {
    await readCard(null,{x:.25,y:.5},{decklist:[],seen:[]},new AbortController().signal,quads[0],[first,second]);
    expect(createBitmap).toHaveBeenCalledTimes(1);expect(createBitmap).toHaveBeenCalledWith(first);
    expect(state.recognize).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({card:quads[0],maxFrames:1,deferAICrop:true}));
    expect(state.detectCards).not.toHaveBeenCalled();
  }finally{disposeRecognizer();}
});
import { HoloField } from "../src/components/remote/ui/holo-field";
import { cellsFor, foundationZone } from "../src/components/remote/ui/model";
it('renders two interactive EMZ above the main row only for Advanced and Domain',()=>{
  const twin=[{ref:'extra-right',zone:'extra-monster',slot:2,faceUp:false,position:'attack' as const}];
  const onRv=vi.fn(),onAttack=vi.fn();
  const props={seat:0,name:'Owner',twin,info:()=>undefined,rv:'m4' as const,onRv,picking:true,warnRefs:new Set<string>(),onActivate:vi.fn(),onAttack,onInspect:vi.fn()};
  const view=render(<HoloField {...props} format="normal"/>);
  expect(screen.getByRole('button',{name:/Extra Monster Zone, left: empty/i})).toBeVisible();
  const right=screen.getByRole('button',{name:/Extra Monster Zone, right: face-down/i});
  expect(right).toHaveAttribute('data-zone','emz2');
  fireEvent.keyDown(screen.getByRole('button',{name:/Monster zone 4: empty/i}),{key:'ArrowUp'});
  expect(onRv).toHaveBeenCalledWith('emz2');fireEvent.keyDown(right,{key:'a'});expect(onAttack).toHaveBeenCalledWith('emz2',twin[0]);
  expect(cellsFor(twin).emz2.card?.ref).toBe('extra-right');
  expect(foundationZone('emz2')).toEqual({zone:'extra-monster',slot:2});
  for(const format of ['domain','genesys','genesys-domain'] as const) {
    view.rerender(<HoloField {...props} format={format}/>);
    expect(screen.queryAllByRole('button',{name:/Extra Monster Zone,/i})).toHaveLength(format==='domain'?2:0);
  }
});
it('the watcher hook only starts for an active feed owner and persists its default-on toggle',async()=>{
  localStorage.clear();const create=vi.fn(async()=>null),onEvent=vi.fn();
  const hook=renderHook(({owner})=>useFieldWatcher({owner,active:true,seatKey:'test-seat',sourceKey:'camera',create,onEvent}),{initialProps:{owner:false}});
  await act(async()=>undefined);expect(create).not.toHaveBeenCalled();expect(hook.result.current.enabled).toBe(true);
  hook.rerender({owner:true});await waitFor(()=>expect(create).toHaveBeenCalledOnce());
  act(()=>hook.result.current.setEnabled(false));expect(JSON.parse(localStorage.getItem('dd-field-watcher:v1:test-seat')!)).toMatchObject({enabled:false});
  hook.unmount();const again=renderHook(()=>useFieldWatcher({owner:true,active:true,seatKey:'test-seat',create,onEvent}));await act(async()=>undefined);
  expect(again.result.current.enabled).toBe(false);expect(create).toHaveBeenCalledOnce();again.unmount();localStorage.clear();
});
it('the watcher hook discards resource setup that resolves after unmount',async()=>{
  localStorage.clear();const ready=deferred<null>(),create=vi.fn(()=>ready.promise);
  const hook=renderHook(()=>useFieldWatcher({owner:true,active:true,seatKey:'late-seat',create,onEvent:vi.fn()}));await waitFor(()=>expect(create).toHaveBeenCalledOnce());
  hook.unmount();await act(async()=>{ready.resolve(null);await ready.promise;});localStorage.clear();
});

vi.mock('../src/components/remote/ui/video-hub',()=>({useVideoHub:()=>state.feedHub}));
vi.mock('../src/components/remote/ui/recognizer',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/components/remote/ui/recognizer')>();
 return {...original,attachOwnFeed:()=>{},detachOwnFeed:()=>{},detectCards:state.feedDetect,ownFeedFrames:vi.fn(async()=>[]),ownFieldResources:(...args:Parameters<typeof original.ownFieldResources>)=>state.fieldWatch?Promise.resolve({entries:state.fieldWatch.entries??cards,cpuBusy:()=>false}):original.ownFieldResources(...args)};
});
vi.mock('../src/lib/remote/use-field-watcher',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/lib/remote/use-field-watcher')>(),react=await import('react');
 return {...original,useFieldWatcher:(options:Parameters<typeof original.useFieldWatcher>[0])=>{
  if(!state.fieldWatch)return original.useFieldWatcher(options);
  const fixture=state.fieldWatch;fixture.onEvent=options.onEvent;
  react.useEffect(()=>{void options.create().then(config=>{fixture.config=config;fixture.ready=true;});},[]);
  return fixture.watch;
 }};
});

it.each(['face-down restart','face-down restart needs flip','different-card restart','face-down moved restart','different-card moved restart','unbound same-spot swap','second copy with hidden first track','automatic second copy with hidden first track'])('round 2 NB1/NS2: resolves %s without duplicating or stealing a twin',async scenario=>{
 const {AutoFieldWatcher}=await import('../src/components/remote/field-watcher');
 const {createRoomMutationQueue}=await import('../src/lib/remote/room-mutations');
 const {ygoModule}=await import('@yugidraft/shared/remote');
 const faceDown=scenario.startsWith('face-down'),secondCopy=scenario.includes('second copy'),automatic=scenario.startsWith('automatic'),unbound=scenario.startsWith('unbound'),moved=scenario.includes('moved');
 const old={ref:'old-twin',zone:'monster',slot:2,faceUp:!faceDown||scenario==='face-down restart needs flip',cardId:46986414,name:'Dark Magician',position:'attack' as const};
 let room:any={guildId:'g',slug:'round2',mySeat:0,lastSeq:0,status:'active',seats:[{seat:0,userId:1}],state:ygoModule.initialState({seatCount:2})};room.state.seats[0].twin=[old];
 const track:any={id:'candidate',zone:secondCopy?'M3':'M2',card:quads[0],faceDown,position:'attack',state:automatic?'identified':'prompt',...(automatic?{cardId:cards[0].cardId}:{}),visible:true,removed:false,firstSeen:0,lastSeen:1000};
 const tracks=secondCopy||unbound?[{...track,id:old.ref,zone:'M2',state:'identified',visible:false,cardId:'46986414'},track]:[track];
 const confirm=vi.fn((id:string,cardId?:string,ref?:string)=>{const i=tracks.findIndex(t=>t.id===ref&&t.id!==id);if(i>=0)tracks.splice(i,1);Object.assign(track,{id:ref??id,cardId,state:'identified'});});
 const fixture:any={ready:false,watch:{enabled:true,setEnabled:vi.fn(),setCalibration:vi.fn(),snapshot:{status:'watching',tracks,metrics:{detectorMs:1,dutyPercent:1}},getTrack:(id:string)=>tracks.find(t=>t.id===id),confirm,forget:vi.fn(),isRemoved:()=>false,dismiss:vi.fn()}};state.fieldWatch=fixture;
 const source={local:true};state.feedHub={cameraOn:true,sourceFor:()=>source,publishFieldTracks:vi.fn()};
 const post=vi.fn(async(proposal:any)=>{room={...room,lastSeq:room.lastSeq+1,state:ygoModule.reduce(room.state,{...proposal,idempotencyKey:`r2-${room.lastSeq+1}`})};return room;});
 const queue=createRoomMutationQueue(()=>room,post);
 const host=document.createElement('div');host.dataset.testid='feed-box-0';host.innerHTML='<span data-field-watcher-status-slot></span><div data-feed-toolbar><span data-field-watcher-controls></span></div>';document.body.append(host);
 try{
  render(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);await waitFor(()=>expect(fixture.ready).toBe(true));
  const chosen=secondCopy?cards[0]:cards[1];
  await act(async()=>fixture.onEvent({type:automatic?'placed':'prompt',track:{...track},...(!secondCopy&&!unbound?{bindRef:old.ref}:{}),source:'auto',reason:unbound?'changed':'restart',...(!faceDown?{result:{...result,candidates:[{cardId:chosen.cardId,score:.99}]}}:{})}));
  if(moved)track.zone='M3';
  if(!automatic)fireEvent.click(await screen.findByRole('button',{name:new RegExp(faceDown?'Confirm face-down card':chosen.name)}));
  await waitFor(()=>expect(confirm).toHaveBeenCalledOnce());expect(screen.queryByTestId('field-watcher-prompt')).toBeNull();
  expect(room.state.seats[0].twin).toHaveLength(secondCopy?2:1);
  const target=room.state.seats[0].twin.find((c:any)=>c.ref===(secondCopy?'candidate':old.ref));
  expect(target.faceUp).toBe(!faceDown);if(!faceDown)expect(target.cardId).toBe(Number(chosen.cardId));
  expect(confirm).toHaveBeenCalledWith('candidate',faceDown?undefined:chosen.cardId,secondCopy?undefined:old.ref);
  expect(post.mock.calls.map(([p])=>p.type)).toEqual(secondCopy?['twin.place']:[...(faceDown?(old.faceUp?['twin.flip']:[]):['card.identified']),...(moved?['twin.move']:[])]);
  if(moved)expect(target.slot).toBe(3);
  if(secondCopy)expect(room.state.seats[0].twin.find((c:any)=>c.ref===old.ref).slot).toBe(2);
 }finally{cleanup();host.remove();state.fieldWatch=null;}
});

vi.mock('next/navigation',()=>({useRouter:()=>({push:()=>{}})}));
vi.mock('swr',async importOriginal=>{
 const original=await importOriginal<typeof import('swr')>();
 return {...original,default:(...args:Parameters<typeof original.default>)=>state.roomHook??original.default(...args)};
});
it.each(['hung action','hung recovery','hung action and recovery'])('round 2 NS1: %s times out, shows an error and releases the shared queue',async scenario=>{
 const {useRemoteRoom}=await import('../src/components/remote/ui/use-remote-room');
 vi.useFakeTimers();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('The operation timed out','TimeoutError')),ms);return controller.signal;});
 const room:any={slug:'timeout-room',lastSeq:0,status:'active'},signals:AbortSignal[]=[];
 const mutate=vi.fn((update?:any)=>update?Promise.resolve(typeof update==='function'?update(room):update):new Promise(()=>{}));
 state.roomHook={data:room,mutate};
 fetcher.mockImplementation((url,init)=>{
  const action=String(url).endsWith('/actions');
  if(action&&JSON.parse(init.body).action.type==='phase.advance')return Promise.resolve(Response.json({...room,lastSeq:2}));
  if((action&&scenario!=='hung recovery')||(!action&&scenario!=='hung action'))return new Promise((_resolve,reject)=>{const signal=init?.signal;if(signal){signals.push(signal);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}});
  return Promise.resolve(action?Response.json({error:'Rejected action'},{status:409}):Response.json({...room,lastSeq:1}));
 });
 let done=false,first:any;const hook=renderHook(()=>useRemoteRoom(room.slug));
 try{
  await act(async()=>{void hook.result.current.action({type:'lp.change',actorSeat:0,seat:0,delta:-100,reason:'damage'}).then(value=>{done=true;first=value;});});
  expect(done).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(scenario==='hung action and recovery'?20001:10001);});
  expect(done).toBe(true);expect(first).toBeNull();expect(hook.result.current.error).toMatch(/timed out|Rejected action/i);
  expect(signals.every(signal=>signal.aborted)).toBe(true);expect(timeout).toHaveBeenCalledWith(10000);expect(mutate.mock.calls.every(args=>args.length>0)).toBe(true);
  let next:any;await act(async()=>{next=await hook.result.current.action({type:'phase.advance',actorSeat:0});});expect(next.lastSeq).toBe(2);expect(hook.result.current.error).toBe('');
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).baseSeq).toBe(scenario==='hung action'?1:0);
 }finally{hook.unmount();state.roomHook=null;vi.useRealTimers();}
});
it('owner and observer feed clicks select an identified physical ref without capturing or recognizing',async()=>{
  const {Feed}=await import('../src/components/remote/ui/feed');
  const card={ref:'physical-cached',cardId:46986414,name:'Dark Magician',quad:[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}]};
  const source={local:true,attach:(video:HTMLVideoElement)=>{Object.defineProperty(video,'videoWidth',{value:1280,configurable:true});Object.defineProperty(video,'videoHeight',{value:720,configurable:true});return ()=>{};}};
  vi.stubGlobal('ResizeObserver',class{constructor(private callback:()=>void){}observe(){this.callback();}disconnect(){}});
  const width=vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(640),height=vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(360);
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:640,bottom:360,width:640,height:360,x:0,y:0,toJSON:()=>({})});
  const capture=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>{throw Error('cached click must not capture');});
  try{for(const you of [true,false]){
    capture.mockClear();capture.mockImplementation(()=>{throw Error('cached click must not capture');});state.feedDetect.mockClear();
    const select=vi.fn(),begin=vi.fn(),point=vi.fn();
    state.feedHub={sourceFor:()=>source,setFrozen:()=>{},trackedAt:vi.fn(()=>card),trackedCards:()=>[card]};
    const view=render(<Feed seat={0} name="Owner" you={you} health={{q:'good',label:'Live',detail:''}} marks={[]} reticles={[]} onBegin={begin} onPoint={point} onSelect={select} onAdd={()=>{}} holdSelection={false} emptyText=""/>);
    fireEvent.click(view.getByTestId('feed-0'),{clientX:192,clientY:108});
    expect(select).toHaveBeenCalledWith(0,expect.objectContaining({cached:card,quad:card.quad}));
    expect(begin).not.toHaveBeenCalled();expect(point).not.toHaveBeenCalled();expect(state.feedDetect).not.toHaveBeenCalled();expect(capture).not.toHaveBeenCalled();
    capture.mockImplementation(()=>({drawImage:()=>{}} as any));
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:640,height:360,close:()=>{}})));
    state.feedDetect.mockResolvedValue({status:'ready',cards:[{quad:card.quad,kind:'face-up',confidence:.9,partial:false,refined:true}],ms:1});
    fireEvent.keyDown(view.getByTestId('feed-box-0'),{key:'f'});await within(view.container).findByTestId('quads');
    const newer={...card,ref:'new-card',cardId:89631139,name:'Blue-Eyes White Dragon'};
    state.feedHub.trackedAt.mockReturnValue(newer);state.feedHub.trackedCards=()=>[newer];
    fireEvent.click(view.getByTestId('feed-0'),{clientX:192,clientY:108});
    expect(select.mock.calls.at(-1)?.[1].cached).toEqual(card);
    expect(select.mock.calls.at(-1)?.[1].frozenFrame).toBe(view.getByTestId('frozen-frame').querySelector('canvas'));
    view.unmount();
  }}finally{width.mockRestore();height.mockRestore();rect.mockRestore();capture.mockRestore();}
});

async function typedWatcherFixture(entry:typeof cards[number],zone:string,twins:any[]=[],type:'placed'|'prompt'|'moved'='placed',bindRef?:string,beforePost?:(proposal:any)=>Promise<void>){
 const {AutoFieldWatcher}=await import('../src/components/remote/field-watcher'),{createRoomMutationQueue}=await import('../src/lib/remote/room-mutations'),{ygoModule}=await import('@yugidraft/shared/remote');
 let room:any={guildId:'g',slug:'typed-zone',mySeat:0,lastSeq:0,status:'active',format:{id:'normal'},seats:[{seat:0,userId:1}],state:ygoModule.initialState({seatCount:2})};room.state.seats[0].twin=twins;
 const track:any={id:type==='moved'?twins[0].ref:'physical-typed',zone,card:quads[0],cardId:entry.cardId,faceDown:false,position:'attack',state:type==='prompt'?'prompt':'identified',visible:true,removed:false,firstSeen:0,lastSeen:1000};
 const confirm=vi.fn((id:string,cardId?:string,ref?:string)=>Object.assign(track,{id:ref??id,cardId,state:'identified'}));
 const fixture:any={entries:[...cards,...zoneEntries,entry],ready:false,watch:{enabled:true,setEnabled:vi.fn(),setCalibration:vi.fn(),snapshot:{status:'watching',tracks:[track],metrics:{detectorMs:1,dutyPercent:1}},getTrack:(id:string)=>track.id===id?track:undefined,confirm,forget:vi.fn(),isRemoved:()=>false,dismiss:vi.fn()}};state.fieldWatch=fixture;
 let source={local:true};state.feedHub={cameraOn:true,sourceFor:()=>source,publishFieldTracks:vi.fn()};
 const post=vi.fn(async(proposal:any)=>{await beforePost?.(proposal);room={...room,lastSeq:room.lastSeq+1,state:ygoModule.reduce(room.state,{...proposal,idempotencyKey:`typed-${room.lastSeq+1}`})};return room;});
 const queue=createRoomMutationQueue(()=>room,post),host=document.createElement('div');host.dataset.testid='feed-box-0';host.innerHTML='<span data-field-watcher-status-slot></span><div data-feed-toolbar><span data-field-watcher-controls></span></div>';document.body.append(host);
 let view=render(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);await waitFor(()=>expect(fixture.ready).toBe(true));
 return {refresh(){view.rerender(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);},setTwins(twins:any[]){room={...room,lastSeq:room.lastSeq+1,state:{...room.state,seats:room.state.seats.map((seat:any,i:number)=>i===0?{...seat,twin:twins}:seat)}};view.rerender(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);},async restart(){view.unmount();fixture.ready=false;view=render(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);await waitFor(()=>expect(fixture.ready).toBe(true));},switchCamera(){source={local:true};view.rerender(<AutoFieldWatcher room={room} transaction={queue.transaction}/>);},known:()=>fixture.config.getKnownCards(),track,post,confirm,room:()=>room,async emit(event:any={}){await act(async()=>fixture.onEvent({type,track:{...track},source:'auto',...(bindRef?{bindRef}:{}),result:{...result,candidates:[{cardId:entry.cardId,score:.99}]},...event}));},dispose(){cleanup();host.remove();state.fieldWatch=null;}};
}

const physicalHintsKey='dd-field-physical:v1:g:typed-zone:0';
const physicalQuad=(row:'M'|'S'):DetectedQuad=>({kind:'face-up',confidence:.99,partial:false,quad:[{x:.588,y:row==='M'?.22:.64},{x:.668,y:row==='M'?.22:.64},{x:.668,y:row==='M'?.38:.8},{x:.588,y:row==='M'?.38:.8}]});
async function readRestart(known:()=>any[],outlines:DetectedQuad[],winner:(card:DetectedQuad)=>string){
 const {createFieldWatcher,yugioh}=await import('@yugidraft/vision');let at=0;
 const recognize=vi.fn(async(_frames:any,opts:any)=>({...result,tier:'sure' as const,candidates:[{cardId:winner(opts.card),score:.99}]}));
 const reader=createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>structuredClone(outlines),recognize},buffer:{sample:async()=>({at,frame:{width:200,height:200,data:new Uint8ClampedArray(160000)} as ImageData})},getKnownCards:known,getPriors:()=>({decklist:cards.map(c=>c.cardId)}),now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2),halo:()=>Array(192).fill(.2)}),clone:async frame=>frame});
 const events:any[]=[];reader.subscribe(event=>events.push(event));try{for(let i=0;i<12;i++){at+=333;await reader.tick();}return {events,recognize};}finally{reader.dispose();}
}
describe('typed watcher zone projection',()=>{
 it.each([
  ['Solemn Judgment in monster row',0,'M4','spell-trap',4],
  ['Field Spell in monster row',1,'M4','field',undefined],
  ['Fusion monster in Extra Monster Zone',2,'EMZ1','extra-monster',1],
  ['Pendulum at left edge',3,'S1','spell-trap',1],
  ['Pendulum at right edge',3,'S5','spell-trap',5],
  ['Pendulum in middle Spell/Trap Zone',3,'S3','monster',3],
  ['Extra Deck Pendulum in Extra Monster Zone',4,'EMZ2','extra-monster',2],
 ] as const)('places %s in its legal row',async(_name,index,observed,zone,slot)=>{
  const fixture=await typedWatcherFixture(zoneEntries[index],observed);try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin).toEqual([expect.objectContaining({zone,...(slot?{slot}:{}),cardId:zoneEntries[index].passcode})]);expect(fixture.post).toHaveBeenCalledOnce();}finally{fixture.dispose();}
 });
 it.each([['EMZ1',2],['EMZ2',4]] as const)('corrects a main-deck monster at %s to its aligned main column',async(observed,slot)=>{
  const fixture=await typedWatcherFixture(cards[0],observed);try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin[0]).toMatchObject({zone:'monster',slot});}finally{fixture.dispose();}
 });
 it('waits for an already-started catalog prefetch before committing the legal row',async()=>{
  const {loadCards}=await import('../src/components/remote/ui/catalog'),ready=deferred<Response>();
  const entry={cardId:'900000103',passcode:900000103,name:'Prefetched trap fixture'};
  fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/api/cards/resolve')?ready.promise:Response.json({entries:cards}));
  const prefetch=loadCards([entry.passcode]),fixture=await typedWatcherFixture(entry,'M4');
  try{await fixture.emit();expect(fixture.post).not.toHaveBeenCalled();await act(async()=>{ready.resolve(Response.json({cards:[{id:entry.passcode,name:entry.name,type:'Trap Card',frameType:'trap',effectText:''}]}));await prefetch;});await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:4});expect(fetcher).toHaveBeenCalledTimes(1);}finally{fixture.dispose();}
 });
 it('uses the latest physical column when a card moves during full-type loading',async()=>{
  const ready=deferred<Response>(),entry={cardId:'900000104',passcode:900000104,name:'Moving trap fixture'};
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/api/cards/resolve')?ready.promise:Response.json({entries:cards}));
  const fixture=await typedWatcherFixture(entry,'M4');try{await fixture.emit();fixture.track.zone='M5';await act(async()=>{ready.resolve(Response.json({cards:[{id:entry.passcode,name:entry.name,type:'Trap Card',frameType:'trap',effectText:''}]}));await ready.promise;});await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:5});}finally{fixture.dispose();}
 });
 it.each(['new placement','bound identity correction'])('follows a physical move during %s HTTP with the same ref',async scenario=>{
  const ready=deferred<void>(),bound=scenario==='bound identity correction',initialType=bound?'card.identified':'twin.place';
  const old={ref:'bound-save-race',zone:'monster',slot:4,cardId:46986414,name:'Old identity',faceUp:true,position:'attack'};
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',bound?[old]:[],bound?'prompt':'placed',bound?old.ref:undefined,async proposal=>{if(proposal.type===initialType)await ready.promise;});
  try{
   await fixture.emit();if(bound){const button=await screen.findByRole('button',{name:/Solemn Judgment.*Spell\/Trap Zone 4/i});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);}
   await waitFor(()=>expect(fixture.post).toHaveBeenCalledOnce());const first=fixture.post.mock.calls[0][0];expect(first.type).toBe(initialType);if(!bound)expect(first).toMatchObject({zone:'spell-trap',card:{slot:4}});
   fixture.track.zone='M5';fixture.track.card={...fixture.track.card,quad:fixture.track.card.quad.map((point:any)=>({...point,x:point.x+.128}))};
   await act(async()=>{ready.resolve();await ready.promise;});await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());
   expect(fixture.post.mock.calls.map(([proposal])=>proposal.type)).toEqual([initialType,'twin.move']);
   expect(fixture.room().state.seats[0].twin).toEqual([expect.objectContaining({ref:bound?old.ref:'physical-typed',zone:'spell-trap',slot:5,cardId:41420027})]);
   expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({[bound?old.ref:'physical-typed']:'M5'});
  }finally{ready.resolve();fixture.dispose();}
 });
 it('chooses the nearest free Spell/Trap slot when the physical column is occupied',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[{ref:'other',zone:'spell-trap',slot:4,cardId:55144522,faceUp:true,position:'attack'}]);
  try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin.find((card:any)=>card.ref==='physical-typed')).toMatchObject({zone:'spell-trap',slot:3});}finally{fixture.dispose();}
 });
 it('annotates a prompt with its legal destination and applies that same projection',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[],'prompt');try{await fixture.emit();const button=await screen.findByRole('button',{name:/Solemn Judgment.*Spell\/Trap Zone 4/i});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:4});}finally{fixture.dispose();}
 });
 it.each(['candidate revalidation','new revision'])('hides stale choice UI during %s',async scenario=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[],'prompt');try{await fixture.emit();await screen.findByTestId('field-watcher-prompt');if(scenario==='candidate revalidation')Object.assign(fixture.track,{state:'candidate',visible:false});else fixture.track.revision=1;fixture.refresh();expect(screen.queryByTestId('field-watcher-prompt')).toBeNull();expect(fixture.post).not.toHaveBeenCalled();}finally{fixture.dispose();}
 });
 it('disables a prompt choice when its legal row has no free slot',async()=>{
  const occupied=Array.from({length:5},(_,i)=>({ref:`s${i}`,zone:'spell-trap',slot:i+1,cardId:55144522,faceUp:true,position:'attack'}));
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',occupied,'prompt');try{await fixture.emit();const button=await screen.findByRole('button',{name:/Solemn Judgment/i});await waitFor(()=>expect(button).toBeDisabled());expect(fixture.post).not.toHaveBeenCalled();}finally{fixture.dispose();}
 });
 it('abstains when the full type is unavailable instead of using an index-frame guess',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[5],'M4');try{await fixture.emit();await screen.findByText(/Card type is unknown/);expect(fixture.post).not.toHaveBeenCalled();expect(fixture.confirm).not.toHaveBeenCalled();}finally{fixture.dispose();}
 });
 it('corrects a live move while keeping the bound ref independent of its physical row',async()=>{
  const old={ref:'bound-spell',zone:'spell-trap',slot:4,cardId:41420027,name:'Solemn Judgment',faceUp:true,position:'attack'};
  const fixture=await typedWatcherFixture(zoneEntries[0],'M5',[old],'moved');try{await fixture.emit();await waitFor(()=>expect(fixture.post).toHaveBeenCalledOnce());expect(fixture.post).toHaveBeenCalledWith(expect.objectContaining({type:'twin.move',cardRef:old.ref,zone:'spell-trap',slot:5}));expect(fixture.room().state.seats[0].twin).toHaveLength(1);}finally{fixture.dispose();}
 });
 it('resolves an old illegal same-spot twin before projecting the corrected destination',async()=>{
  const old={ref:'reserved-spell',zone:'monster',slot:4,cardId:46986414,name:'Old mistaken identity',faceUp:true,position:'attack'};
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[old],'prompt',old.ref);try{await fixture.emit();fireEvent.click(await screen.findByRole('button',{name:/Solemn Judgment/i}));await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.room().state.seats[0].twin).toHaveLength(1);expect(fixture.room().state.seats[0].twin[0]).toMatchObject({ref:old.ref,cardId:41420027,zone:'spell-trap',slot:4});expect(fixture.post.mock.calls.some(([proposal])=>proposal.type==='twin.place')).toBe(false);}finally{fixture.dispose();}
 });
 it('reserves a projected physical spot after camera restart and reload without trusting its old identity',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{
   await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());fixture.switchCamera();await fixture.restart();
   expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({'physical-typed':'M4'});
   expect(fixture.known()).toEqual([expect.objectContaining({id:'physical-typed',zone:'M4',cardId:'41420027'})]);expect(fixture.known()[0]).not.toHaveProperty('card');
   const restarted=await readRestart(fixture.known,[physicalQuad('M')],()=>cards[2].cardId),prompt=restarted.events.find(event=>event.type==='prompt');
   expect(restarted.events.some(event=>event.type==='placed')).toBe(false);expect(restarted.recognize).toHaveBeenCalledOnce();expect(prompt).toMatchObject({bindRef:'physical-typed',reason:'restart'});
   Object.assign(fixture.track,prompt.track);await fixture.emit(prompt);fireEvent.click(await screen.findByRole('button',{name:/Monster Reborn.*Spell\/Trap Zone 4/i}));
   await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledTimes(2));expect(fixture.room().state.seats[0].twin).toEqual([expect.objectContaining({ref:'physical-typed',cardId:83764718,zone:'spell-trap',slot:4})]);expect(fixture.post.mock.calls.map(([p])=>p.type)).toEqual(['twin.place','card.identified']);
  }finally{fixture.dispose();}
 });
 it('keeps actual M4 and S4 cards independent after both virtual destinations were projected',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{
   await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());Object.assign(fixture.track,{id:'physical-s4',zone:'S4',cardId:cards[2].cardId,state:'identified'});await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledTimes(2));await fixture.restart();
   expect(fixture.room().state.seats[0].twin.map((card:any)=>[card.ref,card.slot])).toEqual([['physical-typed',4],['physical-s4',3]]);
   expect(fixture.known().map((card:any)=>[card.id,card.zone])).toEqual([['physical-typed','M4'],['physical-s4','S4']]);
   const restarted=await readRestart(fixture.known,[physicalQuad('M'),physicalQuad('S')],card=>card.quad[0].y<.5?cards[3].cardId:cards[4].cardId);
   expect(restarted.events.filter(event=>event.type==='prompt').map(event=>[event.track.zone,event.bindRef])).toEqual([['M4','physical-typed'],['S4','physical-s4']]);expect(restarted.events.some(event=>event.type==='placed')).toBe(false);
  }finally{fixture.dispose();}
 });
 it('does not steal a projected M4 reference for an unrelated physical S4 prompt',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{
   await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());Object.assign(fixture.track,{id:'new-s4',zone:'S4',cardId:undefined,state:'prompt'});await fixture.emit({type:'prompt',result:{...result,candidates:[{cardId:cards[2].cardId,score:.99}]}});
   fireEvent.click(await screen.findByRole('button',{name:/Monster Reborn.*Spell\/Trap Zone 3/i}));await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledTimes(2));expect(fixture.room().state.seats[0].twin).toEqual([expect.objectContaining({ref:'physical-typed',cardId:41420027,slot:4}),expect.objectContaining({ref:'new-s4',cardId:83764718,slot:3})]);
  }finally{fixture.dispose();}
 });
 it.each(['prompt','automatic'] as const)('keeps an unread restart reservation when a same-card second copy arrives via %s',async mode=>{
  const old={ref:'reserved-unread',zone:'spell-trap',slot:4,cardId:41420027,name:'Solemn Judgment',faceUp:true,position:'attack'};
  sessionStorage.setItem(physicalHintsKey,JSON.stringify({[old.ref]:'M4'}));const fixture=await typedWatcherFixture(zoneEntries[0],'S4',[old],mode==='prompt'?'prompt':'placed');try{
   const first={...fixture.track,id:'fw-unread-first',zone:'M4',state:'candidate',cardId:undefined,visible:false,removed:false};state.fieldWatch.watch.snapshot.tracks.unshift(first);fixture.refresh();
   await fixture.emit();if(mode==='prompt')fireEvent.click(await screen.findByRole('button',{name:/Solemn Judgment/}));await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());
   expect(fixture.post.mock.calls.map(([proposal])=>proposal.type)).toEqual(['twin.place']);expect(fixture.room().state.seats[0].twin).toEqual([expect.objectContaining(old),expect.objectContaining({ref:'physical-typed',cardId:41420027,zone:'spell-trap',slot:3})]);expect(first).toMatchObject({id:'fw-unread-first',state:'candidate',cardId:undefined});expect(fixture.confirm).toHaveBeenCalledWith('physical-typed','41420027',undefined);
  }finally{fixture.dispose();}
 });
 it('updates physical hints when a real move projects to the same virtual slot',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());expect(fixture.known()[0].zone).toBe('M4');fixture.track.zone='S4';await fixture.emit({type:'moved'});await waitFor(()=>expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({'physical-typed':'S4'}));expect(fixture.post).toHaveBeenCalledOnce();await fixture.restart();expect(fixture.known()[0].zone).toBe('S4');}finally{fixture.dispose();}
 });
 it('saves the latest physical row after a live move HTTP returns the matching virtual destination',async()=>{
  const ready=deferred<void>(),fixture=await typedWatcherFixture(zoneEntries[0],'M4',[],'placed',undefined,async proposal=>{if(proposal.type==='twin.move')await ready.promise;});try{
   await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());fixture.track.zone='M5';await fixture.emit({type:'moved'});await waitFor(()=>expect(fixture.post).toHaveBeenCalledTimes(2));fixture.track.zone='S5';await act(async()=>{ready.resolve();await ready.promise;});await waitFor(()=>expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({'physical-typed':'S5'}));expect(fixture.room().state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:5});
  }finally{ready.resolve();fixture.dispose();}
 });
 it('prunes removed refs and keeps pile hints dormant until the same ref returns to the field',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{
   await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());const card=fixture.room().state.seats[0].twin[0];card.zone='graveyard';delete card.slot;fixture.refresh();expect(fixture.known()[0].zone).toBe('GY');expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({'physical-typed':'M4'});
   card.zone='spell-trap';card.slot=4;fixture.refresh();expect(fixture.known()[0].zone).toBe('M4');fixture.setTwins([]);await waitFor(()=>expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({}));
  }finally{fixture.dispose();}
 });
 it('prunes a physical hint immediately when Undo removes its placement',async()=>{
  const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());fixture.room().state.undo.at=Date.now();fixture.refresh();fireEvent.click(await screen.findByRole('button',{name:'Undo'}));await waitFor(()=>expect(fixture.room().state.seats[0].twin).toEqual([]));expect(JSON.parse(sessionStorage.getItem(physicalHintsKey)!)).toEqual({});expect(fixture.known()).toEqual([]);}finally{fixture.dispose();}
 });
 it('retains physical hints in memory when session storage is unavailable',async()=>{
  const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage unavailable');});const fixture=await typedWatcherFixture(zoneEntries[0],'M4');try{await fixture.emit();await waitFor(()=>expect(fixture.confirm).toHaveBeenCalledOnce());fixture.switchCamera();expect(fixture.known()[0].zone).toBe('M4');expect(sessionStorage.getItem(physicalHintsKey)).toBeNull();}finally{blocked.mockRestore();fixture.dispose();}
 });
 it('does not reuse another room\'s hints for the same ref',async()=>{
  sessionStorage.setItem('dd-field-physical:v1:g:another-room:0',JSON.stringify({old:'M4'}));const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[{ref:'old',zone:'spell-trap',slot:4,cardId:41420027,faceUp:true,position:'attack'}]);try{expect(fixture.known()[0].zone).toBe('S4');}finally{fixture.dispose();}
 });
 it.each(['{','[]','{"old":"M99"}','{"old":{"zone":"M4","cardId":"41420027"}}'])('ignores invalid physical-hint storage %s without inferring a cross-row binding',async stored=>{
  sessionStorage.setItem(physicalHintsKey,stored);const fixture=await typedWatcherFixture(zoneEntries[0],'M4',[{ref:'old',zone:'spell-trap',slot:4,cardId:41420027,faceUp:true,position:'attack'}]);try{expect(fixture.known()[0]).toMatchObject({id:'old',zone:'S4'});expect(fixture.known()[0]).not.toHaveProperty('card');}finally{fixture.dispose();}
 });
});

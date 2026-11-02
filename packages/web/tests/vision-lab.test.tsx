// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedQuad, RecognitionResult } from "@yugidraft/vision";

const state = vi.hoisted(() => ({
  initialSource: null as "photo" | "camera" | null, feedHub: null as any, feedDetect: vi.fn(),
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
  fetcher.mockReset().mockImplementation(async (url) => Response.json(String(url).includes("remote-vision/feedback")?{enabled:false,askedAt:1,collectionEnabled:true}:{ entries: cards }));
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
vi.mock('../src/components/remote/ui/recognizer',async importOriginal=>({...await importOriginal<typeof import('../src/components/remote/ui/recognizer')>(),attachOwnFeed:()=>{},detachOwnFeed:()=>{},detectCards:state.feedDetect,ownFeedFrames:vi.fn(async()=>[])}));
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

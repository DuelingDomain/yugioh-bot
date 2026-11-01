// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedQuad, RecognitionResult } from "@yugidraft/vision";

const state = vi.hoisted(() => ({
  initialSource: null as "photo" | "camera" | null,
  createRecognizer: vi.fn(), recognize: vi.fn(), detectCards: vi.fn(), dispose: vi.fn(), askAI: vi.fn(),
  hitTestQuad: vi.fn(), snapshot: vi.fn(), loadPhoto: vi.fn(), startCamera: vi.fn(), stop: vi.fn(),
}));

vi.mock("@yugidraft/vision", () => ({
  createRecognizer: state.createRecognizer,
  hitTestQuad: state.hitTestQuad,
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
  state.createRecognizer.mockImplementation(() => ({ recognize: state.recognize, detectCards: state.detectCards, dispose: state.dispose, askAI: state.askAI }));
  state.recognize.mockResolvedValue(result);
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
  fetcher.mockReset().mockImplementation(async () => Response.json({ entries: cards }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["fixture"], { type: "image/jpeg" })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderLab() {
  render(<VisionLab />);
  // Wait for metadata so the assertions exercise named candidates, not placeholder IDs.
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  vi.spyOn(preview(), "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON: () => ({}) });
}
async function recognizeCenter() {
  fireEvent.click(screen.getByRole("button", { name: "Recognize center card" }));
  return screen.findByRole("dialog", { name: "Card matches" });
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
    expect(fetcher.mock.calls[0][0]).toBe("/test/vision-meta.json");
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
    expect(state.recognize.mock.calls[0][1]).toEqual({ clickPoint: { x: 450 / 640, y: .5 }, k: 5, includeCrop: true, card: quads[1] });
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

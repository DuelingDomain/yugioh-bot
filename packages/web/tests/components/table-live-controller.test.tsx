// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { useLiveTableController, type LiveTableControllerInput } from "@/components/duel/table/use-live-table-controller";
import { promptLegalKeys, promptSelectedKeys, usePromptDraft } from "@/components/duel/prompts";

function input(draft: LiveTableControllerInput["draft"]): LiveTableControllerInput {
  const room = FFA3_FIXTURES.states["choose-opponent"].room;
  const prompt = room.engine!.prompt;
  return {
    room, prompt, nameOf: (seat) => room.session.seats[seat].displayName,
    canAct: true, busy: false, revealed: true, draft,
    legalKeys: promptLegalKeys(prompt), selectedKeys: promptSelectedKeys(prompt, draft.selected),
    aim: null, reducedMotion: true, onAnswer: vi.fn(), onActivate: vi.fn(), onInspect: vi.fn(),
  };
}

function setup(overrides: Partial<LiveTableControllerInput> = {}) {
  return renderHook((updates: Partial<LiveTableControllerInput>) => {
    const draft = usePromptDraft(FFA3_FIXTURES.states["choose-opponent"].room.engine!.prompt);
    const source = { ...input(draft), ...updates };
    return { source, controller: useLiveTableController(source) };
  }, { initialProps: overrides });
}

describe("live table controller", () => {
  it("retains controller and seat-pick identity when only the input container changes", () => {
    const source = setup().result.current.source;
    const { result, rerender } = renderHook((fields) => useLiveTableController({ ...fields }), { initialProps: source });
    const first = result.current;
    rerender({ ...source });
    expect(result.current).toBe(first);
    expect(result.current!.seatPick).toBe(first!.seatPick);
    rerender({ ...source, busy: true });
    expect(result.current).not.toBe(first);
    expect(result.current!.seatPick).toBeNull();
  });
  it("uses the live room and the room's draft, keys and handlers without another draft", () => {
    const { result } = setup();
    const { source, controller } = result.current;
    expect(controller).toMatchObject({ room: source.room, engine: source.room!.engine, viewerSeat: source.room!.mySeat, promptSeat: source.prompt!.seat });
    for (const key of ["draft", "legalKeys", "selectedKeys", "onAnswer", "onActivate", "onInspect", "nameOf"] as const) {
      expect(controller![key]).toBe(source[key]);
    }
  });

  it("routes an offered opponent seat to the room submit handler", () => {
    const onAnswer = vi.fn();
    const { result } = setup({ onAnswer });
    const pick = result.current.controller!.seatPick!;
    const [seat, choice] = [...pick.options][0];
    pick.onPick(seat);
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ choice });
    pick.onPick(99);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it.each([{ canAct: false }, { revealed: false }, { busy: true }, { error: new Error("offline") }, { catchingUp: true }])("withholds seat picks while gated: %j", (gate) => {
    const { result } = setup(gate);
    expect(result.current.controller!.seatPick).toBeNull();
    if ("busy" in gate || "error" in gate || "catchingUp" in gate) {
      expect(result.current.controller!.busy).toBe(true);
      expect(result.current.controller!.canAct).toBe(false);
    }
  });

  it("marks only a connection error as offline, so prompts say Reconnecting and not Syncing", () => {
    expect(setup({ error: new Error("offline") }).result.current.controller!.offline).toBe(true);
    expect(setup({ busy: true }).result.current.controller!.offline).toBe(false);
    expect(setup({ catchingUp: true }).result.current.controller!.offline).toBe(false);
  });

  it("returns no controller until an engine view arrives, retaining hook order", () => {
    const { result, rerender } = setup({ room: undefined });
    expect(result.current.controller).toBeNull();
    rerender({});
    expect(result.current.controller!.engine.seats).toHaveLength(3);
    rerender({ room: { ...result.current.source.room!, engine: null } });
    expect(result.current.controller).toBeNull();
  });

  describe("2v2 Tag room", () => {
    const tagInput = (id: "choose-opponent" | "main", overrides: Partial<LiveTableControllerInput> = {}) => {
      const room = TAG_FIXTURES.states[id].room;
      const prompt = room.engine!.prompt;
      return renderHook(() => {
        const draft = usePromptDraft(prompt);
        return useLiveTableController({
          room, prompt, nameOf: (seat) => room.session.seats[seat].displayName,
          canAct: true, busy: false, revealed: true, draft,
          legalKeys: promptLegalKeys(prompt), selectedKeys: promptSelectedKeys(prompt, draft.selected),
          aim: null, reducedMotion: true, onAnswer: vi.fn(), onActivate: vi.fn(), onInspect: vi.fn(), ...overrides,
        });
      }).result.current;
    };

    it("offers the rival seats when the player can act and the prompt is revealed", () => {
      const controller = tagInput("choose-opponent")!;
      expect(controller.viewerSeat).toBe(0);
      expect([...controller.seatPick!.options.keys()]).toEqual([1, 3]);
    });
    it.each([{ canAct: false }, { revealed: false }])("withholds the seat pick while gated: %j", (gate) => {
      expect(tagInput("choose-opponent", gate)!.seatPick).toBeNull();
    });
    it("offers no seat pick for a prompt that does not choose an opponent", () => {
      expect(tagInput("main")!.seatPick).toBeNull();
    });
  });
});

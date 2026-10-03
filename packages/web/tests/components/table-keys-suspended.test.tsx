// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { tableLayout } from "@/components/duel/table/geometry";
import { useAimFlow } from "@/components/duel/table/use-aim-flow";
import { useCamera } from "@/components/duel/table/use-camera";

afterEach(cleanup);

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function setup(stateId: "main" | "direct-attack", suspended: boolean) {
  return renderHook(() => {
    const state = FFA3_FIXTURES.states[stateId];
    const base = useFixtureController(state, { reducedMotion: true });
    const layout = tableLayout("ffa3", base.engine, base.viewerSeat);
    const flow = useAimFlow(base, layout, { current: null }, { suspended });
    const camera = useCamera({ controller: flow.controller, layout, aiming: flow.aiming, seatKeys: flow.seatKeys, suspended });
    return { flow, camera };
  });
}

describe("table keys while a menu or the pile viewer is open", () => {
  it("the overview key flies up when nothing is open", () => {
    const hook = setup("main", false);
    press("o");
    expect(hook.result.current.camera.state.mode).toBe("fly");
  });

  it("no camera key fires while a menu is open", () => {
    const hook = setup("main", true);
    press("o");
    press("2");
    expect(hook.result.current.camera.state.mode).toBe("home");
  });

  it("no camera key fires inside a text field", () => {
    const hook = setup("main", false);
    const input = document.createElement("input");
    document.body.append(input);
    press("o", input);
    input.remove();
    expect(hook.result.current.camera.state.mode).toBe("home");
  });

  it("a number key aims at a rival, unless a menu is open", () => {
    const open = setup("direct-attack", false);
    press("1");
    expect(open.result.current.flow.pointed?.lpSeat).toBe(1);
    cleanup();
    const shut = setup("direct-attack", true);
    press("1");
    expect(shut.result.current.flow.pointed).toBeNull();
  });
});

// @vitest-environment jsdom
// The 3D room keeps the FX canvas on the table: tilt + Solid palette on mount, back to the classic look on unmount.
import React, { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setFx3dLook } = vi.hoisted(() => ({ setFx3dLook: vi.fn() }));
vi.mock("@/components/duel/fx3d/shared", () => ({ setFx3dLook }));
import { useSolidFx3dSync } from "@/components/duel/solid/fx-sync";

function Probe({ tilt }: { tilt: "tilt" | "flat" }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useSolidFx3dSync(ref, tilt);
  return <div ref={ref} style={{ ["--tilt" as string]: "15deg" }} />;
}

afterEach(() => { cleanup(); setFx3dLook.mockClear(); });

describe("useSolidFx3dSync", () => {
  it("sets the solid look on mount and the default look on unmount", () => {
    const { unmount } = render(<Probe tilt="tilt" />);
    expect(setFx3dLook).toHaveBeenCalledWith(expect.objectContaining({ palette: "solid" }));
    expect(setFx3dLook).not.toHaveBeenCalledWith({ tilt: 0, palette: "v1" });
    unmount();
    expect(setFx3dLook).toHaveBeenLastCalledWith({ tilt: 0, palette: "v1" });
  });
});

// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";
import { BugReportDialog } from "@/components/bug-report/bug-report-dialog";
import { collectBugContext } from "@/components/bug-report/context";

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

// A plain cancelable choice: no pre-check bar, so Escape on the page answers Cancel.
const prompt: DuelPrompt = {
  id: "p1", seat: 0, kind: "choice", title: "Select an option", cancelable: true,
  options: [{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }],
};

function Room({ onSubmit }: { onSubmit: (answer: unknown) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
        menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
      <button type="button" onClick={() => setOpen(true)}>Open report</button>
      <BugReportDialog open={open} onClose={() => setOpen(false)} collect={() => collectBugContext(null)} />
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ knownLimits: [], duplicates: [] }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PromptCenter with the Report bug dialog open", () => {
  it("answers Cancel on Escape when no dialog is open (control)", () => {
    const onSubmit = vi.fn();
    render(<Room onSubmit={onSubmit} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onSubmit).toHaveBeenCalledWith({ cancel: true });
  });

  it("does not answer the prompt when Escape closes the dialog", () => {
    const onSubmit = vi.fn();
    render(<Room onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    const wrong = screen.getByLabelText(/What went wrong\?/);
    expect(screen.getByRole("dialog", { name: "Report a bug" })).toBeTruthy();
    fireEvent.keyDown(wrong, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Report a bug" })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not answer the prompt for keys typed in the dialog", () => {
    const onSubmit = vi.fn();
    render(<Room onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open report" }));
    const wrong = screen.getByLabelText(/What went wrong\?/);
    for (const key of ["1", "2", "a", "f", "Enter", "ArrowDown"]) fireEvent.keyDown(wrong, { key });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_SHARE_PREFIX, encodeSandboxShare, type SandboxShare } from "@yugidraft/shared/duels";
import { ShareDialog } from "@/components/sandbox/share-dialog";
import { applyAction, createBuilderState } from "@/components/sandbox/board-model";

afterEach(() => cleanup());

function sample(): SandboxShare {
  const state = applyAction(applyAction(createBuilderState("ffa4"), { type: "toggleEliminated", seat: "p1" }).state, { type: "add", seat: "p0", card: 46986414 }).state;
  return { name: "Column test", board: state.board, run: state.run };
}

/** A code with valid transport but a JSON body we choose. */
function codeOf(json: unknown): string {
  return SANDBOX_SHARE_PREFIX + btoa(JSON.stringify(json)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function setup(onImport = vi.fn()) {
  const onClose = vi.fn();
  render(<ShareDialog mode="import" onImport={onImport} onClose={onClose} />);
  return { onImport, onClose, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: /share code/i });

describe("ShareDialog import", () => {
  it("decodes a pasted code, hands it over and closes", async () => {
    const { onImport, onClose, user } = setup();
    const share = sample();
    await user.click(box());
    await user.paste(encodeSandboxShare(share));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith(share);
  });

  it("accepts a code that wrapped over several lines", async () => {
    const { onImport, user } = setup();
    const code = encodeSandboxShare(sample());
    await user.click(box());
    await user.paste(`${code.slice(0, 40)}\n  ${code.slice(40, 90)}\r\n${code.slice(90)}\n`);
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(sample()));
  });

  it("keeps Import off until there is text", async () => {
    const { user } = setup();
    const button = screen.getByRole("button", { name: "Import" });
    expect(button).toBeDisabled();
    await user.type(box(), "x");
    expect(button).toBeEnabled();
  });

  it("shows a prefix error inline and stays open", async () => {
    const { onImport, onClose, user } = setup();
    await user.type(box(), "hello");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`Share code must start with ${SANDBOX_SHARE_PREFIX}`);
    expect(onImport).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a base64 error for tampered data", async () => {
    const { user } = setup();
    await user.type(box(), `${SANDBOX_SHARE_PREFIX}!!!not-base64`);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid base64url/);
  });

  it("names the field when the board inside the code is bad", async () => {
    const { onImport, user } = setup();
    await user.click(box());
    await user.paste(codeOf({ board: { format: "ffa3", eliminated: ["p0", "p1"] }, run: { bots: { "1": "pass", "2": "pass", "3": "pass" } } }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^eliminated: /);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("rejects an unknown envelope key", async () => {
    const { user } = setup();
    await user.click(box());
    await user.paste(codeOf({ board: {}, run: { bots: { "1": "pass", "2": "pass", "3": "pass" } }, extra: 1 }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unsupported scenario field: extra/);
  });

  it("shows the text of an error the importer throws, and stays open", async () => {
    const onImport = vi.fn(() => {
      throw new Error("3-way is not available here.");
    });
    const { onClose, user } = setup(onImport);
    await user.click(box());
    await user.paste(encodeSandboxShare(sample()));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("3-way is not available here.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("clears the error when the text changes, and Cancel closes", async () => {
    const { onClose, user } = setup();
    await user.type(box(), "bad");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("alert");
    await user.type(box(), "s");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ShareDialog export", () => {
  it("shows the code read-only and copies it on request", async () => {
    const user = userEvent.setup();
    const code = encodeSandboxShare(sample());
    const onClose = vi.fn();
    render(<ShareDialog mode="export" code={code} onClose={onClose} />);
    expect(box()).toHaveValue(code);
    expect(box()).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: /copy code/i }));
    expect(await navigator.clipboard.readText()).toBe(code);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

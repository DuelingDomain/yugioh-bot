// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesMetaFields, RulesPanel, useRulesAnalysis } from "../../src/components/draft/setup/rules-panel";
import { applyPreset, type PoolCounts, type RulesFields } from "../../src/components/draft/setup/rules-model";
import { configFromFields } from "../../src/components/draft/draft-config-fields";

afterEach(cleanup);

const start = (): RulesFields => ({ cardsPerPlayerText: "40", packSizeText: "15", pickSecondsText: "45", lobbySeatsText: "4", roundsText: "3" });

/** The panel the way a screen holds it: the fields live in the host. */
function Host({ pool, initial = start(), onValue, onFit, withSlots = false, discordEnabled = true }: {
  pool: PoolCounts;
  initial?: RulesFields;
  onValue?: (v: RulesFields) => void;
  onFit?: React.ComponentProps<typeof RulesPanel>["onFit"];
  withSlots?: boolean;
  discordEnabled?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState("c1");
  const analysis = useRulesAnalysis(value, pool);
  onValue?.(value);
  return (
    <RulesPanel
      value={value}
      onChange={setValue}
      pool={pool}
      onFit={onFit}
      discordEnabled={discordEnabled}
      metaSlot={withSlots ? <RulesMetaFields discordEnabled={discordEnabled} name={name} onNameChange={setName} channelId={channel} onChannelChange={setChannel} channels={[{ id: "c1", name: "draft-night" }, { id: "c2", name: "cube-drafts" }]} /> : undefined}
      actionSlot={<button type="button" disabled={!analysis.ok}>Create draft</button>}
    />
  );
}

describe("RulesPanel", () => {
  it("shows the sum and the pool for the Community preset", () => {
    render(<Host pool={{ main: 486, extra: 85 }} />);
    fireEvent.click(screen.getByRole("button", { name: /5 × 4 × 24 · 2-pick/ }));
    expect(screen.getByLabelText(/5 rounds times 4 players times 24 cards per pile equals 480/)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Main piles" })).toHaveAttribute("aria-valuetext", "Needs 480, pool has 486");
    expect(screen.getByText(/6 spare stay out/)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/Extra Deck card/)).toHaveTextContent("85 Extra Deck cards in the pool are not dealt until the Extra Deck round is on");
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /5 × 4 × 24/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("says 90 minutes for 120 two-pick picks at 45 seconds, not half", () => {
    render(<Host pool={{ main: 500, extra: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: /5 × 4 × 24/ }));
    const fact = screen.getByText(/at 45s per pick/).previousElementSibling as HTMLElement;
    expect(fact).toHaveTextContent("90 min");
  });

  it("blocks Create with the shortfall, and Fit to pool repairs it and reports the change", () => {
    const onFit = vi.fn();
    render(<Host pool={{ main: 401, extra: 0 }} onFit={onFit} />);
    fireEvent.click(screen.getByRole("button", { name: /5 × 4 × 24/ }));
    expect(screen.getAllByText(/Main piles are 79 cards short/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fit rules to pool" }));
    expect(onFit).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(screen.getByLabelText("Cards per pile")).toHaveValue("20");
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
    expect(screen.getByText(/1 spare stay out/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready \u00b7 4 seats open");
  });

  it("keeps Create off and shows the deficit when no legal fit exists", () => {
    const onFit = vi.fn();
    render(<Host pool={{ main: 150, extra: 0 }} onFit={onFit} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit rules to pool" }));
    expect(onFit).toHaveBeenCalledWith(expect.objectContaining({ ok: false, mainDeficit: 10 }));
    expect(screen.getByLabelText("Rounds")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });

  it("steps and types numbers, settling a typed value into its range on blur", () => {
    render(<Host pool={{ main: 900, extra: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "More: Players" }));
    expect(screen.getByLabelText("Players")).toHaveValue("5");
    const rounds = screen.getByLabelText("Rounds");
    expect(rounds).toHaveAttribute("readonly");
    expect(rounds).toHaveValue("3");
    const players = screen.getByLabelText("Players");
    fireEvent.change(players, { target: { value: "x1y" } });
    expect(players).toHaveValue("1");
    fireEvent.blur(players);
    expect(players).toHaveValue("2");
  });

  it("holds picks at 40 of the 45 dealt, and always exposes the host cap", () => {
    let latest: RulesFields = start();
    render(<Host pool={{ main: 180, extra: 0 }} onValue={(v) => { latest = v; }} />);
    expect(screen.getByLabelText("Picks each")).toHaveValue("40");
    expect(screen.getByText(/40 picks; 45 cards dealt to each seat/)).toBeInTheDocument();
    expect(configFromFields(latest)).toMatchObject({ cardsPerPlayer: 40, packsPerPlayer: 3, packSize: 15, lobbySeats: 4 });
    fireEvent.click(screen.getByRole("button", { name: /3 × 4 × 15/ }));
    expect(screen.getByLabelText("Picks each")).toHaveValue("45");
  });

  it("switches between 1 and 2 picks per turn", () => {
    let latest: RulesFields = start();
    render(<Host pool={{ main: 500, extra: 0 }} onValue={(v) => { latest = v; }} />);
    const group = screen.getByRole("group", { name: "Picks per turn" });
    fireEvent.click(within(group).getByRole("button", { name: "2-pick" }));
    expect(latest.picksPerStep).toBe(2);
    expect(screen.getByText(/each on the full timer/)).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("button", { name: "1 pick" }));
    expect(latest.picksPerStep).toBe(1);
  });

  it("sets the timer from a chip or a number, and the copy limit", () => {
    let latest: RulesFields = start();
    render(<Host pool={{ main: 500, extra: 0 }} onValue={(v) => { latest = v; }} />);
    fireEvent.click(screen.getByRole("button", { name: "90s" }));
    expect(latest.pickSecondsText).toBe("90");
    const seconds = screen.getByLabelText("Seconds per pick");
    fireEvent.change(seconds, { target: { value: "1" } });
    fireEvent.blur(seconds);
    expect(latest.pickSecondsText).toBe("5");
    fireEvent.click(screen.getByRole("checkbox", { name: "Limit 3 copies per card" }));
    expect(configFromFields(latest).copyLimit).toBe(false);
  });

  it("counts a separate Extra Deck round against the Extra pool only", () => {
    let latest: RulesFields = applyPreset(start(), "quick");
    render(<Host initial={latest} pool={{ main: 180, extra: 40 }} onValue={(v) => { latest = v; }} />);
    expect(screen.queryByLabelText("Extra Deck cards per player")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the Extra Deck on its own" }));
    expect(screen.getByRole("meter", { name: "Extra Deck piles" })).toHaveAttribute("aria-valuetext", "Needs 60, pool has 40");
    expect(screen.getByRole("meter", { name: "Main piles" })).toHaveAttribute("aria-valuetext", "Needs 180, pool has 180");
    expect(screen.getAllByText(/Extra Deck piles are 20 cards short/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fit rules to pool" }));
    expect(screen.getByLabelText("Extra Deck cards per player")).toHaveValue("10");
    expect(configFromFields(latest)).toMatchObject({ extraDeckEnabled: true, extraDeckSize: 10 });
    expect(screen.getByRole("button", { name: "Create draft" })).toBeEnabled();
  });

  it("renders the name, channel and action slots", () => {
    render(<Host pool={{ main: 500, extra: 0 }} withSlots />);
    fireEvent.click(screen.getByText("Name & channel"));
    fireEvent.change(screen.getByLabelText("Draft name"), { target: { value: "Friday" } });
    expect(screen.getByLabelText("Draft name")).toHaveValue("Friday");
    const channel = screen.getByLabelText("Discord channel");
    fireEvent.change(channel, { target: { value: "c2" } });
    expect(channel).toHaveValue("c2");
    expect(screen.getByRole("button", { name: "Create draft" })).toBeInTheDocument();
  });

  it("hides the Discord channel and the Discord seat hint when the bot is off", () => {
    render(<Host pool={{ main: 500, extra: 0 }} withSlots discordEnabled={false} />);
    expect(screen.queryByText("Name & channel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Name"));
    expect(screen.getByLabelText("Draft name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Discord channel")).not.toBeInTheDocument();
    expect(screen.queryByText(/discord/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Seats fill from the invite link/)).toBeInTheDocument();
  });

  it("asks for a pool before anything else", () => {
    render(<Host pool={{ main: 0, extra: 0 }} />);
    expect(screen.getAllByText(/Add cards/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });
});

it("keeps the host cap fixed when changing pile size and derives rounds", () => {
  render(<Host initial={applyPreset(start(), "community")} pool={{ main: 1000, extra: 0 }} />);
  expect(screen.getByLabelText("Picks each")).toHaveValue("120");
  fireEvent.change(screen.getByLabelText("Picks each"), { target: { value: "40" } });
  expect(screen.getByLabelText("Rounds")).toHaveValue("2");
  fireEvent.change(screen.getByLabelText("Cards per pile"), { target: { value: "15" } });
  expect(screen.getByLabelText("Picks each")).toHaveValue("40");
  expect(screen.getByLabelText("Rounds")).toHaveValue("3");
});

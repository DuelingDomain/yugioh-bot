import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { deckRevealViews } from "../../duel-server/tests/helpers/deck-reveal.js";
import { materialCountScenarios, runMaterialCountScenario } from "../../duel-server/tests/material-count-fixture.js";
import { buildProofPage } from "./proof-build.js";
import type { ProofBug, ProofCase, ProofRead } from "./bug-proof-types.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const zoneKey = (option: { controller?: number; location?: number; sequence?: number }) =>
  `${option.controller}:${option.location}:${option.sequence}`;

export async function prepareProofCases(bug: ProofBug): Promise<ProofCase[]> {
  if (bug === 1 || bug === 2) {
    const result = await deckRevealViews(bug === 1 ? "search" : "set");
    return (["opponent", "spectator"] as const).map((viewer) => ({
      id: viewer, bug, mySeat: viewer === "opponent" ? 1 : null,
      title: bug === 1 ? `Reinforcement of the Army search · ${viewer}` : `Ogama Set from Deck · ${viewer}`,
      engine: result[viewer], targetCode: result.card.code!, targetName: result.card.name!,
      // The latest identity event may be a confirmation: replay its linked move too.
      replayFrom: (result.event.moveId ?? result.event.id) - 1,
      setZone: bug === 2 ? zoneKey(result.card) : undefined,
    }));
  }
  const cases: ProofCase[] = [];
  for (const kind of ["synchro", "xyz", "link", "ritual"]) {
    const scenario = materialCountScenarios.find((entry) => entry.kind === kind)!;
    const result = await runMaterialCountScenario(scenario);
    assert(result.materialViews.length > 0, `No real ${kind} material prompt`);
    assert(result.materialViews.every((view) => view.prompt?.seat === 0), "Summoning seat must own the prompt");
    if (kind !== "ritual") assert.equal(result.materialViews.length, 2, "Expected before/after-first-pick core prompts");
    else assert.equal(result.materialViews[0].prompt?.target, 4, "Expected real White Dragon Ritual Level 4 prompt");
    if (kind === "synchro") {
      assert(result.prompts.every((prompt) => prompt.target === 7 && prompt.source?.name === "Junk Archer"),
        "Expected the chosen Junk Archer's Level 7 target throughout the Synchro procedure");
      assert.equal(result.prompts[1].options.find((option) => option.selected)?.currentLevel, 3,
        "Expected Junk Synchron's current Level 3 after the first pick");
    }
    cases.push({
      id: kind, bug, mySeat: 0, title: `${scenario.monster} · material selection`,
      engine: result.materialViews[0], materialViews: result.materialViews,
      materialCodes: result.materials, completedView: result.completedView,
      targetCode: result.summoned.code!, targetName: scenario.monster,
    });
  }
  return cases;
}

/** Each entry script uses the same build and browser driver. --prepare-only needs no Playwright. */
export async function runBugProof(bug: ProofBug) {
  const artifacts = resolve(process.env.PROOF_DIR ?? "/tmp/yugioh-proofs", `bug-${bug}`);
  await mkdir(artifacts, { recursive: true });
  const cases = await prepareProofCases(bug);
  const snapshots = resolve(artifacts, "snapshots.json");
  await writeFile(snapshots, json({ cases }));
  for (const s of cases) console.log(JSON.stringify({ bug, phase: "snapshot", scenario: s.id,
    revision: s.engine.revision, promptKind: s.engine.prompt?.kind ?? null,
    materialPromptCount: s.materialViews?.length, targetCode: s.targetCode, snapshots }));
  const html = await buildProofPage(artifacts, "bug-proof-browser.tsx", `BUG ${bug} browser proof`, { cases });
  if (process.argv.includes("--prepare-only")) {
    console.log(JSON.stringify({ bug, phase: "prepared", html, snapshots, browserRun: false }));
    return;
  }
  const require = createRequire(import.meta.url);
  const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright");
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  const evidence: Array<ProofRead & { bug: ProofBug; scenario: string; screenshots: string[] }> = [];
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => { if (!ok) failures.push(`BUG ${bug}: ${message}`); };
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
    });
    for (const s of cases) {
      const width = Number(process.env.PROOF_WIDTH) || 1600;
      // Phone runs keep 390 width but a tall viewport: history rows use content-visibility: auto and skip rendering off-screen.
      const page = await browser.newPage({ viewport: { width, height: width < 600 ? 1600 : 980 }, reducedMotion: "reduce" });
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      // Stop the real effect's removal timers; seek its WAAPI animation to the readable hold below.
      // This keeps the showcase on screen for BOTH screenshots without fabricating a reveal.
      if (bug === 1) {
        await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
      }
      const names = cardNames(s);
      await page.route("**/api/cards/*/image*", async (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
        const code = /\/cards\/(\d+)\//.exec(route.request().url())?.[1] ?? "0";
        const label = (names[code] ?? `Card ${code}`).replace(/[<>&"]/g, "");
        await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260">
          <rect width="180" height="260" fill="#704354"/><text x="90" y="100" fill="white" text-anchor="middle" font-size="11">${label}</text>
          <text x="90" y="145" fill="white" text-anchor="middle" font-size="12">${code}</text></svg>` });
      });
      await page.goto(`${pathToFileURL(html).href}?scenario=${s.id}`);
      await page.locator('[data-duel-field="true"]').waitFor({ state: "visible" });
      await page.getByRole("region", { name: "Duel history events" }).waitFor({ state: "visible" });
      if (bug === 1) await page.locator('[data-testid="added-ghost"]').waitFor({ state: "attached" });
      if (bug === 4) await page.locator('[data-proof-prompt] [role="group"]').first().waitFor({ state: "visible" });
      if (bug === 1) {
        await page.clock.runFor(400);
        await page.evaluate(() => {
          for (const animation of document.getAnimations()) {
            animation.pause();
            const duration = Number(animation.effect?.getTiming().duration);
            animation.currentTime = Math.min(400, Number.isFinite(duration) ? duration : 400);
          }
        });
      }
      const capture = async (step: number) => {
        if (bug === 1) await page.clock.runFor(32);
        await page.waitForFunction((count: number) => window.readBugProof().step === count, step);
        // Wait for real visible image requests, including lazy history art, before inspecting evidence.
        await page.evaluate(async () => {
          await Promise.all(Array.from(document.images).filter((img) => img.loading !== "lazy" ||
            (img.getBoundingClientRect().top < innerHeight && img.getBoundingClientRect().bottom > 0))
            .map((img) => img.complete && img.naturalWidth > 0 ? Promise.resolve() :
              new Promise<void>((resolve, reject) => {
                if (img.complete) { reject(new Error(`Card image failed: ${img.src}`)); return; }
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => reject(new Error(`Card image failed: ${img.src}`)), { once: true });
              })));
        });
        const screenshots = [resolve(artifacts, `${s.id}-${bug === 4 ? `${step}-selected` : bug === 1 ? "showcase" : "set"}.png`)];
        await page.screenshot({ path: screenshots[0], fullPage: true });
        if (bug === 1) {
          screenshots.push(resolve(artifacts, `${s.id}-history.png`));
          const clip = await page.getByRole("region", { name: "Duel history events" }).boundingBox();
          assert(clip, "BUG 1: history panel must be visible for its screenshot");
          await page.screenshot({ path: screenshots[1], clip });
        }
        const row = { bug, scenario: s.id, ...await page.evaluate(() => window.readBugProof()), screenshots };
        evidence.push(row);
        console.log(JSON.stringify(row));
      };
      await capture(0);
      if (bug === 4) {
        for (let step = 0; step < 2; step++) {
          const view = s.materialViews![Math.min(step, s.materialViews!.length - 1)];
          const prompt = view.prompt!;
          const option = prompt.options.find((entry) => !entry.selected && s.materialCodes!.includes(entry.card?.code ?? -1)
            && (prompt.kind === "toggle" || entry.card?.code === s.materialCodes![step]));
          assert(option, `BUG 4: no selectable material for ${s.id} step ${step + 1}`);
          await page.locator(`[data-duel-field] [data-zones~="${zoneKey(option)}"] button`).first().click();
          await capture(step + 1);
        }
      }
      check(pageErrors.length === 0, `${s.id}: browser render errors: ${pageErrors.join("; ")}`);
      await page.close();
    }
    // Check desired fixed behavior only AFTER all cases/steps have their screenshots.
    for (const row of evidence) {
      const label = `${row.scenario}${bug === 4 ? ` (${row.step} selected)` : ""}`;
      if (bug === 1 || bug === 2) {
        check(row.confirmationBannerCount === 0, `${label}: confirmation must not also show a feedback banner`);
      }
      if (bug === 1) {
        check(row.historyShowsTarget || row.revealShowsTarget, `${label}: confirmed Kojikocy is invisible in history and showcase`);
        const addition = row.historyRows.find((entry) => entry.showsTargetArt || entry.text.includes("Kojikocy"))
          ?? row.historyRows.find((entry) => entry.icon === "draw" || entry.icon === "hand");
        check(addition != null && !/\bDraw\b/i.test(addition.text), `${label}: effect search is labelled Draw in history (${addition?.text})`);
        check(/\bAdd(?:ed)? to hand\b/i.test(addition?.text ?? ""), `${label}: search history must label an addition to hand (${addition?.text})`);
        check(/\bAdded to hand\b/i.test(row.revealText), `${label}: the add-to-hand showcase must be visible and labelled`);
      } else if (bug === 2) {
        check(row.historyShowsTarget || row.revealShowsTarget, `${label}: confirmed Majespecter Tempest name/art is invisible in history and reveal`);
        check(row.fieldCardBack === true && Boolean((row.fieldCardPosition ?? 0) & 0x0a),
          `${label}: the confirmed field card must stay face-down (face-down position, card back, no face art)`);
      } else {
        check(!/\b[012]\/1 selected\b/.test(row.promptText), `${label}: per-step maximum shown as a total (${row.counterText})`);
        if (row.scenario === "ritual") {
          check(row.titleText === "Tribute", `${label}: Ritual title must read Tribute (got ${row.titleText})`);
          check(row.instructionText === "Total at least 4", `${label}: Ritual must instruct Total at least 4 (got ${row.instructionText})`);
          const counter = ["Level total 0", "Level total 2", "Level total 2 + 3 = 5"][row.step];
          const met = row.step === 2;
          check(row.counterText === counter, `${label}: Ritual must show ${counter}, got ${row.counterText}`);
          check(row.counterMet === met && row.counterMarker?.includes(met ? "✓" : "○") === true,
            `${label}: Ritual pill must be ${met ? "met with ✓" : "unmet with ○"}, got ${row.counterMarker}`);
          check(row.confirmEnabled === met && row.promptReady === met,
            `${label}: Ritual Confirm must be ${met ? "enabled" : "disabled"}`);
        } else {
          check(row.titleText === "Choose a material", `${label}: title must read Choose a material, got ${row.titleText}`);
          check(row.instructionText === null, `${label}: no per-click count instruction should be shown (got ${row.instructionText})`);
          if (row.scenario === "synchro") {
            const counter = ["Level 0 / 7", "Level 3 / 7", "Level 7 / 7"][row.step];
            const met = row.step === 2;
            check(row.detailText === "Synchro material", `${label}: must name Synchro material`);
            check(row.counterText === counter, `${label}: Synchro must show ${counter}, got ${row.counterText}`);
            check(row.counterMet === met && row.counterMarker?.includes(met ? "✓" : "○") === true,
              `${label}: Synchro pill must be ${met ? "met with ✓" : "unmet with ○"}, got ${row.counterMarker}`);
          } else {
            check(row.counterText === `${row.step} selected`, `${label}: counter must read ${row.step} selected, got ${row.counterText}`);
          }
        }
      }
    }
    await writeFile(resolve(artifacts, "evidence.json"), json({ bug, evidence, failures }));
    console.log(JSON.stringify({ bug, phase: "assertions", passed: failures.length === 0, failures }));
    assert.equal(failures.length, 0, failures.join("\n"));
  } finally { await browser?.close(); }
}

function cardNames(s: ProofCase) {
  const names: Record<string, string> = { [s.targetCode]: s.targetName };
  const add = (card: { code?: number | null; name?: string | null } | null | undefined) => {
    if (card?.code && card.name) names[card.code] = card.name;
  };
  const visit = (view: DuelEngineView) => {
    for (const seat of view.seats) {
      for (const card of [...seat.hand, ...seat.monsters, ...seat.spells, ...seat.graveyard, ...seat.banished]) add(card);
    }
    for (const event of view.events) add(event.card);
    for (const option of view.prompt?.options ?? []) add(option.card);
  };
  visit(s.engine);
  for (const view of s.materialViews ?? []) visit(view);
  return names;
}

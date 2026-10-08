import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { countDiscordHops, formatTimeline, redactUrl, type NavigationEntry } from "./timeline.ts";

test("Continue with Discord signs in to the real site", async ({}, testInfo) => {
  // Defence in depth if this file is ever selected through another config.
  test.skip(Boolean(process.env.CI), "Live Discord login must never run in CI.");

  const baseUrl = new URL(process.env.LIVE_BASE_URL || "https://app.duelingdomain.com");
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("LIVE_BASE_URL must be an HTTP(S) app URL without credentials, query or fragment.");
  }
  const returnPath = process.env.LIVE_RETURN_PATH || "/dashboard";
  const destination = new URL(returnPath, baseUrl.origin);
  if (!returnPath.startsWith("/") || destination.origin !== baseUrl.origin || destination.pathname !== returnPath || destination.search || destination.hash || /^\/(sign-in|sign-up|sso-callback|welcome-back|access)(\/|$)/.test(returnPath)) {
    throw new Error("LIVE_RETURN_PATH must be an absolute app path outside the auth screens, without query or fragment.");
  }
  const numberOption = (name: string, fallback: number, minimum: number) => {
    const value = process.env[name] ?? String(fallback);
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum) {
      throw new Error(`${name} must be an integer of at least ${minimum}.`);
    }
    return parsed;
  };
  const expectedHops = numberOption("LIVE_EXPECT_DISCORD_HOPS", 1, 1);
  const minSuccessMs = numberOption("LIVE_MIN_SUCCESS_MS", 1500, 0);
  const autoAuthorize = process.env.LIVE_AUTO_AUTHORIZE === "1";
  const allowRecovery = process.env.LIVE_ALLOW_RECOVERY === "1";
  const configuredProfile = process.env.LIVE_PROFILE_DIR;
  const profileDir = configuredProfile ? resolve(configuredProfile.startsWith("~/") ? join(homedir(), configuredProfile.slice(2)) : configuredProfile)
    : join(homedir(), ".cache/dueling-domain/live-login-profile");

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let startedAt = Date.now();
  let endedAt: number | undefined;
  let stage = "opening the persistent Chromium profile";
  let flowFailure: string | undefined;
  const entries: NavigationEntry[] = [];
  let success: { startedAt: number; lastVisibleAt: number } | undefined;
  const successDurations: number[] = [];
  const endSuccess = () => {
    if (success) successDurations.push(success.lastVisibleAt - success.startedAt);
    success = undefined;
  };
  const isAuthPath = (path: string) => path === "/sign-in" || path === "/sso-callback";
  const recordNavigation = (url: string) => {
    const entry = { at: Date.now(), ...redactUrl(url) };
    entries.push(entry);
    if (entry.path === "/access" || new URLSearchParams(entry.query).has("error")) {
      flowFailure = "The login visited /access or an error query marker. See the redacted timeline.";
    }
    if (entry.host === baseUrl.host && !allowRecovery && ["/api/auth/existing-player/start", "/welcome-back"].includes(entry.path)) {
      flowFailure = "Existing-player recovery is disabled: /welcome-back consent creates a real Clerk user. Opt in with LIVE_ALLOW_RECOVERY=1 and normally LIVE_EXPECT_DISCORD_HOPS=2.";
    }
  };

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: process.env.LIVE_CHANNEL || undefined,
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
      // Persistent contexts are owned by this test, so record and attach their video explicitly.
      recordVideo: { dir: testInfo.outputPath("videos") },
    });
    // The runner's trace recorder also observes manually launched persistent contexts.
    for (const restoredPage of context.pages()) await restoredPage.close();
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);

    stage = "clearing app and Clerk sign-in state";
    // App, Clerk and the shared dd_signed_in hint live under duelingdomain.com; Discord's own cookies stay.
    await context.clearCookies({ domain: /(^|\.)duelingdomain\.com$/i });
    const escapedHost = baseUrl.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await context.clearCookies({ domain: new RegExp(`^\\.?${escapedHost}$`, "i") });
    // Serve a blank document at the app origin, so storage is cleared before any app code runs.
    const resetUrl = new URL("/__live_login_reset__", baseUrl.origin).href;
    await page.route(resetUrl, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preparing live login</title>" }));
    await page.goto(resetUrl);
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.unroute(resetUrl);

    await page.exposeBinding("liveLoginSuccessSample", ({ frame }, sample: { visible: boolean; at: number }) => {
      const current = redactUrl(frame.url());
      if (current.host !== baseUrl.host || !isAuthPath(current.path)) { endSuccess(); return; }
      if (!sample.visible) { endSuccess(); return; }
      success ??= { startedAt: sample.at, lastVisibleAt: sample.at };
      success.lastVisibleAt = sample.at;
    });
    // Sample rendered frames in the browser; do not hold navigation to make the assertion pass.
    await page.addInitScript(({ origin }) => {
      if (window.top !== window || location.origin !== origin) return;
      let previouslyVisible = false;
      const sample = () => {
        const authPath = location.pathname === "/sign-in" || location.pathname === "/sso-callback";
        const heading = authPath ? Array.from(document.querySelectorAll("h1, h2, h3, [role=heading]")).find(node => /^You[’']re\s+in$/.test(node.textContent?.trim().replace(/\s+/g, " ") ?? "")) : undefined;
        let visible = Boolean(heading && heading.getBoundingClientRect().width > 0 && heading.getBoundingClientRect().height > 0);
        for (let node = heading; visible && node; node = node.parentElement ?? undefined) {
          const style = getComputedStyle(node);
          if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none" || Number(style.opacity) === 0) visible = false;
        }
        if (visible || previouslyVisible) {
          const report = (window as unknown as { liveLoginSuccessSample: (value: { visible: boolean; at: number }) => Promise<void> }).liveLoginSuccessSample;
          void report({ visible, at: Date.now() }).catch(() => {});
        }
        previouslyVisible = visible;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { origin: baseUrl.origin });

    let pendingNavigationUrl: string | undefined;
    // Requests include server redirects (not all of those commit a document).
    page.on("request", request => {
      if (!request.isNavigationRequest() || request.frame() !== page!.mainFrame()) return;
      pendingNavigationUrl = request.url();
      recordNavigation(pendingNavigationUrl);
    });
    page.on("framenavigated", frame => {
      if (frame !== page!.mainFrame()) return;
      // Also include client-side/history navigations, without double-counting document commits.
      if (frame.url() !== pendingNavigationUrl) recordNavigation(frame.url());
      pendingNavigationUrl = undefined;
      const current = redactUrl(frame.url());
      if (current.host !== baseUrl.host || !isAuthPath(current.path)) endSuccess();
    });

    stage = "opening /sign-in";
    const signInUrl = new URL("/sign-in", baseUrl.origin);
    signInUrl.searchParams.set("redirect_url", returnPath);
    startedAt = Date.now();
    await page.goto(signInUrl.href, { waitUntil: "domcontentloaded" });
    if (flowFailure) throw new Error(flowFailure);
    stage = "clicking Continue with Discord";
    await page.getByRole("button", { name: "Continue with Discord", exact: true }).click();

    stage = "waiting for Discord login, consent and the app callback";
    let discordSince: number | undefined;
    let consentSince: number | undefined;
    let authorizedThisVisit = false;
    let recoveryContinued = false;
    await expect.poll(async () => {
      if (flowFailure) return "finished";
      if (page!.isClosed()) { flowFailure = "The live login window was closed before completion."; return "finished"; }
      const current = new URL(page!.url());
      if (current.origin === baseUrl.origin && current.pathname === returnPath) return "finished";
      if (current.origin === baseUrl.origin && current.pathname === "/welcome-back" && allowRecovery && !recoveryContinued) {
        console.log("Recovery enabled: accepting /welcome-back consent creates a real Clerk user.");
        try {
          await page!.getByRole("checkbox").check();
          await page!.getByRole("button", { name: "Continue", exact: true }).click();
          recoveryContinued = true;
        } catch {
          flowFailure = "Could not complete /welcome-back consent. See the redacted timeline and local browser artifacts.";
        }
      }
      if (current.hostname !== "discord.com") {
        discordSince = undefined;
        consentSince = undefined;
        authorizedThisVisit = false;
        return "waiting";
      }
      if (discordSince === undefined) {
        discordSince = Date.now();
        console.log("Discord opened. First run: sign in to Discord in this window (up to 3 minutes). The profile keeps your Discord login for future runs.");
      }
      const authorize = page!.getByRole("button", { name: /^Authorize$/i });
      if (await authorize.isVisible().catch(() => false)) {
        if (consentSince === undefined) {
          consentSince = Date.now();
          console.log(autoAuthorize ? "Discord consent appeared; LIVE_AUTO_AUTHORIZE=1 will click Authorize."
            : "Discord consent appeared. Click Authorize in the browser within 2 minutes to continue.");
        }
        if (autoAuthorize && !authorizedThisVisit) {
          try {
            await authorize.click();
            authorizedThisVisit = true;
          } catch {
            flowFailure = "Could not click Discord Authorize. See the redacted timeline and local browser artifacts.";
          }
        }
      } else if (consentSince === undefined && Date.now() - discordSince > 180_000) {
        flowFailure = "Discord login timed out after 3 minutes. Sign in in the persistent browser window on the next run.";
      }
      if (!autoAuthorize && consentSince !== undefined && Date.now() - consentSince > 120_000) {
        flowFailure = "Discord consent timed out after 2 minutes. Click Authorize, or set LIVE_AUTO_AUTHORIZE=1.";
      }
      return flowFailure ? "finished" : "waiting";
    }, { timeout: 8 * 60_000, intervals: [100, 250], message: "Live Discord login did not reach the return path within 8 minutes." }).toBe("finished");
    endedAt = Date.now();
    endSuccess();
    if (flowFailure) throw new Error(flowFailure);

    stage = "checking the final URL, authenticated session, hops and success frame";
    const finalUrl = new URL(page.url());
    expect(finalUrl.origin, "The login must return to the app origin").toBe(baseUrl.origin);
    expect(finalUrl.pathname, "The login must reach LIVE_RETURN_PATH").toBe(returnPath);
    // Return only status and a boolean from the page; never serialize the session or identity.
    const session = await page.evaluate(async () => {
      const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
      const body: unknown = await response.json();
      return { ok: response.ok, present: body !== null && typeof body === "object" && "user" in body && body.user !== null && typeof body.user === "object" };
    });
    expect(session.ok, "GET /api/auth/session must succeed").toBe(true);
    expect(session.present, "GET /api/auth/session must return a non-null authenticated session").toBe(true);
    expect(countDiscordHops(entries), "Discord authorize hops must equal LIVE_EXPECT_DISCORD_HOPS").toBe(expectedHops);
    expect(entries.some(entry => entry.path === "/access" || new URLSearchParams(entry.query).has("error")), "The flow must never visit /access or an error query marker").toBe(false);
    expect(successDurations.length, "The You’re in heading must be visible on /sign-in or /sso-callback before navigation").toBeGreaterThan(0);
    expect(Math.max(...successDurations), "The You’re in success frame disappeared before LIVE_MIN_SUCCESS_MS elapsed").toBeGreaterThanOrEqual(minSuccessMs);
  } catch (error) {
    // Playwright action errors can contain full OAuth URLs. Keep only our own safe assertions/messages.
    if (flowFailure) throw new Error(flowFailure);
    if (error && typeof error === "object" && "matcherResult" in error) throw error;
    throw new Error(`Live Discord login failed while ${stage}. See the redacted timeline and local browser artifacts.`);
  } finally {
    endedAt ??= Date.now();
    endSuccess();
    const timeline = formatTimeline(entries, startedAt, endedAt, baseUrl.href);
    const successMs = successDurations.length ? Math.max(...successDurations) : 0;
    console.log(`\nLive Discord login timeline\n${timeline}\nSuccess heading visible: ${successMs}ms (minimum ${minSuccessMs}ms)`);
    await testInfo.attach("live-login-timeline", { body: `${timeline}\nSuccess heading visible: ${successMs}ms (minimum ${minSuccessMs}ms)\n`, contentType: "text/plain" });
    await testInfo.attach("live-login-timeline-json", {
      body: JSON.stringify({ startedAt: new Date(startedAt).toISOString(), totalMs: endedAt - startedAt, discordHops: countDiscordHops(entries), successMs,
        navigations: entries.map(entry => ({ ...entry, at: new Date(entry.at).toISOString() })) }, null, 2),
      contentType: "application/json",
    });
    if (context) {
      const video = page?.video();
      try {
        // Closing the context finalizes video and lets the runner attach its trace.
        await context.close();
        if (video) await testInfo.attach("video", { path: await video.path(), contentType: "video/webm" });
      } catch {
        throw new Error("Could not finalize the live login browser artifacts. See the redacted timeline.");
      }
    }
  }
});

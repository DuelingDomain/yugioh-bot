import { expect, test, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";

test("two seated browsers exchange field video, detect stalled frames, relay recognition and reconnect", async ({ browser }) => {
  const alice = await browser.newContext(); const bob = await browser.newContext();
  try {
    for (const [context, userId] of [[alice, 101], [bob, 102]] as const) {
      await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      // Test the real RTP stall, without adding production-only test controls.
      await context.addInitScript(() => {
        const original = RTCPeerConnection.prototype.addTransceiver;
        const senders: { sender: RTCRtpSender; track: MediaStreamTrack }[] = [];
        Object.assign(window, { videoSenders: senders });
        RTCPeerConnection.prototype.addTransceiver = function (...args) {
          const transceiver = original.apply(this, args);
          if (args[0] instanceof MediaStreamTrack && args[0].kind === "video") senders.push({ sender: transceiver.sender, track: args[0] });
          return transceiver;
        };
      });
    }
    const created = await alice.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2 } });
    expect(created.status()).toBe(201); const room = await created.json();
    expect((await bob.request.post(`/api/remote/${room.slug}/seat`, { data: { seat: 1 } })).ok()).toBe(true);
    const a = await alice.newPage(); const b = await bob.newPage();
    await Promise.all([a.goto(`/duels/remote/${room.slug}`), b.goto(`/duels/remote/${room.slug}`)]);
    for (const page of [a, b]) await page.getByRole("button", { name: "Enable table video" }).click();
    const video = (page: Page, seat: number) => page.locator(`video[data-remote-seat="${seat}"]`);
    for (const page of [a, b]) for (const seat of [0, 1]) {
      await expect(video(page, seat)).toBeVisible();
      await expect.poll(() => video(page, seat).evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(10);
    }
    // Returning from the active device to Default must retain a live raw camera.
    const picker = a.getByRole("combobox", { name: /^Field camera/ });
    await expect(picker).not.toHaveValue("");
    await picker.selectOption("");
    await expect(picker).toHaveValue("");
    await expect.poll(() => video(a, 0).evaluate(node => (node as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await expect(a.getByTestId("feed-health-0")).toHaveText("Live");
    const localSize = await video(a, 0).evaluate(node => ({ width: (node as HTMLVideoElement).videoWidth, height: (node as HTMLVideoElement).videoHeight }));
    expect(localSize.width).toBeLessThanOrEqual(1920); expect(localSize.height).toBeLessThanOrEqual(1080);
    await a.getByRole("button", { name: "Recognize on seat 2" }).click();
    for (const page of [a, b]) await expect(page.getByText("Seat 2: no recognition candidates (vision integration pending).")).toBeVisible();
    await a.evaluate(async () => {
      const senders = (window as unknown as { videoSenders: { sender: RTCRtpSender; track: MediaStreamTrack }[] }).videoSenders;
      for (const entry of senders) if (entry.sender.track) entry.track = entry.sender.track;
      if (!senders.length) throw new Error("No captured camera sender");
      await Promise.all(senders.map(({ sender }) => sender.replaceTrack(null)));
    });
    await expect(b.getByTestId("feed-health-0")).toHaveText("Feed frozen (no frames for 3 s)");
    await a.evaluate(async () => {
      const senders = (window as unknown as { videoSenders: { sender: RTCRtpSender; track: MediaStreamTrack }[] }).videoSenders;
      await Promise.all(senders.map(({ sender, track }) => sender.replaceTrack(track)));
    });
    await expect(b.getByTestId("feed-health-0")).toHaveText("Live");
    // A complete transport interruption exercises SDK automatic reconnect/republish.
    await bob.setOffline(true);
    await expect(b.getByTestId("video-connection")).toContainText(/reconnecting|disconnected/i);
    await bob.setOffline(false);
    await expect(b.getByTestId("video-connection")).toHaveText("Video connected", { timeout: 35_000 });
    const before = await video(a, 1).evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
    await expect.poll(() => video(a, 1).evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(before + 5);
    await b.getByRole("button", { name: "Enable microphone" }).click();
    await expect(b.getByRole("button", { name: "Mute microphone" })).toBeVisible();
    await b.getByRole("button", { name: "Mute microphone" }).click();
    await b.getByRole("button", { name: "Stop table video" }).click();
    await expect(video(a, 1)).toHaveCount(0);
    expect(await b.evaluate(() => (window as unknown as { videoSenders: { track: MediaStreamTrack }[] }).videoSenders.every(({ track }) => track.readyState === "ended"))).toBe(true);
  } finally { await Promise.allSettled([alice.close(), bob.close()]); }
});

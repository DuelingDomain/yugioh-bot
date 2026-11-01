import { expect, test, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";

test("two seated browsers exchange field video, detect stalled frames and reconnect", async ({ browser }) => {
  test.setTimeout(300_000);
  const alice = await browser.newContext(); const bob = await browser.newContext();
  try {
    for (const [context, userId] of [[alice, 101], [bob, 102]] as const) {
      await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      // Test the real RTP stall, without adding production-only test controls.
      await context.addInitScript(() => {
        // Keep the LiveKit signal sockets so the test can cut them: Chrome's offline mode does not close an open socket.
        const sockets: WebSocket[] = []; const NativeSocket = window.WebSocket;
        Object.assign(window, { signalSockets: sockets });
        window.WebSocket = class extends NativeSocket { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); } };
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
    const slug = await startTwoPlayerTable(alice.request, bob.request);
    const a = await alice.newPage(); const b = await bob.newPage();
    await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`)]);
    for (const page of [a, b]) {
      await expect(page.getByTestId("remote-table")).toBeVisible();
      await page.getByTestId("camera-on-feed").click();
    }
    const video = (page: Page, seat: number) => page.locator(`[data-testid="feed-${seat}"] video`);
    const frames = (page: Page, seat: number) => video(page, seat).evaluate(node => (node as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
    const health = (page: Page, seat: number) => page.locator(`[data-hl="${seat}"]`);
    for (const page of [a, b]) for (const seat of [0, 1]) {
      await expect(video(page, seat)).toBeVisible();
      await expect.poll(() => frames(page, seat)).toBeGreaterThan(10);
    }
    const size = await video(a, 0).evaluate(node => ({ width: (node as HTMLVideoElement).videoWidth, height: (node as HTMLVideoElement).videoHeight }));
    expect(size.width).toBeGreaterThan(0); expect(size.width).toBeLessThanOrEqual(1920); expect(size.height).toBeLessThanOrEqual(1080);
    await expect(health(b, 0)).toContainText("Good");
    // The top health chip opens the same list.
    await b.getByTestId("health-chip").click();
    await expect(b.getByTestId("health-popover")).toContainText("E2E Alice");
    await b.keyboard.press("Escape");

    // Alice's sender stops: Bob sees the frozen feed, then it recovers.
    await a.evaluate(async () => {
      const senders = (window as unknown as { videoSenders: { sender: RTCRtpSender; track: MediaStreamTrack }[] }).videoSenders;
      for (const entry of senders) if (entry.sender.track) entry.track = entry.sender.track;
      if (!senders.length) throw new Error("No captured camera sender");
      await Promise.all(senders.map(({ sender }) => sender.replaceTrack(null)));
    });
    await expect(health(b, 0)).toContainText("Frozen");
    await a.evaluate(async () => {
      const senders = (window as unknown as { videoSenders: { sender: RTCRtpSender; track: MediaStreamTrack }[] }).videoSenders;
      await Promise.all(senders.map(({ sender, track }) => sender.replaceTrack(track)));
    });
    await expect(health(b, 0)).toContainText("Good");

    // A short network blip: the SDK keeps the room and Bob's feed keeps moving on Alice's screen.
    await bob.setOffline(true); await b.waitForTimeout(3_000); await bob.setOffline(false);
    await expect(health(b, 0)).toContainText("Good", { timeout: 40_000 });
    const before = await frames(a, 1);
    await expect.poll(() => frames(a, 1), { timeout: 30_000 }).toBeGreaterThan(before + 5);

    // A hard drop: Bob loses the signal socket for good. His screen says so and offers the way back in.
    await bob.setOffline(true);
    await b.evaluate(() => { for (const socket of (window as unknown as { signalSockets: WebSocket[] }).signalSockets) if (socket.url.includes("/rtc")) socket.close(); });
    await expect(health(b, 0)).toContainText(/Reconnecting|No feed/, { timeout: 60_000 });
    await bob.setOffline(false);
    await expect(b.getByTestId("camera-on-feed")).toBeVisible({ timeout: 60_000 });
    await b.getByTestId("camera-on-feed").click();
    await expect(health(b, 0)).toContainText("Good", { timeout: 40_000 });
    const afterJoin = await frames(a, 1);
    await expect.poll(() => frames(a, 1), { timeout: 30_000 }).toBeGreaterThan(afterJoin + 5);

    await b.getByRole("button", { name: "Mute microphone" }).click();
    await b.getByRole("button", { name: "Camera off" }).click();
    await expect(video(a, 1)).toHaveCount(0);
    expect(await b.evaluate(() => (window as unknown as { videoSenders: { track: MediaStreamTrack }[] }).videoSenders.every(({ track }) => track.readyState === "ended"))).toBe(true);
  } finally { await Promise.allSettled([alice.close(), bob.close()]); }
});

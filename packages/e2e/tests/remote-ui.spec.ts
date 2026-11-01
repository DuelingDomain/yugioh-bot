import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";

const SHOTS = process.env.E2E_SHOTS ?? "";
// A still picture of two cards on a table, served as the camera. Chrome's fake-file camera is not reliable between tests.
const FRAME = process.env.E2E_FAKE_FRAME ? readFileSync(process.env.E2E_FAKE_FRAME).toString("base64") : "";
async function fakeCamera(page: Page) {
  if (!FRAME) return;
  await page.addInitScript(data => {
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext("2d")!; let image: ImageBitmap | null = null;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    void createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).then(bitmap => { image = bitmap; });
    const paint = () => { if (image) context.drawImage(image, 0, 0, 1280, 720); else { context.fillStyle = "#2a3a2e"; context.fillRect(0, 0, 1280, 720); } };
    setInterval(paint, 50);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints?.video) throw new DOMException("No video", "NotFoundError");
      paint(); return canvas.captureStream(15);
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  }, FRAME);
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true } });
  expect(created.status()).toBe(201); const room = await created.json();
  const ready = await api.post(`/api/remote/${room.slug}/ready`, { data: { ready: true } });
  const started = await api.post(`/api/remote/${room.slug}/start`, { data: {} });
  expect([ready.status(), started.status()], await started.text()).toEqual([200, 200]);
  return room.slug as string;
}

test.describe("remote duels screen, solo", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, (process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310")); });

  test("1v1 table: phase rail, LP, undo, drawers", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("remote-table")).toBeVisible();
    await expect(page.getByTestId("remote-table")).toHaveAttribute("data-mode", "1v1");
    await shot(page, "1v1-1920-initial");
    await page.getByTestId("phase-main1").click();
    await expect(page.getByTestId("phase-main1")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("banner")).toBeVisible();
    const lp = page.getByTestId("lp-value-0"); const before = Number((await lp.textContent())?.replace(/\D/g, ""));
    await page.getByRole("button", { name: "E2E Alice minus 500" }).click();
    await expect(lp).toContainText(String(before - 500));
    await expect(page.getByTestId("undo")).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect(lp).toContainText(String(before));
    await page.getByTestId("log-button").click();
    await expect(page.getByTestId("log-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("card-button").click();
    await expect(page.getByTestId("inspector")).toBeVisible();
    await page.keyboard.press("Escape");
    await shot(page, "1v1-1920-played");
  });

  test("3-way and 4-way layouts", async ({ page, context }) => {
    for (const [count, mode] of [[3, "3"], [4, "4"]] as const) {
      const slug = await soloTable(context.request, count);
      await page.goto(`/duels/remote/${slug}`);
      await expect(page.getByTestId("remote-table")).toHaveAttribute("data-mode", mode);
      for (let seat = 0; seat < count; seat++) await expect(page.getByTestId(`seat-${seat}`)).toBeVisible();
      await shot(page, `${mode}way-1920`);
    }
  });

  test("click on the live feed opens the card popup, Esc closes it", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // Click on the first card of the fake camera frame (card centre at 26% x 49% of the picture).
    const at = async (fx: number, fy: number) => video.evaluate((v: HTMLVideoElement, [x, y]) => {
      const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const w = v.videoWidth * s; const h = v.videoHeight * s;
      return { x: r.left + (r.width - w) / 2 + x * w, y: r.top + (r.height - h) / 2 + y * h };
    }, [fx, fy]);
    await page.getByTestId("feed-0").hover();
    await page.waitForTimeout(500);
    const p = await at(0.338, 0.486); 
    await page.mouse.click(p.x, p.y);
    // The popup is there at once, with the skeleton.
    const popup = page.locator('[data-layer="tray"], [data-layer="card"]').first();
    await expect(popup).toBeVisible({ timeout: 2_000 });
    await shot(page, "live-click-reading");
    await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("big-art")).toBeVisible();
    await expect(page.getByTestId("popover-name")).toHaveText("Dark Magician");
    await expect(page.getByTestId("pin-inspector")).toBeVisible();
    // The art comes from the card image route. Without a cached file it is fetched from the card site, so give it time and do not fail on it.
    await expect.poll(() => page.getByTestId("big-art").evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0).catch(() => undefined);
    const box = await popup.boundingBox(); const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);
    await shot(page, "live-click-popup");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
    // A second click, then a press outside the feed closes it too.
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]').first()).toBeVisible({ timeout: 2_000 });
    await page.getByTestId("remote-table").click({ position: { x: 4, y: 4 } });
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
  });

  test("F freezes the frame and outlines the cards", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-box-0").focus();
    await page.keyboard.press("f");
    await expect(page.getByTestId("quad").first()).toBeVisible({ timeout: 90_000 });
    expect(await page.getByTestId("quad").count()).toBeGreaterThanOrEqual(1);
    await shot(page, "freeze-outlines");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("frozen-frame")).toHaveCount(0);
  });

  for (const [width, height, label] of [[1366, 768, "1366"], [390, 844, "390"]] as const) {
    test(`card popup stays inside the window at ${label}`, async ({ page, context }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height });
      const slug = await soloTable(context.request, 2);
      await fakeCamera(page);
      await page.goto(`/duels/remote/${slug}`);
      await page.getByTestId("camera-on-feed").click();
      const video = page.locator('[data-testid="feed-0"] video');
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
      const p = await video.evaluate((v: HTMLVideoElement) => {
        const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * s; const h = v.videoHeight * s;
        return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
      });
      await page.mouse.move(p.x, p.y); await page.waitForTimeout(500);
      await page.mouse.click(p.x, p.y);
      await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => page.getByTestId("big-art").evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0).catch(() => undefined);
      const box = await page.getByTestId("card-popover").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      await shot(page, `live-click-popup-${label}`);
      await page.keyboard.press("Escape");
    });
  }
});

test("private Set candidate pick, public reveal and a soft mismatch note",async({page,context})=>{
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,(process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310"));
  const decks=await (await context.request.get("/api/decks")).json();
  const deck=decks.decks.find((d:{name:string})=>d.name==="Remote origin fixture");
  const created=await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2,solo:true}});
  let room=await created.json(); const slug=room.slug;
  const selected=await context.request.post(`/api/remote/${slug}/deck`,{data:{savedDeckId:deck.id}}); expect(selected.status(),await selected.text()).toBe(200);
  await context.request.post(`/api/remote/${slug}/ready`,{data:{ready:true}});
  const started=await context.request.post(`/api/remote/${slug}/start`,{data:{}}); expect(started.status(),await started.text()).toBe(200); room=await started.json();
  const source=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:room.lastSeq,action:{type:"twin.place",actorSeat:0,seat:0,zone:"spell-trap",card:{ref:"tracks",cardId:70825459,name:"Trap Tracks",slot:1,faceUp:true},idempotencyKey:crypto.randomUUID()}}});
  expect(source.status(),await source.text()).toBe(200);
  // Keep image loading offline; the behavior under test is the owned card state.
  await page.route("**/api/cards/*/image**",route=>route.fulfill({status:204}));
  await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId("field-0").locator('[data-zone="s1"]').click();
  await page.getByRole("button",{name:"Activate",exact:true}).click();
  await page.getByRole("button",{name:"Set face-down",exact:true}).click();
  const set=page.getByTestId("field-0").locator('[data-zone="s2"]');
  await expect(set).toHaveAttribute("aria-label",/Face-down · Set by Trap Tracks/);
  await set.click();
  await expect(page.getByTestId("effect-picker")).toBeVisible();
  await page.getByRole("button",{name:/Torrential Tribute ×1/}).click();
  await expect(set).toHaveAttribute("aria-label",/Torrential Tribute/);
  await set.click(); await page.getByRole("button",{name:"Reveal chosen card"}).click();
  await expect(set).toHaveAttribute("aria-label",/Torrential Tribute/);
  await expect(set).not.toHaveAttribute("aria-label",/Face-down/);
  // A later camera correction is assistive: the action succeeds and everyone gets a dismissible note.
  room=await (await context.request.get(`/api/remote/${slug}`)).json();
  const ref=room.state.seats[0].twin.find((c:{ref:string})=>c.ref!=="tracks").ref;
  const corrected=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:room.lastSeq,action:{type:"card.identified",actorSeat:0,seat:0,cardRef:ref,cardId:5318639,source:"auto",idempotencyKey:crypto.randomUUID()}}});
  expect(corrected.status()).toBe(200);
  await expect(page.getByText("Mystical Space Typhoon could not be Set by Trap Tracks",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Dismiss note"}).click();
  await expect(page.getByText("Mystical Space Typhoon could not be Set by Trap Tracks",{exact:true})).toHaveCount(0);
});

test("two browsers keep Set and search identities private until a reveal or announcement",async({page,context,browser})=>{
  const url=process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,url);
  const bob=await browser.newContext();
  try {
    await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,url);
    const aliceDeck=(await (await context.request.get("/api/decks")).json()).decks.find((d:{name:string})=>d.name==="Remote origin fixture");
    const bobDeck=(await (await bob.request.get(`${url}/api/decks`)).json()).decks.find((d:{name:string})=>d.name==="Remote origin fixture");
    let room=await (await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2}})).json();const path=`/api/remote/${room.slug}`;
    expect((await context.request.post(`${path}/deck`,{data:{savedDeckId:aliceDeck.id}})).status()).toBe(200);
    expect((await bob.request.post(`${url}${path}/seat`,{data:{seat:1}})).status()).toBe(200);
    expect((await bob.request.post(`${url}${path}/deck`,{data:{savedDeckId:bobDeck.id}})).status()).toBe(200);
    await context.request.post(`${path}/ready`,{data:{ready:true}});await bob.request.post(`${url}${path}/ready`,{data:{ready:true}});
    const start=await context.request.post(`${path}/start`,{data:{}});expect(start.status(),await start.text()).toBe(200);room=await start.json();
    const act=async(action:Record<string,unknown>)=>{
      room=await (await context.request.get(path)).json();
      const response=await context.request.post(`${path}/actions`,{data:{baseSeq:room.lastSeq,action:{actorSeat:0,idempotencyKey:crypto.randomUUID(),...action}}});
      expect(response.status(),await response.text()).toBe(200);room=await response.json();
    };
    await act({type:"effect.activated",source:{cardId:70825459}});
    await act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"private",slot:1,faceUp:false}});
    const observer=await bob.newPage();
    await Promise.all([page,observer].map(p=>p.route("**/api/cards/*/image**",route=>route.fulfill({status:204}))));
    await Promise.all([page.goto(`/duels/remote/${room.slug}`),observer.goto(`${url}/duels/remote/${room.slug}`)]);
    await page.getByTestId("field-0").locator('[data-zone="s1"]').click();
    await page.getByRole("button",{name:/Torrential Tribute ×1/}).click();
    const otherSet=observer.getByTestId("field-0").locator('[data-zone="s1"]');
    await expect(otherSet).toHaveAttribute("aria-label",/Face-down · Set by Trap Tracks/);
    await expect(otherSet).not.toHaveAttribute("aria-label",/Torrential/);
    await otherSet.click();await expect(observer.getByTestId("effect-picker")).toHaveCount(0);
    const privateView=await (await bob.request.get(`${url}${path}`)).json();
    expect(privateView.seats[0].deck).toBeUndefined();expect(privateView.state.effectTracking.origins[0].candidates).toBeUndefined();
    expect(privateView.state.seats[0].twin[0].cardId).toBeUndefined();
    await act({type:"twin.flip",seat:0,cardRef:"private",faceUp:true});
    await expect(otherSet).toHaveAttribute("aria-label",/Torrential Tribute/);
    await act({type:"effect.activated",source:{cardId:73628505}});
    await page.getByRole("button",{name:"Choose searched card · from Terraforming"}).click();
    await page.getByRole("button",{name:/Necrovalley ×1/}).click();
    await expect(observer.getByText("Necrovalley added to hand by Terraforming",{exact:true})).toHaveCount(0);
    const handView=await (await bob.request.get(`${url}${path}`)).json();
    expect(handView.state.effectTracking.origins.find((o:{destination:string})=>o.destination==="hand").chosenCardId).toBeUndefined();
    await page.getByRole("button",{name:"Announce searched card"}).click();
    await expect(observer.getByText("Necrovalley added to hand by Terraforming",{exact:true})).toBeVisible();
  } finally {await bob.close();}
});

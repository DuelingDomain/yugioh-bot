import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";

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

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4, registeredDeck=false) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true } });
  expect(created.status()).toBe(201); const room = await created.json();
  if(registeredDeck){
    const {decks}=await (await api.get('/api/decks')).json();
    const picked=await api.post(`/api/remote/${room.slug}/deck`,{data:{savedDeckId:decks[0].id}});
    expect(picked.ok(),await picked.text()).toBe(true);
  }
  const ready = await api.post(`/api/remote/${room.slug}/ready`, { data: { ready: true } });
  const started = await api.post(`/api/remote/${room.slug}/start`, { data: {} });
  expect([ready.status(), started.status()], await started.text()).toEqual([200, 200]);
  return room.slug as string;
}

test.describe("remote duels screen, solo", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310"); });

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

test.describe("remote duels screen, two players on LiveKit", () => {
  test("Bob reads Alice's feed, both see it, and the other player can undo", async ({ browser }) => {
    test.setTimeout(300_000);
    const alice = await browser.newContext(); const bob = await browser.newContext();
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const a = await alice.newPage(); const b = await bob.newPage();
      // Only Alice's camera shows cards. Bob's page needs a camera to join the table, nothing more.
      await fakeCamera(a); await fakeCamera(b);
      await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`)]);
      for (const page of [a, b]) { await expect(page.getByTestId("remote-table")).toBeVisible(); await page.getByTestId("camera-on-feed").click(); }
      const video = b.locator('[data-testid="feed-0"] video');
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 40_000 }).toBeGreaterThan(0);
      await shot(b, "two-players-bob");
      await b.getByTestId("feed-0").hover(); await b.waitForTimeout(500);
      const p = await video.evaluate((v: HTMLVideoElement) => {
        const r = v.getBoundingClientRect(); const sc = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * sc; const h = v.videoHeight * sc;
        return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
      });
      await b.mouse.click(p.x, p.y);
      await expect(b.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
      await expect(b.getByTestId("popover-name")).toHaveText("Dark Magician");
      await b.keyboard.press("Escape");
      // Alice sees the result in her log: the identification travelled through the table, not only Bob's screen.
      await a.getByTestId("log-button").click();
      await expect(a.getByTestId("log-list")).toContainText("Dark Magician identified on E2E Alice", { timeout: 20_000 });
      await a.keyboard.press("Escape");
      await shot(a, "two-players-alice-log");
      // Alice changes her LP. Bob undoes it from his own screen.
      const lp = (page: Page) => page.getByTestId("lp-value-0");
      const before = Number((await lp(b).textContent())?.replace(/\D/g, ""));
      await a.getByRole("button", { name: "E2E Alice minus 500" }).click();
      await expect(lp(a)).toContainText(String(before - 500));
      await expect(lp(b)).toContainText(String(before - 500));
      await expect(b.getByTestId("undo")).toBeEnabled();
      await b.getByTestId("undo").click();
      await expect(lp(a)).toContainText(String(before));
      await expect(lp(b)).toContainText(String(before));
      await shot(b, "two-players-undo");
    } finally { await Promise.allSettled([alice.close(), bob.close()]); }
  });

  test("two-player table fits every screen size, with the health chip in reach", async ({ browser }) => {
    test.setTimeout(240_000);
    const alice = await browser.newContext(); const bob = await browser.newContext();
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const a = await alice.newPage(); const b = await bob.newPage();
      await fakeCamera(a); await fakeCamera(b);
      await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`)]);
      for (const page of [a, b]) { await expect(page.getByTestId("remote-table")).toBeVisible(); await page.getByTestId("camera-on-feed").click(); }
      await expect.poll(() => b.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 40_000 }).toBeGreaterThan(0);
      for (const [w, h] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]] as const) {
        await b.setViewportSize({ width: w, height: h }); await b.waitForTimeout(600);
        await expect(b.getByTestId("health-chip")).toBeVisible();
        const box = await b.getByTestId("health-chip").boundingBox();
        expect(box && box.height >= 24 && box.x >= 0 && box.x + box.width <= w).toBe(true);
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(b, `two-players-${w}x${h}`);
        if (w === 390) { await b.getByTestId("health-chip").click(); await expect(b.getByTestId("health-popover")).toBeVisible(); await shot(b, "two-players-390-health"); await b.keyboard.press("Escape"); }
      }
    } finally { await Promise.allSettled([alice.close(), bob.close()]); }
  });
});

// Standalone real-worker coverage: run with playwright.vision.config.ts and a prepared local lab.
const AUTO_CARD = process.env.E2E_AUTO_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/card.png', import.meta.url).pathname;
const EXTRA_CARD = process.env.E2E_EXTRA_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/44508094.png', import.meta.url).pathname;
const TRAP_CARD = process.env.E2E_TRAP_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/41420027.png', import.meta.url).pathname;
async function appearingCamera(page:Page,cardFile=AUTO_CARD) {
  const data=readFileSync(cardFile).toString('base64');
  await page.addInitScript(async data=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    let visible=false,x=460,y=170,defense=false,jitter=false,others:{x:number;y:number}[]=[];
    const paint=()=>{ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);if(visible){ctx.save();if(jitter){const phase=performance.now()/1400;ctx.filter=`brightness(${.85+.12*Math.sin(phase)})`;ctx.translate(x+90,y+131);ctx.rotate(.04*Math.sin(phase*.7));ctx.translate(-x-90,-y-131);}if(defense){ctx.translate(x+131,y+90);ctx.rotate(Math.PI/2);ctx.drawImage(image,-90,-131,180,262);}else ctx.drawImage(image,x,y,180,262);ctx.restore();for(const other of others)ctx.drawImage(image,other.x,other.y,180,262);}};
    (window as any).fieldTest={appear:()=>{visible=true;paint();},place:(left:number,top:number,def=false)=>{x=left;y=top;defense=def;visible=true;paint();},move:()=>{x=660;y=185;paint();},jitter:(active:boolean)=>{jitter=active;paint();},clear:()=>{visible=false;others=[];paint();},many:(points:{x:number;y:number}[])=>{[ {x,y},...others]=points;visible=true;paint();}};
    paint();setInterval(paint,65);
    navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints?.video)throw new DOMException('Video only','NotFoundError');return canvas.captureStream(15);};
    navigator.mediaDevices.enumerateDevices=async()=>[];
  },data);
}
test('field watcher automatic: a lab without a deck asks before placement and follows a confirmed card',async({page})=>{
  test.setTimeout(120_000);await appearingCamera(page);await page.goto('/dev/vision-lab');
  await page.getByRole('tab',{name:'Auto-detect',exact:true}).click();
  await page.getByLabel('Auto-detect compute').selectOption('wasm');await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await expect(page.getByTestId('auto-detect-status')).toContainText('Watching field');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(1280);
  await page.waitForTimeout(2000);await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await page.evaluate(()=>((window as any).fieldTest).appear());
  const prompt=page.getByRole('group',{name:'New card?',exact:true});await expect(prompt).toBeVisible({timeout:30_000});
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await prompt.getByRole('button',{name:/Sacred Sword of Seven Stars/}).click();
  await expect(page.getByTestId('auto-detect-twin')).toContainText('Sacred Sword of Seven Stars');
  await expect(page.getByTestId('auto-detect-events')).toContainText('prompt');
  await page.evaluate(()=>((window as any).fieldTest).move());
  await expect(page.getByTestId('auto-detect-events')).toContainText('moved',{timeout:15_000});
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.evaluate(()=>((window as any).fieldTest).clear());
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0,{timeout:12000});
  await expect(page.getByTestId('auto-detect-departure')).toContainText('left the field');
  await page.getByRole('button',{name:'Undo automatic field change'}).click();await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.waitForTimeout(2800);await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
});
test('field watcher automatic: owner table applies once and Undo removes the atomic placement',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2,true);
  // Next dev compiles these on first use. Warm them before a placement starts
  // the five-second Undo window; compilation is not part of the Undo contract.
  await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await context.request.post('/api/cards/resolve',{data:{customCardIds:[45725480]}});
  await context.request.get('/api/cards/45725480/image?variant=cropped');
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.waitForTimeout(2000);await page.evaluate(()=>((window as any).fieldTest).appear());
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>{const r=await room();return r.state.seats[0].twin.length;},{timeout:30_000}).toBe(1);
  const placed=await room();expect(placed.state.seats[0].twin[0].cardId).toBe(45725480);
  expect(placed.state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:2});
  expect(placed.events.filter((e:any)=>e.action.type==='twin.place'&&e.action.source==='auto')).toHaveLength(1);
  expect(placed.events.some((e:any)=>e.action.type==='card.identified')).toBe(false);
  await page.getByTestId('undo').click();await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(0);
  await page.waitForTimeout(2500);expect((await room()).state.seats[0].twin).toHaveLength(0);
  await page.evaluate(()=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,r=feed.getBoundingClientRect();
    const scale=Math.min(r.width/video.videoWidth,r.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+(r.width-w)/2+550/1280*w,clientY:r.top+(r.height-h)/2+301/720*h}));
  });
  await expect(page.getByTestId('recognition-tray')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-popover')).toHaveCount(0);
  await page.getByLabel('Auto-detect cards',{exact:true}).uncheck();await expect(page.getByTestId('field-watcher-status')).toHaveCount(0);
});

test('field watcher automatic: a failed lazy recognition load leaves detection usable and can retry',async({page})=>{
  test.setTimeout(90_000);await page.route('**/dev/vision-assets/yugioh-index.bin',route=>route.fulfill({status:503,body:'temporary fixture failure'}),{times:1});
  await page.goto('/dev/vision-lab');
  const answer=await page.evaluate(async()=>{
    const api=await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/field-watcher/api.js'));
    const reader=api.createRecognizer({backend:'wasm'}),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);ctx.drawImage(await createImageBitmap(await(await fetch('/dev/vision-assets/benchmark/field-watcher/card.png')).blob()),460,170,180,262);
    try {
      const cards=await reader.detectCards(await createImageBitmap(canvas));let failure='';
      try{await reader.recognize([await createImageBitmap(canvas)],{card:cards[0]});}catch(e){failure=(e as Error).message;}
      const after=await reader.detectCards(await createImageBitmap(canvas)),retried=await reader.recognize([await createImageBitmap(canvas)],{card:after[0]});
      return {failure,detected:after.length,tier:retried.tier};
    }finally{reader.dispose();}
  });
  expect(answer.failure).toContain('503');expect(answer.detected).toBe(1);expect(answer.tier).toBe('sure');
});

test('field watcher automatic: actual table format places both EMZ above the main row and omits them in Genesys',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  for(const format of ['normal','domain','genesys','genesys-domain']) {
    const created=await context.request.post('/api/remote',{data:{gameId:'ygo',seatCount:2,solo:true,format}});expect(created.status()).toBe(201);
    const {slug}=await created.json();await context.request.post(`/api/remote/${slug}/ready`,{data:{ready:true}});await context.request.post(`/api/remote/${slug}/start`,{data:{}});
    await page.goto(`/duels/remote/${slug}`);const field=page.getByTestId('field-0');
    await expect(field.locator('[data-zone^="emz"]')).toHaveCount(format.startsWith('genesys')?0:2);
    if(!format.startsWith('genesys'))for(const [extra,main] of [['emz1','m2'],['emz2','m4']]) {
      const a=await field.locator(`[data-zone="${extra}"]`).boundingBox(),b=await field.locator(`[data-zone="${main}"]`).boundingBox();
      expect(a).not.toBeNull();expect(b).not.toBeNull();expect(a!.y+a!.height).toBeLessThanOrEqual(b!.y);
      // The existing perspective tilt shifts the projected x coordinate by row.
      expect(Math.abs(a!.x+a!.width/2-b!.x-b!.width/2)).toBeLessThan(b!.width*.1);
    }
  }
});

async function cachedPopupClick(page:Page) {
  return page.evaluate(()=>new Promise<number>((resolve,reject)=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,rect=feed.getBoundingClientRect();
    const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    const start=performance.now(),timer=setTimeout(()=>{observer.disconnect();reject(Error('No cached popup '+JSON.stringify({status:document.querySelector('[data-testid=field-watcher-status]')?.textContent,tray:document.querySelector('[data-testid=recognition-tray]')?.textContent,calls:(window as any).visionCalls,visibility:document.visibilityState})));},3000);
    const observer=new MutationObserver(()=>{if(document.querySelector('[data-testid="card-popover"]')?.textContent?.includes('Sacred Sword of Seven Stars')){clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);}});
    observer.observe(document.body,{subtree:true,childList:true});
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+(rect.width-w)/2+550/1280*w,clientY:rect.top+(rect.height-h)/2+301/720*h}));
  }));
}
test('field watcher automatic: cached owner and observer clicks open the popup without another read',async({browser})=>{
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  const alice=await browser.newContext({baseURL:origin,permissions:["camera","microphone"]}),bob=await browser.newContext({baseURL:origin,permissions:["camera","microphone"]}),records:{view:string;ms:number}[]=[];
  try{
    await authenticatePlayer(alice.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,origin);
    const slug=await startTwoPlayerTable(alice.request,bob.request),a=await alice.newPage(),b=await bob.newPage(),realtimeSeen=new Set<Page>(),realtimeAt=new Map<Page,number>();
    for(const page of [a,b])page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
      const frame=typeof payload==='string'?payload:payload.toString();if(!frame.startsWith('42'))return;
      try{const [event,snapshot]=JSON.parse(frame.slice(2));if(event==='remote:changed'&&snapshot?.state?.seats?.[0]?.twin?.some((card:any)=>card.cardId===45725480)&&!realtimeSeen.has(page)){realtimeSeen.add(page);realtimeAt.set(page,Date.now());}}catch{/* Other transports are not Socket.IO snapshots. */}
    }));
    for(const page of [a,b]){await appearingCamera(page);await page.addInitScript(()=>{
      (window as any).visionCalls=[];const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(...args:any[]){if(['recognize','detect'].includes(args[0]?.type))(window as any).visionCalls.push(args[0].type);return (post as any).apply(this,args);};
    });}
    await Promise.all([a.goto(`/duels/remote/${slug}`),b.goto(`/duels/remote/${slug}`)]);
    for(const page of [a,b]){await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field',{timeout:40_000});}
    await b.getByLabel('Auto-detect cards',{exact:true}).uncheck();
    await expect.poll(()=>b.locator('[data-testid="feed-0"] video').evaluate((v:HTMLVideoElement)=>v.videoWidth),{timeout:40_000}).toBeGreaterThan(0);
    const appearedAt=await a.evaluate(()=>{const at=Date.now();((window as any).fieldTest).appear();return at;});
    await expect.poll(async()=>{const r=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());return r.state.seats[0].twin.length;},{timeout:30_000}).toBe(1);
    // Require the real socket snapshot before testing the receiver's twin-state cache guard.
    for(const page of [a,b])await expect.poll(()=>realtimeSeen.has(page),{timeout:10_000}).toBe(true);
    for(const page of [a,b])await expect(page.getByTestId('field-0')).toContainText('Sacred Sword',{timeout:15_000});
    await b.waitForTimeout(1200);
    const counts=await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)));
    const eventCount=(await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length;
    for(let n=0;n<20;n++)for(const [view,page] of [['owner',a],['observer',b]] as const){
      records.push({view,ms:await cachedPopupClick(page)});await expect(page.getByTestId('recognition-tray')).toHaveCount(0);await page.getByRole('button',{name:'Close card',exact:true}).click();await expect(page.getByTestId('card-popover')).toHaveCount(0);
    }
    expect(await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)))).toEqual(counts);
    expect((await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length).toBe(eventCount);
    const summary=Object.fromEntries(['owner','observer'].map(view=>{const v=records.filter(r=>r.view===view).map(r=>r.ms).sort((a,b)=>a-b);return [view,{n:v.length,p50Ms:v[9],p95Ms:v[18],maxMs:v[19]}];}));
    console.log('cached popup latency',JSON.stringify(summary));console.log('Appearance to real socket snapshot',JSON.stringify({ownerMs:realtimeAt.get(a)!-appearedAt,observerMs:realtimeAt.get(b)!-appearedAt}));mkdirSync(new URL('../../../data/vision/benchmark/cache/',import.meta.url),{recursive:true});writeFileSync(new URL('../../../data/vision/benchmark/cache/clicks.json',import.meta.url),JSON.stringify({summary,records,recognitionCounts:counts,realtimeSnapshots:{owner:realtimeSeen.has(a),observer:realtimeSeen.has(b)},appearanceToSnapshotMs:{owner:realtimeAt.get(a)!-appearedAt,observer:realtimeAt.get(b)!-appearedAt}},null,2));
    for(const row of Object.values(summary))expect(row.p95Ms).toBeLessThan(50);
    await cachedPopupClick(a);await a.getByRole('button',{name:'Wrong card?',exact:true}).click();
    await expect.poll(()=>a.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)).toBeGreaterThan(counts[0]);
    await expect(a.getByTestId('card-popover')).toContainText('Sacred Sword of Seven Stars');
    const room=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());expect(room.state.seats[0].twin).toHaveLength(1);
  }finally{await Promise.allSettled([alice.close(),bob.close()]);}
});
async function measuredFieldChange(page:Page,kind:'move'|'remove') {
  return page.evaluate(kind=>new Promise<number>((resolve,reject)=>{
    const started=performance.now(),observer=new MutationObserver(()=>{
      const done=kind==='move'?document.querySelector('[data-testid="field-0"] [data-zone="emz2"]')?.textContent?.includes('Stardust'):document.querySelector('[data-testid="field-departure-toast"]')?.textContent?.includes('left the field');
      if(done){clearTimeout(timer);observer.disconnect();resolve(performance.now()-started);}
    }),timer=setTimeout(()=>{observer.disconnect();reject(Error('Camera field update timed out: '+kind));},15000);
    observer.observe(document.body,{childList:true,subtree:true});
    if(kind==='move')(window as any).fieldTest.place(714,8,false);else (window as any).fieldTest.clear();
  }),kind);
}
test('field watcher automatic: camera follows EMZ/DEF moves and clear departure with destinations and Undo',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2,true);await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await appearingCamera(page,EXTRA_CARD);await page.goto(`/duels/remote/${slug}`);await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).place(345,8,true));
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:30_000}).toMatchObject({cardId:44508094,zone:'extra-monster',slot:1,position:'defense'});
  const first=(await room()).state.seats[0].twin[0];await expect(page.getByTestId('field-0').locator('[data-zone="emz1"]')).toContainText('Stardust');
  await expect.poll(()=>page.getByTestId('field-0').locator('[data-zone="emz1"]').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild!).transform);return Math.round(Math.atan2(m.b,m.a)*180/Math.PI);})).toBe(-90);
  const moveMs=await measuredFieldChange(page,'move');
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:20_000}).toMatchObject({ref:first.ref,zone:'extra-monster',slot:2,position:'attack'});
  expect((await room()).state.seats[0].twin).toHaveLength(1);
  const removalMs=await measuredFieldChange(page,'remove');
  await expect.poll(async()=>(await room()).state.seats[0].twin[0]).toMatchObject({ref:first.ref,zone:'graveyard'});
  const toast=page.getByTestId('field-departure-toast');await expect(toast).toContainText('Stardust Dragon left the field');
  await expect(page.getByTestId('field-0').locator('[data-zone="emz2"]')).not.toContainText('Stardust');
  const departed=await room();expect(departed.events.at(-1).action).toMatchObject({type:'twin.move',source:'auto',cardRef:first.ref,zone:'graveyard',name:'Stardust Dragon'});
  await toast.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await room()).state.seats[0].twin[0]).toMatchObject({ref:first.ref,zone:'extra-monster',slot:2});
  await page.waitForTimeout(3200);expect((await room()).events.length).toBe(departed.events.length+1);
  await page.evaluate(()=>((window as any).fieldTest).place(345,8,true));
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:15000}).toMatchObject({ref:first.ref,zone:'extra-monster',slot:1});
  let rejectDeparture=true;await page.route('**/api/remote/*/actions',async route=>{
    const action=route.request().postDataJSON()?.action;
    if(rejectDeparture&&action?.type==='twin.move'&&action.source==='auto'){rejectDeparture=false;await route.fulfill({status:409,json:{error:'Stale sequence; fetch state and retry'}});}else await route.continue();
  });
  await page.evaluate(()=>((window as any).fieldTest).clear());
  await expect(toast).toContainText('update failed',{timeout:15000});await toast.getByRole('button',{name:'Retry removal',exact:true}).click();
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:15000}).toMatchObject({ref:first.ref,zone:'graveyard'});
  for(const [label,zone] of [['Banish','banished'],['Hand','hand'],['Extra Deck','extra'],['GY','graveyard']] as const){
    await toast.getByRole('button',{name:label,exact:true}).click();await expect.poll(async()=>(await room()).state.seats[0].twin[0].zone).toBe(zone);
  }
  await toast.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await room()).state.seats[0].twin[0].zone).toBe('extra');
  await page.getByTestId('log-button').click();await expect(page.getByTestId('log-drawer')).toContainText('Stardust Dragon left the field');
  console.log('Table camera follow',JSON.stringify({moveMs,removalMs}));mkdirSync(new URL('../../../data/vision/benchmark/field-watcher/',import.meta.url),{recursive:true});writeFileSync(new URL('../../../data/vision/benchmark/field-watcher/table-follow.json',import.meta.url),JSON.stringify({moveMs,removalMs,ref:first.ref},null,2));
});

test('field watcher automatic: Solemn Judgment uses the legal row and confirmed prompts stay quiet through jitter and moves',async({page,context})=>{
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const records:{registeredDeck:boolean;moveMs:number}[]=[];
  for(const registeredDeck of [true,false]){
    const slug=await soloTable(context.request,2,registeredDeck),room=()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
    await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
    await context.request.post('/api/cards/resolve',{data:{customCardIds:[41420027]}});
    await appearingCamera(page,TRAP_CARD);await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId('camera-on-feed').click();await page.getByLabel('Auto-detect cards',{exact:true}).check();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
    await page.evaluate(()=>((window as any).fieldTest).place(650,170,false));
    const prompt=page.getByTestId('field-watcher-prompt');
    if(!registeredDeck){
      await expect(prompt).toBeVisible({timeout:30_000});
      await prompt.getByRole('button',{name:/Solemn Judgment.*To Spell\/Trap Zone 4/}).click();
    }
    await expect.poll(async()=>(await room()).state.seats[0].twin,{timeout:30_000}).toMatchObject([{cardId:41420027,zone:'spell-trap',slot:4}]);
    await expect(prompt).toHaveCount(0);const first=(await room()).state.seats[0].twin[0];
    const moveMs=await page.evaluate(()=>new Promise<number>((resolve,reject)=>{
      const start=performance.now(),observer=new MutationObserver(()=>{
        if(document.querySelector('[data-testid="field-0"] [data-zone="s2"]')?.textContent?.includes('Solemn Judgment')){
          clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);
        }
      }),timer=setTimeout(()=>{observer.disconnect();reject(Error('Trap did not follow its legal column'));},10000);
      observer.observe(document.body,{subtree:true,childList:true});(window as any).fieldTest.place(360,170,false);
    }));
    await expect.poll(async()=>(await room()).state.seats[0].twin).toMatchObject([{ref:first.ref,cardId:41420027,zone:'spell-trap',slot:2}]);
    await expect(prompt).toHaveCount(0);const eventCount=(await room()).events.length;
    await page.evaluate(()=>((window as any).fieldTest).jitter(true));await page.waitForTimeout(12_000);
    await expect(prompt).toHaveCount(0);const stable=await room();expect(stable.events).toHaveLength(eventCount);
    expect(stable.state.seats[0].twin).toMatchObject([{ref:first.ref,cardId:41420027,zone:'spell-trap',slot:2}]);
    records.push({registeredDeck,moveMs});expect(moveMs).toBeLessThan(1000);
    await page.evaluate(()=>((window as any).fieldTest).jitter(false));await page.getByLabel('Auto-detect cards',{exact:true}).uncheck();
  }
  console.log('Solemn Judgment legal row and quiet prompts',JSON.stringify(records));
  writeFileSync(new URL('../../../data/vision/benchmark/field-watcher/solemn-follow.json',import.meta.url),JSON.stringify({records,jitterSecondsPerMode:12,repeatedPrompts:0,illegalPlacements:0},null,2));
});

test('field watcher automatic: a manual feed read before settling keeps exactly one physical twin',async({page,context})=>{
  test.setTimeout(120_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,2,true),room=()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);await page.evaluate(()=>((window as any).fieldTest).appear());
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await expect.poll(()=>page.locator('[data-testid="feed-0"] video').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBe(1280);
  await page.evaluate(()=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,rect=feed.getBoundingClientRect();
    const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+(rect.width-w)/2+550/1280*w,clientY:rect.top+(rect.height-h)/2+301/720*h}));
  });
  // A sure manual read confirms through the normal click flow before the watcher settles.
  await expect(page.getByTestId('card-popover')).toContainText('Sacred Sword of Seven Stars',{timeout:30_000});
  await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(1);
  const initial=(await room()).state.seats[0].twin[0];await page.getByRole('button',{name:'Close card',exact:true}).click();
  await page.waitForTimeout(4000);const settled=await room();expect(settled.state.seats[0].twin).toHaveLength(1);expect(settled.state.seats[0].twin[0].ref).toBe(initial.ref);
  expect(settled.events.filter((event:any)=>event.action.type==='twin.place')).toHaveLength(1);
  expect(initial.ref).toMatch(/^c0-/);
});

for(const seatCount of [2,4] as const)test(`field watcher automatic: responsive prompt and calibration screenshots for ${seatCount} seats`,async({page,context})=>{
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,seatCount),directory=process.env.E2E_FIELD_SHOTS??new URL('../../../data/vision/benchmark/field-watcher/r1-shots/',import.meta.url).pathname;
  mkdirSync(directory,{recursive:true});await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).many([{x:300,y:440},{x:800,y:440}]));
  const prompt=page.getByTestId('field-watcher-prompt');await expect(prompt).toBeVisible({timeout:40_000});await expect(prompt).toContainText('+1 more',{timeout:40_000});
  expect((await context.request.get(`/api/remote/${slug}`).then(r=>r.json())).state.seats[0].twin).toHaveLength(0);
  for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]] as const){
    await page.setViewportSize({width,height});await page.getByTestId('feed-box-0').focus();await page.waitForTimeout(250);
    await expect(prompt).toHaveCount(1);await expect(prompt).toHaveAccessibleDescription(/Detected in (Spell\/Trap|Main Monster) Zone/);
    expect(await prompt.evaluate(node=>node.parentElement===document.body)).toBe(true);
    const checkBounds=async(locator:ReturnType<Page['locator']>)=>{
      const rect=await locator.boundingBox();expect(rect).not.toBeNull();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x+rect!.width).toBeLessThanOrEqual(width+1);expect(rect!.y+rect!.height).toBeLessThanOrEqual(height+1);
    };
    await checkBounds(prompt);await checkBounds(prompt.getByRole('button',{name:'Dismiss',exact:true}));
    const overlap=await page.getByTestId('feed-box-0').evaluate(host=>{
      const toolbar=host.querySelector('[data-feed-toolbar]')!,chip=host.querySelector('[data-field-watcher-status-slot]')!,tag=chip.previousElementSibling!;
      const camera=Array.from(host.children).find(node=>node.className.includes('camsel'));
      const intersects=(a:Element,b:Element)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top);};
      return {chipTag:intersects(chip,tag),toolbarCamera:camera?intersects(toolbar,camera):false};
    });
    expect(overlap).toEqual({chipTag:false,toolbarCamera:false});
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-prompt.png`});
    const calibrate=page.getByRole('button',{name:'Calibrate zones',exact:true});await calibrate.focus();await page.keyboard.press('Enter');
    const modal=page.getByRole('dialog',{name:'Calibrate field zones',exact:true});await expect(modal).toHaveAttribute('aria-modal','true');await expect(modal).toBeFocused();
    expect(await modal.evaluate(node=>node.parentElement?.parentElement===document.body)).toBe(true);
    await checkBounds(modal);await modal.getByRole('button',{name:'Cancel calibration'}).scrollIntoViewIfNeeded();await checkBounds(modal.getByRole('button',{name:'Cancel calibration'}));
    await page.keyboard.press('Shift+Tab');await expect(modal.getByRole('button',{name:'Cancel calibration'})).toBeFocused();
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-calibration.png`});
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(calibrate).toBeFocused();
  }
});

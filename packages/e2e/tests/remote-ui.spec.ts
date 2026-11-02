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

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true } });
  expect(created.status()).toBe(201); const room = await created.json();
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
async function appearingCamera(page:Page) {
  const data=readFileSync(AUTO_CARD).toString('base64');
  await page.addInitScript(async data=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    let visible=false,x=460,y=170,defense=false;
    const paint=()=>{ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);if(visible){ctx.save();if(defense){ctx.translate(x+131,y+90);ctx.rotate(Math.PI/2);ctx.drawImage(image,-90,-131,180,262);}else ctx.drawImage(image,x,y,180,262);ctx.restore();}};
    (window as unknown as {fieldTest:{appear():void;place(left:number,top:number,defense?:boolean):void;move():void;clear():void}}).fieldTest={appear:()=>{visible=true;paint();},place:(left:number,top:number,def=false)=>{x=left;y=top;defense=def;visible=true;paint();},move:()=>{x=660;y=185;paint();},clear:()=>{visible=false;paint();}};
    paint();setInterval(paint,65);
    navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints?.video)throw new DOMException('Video only','NotFoundError');return canvas.captureStream(15);};
    navigator.mediaDevices.enumerateDevices=async()=>[];
  },data);
}
test('field watcher automatic: card appearance fills the lab twin without clicking the card',async({page})=>{
  test.setTimeout(120_000);await appearingCamera(page);await page.goto('/dev/vision-lab');
  await page.getByRole('tab',{name:'Auto-detect',exact:true}).click();
  await page.getByLabel('Auto-detect compute').selectOption('wasm');await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await expect(page.getByTestId('auto-detect-status')).toContainText('Watching field');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(1280);
  await page.waitForTimeout(2000);await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await page.evaluate(()=>((window as any).fieldTest).appear());
  await expect(page.getByTestId('auto-detect-twin')).toContainText('Sacred Sword of Seven Stars',{timeout:30_000});
  await expect(page.getByTestId('auto-detect-events')).toContainText('placed');
  await page.evaluate(()=>((window as any).fieldTest).move());
  await expect(page.getByTestId('auto-detect-events')).toContainText('moved',{timeout:15_000});
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo automatic placement'}).click();await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
});
test('field watcher automatic: owner table applies once, logs auto and Undo removes the placement',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2);
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
  expect(placed.events.some((e:any)=>e.action.type==='card.identified'&&e.action.source==='auto')).toBe(true);
  await page.getByTestId('undo').click();await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(0);
  await page.waitForTimeout(2500);expect((await room()).state.seats[0].twin).toHaveLength(0);
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
    const slug=await startTwoPlayerTable(alice.request,bob.request),a=await alice.newPage(),b=await bob.newPage();
    for(const page of [a,b]){await appearingCamera(page);await page.addInitScript(()=>{
      (window as any).visionCalls=[];const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(...args:any[]){if(['recognize','detect'].includes(args[0]?.type))(window as any).visionCalls.push(args[0].type);return (post as any).apply(this,args);};
    });}
    await Promise.all([a.goto(`/duels/remote/${slug}`),b.goto(`/duels/remote/${slug}`)]);
    for(const page of [a,b]){await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field',{timeout:40_000});}
    await b.getByLabel('Auto-detect cards',{exact:true}).uncheck();
    await expect.poll(()=>b.locator('[data-testid="feed-0"] video').evaluate((v:HTMLVideoElement)=>v.videoWidth),{timeout:40_000}).toBeGreaterThan(0);
    await a.evaluate(()=>((window as any).fieldTest).appear());
    await expect.poll(async()=>{const r=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());return r.state.seats[0].twin.length;},{timeout:30_000}).toBe(1);await b.waitForTimeout(800);
    const counts=await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)));
    const eventCount=(await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length;
    for(let n=0;n<20;n++)for(const [view,page] of [['owner',a],['observer',b]] as const){
      records.push({view,ms:await cachedPopupClick(page)});await expect(page.getByTestId('recognition-tray')).toHaveCount(0);await page.getByRole('button',{name:'Close card',exact:true}).click();await expect(page.getByTestId('card-popover')).toHaveCount(0);
    }
    expect(await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)))).toEqual(counts);
    expect((await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length).toBe(eventCount);
    const summary=Object.fromEntries(['owner','observer'].map(view=>{const v=records.filter(r=>r.view===view).map(r=>r.ms).sort((a,b)=>a-b);return [view,{n:v.length,p50Ms:v[9],p95Ms:v[18],maxMs:v[19]}];}));
    console.log('cached popup latency',JSON.stringify(summary));mkdirSync(new URL('../../../data/vision/benchmark/cache/',import.meta.url),{recursive:true});writeFileSync(new URL('../../../data/vision/benchmark/cache/clicks.json',import.meta.url),JSON.stringify({summary,records,recognitionCounts:counts},null,2));
    for(const row of Object.values(summary))expect(row.p95Ms).toBeLessThan(50);
    await cachedPopupClick(a);await a.getByRole('button',{name:'Wrong card?',exact:true}).click();
    await expect.poll(()=>a.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)).toBeGreaterThan(counts[0]);
    await expect(a.getByTestId('card-popover')).toContainText('Sacred Sword of Seven Stars');
    const room=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());expect(room.state.seats[0].twin).toHaveLength(1);
  }finally{await Promise.allSettled([alice.close(),bob.close()]);}
});
test('field watcher automatic: physical EMZ and DEF orientation reach the correct virtual slot',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2);await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).place(345,8,true));
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:30_000}).toMatchObject({cardId:45725480,zone:'extra-monster',slot:1,position:'defense'});
  const first=(await room()).state.seats[0].twin[0];await expect(page.getByTestId('field-0').locator('[data-zone="emz1"]')).toContainText('Sacred Sword');
  await expect.poll(()=>page.getByTestId('field-0').locator('[data-zone="emz1"]').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild!).transform);return Math.round(Math.atan2(m.b,m.a)*180/Math.PI);})).toBe(-90);
  await page.evaluate(()=>((window as any).fieldTest).place(714,8,false));
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:20_000}).toMatchObject({ref:first.ref,zone:'extra-monster',slot:2,position:'attack'});
  expect((await room()).state.seats[0].twin).toHaveLength(1);
});

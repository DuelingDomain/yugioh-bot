import { expect, test } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";

const base = "http://localhost:3436";
// Next dev recompiles shared server modules as API routes are first requested.
// Its document reloads tear down media mid-proof; these tests exercise one fixed client build.
const noHmr = (context:import("@playwright/test").BrowserContext) => context.routeWebSocket(/\/_next\/hmr/,socket=>{
  const server=socket.connectToServer();let synced=false;
  server.onMessage(message=>{
    try{
      const value=JSON.parse(String(message));
      if(value.type==="sync"){if(synced)return;synced=true;}
      else if(!["devtoolsConfig","isrManifest","cacheIndicator","runtimeErrors","serverError"].includes(value.type))return;
    }catch{/* Forward binary development error messages. */}
    socket.send(message);
  });
});
test.beforeEach(async({context})=>{await noHmr(context);});
async function installPhoneFrame(mobile:import("@playwright/test").Page,bytes:string){
  await noHmr(mobile.context());
  await mobile.addInitScript(data=>{
      const captures:unknown[]=[];Object.assign(window,{phoneCaptureMeasurements:captures});window.addEventListener("remote-phone-capture",e=>captures.push((e as CustomEvent).detail));
      const canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext("2d")!;let image:ImageBitmap|null=null;
      const raw=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const ready=createImageBitmap(new Blob([raw],{type:"image/jpeg"})).then(v=>{image=v;});
      let tick=0;const paint=()=>{ctx.filter="none";ctx.fillStyle="#344236";ctx.fillRect(0,0,1920,1080);if(image){const scale=Math.min(1920/image.width,1080/image.height);const w=image.width*scale,h=image.height*scale;ctx.filter=(++tick%8<4)?"blur(5px)":"none";ctx.drawImage(image,(1920-w)/2,(1080-h)/2,w,h);ctx.filter="none";}};
      setInterval(paint,50);
      navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints?.video)throw new DOMException("Video only","NotAllowedError");await ready;paint();return canvas.captureStream(15);};
      navigator.mediaDevices.enumerateDevices=async()=>[];
    },bytes);
 }

test("phone invitations are one use, scoped, revocable and camera-only", async ({ context, browser }) => {
  await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, base);
  const created = await context.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2, solo: true } });
  expect(created.status()).toBe(201); const { slug } = await created.json();
  const issue = await context.request.post(`/api/remote/${slug}/phone`, { data: {} });
  expect(issue.status(), await issue.text()).toBe(201);
  const pair = await issue.json(); expect(pair.code).toMatch(/^[A-Z2-9]{8}$/);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: ["camera"] });
  try {
    const redeem = await phone.request.post(`/api/remote/${slug}/phone/connect`, { data: { pair: pair.token } });
    expect(redeem.status(), await redeem.text()).toBe(200); const device = await redeem.json();
    const jwt = JSON.parse(Buffer.from(device.token.split(".")[1], "base64url").toString());
    expect(jwt.video).toMatchObject({ room: `remote-${slug}`, roomJoin: true, canSubscribe: false, canPublish: true, canPublishData: true, canPublishSources: ["camera"], canUpdateOwnMetadata: false });
    expect(jwt.video.roomAdmin).toBeFalsy();
    expect((await phone.request.post(`/api/remote/${slug}/phone/connect`, { data: { pair: pair.token } })).status()).toBe(401);
    expect((await phone.request.post(`/api/remote/wrong-table/phone/connect`, { data: { device: device.device } })).status()).toBe(401);
    expect((await phone.request.post(`/api/remote/${slug}/actions`, { data: { device: device.device } })).status()).toBe(401);
    expect((await phone.request.post(`/api/remote/${slug}/phone`, { data: {} })).status()).toBe(401);
    expect((await context.request.delete(`/api/remote/${slug}/phone`)).status()).toBe(200);
    expect((await phone.request.post(`/api/remote/${slug}/phone/connect`, { data: { device: device.device } })).status()).toBe(401);
  } finally { await phone.close(); }
});

test("expired invitations and short codes cannot be redeemed; concurrent redemption has one winner", async ({context,browser})=>{
  const {default:Database}=await import("better-sqlite3");
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,base);
  const {slug}=await (await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2,solo:true}})).json();
  const expired=await (await context.request.post(`/api/remote/${slug}/phone`,{data:{}})).json();
  expect(expired.expiresAt-Date.now()).toBeGreaterThan(290_000);expect(expired.expiresAt-Date.now()).toBeLessThanOrEqual(300_000);
  const db=new Database(new URL("../.stack-remote-phone/phone.sqlite",import.meta.url).pathname);
  try{db.prepare("UPDATE remote_phone_pairs SET expires_at=? WHERE slug=?").run(Date.now()-1,slug);}finally{db.close();}
  const phone=await browser.newContext();
  try{
    for(const data of [{pair:expired.token},{code:expired.code}])expect((await phone.request.post(`/api/remote/${slug}/phone/connect`,{data})).status()).toBe(401);
    expect((await phone.request.post(`/api/remote/${slug}/phone/connect`,{data:{device:"x",code:expired.code}})).status()).toBe(400);
    const fresh=await (await context.request.post(`/api/remote/${slug}/phone`,{data:{}})).json();
    const replies=await Promise.all([{pair:fresh.token},{code:fresh.code}].map(data=>phone.request.post(`/api/remote/${slug}/phone/connect`,{data})));
    expect(replies.map(r=>r.status()).sort()).toEqual([200,401]);
  }finally{await phone.close();}
});

test("no-camera desktop pairs an unsigned-in mobile, scans a real still and confirms exactly one twin",async({context,page,browser},testInfo)=>{
  const {readFileSync,mkdirSync,writeFileSync}=await import("node:fs");
  const shots=process.env.E2E_PHONE_SHOTS??"/home/sulman633/repos/yugioh-bot/data/briefs/remote-duels/phone-shots";mkdirSync(shots,{recursive:true});
  const frame=process.env.E2E_PHONE_FRAME??"/home/sulman633/repos/yugioh-bot/.worktrees/remote-vision/data/vision/benchmark/photo-00.jpg";
  const bytes=readFileSync(frame).toString("base64");
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,base);
  // Deny camera on desktop: receiving phone video and running recognition must not call getUserMedia.
  await page.addInitScript(()=>{Object.assign(window,{desktopCameraCalls:0});navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints?.video)(window as unknown as {desktopCameraCalls:number}).desktopCameraCalls++;throw new DOMException("No desktop camera","NotFoundError");};});
  const {slug}=await(await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2,solo:true}})).json();
  await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId("pair-phone").click();await expect(page.getByTestId("phone-qr")).toBeVisible();
  const url=await page.getByTestId("phone-pair-url").getAttribute("href");expect(url).toContain("/cam?pair=");
  await page.screenshot({path:`${shots}/desktop-pairing.png`});
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:["camera"]});
  try{
    const mobile=await phone.newPage();const errors:string[]=[];
    let phoneIdentity="";mobile.on("response",async response=>{if(response.url().endsWith("/phone/connect")&&response.status()===200){const c=await response.json().catch(()=>null);if(c)phoneIdentity=`remote-phone-${c.id}`;}});mobile.on("pageerror",e=>errors.push(e.message));
    const desktopErrors:string[]=[];page.on("pageerror",e=>desktopErrors.push(e.message));
    await installPhoneFrame(mobile,bytes);
    const cdp=await phone.newCDPSession(mobile);await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
    await mobile.goto(url!);await expect(mobile.getByTestId("phone-camera-page")).toBeVisible();expect(mobile.url()).not.toContain("sign-in");
    await mobile.getByTestId("phone-connect").click();
    await expect(mobile.getByTestId("phone-connection")).toContainText(/^connected\b/,{timeout:60_000});
    await expect(page.getByTestId("phone-pair-dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({hasText:"Phone camera · connected"})).toBeVisible();
    expect((await phone.cookies()).some(c=>c.name.includes("session"))).toBe(false);
    await mobile.screenshot({path:`${shots}/phone-field-portrait.png`,fullPage:true});
    const {RoomServiceClient}=await import("livekit-server-sdk");const sdk=new RoomServiceClient("http://127.0.0.1:7880","devkey","secret");
    const participants=await sdk.listParticipants(`remote-${slug}`);const participant=participants.find(p=>p.identity===phoneIdentity)!;
    expect(participant.permission).toMatchObject({canPublish:true,canSubscribe:false,canPublishData:true});
    expect(participant.tracks).toHaveLength(1);expect(participant.tracks[0].source).toBe(1); // CAMERA
    // Force a terminal transport loss in this test's own room. The phone must renew and rejoin by itself.
    await sdk.removeParticipant(`remote-${slug}`,phoneIdentity);
    await expect.poll(async()=> (await sdk.listParticipants(`remote-${slug}`)).some(p=>p.identity===phoneIdentity),{timeout:30_000}).toBe(true);
    await expect(mobile.getByTestId("phone-connection")).toContainText(/^connected\b/);
    await context.request.post(`/api/remote/${slug}/ready`,{data:{ready:true}});await context.request.post(`/api/remote/${slug}/start`,{data:{}});
    await expect(page.getByTestId("remote-table")).toBeVisible();
    await expect.poll(()=>page.locator('[data-testid="feed-0"] video').evaluate((v:HTMLVideoElement)=>v.videoWidth),{timeout:30_000}).toBeGreaterThan(0);

    await mobile.getByTestId("phone-scan-mode").click();await expect(page.getByRole("button",{name:/feed: Scan mode/})).toBeVisible();
    await expect(mobile.locator("video")).toHaveJSProperty("srcObject",null);
    await mobile.reload();await expect(mobile.getByTestId("phone-scan")).toBeEnabled({timeout:30_000});
    await expect(mobile.locator("video")).toHaveJSProperty("srcObject",null);
    await mobile.getByLabel("Scan zone").selectOption("M3");
    const timings:number[]=[];
    for(let i=0;i<3;i++){
      const started=Date.now();await mobile.getByTestId("phone-scan").click();
      await expect(page.getByTestId("phone-scan-review")).toBeVisible({timeout:90_000});
      await expect(page.getByTestId("phone-confirm-45725480")).toBeVisible();timings.push(Date.now()-started);
      const before=await(await context.request.get(`/api/remote/${slug}`)).json();expect(before.state.seats[0].twin).toHaveLength(0);
      if(i<2){await page.getByRole("button",{name:"Cancel scan",exact:true}).click();await expect(mobile.getByTestId("phone-scan")).toBeEnabled();}
    }
    await page.screenshot({path:`${shots}/desktop-scan-review.png`});
    await page.getByTestId("phone-confirm-45725480").click();await expect(page.getByTestId("phone-scan-review")).toHaveCount(0);
    const after=await(await context.request.get(`/api/remote/${slug}`)).json();
    expect(after.state.seats[0].twin).toHaveLength(1);expect(after.state.seats[0].twin[0]).toMatchObject({cardId:45725480,zone:"monster",slot:3});
    expect(after.events.filter((e:{action:{type:string}})=>e.action?.type==="card.identified")).toHaveLength(1);
    await expect(mobile.getByTestId("phone-note")).toContainText("announced and placed");
    await page.screenshot({path:`${shots}/desktop-scan-twin.png`});await mobile.screenshot({path:`${shots}/phone-scan-portrait.png`,fullPage:true});
    await mobile.setViewportSize({width:844,height:390});await mobile.screenshot({path:`${shots}/phone-scan-landscape.png`,fullPage:true});
    const measurements=await mobile.evaluate(()=>((window as unknown as {phoneCaptureMeasurements:unknown[]}).phoneCaptureMeasurements));
    expect((measurements as {scores:number[]}[]).some(m=>new Set(m.scores).size>1)).toBe(true);
    for(const m of measurements as {scores:number[];selected:number}[])expect(m.scores[m.selected]).toBe(Math.max(...m.scores));
    writeFileSync(`${shots}/timings.json`,JSON.stringify({environment:"Chromium mobile viewport, 4x phone CPU throttle, vision inference on desktop",timingsMs:timings,captures:measurements,errors,desktopErrors},null,2));
    await testInfo.attach("timings",{body:JSON.stringify({timings,measurements}),contentType:"application/json"});
    expect(errors).toEqual([]);expect(desktopErrors).toEqual([]);
    expect(await page.evaluate(()=>(window as unknown as {desktopCameraCalls:number}).desktopCameraCalls)).toBe(0);
    await page.getByTestId("revoke-phone").click();
    await expect(mobile.getByTestId("phone-connection")).toContainText(/^Disconnected\b/,{timeout:30_000});
    await page.getByTestId("manual-camera").click();await expect(page.getByTestId("seat-0")).toContainText("No camera (manual)");
    await page.getByTestId("phase-main1").click();await expect(page.getByTestId("phase-main1")).toHaveAttribute("aria-current","step");
    await page.getByRole("button",{name:"E2E Alice minus 500"}).click();await expect(page.getByTestId("lp-value-0")).toHaveText("7500");
    await page.screenshot({path:`${shots}/desktop-manual.png`});
  }finally{await phone.close();}
});


test("re-pair, departure and table end permanently revoke device capabilities",async({context,browser})=>{
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,base);
  const bob=await browser.newContext();const phone=await browser.newContext();
  try {
    await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,base);
    const {slug}=await(await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2}})).json();
    expect((await bob.request.post(`/api/remote/${slug}/seat`,{data:{seat:1}})).ok()).toBe(true);
    const issue=async()=>await(await bob.request.post(`/api/remote/${slug}/phone`,{data:{}})).json();
    const redeem=async(token:string)=>await(await phone.request.post(`/api/remote/${slug}/phone/connect`,{data:{pair:token}})).json();
    const renew=(device:string)=>phone.request.post(`/api/remote/${slug}/phone/connect`,{data:{device}});
    const first=await issue();const firstDevice=await redeem(first.token);
    const second=await issue();expect((await renew(firstDevice.device)).status()).toBe(401);const secondDevice=await redeem(second.token);
    await bob.request.post(`/api/remote/${slug}/leave`,{data:{}});await bob.request.post(`/api/remote/${slug}/seat`,{data:{seat:1}});
    expect((await renew(secondDevice.device)).status()).toBe(401);
    // Concurrent desktop requests still produce exactly one active invitation.
    const pairs=await Promise.all([issue(),issue()]);
    const outcomes=await Promise.all(pairs.map(p=>phone.request.post(`/api/remote/${slug}/phone/connect`,{data:{pair:p.token}})));
    expect(outcomes.map(r=>r.status()).sort()).toEqual([200,401]);
    const active=await outcomes.find(r=>r.ok())!.json();
    await context.request.post(`/api/remote/${slug}/leave`,{data:{}});
    expect((await renew(active.device)).status()).toBe(401);
  }finally{await bob.close();await phone.close();}
});


test("invalid code is explained on the public phone page",async({browser})=>{
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  try{
    const page=await phone.newPage();await page.goto(`${base}/duels/remote/invalid-table/cam`);
    await page.getByLabel("Pairing code",{exact:true}).fill("ABCDEFGH");await page.getByTestId("phone-connect").click();
    await expect(page.getByTestId("phone-camera-page").getByRole("alert")).toContainText("Pairing expired or revoked");
  }finally{await phone.close();}
});


test("another player clicks the phone feed and receives recognition from its owner's desktop",async({context,page,browser})=>{
  const {readFileSync}=await import("node:fs");
  const bytes=readFileSync(process.env.E2E_PHONE_FRAME??"/home/sulman633/repos/yugioh-bot/.worktrees/remote-vision/data/vision/benchmark/photo-00.jpg").toString("base64");
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,base);
  const {slug}=await(await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2}})).json();
  const peer=await browser.newContext();const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,permissions:["camera"]});
  try {
    await noHmr(peer);
    await authenticatePlayer(peer.request,{userId:102},process.env.E2E_AUTH_SECRET!,base);
    await peer.request.post(`/api/remote/${slug}/seat`,{data:{seat:1}});
    await page.goto(`/duels/remote/${slug}`);await page.getByTestId("pair-phone").click();
    const url=await page.getByTestId("phone-pair-url").getAttribute("href");
    const mobile=await phone.newPage();await installPhoneFrame(mobile,bytes);await mobile.goto(url!);await mobile.getByTestId("phone-connect").click();
    await expect(page.getByTestId("lobby-phone-feed-0")).toBeVisible();
    // The first reader is an opponent: include model/index cold start in the phone budget.
    const opponent=await peer.newPage();await opponent.goto(`/duels/remote/${slug}`);
    await expect(opponent.getByTestId("lobby-phone-feed-0")).toBeVisible();
    await expect.poll(()=>opponent.getByTestId("lobby-phone-feed-0").locator("video").evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBeGreaterThan(0);
    await opponent.getByTestId("lobby-phone-feed-0").click();
    await expect(opponent.getByTestId("lobby-phone-read-0")).toContainText("Sacred Sword of Seven Stars",{timeout:60_000});
    const room=await(await context.request.get(`/api/remote/${slug}`)).json();expect(room.state.seats[0].twin).toHaveLength(0);
    // Then prove replacement clears a scan awaiting confirmation.
    await mobile.getByTestId("phone-scan").click();
    await expect(page.getByTestId("phone-scan-review")).toContainText("Sacred Sword of Seven Stars",{timeout:60_000});
    // Replace the phone while its first scan awaits confirmation; the new device must not inherit that lock.
    await page.getByTestId("pair-phone").click();
    const replacement=await page.getByTestId("phone-pair-url").getAttribute("href");
    await mobile.goto(replacement!);await mobile.getByTestId("phone-connect").click();
    await expect(page.getByTestId("phone-scan-review")).toHaveCount(0);
    await mobile.getByTestId("phone-scan").click();
    await expect(page.getByTestId("phone-scan-review")).toContainText("Sacred Sword of Seven Stars",{timeout:60_000});
    await page.getByRole("button",{name:"Cancel scan",exact:true}).click();
    await page.getByTestId("lobby-phone-feed-0").click();await expect(page.getByTestId("lobby-phone-read-0")).toContainText("Sacred Sword of Seven Stars",{timeout:60_000});
    await context.request.delete(`/api/remote/${slug}/phone`);
  }finally{await peer.close();await phone.close();}
});

/** Real owner default/capture/live-read/moderation smoke; isolated seeded E2E accounts only. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3438';
if(['3000','3417'].includes(new URL(origin).port))throw new Error('Use an isolated server; ports 3000 and 3417 are protected.');
const secret=process.env.E2E_AUTH_SECRET;
const userId=Number(process.env.VISION_FEEDBACK_TEST_USER);
const photo=process.env.VISION_FEEDBACK_TEST_PHOTO;
if(!secret||!userId||!photo)throw new Error('Set E2E_AUTH_SECRET, VISION_FEEDBACK_TEST_USER (fresh owner account), and VISION_FEEDBACK_TEST_PHOTO; use an isolated DB only.');
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu']});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  if(process.env.VISION_FEEDBACK_TEST_LIVE==='1') {
    const photoData=`data:image/jpeg;base64,${(await readFile(resolve(photo))).toString('base64')}`;
    await context.addInitScript(`navigator.mediaDevices.getUserMedia=async()=>{
      const image=new Image();image.src=${JSON.stringify(photoData)};await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const stream=canvas.captureStream(10),timer=setInterval(()=>ctx.drawImage(image,0,0),100);
      const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
      track.stop=()=>{clearInterval(timer);stop();};return stream;
    };`);
  }
  const errors:string[]=[],payloads:Record<string,unknown>[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/remote-vision/feedback'))payloads.push(r.postDataJSON());});
  const login=await context.request.post(`${origin}/api/test-auth/session`,{data:{secret,userId}});expect(login.status()).toBe(200);
  await page.goto(`${origin}/dev/vision-lab`);
  const toggle=page.getByRole('checkbox',{name:'Save to training set'});await expect(toggle).toBeChecked();
  await expect(page.getByText('Saving to training set')).toBeVisible();await expect(page.getByRole('button',{name:'No thanks'})).toHaveCount(0);
  expect(await (await context.request.get(`${origin}/api/remote-vision/feedback`)).json()).toMatchObject({enabled:true,isAdmin:true});
  expect(payloads).toHaveLength(0);
  await page.locator('input[type=file]').setInputFiles(resolve(photo));
  await page.getByRole('combobox',{name:'Compute'}).selectOption('wasm');
  await page.getByRole('button',{name:'Recognize center card'}).click();
  const dialog=page.getByRole('dialog',{name:'Card matches'});
  await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-busy','false',{timeout:60_000});
  await expect(dialog.getByRole('img')).toHaveAttribute('width','360');
  await expect(dialog.getByRole('img')).toHaveAttribute('src',/\/api\/cards\/\d+\/image$/);
  await expect.poll(()=>dialog.getByRole('img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
  await expect(dialog.getByText('Loading full card text…')).toHaveCount(0);
  const out=resolve(process.env.VISION_FEEDBACK_TEST_OUTPUT??'data/vision-feedback-smoke');await mkdir(out,{recursive:true});
  await page.screenshot({path:resolve(out,'popup-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:resolve(out,'popup-mobile.png')});await page.setViewportSize({width:1280,height:900});
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(page.getByText('Recognition sample saved.')).toBeVisible();expect(payloads).toHaveLength(1);
  const sent=payloads[0];expect(sent.source).toBe('pick');expect((sent.embedding as number[]).length).toBe(384);expect((sent.top5 as unknown[]).length).toBe(5);expect(sent).not.toHaveProperty('warpedCard');expect(sent).not.toHaveProperty('frame');
  const review=await (await context.request.get(`${origin}/api/admin/console/vision`)).json();
  const sample=review.data.samples.find((s:{userId:number})=>s.userId===userId);expect(sample).toBeTruthy();
  expect(sample.review).toBe('approved');
  const autoLearned=await (await context.request.get(`${origin}/api/remote-vision/learning`)).json();expect(autoLearned.references.some((r:{id:string})=>r.id===sample.id)).toBe(true);
  await toggle.uncheck();await expect(page.getByText('Training capture paused')).toBeVisible();
  expect((await (await context.request.get(`${origin}/api/remote-vision/feedback`)).json()).enabled).toBe(false);
  let liveRead=false;
  if(process.env.VISION_FEEDBACK_TEST_LIVE==='1') {
    await page.getByRole('button',{name:'Start camera'}).click();
    const preview=page.getByRole('button',{name:/Recognize a card:/});await expect(preview).toHaveAttribute('aria-disabled','false');
    const time=await page.locator('video').evaluate(video=>(video as HTMLVideoElement).currentTime);
    await preview.click();await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-busy','true');
    await expect(dialog).toHaveAttribute('aria-busy','false',{timeout:60_000});
    await expect(page.getByLabel('Selected card outline')).toBeVisible();
    expect(await page.locator('video').evaluate(video=>!(video as HTMLVideoElement).paused&&(video as HTMLVideoElement).currentTime>0)).toBe(true);
    await expect.poll(()=>page.locator('video').evaluate(video=>(video as HTMLVideoElement).currentTime)).toBeGreaterThan(time);
    await expect(page.getByRole('button',{name:'Freeze & outline cards'})).toBeVisible();
    await dialog.getByRole('button',{name:'Confirm',exact:true}).click();expect(payloads).toHaveLength(1);
    await page.getByRole('button',{name:'Stop',exact:true}).click();liveRead=true;
  }
  await page.goto(`${origin}/admin#vision`);await expect(page.getByText('Recent confirmations and corrections')).toBeVisible();
  const row=page.locator('li').filter({has:page.locator(`img[src="/api/admin/console/vision/${sample.id}/crop"]`)});
  await expect(row.getByRole('button',{name:'Approve reference'})).toBeDisabled();
  const learned=await (await context.request.get(`${origin}/api/remote-vision/learning`)).json();expect(learned.references.some((r:{id:string})=>r.id===sample.id)).toBe(true);
  const rejection=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(`/api/admin/console/vision/${sample.id}`));
  await row.getByRole('button',{name:'Reject reference'}).click();expect((await rejection).status()).toBe(200);
  await expect.poll(async()=>(await (await context.request.get(`${origin}/api/remote-vision/learning`)).json()).references.some((r:{id:string})=>r.id===sample.id)).toBe(false);
  await page.goto(`${origin}/settings/account`);await page.getByRole('button',{name:'Delete my recognition samples'}).click();await expect(page.getByText('Deleted 1 recognition samples.')).toBeVisible();
  await page.screenshot({path:resolve(out,'account.png'),fullPage:true});
  const report={browser:browser.version(),feedbackUploads:payloads.length,cropBytes:sample.cropBytes,embeddingDim:384,top5:5,ownerDefaultOn:true,noOwnerPrompt:true,immediateApproval:true,pauseToggle:true,fullSizePopup:true,mobileOverflow:false,liveRead,approveReject:true,deleteOwn:true,pageErrors:errors};
  await writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));expect(errors).toHaveLength(0);
}finally{await browser.close();}

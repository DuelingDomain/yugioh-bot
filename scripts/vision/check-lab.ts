/** Browser smoke against an already-running isolated worktree lab; AI is mocked. */
import {chromium,expect} from '@playwright/test';
import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3417';
if(new URL(origin).port==='3000') throw new Error('Do not use port 3000');
const data=resolve(process.env.VISION_DATA_DIR??'data/vision'),directory=join(data,'benchmark');
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu','--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  let requests=0,cropBytes=0;
  await page.route('**/api/remote-vision/ai',async route=>{
    requests++;const body=route.request().postDataJSON();
    if(body.explicitRequest!==true || typeof body.jpegBase64!=='string') throw new Error('Invalid AI client contract');
    cropBytes=Buffer.from(body.jpegBase64,'base64').length;
    if(cropBytes>256*1024) throw new Error('Oversized crop');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'Blue-Eyes White Dragon',passcode:89631139,match:{name:'Blue-Eyes White Dragon',passcode:89631139}})});
  });
  await page.goto(origin+'/dev/vision-lab');
  await page.waitForFunction(()=>Object.keys(document.querySelector('input[type=file]')??{}).some(k=>k.startsWith('__reactProps')),{},{timeout:30000});
  await page.getByLabel('Compute').selectOption('wasm');
  await page.getByLabel('Upload a card photo').setInputFiles(join(data,'benchmark/photo-00.jpg'));
  await expect(page.getByRole('button',{name:'Freeze & outline cards'})).toBeEnabled();
  await page.getByRole('button',{name:'Freeze & outline cards'}).click();
  await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeEnabled({timeout:30000});
  const outlines=page.locator('polygon[role=button]');
  const count=await outlines.count();if(!count) throw new Error('No outlines');
  await outlines.first().focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Card matches'});
  await expect(dialog).toBeVisible({timeout:30000});
  await expect(dialog).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{name:/Recognize a card:/})).toBeFocused();
  if(requests) throw new Error('Unexpected automatic AI request');
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm AI match'})).toBeVisible();
  await page.getByRole('button',{name:'Confirm AI match'}).click();
  await expect(page.getByRole('status').filter({hasText:'Confirmed:'})).toContainText('Blue-Eyes White Dragon');
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await expect(outlines).toHaveCount(0);
  if(errors.length) throw new Error(errors.join('\n'));
  await mkdir(directory,{recursive:true});
  const report={outlines:count,keyboardPopover:true,focusRestored:true,aiRequests:requests,aiMocked:true,cropJpegBytes:cropBytes,resumeClearsOutlines:true,browserErrors:errors};
  await writeFile(join(directory,'lab-round2.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}

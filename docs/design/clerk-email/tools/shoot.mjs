// node shoot.mjs <out_dir>
// Screenshots review.html (desktop 1760 wide, phone 390 wide) and per-template crops at work/<slug>-<w>.png.
// Playwright path comes from $PW (default: the alpha-access-pr2 checkout's node_modules).
const PW = process.env.PW || "/home/imran/orca/workspaces/yugioh-discord-bot/alpha-access-pr2/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);
const OUT = process.argv[2];
const b = await chromium.launch();
for (const [name, w] of [["desktop", 1760], ["phone", 390]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto("file://" + OUT + "/review.html");
  await p.waitForTimeout(1200);
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  console.log(name, "scrollWidth/innerWidth", sw);
  await p.screenshot({ path: `${OUT}/review-${name}.png`, fullPage: true });
  await p.close();
}
await b.close();

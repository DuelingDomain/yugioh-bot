const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.BASE || 'http://localhost:4199';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const screens = ['signin','password','code','newpw','invite','err-username','err-invite','err-signup','err-password','err-banned','err-service','signing'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
  const log = [];
  for (const c of ['a','b','c']) {
    if (only.length && !only.includes(c)) continue;
    const list = c === 'a' ? screens.concat(['success']) : screens;
    for (const w of [1440, 390]) {
      const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
      const p = await ctx.newPage();
      p.on('pageerror', e => log.push(`${c} pageerror ${e.message}`));
      for (const s of list) {
        await p.goto(`${base}/${c}/index.html?s=${s}&shot=1`, { waitUntil: 'networkidle' });
        await p.waitForTimeout(s === 'success' ? 2600 : 1300);
        const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight, f: document.fonts.check('16px "Russo One"') && document.fonts.check('16px "Chakra Petch"') }));
        log.push(`${c} ${s} ${w} ${m.sw>m.iw?'HSCROLL ':''}h=${m.sh}/${m.ih}${m.f?'':' FONT-MISSING'}`);
        const tall = m.sh > m.ih;
        await p.screenshot({ path: `${process.env.OUT || 'shots'}/${c}-${s}-${w}.png`, fullPage: tall });
      }
      await ctx.close();
    }
  }
  console.log(log.join('\n'));
  await b.close();
})();

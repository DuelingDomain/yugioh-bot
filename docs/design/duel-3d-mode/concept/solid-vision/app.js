/* Solid Vision — prototype app.
   The DOM board is rendered from a board model per storyboard state; moments (projection.js,
   or the CSS fallback) play on top and then get out of the way. */
(function () {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const Q = new URLSearchParams(location.search);
  const STILL = Q.has('still');
  const root = document.documentElement;
  const ART = (id) => `../assets/cards/${id}.jpg`;
  const BACK = '../assets/card-back-main-hd.webp';
  const BACK_X = '../assets/card-back-extra-hd.webp';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const isMobile = () => innerWidth <= 760;

  /* ------------------------------------------------------------ icons (authored, 1.6 stroke) */
  const I = {
    chevUp: '<path d="M6 15l6-6 6 6"/>',
    chevR: '<path d="M9 6l6 6-6 6"/>',
    summon: '<path d="M12 17V5"/><path d="M7 10l5-5 5 5"/><path d="M5 20h14"/>',
    set: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M12 8v6"/><path d="M9.5 11.5L12 14l2.5-2.5"/>',
    sword: '<path d="M19 5l-9.5 9.5"/><path d="M14 5h5v5"/><path d="M7 13l4 4"/><path d="M8.5 15.5L5 19"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"/>',
    tilt: '<path d="M7 7h10l4 11H3z"/>',
    flat: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4.5V8"/><path d="M9.5 13h.01M14.5 13h.01"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/>',
    burst: '<path d="M12 3l1.6 5 5-2.2-2.3 4.9 5 1.7-5 1.6 2.3 5-5-2.3L12 21l-1.6-5.3-5 2.3 2.3-5-5-1.6 5-1.7L5.4 5.8l5 2.2z"/>',
    negate: '<circle cx="12" cy="12" r="8"/><path d="M6.4 6.4l11.2 11.2"/>',
    arrowR: '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    card: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/>',
    log: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  };
  const svg = (n, c = '') => `<svg class="icon ${c}" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

  /* ------------------------------------------------------------ cards (brief facts only) */
  const C = { DM: 46986414, BEWD: 89631139, CG: 91152256, BW: 32452818, SF: 90357090, OX: 5053103, FIS: 66788016, TH: 4206964, BOM: 14087893, SJ: 41420027 };
  const mon = (name, attr, race, level, atk, def) => ({ name, kind: 'monster', attr, race, level, atk, def });
  const CARD = {
    [C.DM]: mon('Dark Magician', 'DARK', 'Spellcaster', 7, 2500, 2100),
    [C.BEWD]: mon('Blue-Eyes White Dragon', 'LIGHT', 'Dragon', 8, 3000, 2500),
    [C.CG]: mon('Celtic Guardian', 'EARTH', 'Warrior', 4, 1400, 1200),
    [C.BW]: mon('Beaver Warrior', 'EARTH', 'Beast-Warrior', 4, 1200, 1500),
    [C.SF]: mon('Silver Fang', 'EARTH', 'Beast', 3, 1200, 800),
    [C.OX]: mon('Battle Ox', 'EARTH', 'Beast-Warrior', 4, 1700, 1000),
    [C.FIS]: { name: 'Fissure', kind: 'spell', sub: 'Normal Spell', text: 'Destroy the 1 face-up monster your opponent controls that has the lowest ATK.' },
    [C.TH]: { name: 'Trap Hole', kind: 'trap', sub: 'Normal Trap', text: 'When your opponent Normal or Flip Summons a monster with 1000 or more ATK: target it; destroy it.' },
    [C.BOM]: { name: 'Book of Moon', kind: 'spell', sub: 'Quick-Play Spell', text: 'Target 1 face-up monster on the field; change it to face-down Defense Position.' },
    [C.SJ]: { name: 'Solemn Judgment', kind: 'trap', sub: 'Counter Trap', text: 'When a monster would be Summoned, OR a Spell/Trap Card is activated: pay half your LP; negate the Summon or activation, and destroy that card.' },
  };

  /* ------------------------------------------------------------ board model */
  const CLOCK = { you: 192, opp: 238 };
  SV.stChoice = 2; // S/T zone index chosen for Trap Hole (default S/T 3)
  function baseBoard() {
    return {
      turn: 3, phase: 'M1', owner: 'you', acting: 'you',
      you: { lp: 8000, hand: [C.CG, C.BW, C.FIS, C.TH, C.SF], m: [null, null, null, null, null], s: [null, { id: C.SJ, face: 'down' }, null, null, null], deck: 33, extra: 15, gy: [], ban: [], dm: { id: C.DM, status: 'dmz', returns: 0, surcharge: 0 } },
      opp: { lp: 8000, hand: 5, m: [null, null, { id: C.OX, face: 'up', pos: 'atk' }, null, null], s: [null, { id: C.BOM, face: 'down' }, null, null, null], deck: 32, extra: 15, gy: [], ban: [], dm: { id: C.BEWD, status: 'dmz', returns: 0, surcharge: 0 } },
      log: [
        { t: 'Turn 3 · Sulman', turn: true },
        { t: 'Sulman draws 1 card.', who: 'you' },
        { t: 'You drew Silver Fang.', who: 'you', priv: true },
        { t: 'Standby Phase.' },
        { t: 'Main Phase 1.' },
      ],
      placing: null,
    };
  }
  const STEP = {
    m1() {},
    m1b(b) {
      b.you.hand = b.you.hand.filter((x) => x !== C.CG);
      b.you.m[1] = { id: C.CG, face: 'up', pos: 'atk' };
      b.log.push({ t: 'Sulman Normal Summons Celtic Guardian to Main Monster Zone 2.', who: 'you' });
    },
    summon(b) {
      b.you.m[2] = { id: C.DM, face: 'up', pos: 'atk' };
      b.you.dm.status = 'field';
      b.log.push({ t: 'Sulman Special Summons Dark Magician from the Deck Master Zone to Main Monster Zone 3.', who: 'you' });
    },
    battle(b) {
      b.phase = 'BP';
      b.log.push({ t: 'Battle Phase.' });
    },
    chain(b) {
      b.opp.s[1] = { id: C.BOM, face: 'up', link: 1 };
      b.log.push({ t: 'Dark Magician attacks Battle Ox.', who: 'you' }, { t: 'Practice Bot activates Book of Moon (Chain Link 1), targeting Dark Magician.', who: 'opp' });
    },
    damage(b) {
      b.you.s[1] = null; b.you.gy = [C.SJ]; b.you.lp = 4000;
      b.opp.s[1] = null; b.opp.m[2] = null; b.opp.gy = [C.BOM, C.OX]; b.opp.lp = 7200;
      b.log.push(
        { t: 'Sulman activates Solemn Judgment (Chain Link 2) and pays 4000 LP.', who: 'you' },
        { t: 'Chain Link 2 resolves: Book of Moon is negated and destroyed.', who: 'you' },
        { t: 'Chain Link 1 is negated: no effect.', who: 'opp' },
        { t: 'Battle Ox is destroyed.', who: 'opp' },
        { t: 'Practice Bot takes 800 battle damage.', who: 'opp' }
      );
    },
    m2(b) {
      b.phase = 'M2';
      b.you.hand = b.you.hand.filter((x) => x !== C.TH);
      b.placing = C.TH;
      b.log.push({ t: 'Main Phase 2.' });
    },
    m2p(b) {
      const k = SV.stChoice;
      b.you.s[k] = { id: C.TH, face: 'down' };
      b.placing = null;
      b.log.push({ t: `Sulman sets a card in Spell & Trap Zone ${k + 1}.`, who: 'you' }, { t: 'You set Trap Hole.', who: 'you', priv: true });
    },
    end(b) {
      b.log.push({ t: 'End Phase.' }, { t: 'Turn 4 · Practice Bot', turn: true }, { t: 'Draw Phase.' });
      b.turn = 4; b.phase = 'DP'; b.owner = 'opp'; b.acting = 'opp';
    },
  };
  const SEQ = ['m1', 'm1b', 'summon', 'battle', 'chain', 'damage', 'm2', 'm2p', 'end'];
  function boardAt(id) {
    const b = baseBoard();
    for (const k of SEQ) {
      STEP[k](b);
      if (k === id) break;
    }
    b.you.time = CLOCK.you;
    b.opp.time = CLOCK.opp;
    return b;
  }

  /* ------------------------------------------------------------ per-state UI (transient) */
  const UI = {
    m1: { inspect: { id: C.CG, where: 'hand' }, sel: C.CG, menu: C.CG, legalHand: 'all', dmAction: true, offers: ['BP', 'EP'], next: 'Battle or End is available' },
    m1b: { inspect: { id: C.CG, where: 'y-m2' }, legalHand: [C.FIS, C.TH], dmAction: true, offers: ['BP', 'EP'], next: 'Battle or End is available' },
    summon: { inspect: { id: C.DM, where: 'y-m3' }, legalHand: [C.FIS, C.TH], offers: ['BP', 'EP'], next: 'Battle or End is available' },
    battle: { inspect: { id: C.DM, where: 'y-m3', note: 'atk' }, attacker: 'y-m3', target: 'o-m3', legalField: ['y-m2', 'y-m3'], offers: ['M2', 'EP'], next: 'Main 2 or End is available', path: 'live' },
    chain: { inspect: { id: C.BOM, where: 'o-s2' }, chain: 'respond', legalField: ['y-s2'], target: 'o-m3', path: 'dim', targetLine: true, offers: [], next: 'Waiting on the chain' },
    damage: { inspect: { id: C.SJ, where: 'gy' }, chain: 'done', deltas: true, legalField: ['y-m2'], offers: ['M2', 'EP'], next: 'Main 2 or End is available', deadTag: true },
    m2: { inspect: { id: C.TH, where: 'placing' }, place: true, placeFocus: true, offers: ['EP'], next: 'End is available' },
    m2p: { inspect: { id: C.TH, where: 'set' }, legalHand: [C.FIS], offers: ['EP'], next: 'End is available' },
    end: { inspect: { id: C.TH, where: 'set' }, quiet: true, handoff: true, offers: [], next: 'Practice Bot is playing' },
  };
  const STATES = ['m1', 'summon', 'battle', 'chain', 'damage', 'm2', 'end'];
  const LABEL = { m1: 'Main 1', summon: 'Summon', battle: 'Battle', chain: 'Chain', damage: 'Damage', m2: 'Main 2', end: 'End' };
  const PHASES = ['DP', 'SP', 'M1', 'BP', 'M2', 'EP'];
  const PHASE_NAME = { DP: 'Draw', SP: 'Standby', M1: 'Main 1', BP: 'Battle', M2: 'Main 2', EP: 'End' };

  /* ------------------------------------------------------------ settings */
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');
  const SET = {
    motion: Q.get('motion') || (prefersReduced.matches ? 'reduced' : 'full'),
    view: Q.get('view') || 'tilt',
    chain: 'Auto',
    sound: 'On',
    cutin: 'every',
  };
  let cutinPlayed = false;
  const reduced = () => SET.motion === 'reduced';
  const useGL = () => SV.proj && SV.proj.available && !reduced();
  function applySettings() {
    root.dataset.motion = SET.motion;
    root.dataset.view = SET.view;
    SV.tiltDeg = parseFloat(getComputedStyle(root).getPropertyValue('--tilt')) || 0;
    root.dataset.fx = useGL() ? 'gl' : 'css';
    $('#tMotion').innerHTML = `Motion: <b>${SET.motion === 'full' ? 'Full' : 'Reduced'}</b>`;
    $('#tSound').innerHTML = `Sound: <b>${SET.sound}</b>`;
    $('#tChain').innerHTML = `Chain: <b>${SET.chain}</b>`;
    const flat = SET.view === 'flat';
    $('#tView').innerHTML = `${svg(flat ? 'flat' : 'tilt')}<b>${flat ? 'Flat' : 'Tilt'}</b>`;
    $('#tView').setAttribute('aria-pressed', String(flat));
    $('#tView').setAttribute('aria-label', flat ? 'Board view: Flat. Switch to Tilt' : 'Board view: Tilt. Switch to Flat');
    renderOptions();
  }

  /* ------------------------------------------------------------ layout table */
  const LAYOUT = [
    ['o-deck', 1, 1], ['o-s5', 2, 1], ['o-s4', 3, 1], ['o-s3', 4, 1], ['o-s2', 5, 1], ['o-s1', 6, 1], ['o-extra', 7, 1],
    ['o-gy', 1, 2], ['o-m5', 2, 2], ['o-m4', 3, 2], ['o-m3', 4, 2], ['o-m2', 5, 2], ['o-m1', 6, 2], ['o-field', 7, 2],
    ['o-ban', 1, 3], ['emz-l', 3, 3], ['emz-r', 5, 3], ['y-ban', 7, 3],
    ['y-field', 1, 4], ['y-m1', 2, 4], ['y-m2', 3, 4], ['y-m3', 4, 4], ['y-m4', 5, 4], ['y-m5', 6, 4], ['y-gy', 7, 4],
    ['y-extra', 1, 5], ['y-s1', 2, 5], ['y-s2', 3, 5], ['y-s3', 4, 5], ['y-s4', 5, 5], ['y-s5', 6, 5], ['y-deck', 7, 5],
  ];
  const PILE_NAME = { deck: ['Deck', 'Deck'], gy: ['GY', 'GY'], ban: ['Banished', 'Ban'], extra: ['Extra', 'Ext'], field: ['Field', 'Field'] };
  function zoneName(z) {
    if (z === 'emz-l') return 'Extra Monster Zone, left, shared';
    if (z === 'emz-r') return 'Extra Monster Zone, right, shared';
    const [side, key] = z.split('-');
    const who = side === 'y' ? 'Your' : "Practice Bot's";
    const map = { deck: 'Deck', gy: 'Graveyard', ban: 'Banished pile', extra: 'Extra Deck', field: 'Field Zone' };
    if (map[key]) return `${who} ${map[key]}`;
    return `${who} ${key[0] === 'm' ? 'Main Monster Zone' : 'Spell & Trap Zone'} ${key[1]}`;
  }
  function zoneModel(b, z) {
    const [side, key] = z.split('-');
    if (side === 'emz') return { kind: 'mz emz' };
    const P = side === 'y' ? b.you : b.opp;
    if (/^m\d$/.test(key)) return { kind: 'mz', card: P.m[+key[1] - 1], side };
    if (/^s\d$/.test(key)) return { kind: 'st', card: P.s[+key[1] - 1], side, pz: key === 's1' || key === 's5' };
    return { kind: 'pile', pile: key, side, P };
  }

  /* ------------------------------------------------------------ render: table */
  const EMBLEM = (() => {
    let rays = '';
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r1 = 36, r2 = i % 2 ? 58 : 68;
      rays += `<line x1="${(100 + Math.cos(a) * r1).toFixed(1)}" y1="${(100 + Math.sin(a) * r1).toFixed(1)}" x2="${(100 + Math.cos(a) * r2).toFixed(1)}" y2="${(100 + Math.sin(a) * r2).toFixed(1)}"/>`;
    }
    return `<svg class="emblem" viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.8"><circle cx="100" cy="100" r="97"/><circle cx="100" cy="100" r="92" stroke-dasharray="1.5 4"/><circle cx="100" cy="100" r="74"/><circle cx="100" cy="100" r="30" stroke-width="1.2"/><circle cx="100" cy="100" r="22"/>${rays}</g></svg>`;
  })();
  const NOTCH = '<svg viewBox="0 0 10 18" aria-hidden="true"><path d="M9 1L1 9l8 8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

  function fieldCardHTML(c, side, z, ui) {
    const info = CARD[c.id];
    const mine = side === 'y';
    const down = c.face === 'down';
    const cls = ['fc'];
    if (c.pos === 'def') cls.push('def');
    const legal = !ui.quiet && (ui.legalField || []).includes(z) && ui.attacker !== z;
    if (legal) cls.push('legal');
    if (ui.attacker === z) cls.push('sel');
    if (ui.target === z) cls.push('target');
    if ((ui.hide || []).includes(z)) cls.push('hidden-for-fx');
    let label = down ? (mine ? `Your face-down card, ${info.name}, hidden from Practice Bot` : 'Face-down card') : `${info.name}, ${mine ? 'yours' : "Practice Bot's"}`;
    if (!down && info.kind === 'monster') label += `, ATK ${info.atk}, DEF ${info.def}, ${c.pos === 'def' ? 'Defense' : 'Attack'} Position`;
    if (c.link) label += `, Chain Link ${c.link}`;
    if (legal) label += ', can act';
    if (ui.attacker === z) label += ', selected attacker';
    if (ui.target === z) label += ', attack target';
    let inner = `<img src="${down ? BACK : ART(c.id)}" alt="" draggable="false">`;
    if (!down && info.kind === 'monster') inner += `<span class="stat"><b>${info.atk}</b><i>/</i><span class="d">${info.def}</span></span>`;
    if (down && mine) inner += `<span class="peekart" style="background-image:url(${ART(c.id)})"></span>`;
    if (c.link) inner += `<span class="linkbadge ${mine ? 'you' : ''}">${c.link}</span>`;
    if (legal) inner += `<span class="ltab">${svg('chevUp')}</span>`;
    return `<button class="${cls.join(' ')}" type="button" data-card="${c.id}" data-zone="${z}" aria-label="${esc(label)}">${inner}</button>`;
  }
  function pileHTML(zm, z) {
    const P = zm.P, k = zm.pile;
    let count = null, img = null;
    if (k === 'deck') { count = P.deck; img = BACK; }
    if (k === 'extra') { count = P.extra; img = BACK_X; }
    if (k === 'gy') { count = P.gy.length; img = count ? ART(P.gy[count - 1]) : null; }
    if (k === 'ban') count = P.ban.length;
    let h = '';
    if (img) h += `<button class="pilecard ${k === 'gy' ? 'flat' : ''}" type="button" style="background-image:url(${img})" data-pile="${z}" ${k === 'gy' ? `data-inspect="${P.gy[P.gy.length - 1]}"` : ''} aria-label="${esc(zoneName(z))}, ${count} cards${k === 'gy' ? `, top card ${CARD[P.gy[P.gy.length - 1]].name}` : ''}"></button>`;
    const [lf, ls] = PILE_NAME[k];
    h += `<span class="plabel"><span class="lf">${lf}</span><span class="ls">${ls}</span>${count != null ? `<b>${count}</b>` : ''}</span>`;
    return h;
  }
  function renderPlane(b, ui) {
    let h = EMBLEM + `<span class="notch l">${NOTCH}</span><span class="notch r">${NOTCH}</span>`;
    for (const [z, col, row] of LAYOUT) {
      const zm = zoneModel(b, z);
      const cls = ['zone', ...zm.kind.split(' ')];
      if (zm.kind === 'pile' && row === 3) cls.push('band-pile');
      let inner = zm.kind === 'pile' ? '<i class="gp"></i>' : zm.kind.startsWith('mz') ? '<i class="gp"></i><i class="gl"></i>' : '<i class="gp"></i>';
      if (zm.pz) inner += '<span class="pmark" aria-hidden="true">P</span>';
      if (zm.kind === 'mz emz') inner += '<span class="zlabel">Extra<br>Monster</span>';
      if (zm.card) inner += fieldCardHTML(zm.card, zm.side, z, ui);
      if (!zm.card && ui.fxCard && ui.fxCard.zone === z) inner += `<button class="fc hidden-for-fx" tabindex="-1" aria-hidden="true" data-zone="${z}"><img src="${ART(ui.fxCard.id)}" alt=""></button>`;
      if (zm.kind === 'pile') inner += pileHTML(zm, z);
      let attrs = `data-z="${z}" style="grid-area:${row}/${col}"`;
      if (ui.place && /^y-s\d$/.test(z) && !zm.card) {
        cls.push('place');
        const idx = +z.slice(-1) - 1;
        const focused = ui.placeFocus && idx === SV.stChoice;
        if (focused) cls.push('focus');
        attrs += ` role="button" tabindex="0" data-place="${idx}" aria-label="Set Trap Hole in ${esc(zoneName(z))}"`;
        inner += `<span class="placemark">${svg('plus')}<span>S/T ${idx + 1}</span></span>`;
        inner += `<span class="ghost" style="background-image:url(${ART(C.TH)});${focused ? '' : 'display:none'}"></span>`;
      }
      h += `<div class="${cls.join(' ')}" ${attrs}>${inner}</div>`;
    }
    h += '<svg class="plane-svg" id="planeSvg" aria-hidden="true"></svg>';
    const plane = $('#plane');
    plane.innerHTML = h;
    plane.dataset.light = b.owner === 'you' ? 'you' : 'opp';
  }
  function zoneBox(z) {
    const el = $(`[data-z="${z}"]`);
    if (!el) return null;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function layoutPlaneSvg(ui) {
    const s = $('#planeSvg');
    if (!s) return;
    const plane = $('#plane');
    s.setAttribute('viewBox', `0 0 ${plane.offsetWidth} ${plane.offsetHeight}`);
    let h = '<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" fill="#e8cf94"/></marker></defs>';
    if (ui.path) {
      const a = zoneBox('y-m3'), t = zoneBox('o-m3');
      if (a && t) {
        const ch = a.h * 0.875;
        const A = { x: a.x + a.w / 2, y: a.y + a.h / 2 - ch / 2 - 2 };
        const B = { x: t.x + t.w / 2, y: t.y + t.h / 2 + ch / 2 + 6 };
        const d = Math.hypot(B.x - A.x, B.y - A.y);
        const Cx = (A.x + B.x) / 2 + d * 0.34, Cy = (A.y + B.y) / 2;
        h += `<path class="atk-path ${ui.path}" d="M${A.x} ${A.y} Q${Cx} ${Cy} ${B.x} ${B.y}" marker-end="url(#ah)"/>`;
      }
    }
    if (ui.targetLine) {
      const a = zoneBox('o-s2'), t = zoneBox('y-m3');
      if (a && t) {
        const A = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, B = { x: t.x + t.w / 2 + t.w * 0.2, y: t.y + t.h * 0.2 };
        h += `<path class="tgt-path" d="M${A.x} ${A.y} Q${A.x - 10} ${(A.y + B.y) / 2} ${B.x} ${B.y}"/>`;
      }
    }
    s.innerHTML = h;
  }

  /* ------------------------------------------------------------ render: rails, hands, plates */
  const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  function clockSVG(pct) {
    const c = 2 * Math.PI * 7;
    return `<svg viewBox="0 0 18 18" aria-hidden="true"><circle class="ring-bg" cx="9" cy="9" r="7" fill="none" stroke-width="2"/><circle class="ring-fg" cx="9" cy="9" r="7" fill="none" stroke-width="2" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}" transform="rotate(-90 9 9)"/></svg>`;
  }
  function plateHTML(seat, b, ui) {
    const P = b[seat];
    const isTurn = b.owner === seat;
    const acting = b.acting === seat;
    const name = seat === 'you' ? 'Sulman' : 'Practice Bot';
    let delta = '';
    if (ui.deltas) delta = seat === 'you' ? `<span class="delta cost" title="Cost paid for Solemn Judgment">${svg('coin')}<b>−4000</b>cost</span>` : `<span class="delta dmg" title="Battle damage from Dark Magician">${svg('burst')}<b>−800</b>damage</span>`;
    const t = P.time;
    const state = acting ? 'Acting' : 'Waiting';
    return `<div class="plate" id="plate-${seat}" data-seat="${seat}" ${isTurn ? 'data-turn' : ''} ${acting ? 'data-acting' : ''}>
      <div class="who">${svg(seat === 'you' ? 'user' : 'bot')}<span class="pname">${name}</span><span class="turn-tag">Turn</span>${delta}</div>
      <div class="lp" aria-label="${name} Life Points ${P.lp}"><span class="lp-label">LP</span><span class="lp-val" id="lp-${seat}">${P.lp}</span></div>
      <div class="clock" id="clk-${seat}" aria-label="${name} turn timer ${fmt(t)}, ${state}">${clockSVG(t / 240)}<span class="t">${fmt(t)}</span><span class="state">${state}</span></div>
    </div>`;
  }
  function handCardHTML(id, ui) {
    const info = CARD[id];
    const legal = !ui.quiet && (ui.legalHand === 'all' || (ui.legalHand || []).includes(id));
    const sel = ui.sel === id;
    const cls = ['hc'];
    if (legal) cls.push('legal');
    if (sel) cls.push('sel');
    if (ui.quiet) cls.push('quiet');
    const label = `${info.name}, in your hand${legal ? ', can act' : ''}${sel ? ', selected' : ''}`;
    return `<button class="${cls.join(' ')}" type="button" data-hand="${id}" aria-label="${esc(label)}" ${sel ? 'aria-expanded="true"' : ''}><img src="${ART(id)}" alt="" draggable="false">${legal ? `<span class="ltab">${svg('chevUp')}</span>` : ''}</button>`;
  }
  function chipHTML(seat, b, ui) {
    const dm = b[seat].dm;
    const away = dm.status === 'field';
    const can = seat === 'you' && ui.dmAction && !away && !ui.quiet;
    return `<div class="dm-chip ${away ? 'away' : ''} ${can ? 'can-act' : ''}">
      <button class="chip-main" type="button" data-sheet="docks" aria-label="${seat === 'you' ? 'Your' : 'Opponent'} Master, ${esc(CARD[dm.id].name)}, ${away ? 'On field' : 'In Deck Master Zone'}, Returns ${dm.returns}, Next surcharge ${dm.surcharge} LP. Open details">
        <img src="${ART(dm.id)}" alt=""><span class="cn">${seat === 'you' ? 'Your Master' : 'Opp. Master'}</span><span class="cs">${away ? 'On field' : 'In DM Zone'} · R ${dm.returns}</span>
      </button>${can ? `<button class="chip-act" type="button" data-act="dm-ss">${svg('summon')}Summon</button>` : ''}</div>`;
  }
  function renderRails(b, ui) {
    $('#railOpp').innerHTML =
      plateHTML('opp', b, ui) +
      `<div class="hand" aria-label="Practice Bot's hand, ${b.opp.hand} cards">${'<span class="ohc"></span>'.repeat(b.opp.hand)}<span class="handcount">Hand ${b.opp.hand}</span></div>` +
      chipHTML('opp', b, ui);
    $('#railYou').innerHTML =
      plateHTML('you', b, ui) + `<div class="hand" aria-label="Your hand, ${b.you.hand.length} cards">${b.you.hand.map((id) => handCardHTML(id, ui)).join('')}</div>` + chipHTML('you', b, ui);
  }

  /* ------------------------------------------------------------ render: inspector */
  let tab = 'card';
  const WHERE = {
    hand: ['you', 'Yours', 'Hand'],
    'y-m2': ['you', 'Yours', 'Main Monster Zone 2'],
    'y-m3': ['you', 'Yours', 'Main Monster Zone 3 · Deck Master'],
    'o-s2': ['opp', "Practice Bot's", 'Spell & Trap Zone 2 · Chain Link 1'],
    gy: ['you', 'Yours', 'Graveyard · was Chain Link 2'],
    placing: ['you', 'Yours', 'Being Set'],
    set: ['you', 'Yours', 'Set face-down · hidden from Practice Bot'],
    'o-m3': ['opp', "Practice Bot's", 'Main Monster Zone 3'],
    'o-gy': ['opp', "Practice Bot's", 'Graveyard'],
    'y-gy': ['you', 'Yours', 'Graveyard'],
    dmz: ['you', 'Yours', 'Deck Master'],
    odmz: ['opp', "Practice Bot's", 'Deck Master'],
  };
  function noteFor(id, ui) {
    if (ui.quiet) return ['you', 'Practice Bot is playing Turn 4. You still get prompts to respond to chains.'];
    if (id === C.CG && ui.menu) return ['you', 'Can be Normal Summoned or Set. Pick an action on the card.'];
    if (id === C.DM && ui.inspect.note === 'atk') return ['you', 'Attacking Battle Ox: 2500 vs 1700. No direct attack: Practice Bot controls a monster.'];
    if (id === C.DM) return ['you', 'Your Deck Master is on the field. Returns 0 · Next surcharge 0 LP.'];
    if (id === C.BOM) return ['opp', 'Targets Dark Magician. It resolves unless you respond.'];
    if (id === C.SJ && ui.chain === 'done') return ['you', 'Resolved as Chain Link 2. You paid 4000 LP; Book of Moon was negated and destroyed.'];
    if (id === C.TH && ui.place) return ['you', 'Choose an empty Spell & Trap Zone to Set it.'];
    if (id === C.TH) return ['you', 'Set face-down. Practice Bot sees only a card back.'];
    return null;
  }
  function inspectorCardHTML(ui) {
    const it = ui.inspect;
    const info = CARD[it.id];
    const w = WHERE[it.where] || WHERE.hand;
    let meta = '';
    if (info.kind === 'monster') {
      meta = `<div class="insp-meta"><span>${info.attr}</span><span><span class="stars" aria-hidden="true">${'<i></i>'.repeat(info.level)}</span>Level ${info.level}</span></div>
        <div class="insp-meta"><span>${info.race} / Normal Monster</span></div>
        <div class="insp-stats"><span>ATK<b>${info.atk}</b></span><span>DEF<b>${info.def}</b></span></div>`;
    } else {
      meta = `<div class="insp-meta"><span>${info.sub}</span></div><p class="insp-text">${info.text}</p>`;
    }
    const n = noteFor(it.id, ui);
    const note = n ? `<div class="insp-note ${n[0] === 'opp' ? 'opp' : ''}">${svg('info')}<span>${n[1]}</span></div>` : '';
    return `<div class="owner-line" data-owner="${w[0]}"><i class="dot"></i><span><b>${w[1]}</b> · ${w[2]}</span></div>
      <div class="insp-card-grid"><img class="insp-art" src="${ART(it.id)}" alt="${esc(info.name)} card art">
      <div><h2 class="insp-name">${info.name}</h2>${meta}${note}</div></div>`;
  }
  function renderInspector(b, ui) {
    const lines = b.log
      .map((l, i) => {
        const cls = [l.turn ? 'turn' : '', l.priv ? 'priv' : '', i >= b.log.length - (ui.newLog || 0) ? 'new' : ''].join(' ');
        return `<li class="${cls}" data-who="${l.who || 'sys'}"><i class="who" aria-hidden="true"></i><span>${esc(l.t)}${l.priv ? `<span class="privtag">${svg('lock')}Only you</span>` : ''}</span></li>`;
      })
      .join('');
    $('#insp').innerHTML = `<div class="insp-tabs" role="tablist">
        <button role="tab" type="button" data-tab="card" aria-selected="${tab === 'card'}">${svg('card')}Card</button>
        <button role="tab" type="button" data-tab="log" aria-selected="${tab === 'log'}">${svg('log')}Log <span class="count">${b.log.length}</span></button>
        <button class="insp-close btn" type="button" data-close aria-label="Close">${svg('x')}</button>
      </div>
      <div class="insp-body" role="tabpanel">${tab === 'card' ? inspectorCardHTML(ui) : `<ol class="log">${lines}</ol>`}</div>`;
    if (tab === 'log') {
      const body = $('#insp .insp-body');
      body.scrollTop = body.scrollHeight;
    }
  }
  function renderPeek(b, ui) {
    const info = CARD[ui.inspect.id];
    const m = info.kind === 'monster' ? `${info.attr} · Lv ${info.level} · ${info.atk} / ${info.def}` : info.sub;
    $('#peek').innerHTML = `<img src="${ART(ui.inspect.id)}" alt=""><div style="min-width:0"><div class="pn">${info.name}</div><div class="pm">${m}</div></div>
      <button class="btn" type="button" data-sheet="insp" data-tab="card">Card</button><button class="btn" type="button" data-sheet="insp" data-tab="log">Log</button>`;
  }

  /* ------------------------------------------------------------ render: docks */
  function dockHTML(seat, b, ui) {
    const dm = b[seat].dm;
    const away = dm.status === 'field';
    const can = seat === 'you' && ui.dmAction && !away && !ui.quiet;
    const title = seat === 'you' ? 'Your Master' : 'Opponent Master';
    let actions = '';
    if (seat === 'you') {
      if (can) actions = `<div class="dock-actions"><button class="btn primary" type="button" data-act="dm-ss">${svg('summon')}Special Summon</button><button class="btn" type="button" data-inspect="${dm.id}">${svg('eye')}Inspect</button></div>`;
      else actions = `<p class="dock-quiet">${ui.quiet ? 'Deck Master actions return on your turn.' : 'No Deck Master action right now.'}</p>`;
    }
    return `<section class="dock panel ${seat === 'you' ? 'mine' : ''} ${can ? 'can-act' : ''}" aria-label="${title}">
      <h2>${title}</h2>
      <div class="dock-in">
        <button class="dock-art ${away ? 'away' : ''}" type="button" id="dockArt-${seat}" data-inspect="${dm.id}" aria-label="Inspect ${esc(CARD[dm.id].name)}"><img src="${ART(dm.id)}" alt="">${away ? '<span class="awaytag">On field</span>' : ''}${can ? `<span class="ltab">${svg('chevUp')}</span>` : ''}</button>
        <dl class="dock-stats">
          <div><dt>Status</dt><dd id="dmStatus-${seat}">${away ? 'On field' : 'In Deck Master Zone'}</dd></div>
          <div><dt>Returns</dt><dd>${dm.returns}</dd></div>
          <div><dt>Next surcharge</dt><dd>${dm.surcharge} LP</dd></div>
        </dl>
        ${actions}
      </div>
    </section>`;
  }
  function renderDocks(b, ui) {
    $('#docks').innerHTML = dockHTML('opp', b, ui) + dockHTML('you', b, ui);
  }

  /* ------------------------------------------------------------ chrome: header + phase bar */
  function updateChrome(b, ui) {
    const yours = b.owner === 'you';
    $('#turnText').textContent = `Turn ${b.turn} · ${PHASE_NAME[b.phase]}`;
    const pill = $('#ownerPill');
    pill.dataset.owner = b.owner;
    pill.innerHTML = `${svg(yours ? 'user' : 'bot')}<span class="full">${yours ? 'Your turn' : "Practice Bot's turn"}</span><span class="short">${yours ? 'Your turn' : 'Their turn'}</span>`;
    $('#app').classList.toggle('quiet', !!ui.quiet);
    const pb = $('#phasebar');
    if (!pb.firstChild) {
      pb.innerHTML = `<span class="pb-owner" id="pbOwner"><i></i><span></span></span>
        <div class="pb-track" id="pbTrack"><span class="pb-puck" aria-hidden="true"></span>${PHASES.map((p) => `<button type="button" data-ph="${p}" title="${PHASE_NAME[p]} Phase">${p}</button>`).join('')}</div>
        <span class="pb-next" id="pbNext"></span>`;
    }
    const track = $('#pbTrack');
    track.style.setProperty('--pi', PHASES.indexOf(b.phase));
    track.dataset.owner = b.owner;
    $$('button', track).forEach((btn) => {
      const p = btn.dataset.ph;
      const current = p === b.phase;
      const offer = yours && (ui.offers || []).includes(p);
      btn.toggleAttribute('aria-current', false);
      if (current) btn.setAttribute('aria-current', 'step');
      btn.classList.toggle('offer', offer);
      btn.disabled = !offer;
      btn.innerHTML = `${p}${offer ? svg('chevR') : ''}`;
      btn.setAttribute('aria-label', `${PHASE_NAME[p]} Phase${current ? ', current' : ''}${offer ? ', available' : ''}`);
    });
    const own = $('#pbOwner');
    own.dataset.owner = b.owner;
    own.lastElementChild.textContent = `${yours ? 'Sulman' : 'Practice Bot'} · Turn ${b.turn}`;
    $('#pbNext').textContent = ui.next || '';
  }

  /* ------------------------------------------------------------ render: overlay (anchored, untilted) */
  function tileHTML({ link, id, owner, eff, state, own }) {
    const info = CARD[id];
    const st =
      state === 'resolved' ? `<span class="cres ok">${svg('check')}Resolved</span>` :
      state === 'negated' ? `<span class="cres neg">${svg('negate')}Negated</span>` :
      state === 'resolving' ? '<span class="cres ok">Resolving</span>' : '';
    return `<div class="ctile ${state === 'negated' ? 'negated' : ''} ${state === 'resolving' ? 'resolving' : ''}" data-owner="${owner}" data-link="${link}">
      <span class="clink" aria-label="Chain Link ${link}">${link}</span>
      <span class="cart" style="background-image:url(${ART(id)})" aria-hidden="true"></span>
      <div class="cmeta"><div class="cname">${info.name}</div><div class="cowner"><i></i>${own || (owner === 'you' ? 'You' : 'Practice Bot')}${st}</div></div>
      <div class="ceff">${eff}</div></div>`;
  }
  const CD_TOTAL = 15;
  function cdHTML(sec) {
    const c = 2 * Math.PI * 19;
    return `<div class="cd" id="cd" role="timer" aria-label="${sec} seconds left to respond"><svg viewBox="0 0 46 46" aria-hidden="true"><circle class="bg" cx="23" cy="23" r="19" fill="none" stroke-width="3"/><circle class="fg" id="cdFg" cx="23" cy="23" r="19" fill="none" stroke-width="3" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - sec / CD_TOTAL)).toFixed(2)}"/></svg><span id="cdN">${sec}</span></div>`;
  }
  function chainHTML(ui) {
    const tiles = [];
    let head = ['Chain', 'top link resolves first'];
    if (ui.chain === 'respond') {
      tiles.push(`<div class="ctile pending" data-owner="you" data-link="2" id="respondTile" role="group" aria-label="Optional response: Solemn Judgment">
        <span class="clink" aria-label="Chain Link 2">2</span>
        <span class="cart" style="background-image:url(${ART(C.SJ)})" aria-hidden="true"></span>
        <div class="cmeta"><div class="cname">Solemn Judgment</div><div class="cowner"><i></i>You · optional response</div></div>
        <div class="ceff">Pay half your LP (4000) to negate Book of Moon.</div>
        <div class="resp-row">${cdHTML(ui.cd == null ? 11 : ui.cd)}<div class="lpprev">Your LP<b>8000</b>${svg('arrowR')}<b>4000</b></div></div>
        <div class="respond-actions">${cdHTML(ui.cd == null ? 11 : ui.cd).replace('id="cd"', 'id="cdM"').replace('id="cdFg"', 'class="fg"').replace('id="cdN"', 'class="cdn"')}<button class="btn primary" type="button" data-act="activate">Activate</button><button class="btn" type="button" data-act="pass">Pass<span class="kbd">Esc</span></button></div>
      </div>`);
      tiles.push(tileHTML({ link: 1, id: C.BOM, owner: 'opp', eff: 'Targets Dark Magician: change it to face-down Defense Position.' }));
    } else if (ui.chain === 'activated') {
      tiles.push(tileHTML({ link: 2, id: C.SJ, owner: 'you', eff: 'Paid 4000 LP. Negate Book of Moon and destroy it.', state: 'resolving' }));
      tiles.push(tileHTML({ link: 1, id: C.BOM, owner: 'opp', eff: 'Targets Dark Magician: change it to face-down Defense Position.' }));
    } else if (ui.chain === 'negating') {
      tiles.push(tileHTML({ link: 2, id: C.SJ, owner: 'you', eff: 'Paid 4000 LP. Book of Moon is negated and destroyed.', state: 'resolved' }));
      tiles.push(tileHTML({ link: 1, id: C.BOM, owner: 'opp', eff: 'Negated: it does nothing.', state: 'negated' }));
    } else if (ui.chain === 'done') {
      head = ['Chain resolved', 'the attack continues'];
      tiles.push(tileHTML({ link: 2, id: C.SJ, owner: 'you', eff: 'Paid 4000 LP. Book of Moon is negated and destroyed.', state: 'resolved' }));
      tiles.push(tileHTML({ link: 1, id: C.BOM, owner: 'opp', eff: 'Negated: it does nothing.', state: 'negated' }));
    }
    if (ui.chain === 'done' && isMobile()) {
      return `<div class="chainsum" role="status" data-anchor="#peek" data-at="cover" data-m-anchor="#peek" data-m-at="cover">
        <span><b>Chain resolved.</b> Link 2 Solemn Judgment resolved.</span><span>Link 1 Book of Moon <span class="neg">negated</span>: no effect.</span></div>`;
    }
    return `<div class="chain ${ui.enter ? 'enter-rise' : ''}" role="region" aria-label="Chain stack" data-anchor='[data-z="o-m2"]|[data-z="y-m5"]' data-at="inside-top" data-gap="0" data-fitw="16" data-m-anchor=".phasebar" data-m-at="above">
      <div class="chain-head"><span>${head[0]}</span><small>${head[1]}</small></div>${tiles.join('')}<div class="chain-emitter" aria-hidden="true"></div></div>`;
  }
  function renderOverlay(b, ui) {
    let h = '';
    if (ui.menu) {
      const info = CARD[ui.menu];
      const items =
        info.kind === 'monster' ? [['ns', 'summon', 'Normal Summon', 'N'], ['set', 'set', 'Set', 'S']] :
        info.kind === 'spell' ? [['act', 'summon', 'Activate', 'A'], ['set', 'set', 'Set', 'S']] : [['set', 'set', 'Set', 'S']];
      h += `<div class="amenu ${ui.enter ? 'enter-pop' : ''}" role="menu" aria-label="${esc(info.name)} actions" data-anchor='[data-hand="${ui.menu}"]' data-at="top" data-gap="12">
        ${items.map(([a, ic, t, k]) => `<button role="menuitem" type="button" data-act="${a}" data-card="${ui.menu}">${svg(ic)}${t}<span class="k">${k}</span></button>`).join('')}</div>`;
    }
    if (ui.attacker) {
      h += `<span class="tag atk" data-anchor='[data-z="y-m3"] .fc' data-at="bottom" data-gap="12">${svg('sword')}Attacker · 2500 ATK</span>`;
      h += `<span class="tag tgt" data-anchor='[data-z="o-m3"] .fc' data-at="top" data-gap="10">${svg('target')}Target · Battle Ox</span>`;
      if (ui.preview !== false) h += `<div class="preview ${ui.enter ? 'enter-pop' : ''}" role="group" aria-label="Outcome preview: 2500 vs 1700, Battle Ox is destroyed, Practice Bot takes 800" data-anchor='[data-z="o-m3"] .fc' data-at="right-top" data-gap="18" data-m-anchor="#railYou" data-m-at="cover">
        <div class="vs"><span class="win">2500</span><span class="x">vs</span><span>1700</span></div>
        <div class="lines"><span><b>Battle Ox</b> is destroyed</span><span><b>Practice Bot</b> takes 800</span></div>
        <div class="hint">${svg('eye')}Preview before you commit. Drag or click to attack.</div>
        <button class="btn primary" type="button" data-act="attack">${svg('sword')}Attack Battle Ox<span class="kbd">Enter</span></button>
      </div>`;
    }
    if (ui.chain) h += chainHTML(ui);
    if (ui.chain === 'respond') {
      h += `<span class="tag opp" data-anchor='[data-z="y-m3"] .fc' data-at="top" data-gap="10">${svg('target')}Targeted by Book of Moon</span>`;
      h += `<span class="tag tgt desk-only" data-anchor='[data-z="o-m3"] .fc' data-at="left" data-gap="12">${svg('pause')}Attack waits for the chain</span>`;
    }
    if (ui.deadTag) h += `<span class="tag dead" data-anchor='[data-z="o-m3"]' data-at="center">${svg('burst')}<span>Battle Ox destroyed</span></span>`;
    if (ui.bignums) {
      h += `<div class="bignum cost" data-anchor="#plate-you" data-at="top" data-gap="4" data-m-anchor='[data-z="y-s3"]' data-m-at="center">−4000<small>LP paid · Solemn Judgment</small></div>`;
      h += `<div class="bignum dmg" data-anchor="#plate-opp" data-at="bottom" data-gap="4" data-m-anchor='[data-z="o-s3"]' data-m-at="center">−800<small>battle damage</small></div>`;
    }
    if (ui.place) {
      h += `<div class="placehint ${ui.enter ? 'enter-pop' : ''}" data-anchor="#railYou .hand" data-at="right" data-gap="20" data-m-anchor="#peek" data-m-at="cover">
        <span class="thumb" style="background-image:url(${ART(C.TH)})"></span><div><b>Set Trap Hole</b><div class="sub">Choose a Spell &amp; Trap Zone</div></div>
        <button class="btn" type="button" data-act="cancel-place">Cancel<span class="kbd">Esc</span></button></div>`;
    }
    if (ui.handoff) {
      h += `<div class="handoff ${ui.enter ? 'enter-pop' : ''}" role="status" data-anchor='[data-z="emz-l"]|[data-z="emz-r"]' data-at="center">
        <div class="big">${svg('arrowR')}Turn 4 · Practice Bot</div><div class="small">Your turn is over. You still get prompts to respond to chains.</div></div>`;
    }
    $('#overlay').innerHTML = h;
  }
  function unionRect(sel) {
    const rs = sel.split('|').map((s) => $(s)).filter(Boolean).map((e) => e.getBoundingClientRect());
    if (!rs.length) return null;
    const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
    const r = Math.max(...rs.map((r) => r.right)), bt = Math.max(...rs.map((r) => r.bottom));
    return { left: l, top: t, right: r, bottom: bt, width: r - l, height: bt - t };
  }
  function positionOverlay() {
    const vw = innerWidth, vh = innerHeight, mob = isMobile();
    $$('#overlay > [data-anchor]').forEach((el) => {
      const anchor = (mob && el.dataset.mAnchor) || el.dataset.anchor;
      const at = (mob && el.dataset.mAt) || el.dataset.at;
      const r = unionRect(anchor);
      if (!r) { el.style.visibility = 'hidden'; return; }
      el.style.width = '';
      if (at === 'cover' || at === 'above') el.style.width = `${vw - 16}px`;
      else if (el.dataset.fitw && !mob) el.style.width = `${Math.round(r.width + +el.dataset.fitw)}px`;
      const w = el.offsetWidth, h = el.offsetHeight, g = +(el.dataset.gap || 10);
      let x, y;
      switch (at) {
        case 'top': x = r.left + r.width / 2 - w / 2; y = r.top - h - g; break;
        case 'bottom': x = r.left + r.width / 2 - w / 2; y = r.bottom + g; break;
        case 'right': x = r.right + g; y = r.top + r.height / 2 - h / 2; break;
        case 'right-top': x = r.right + g; y = r.top - 4; break;
        case 'center': x = r.left + r.width / 2 - w / 2; y = r.top + r.height / 2 - h / 2; break;
        case 'inside-top': x = r.left + r.width / 2 - w / 2; y = r.top + g; break;
        case 'left': x = r.left - w - g; y = r.top + r.height / 2 - h / 2; break;
        case 'cover': x = 8; y = r.top + r.height / 2 - h / 2; break;
        case 'above': x = 8; y = r.top - h - 8; break;
        default: x = r.left; y = r.top;
      }
      x = Math.max(8, Math.min(vw - w - 8, x));
      y = Math.max(8, Math.min(vh - h - 8, y));
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      el.style.visibility = 'visible';
    });
  }
  function relayout() {
    if (!S.ui) return;
    layoutPlaneSvg(S.ui);
    positionOverlay();
  }

  /* ------------------------------------------------------------ state render */
  const S = { id: null, b: null, ui: null };
  function renderState(id, over = {}) {
    const b = boardAt(over.board || id);
    if (over.mutate) over.mutate(b);
    const ui = Object.assign({}, UI[over.ui || id] || UI[id], over.set || {});
    if (STILL && id === 'damage' && !over.set) Object.assign(ui, { bignums: true, fxCard: { zone: 'o-m3', id: C.OX } });
    S.id = id; S.b = b; S.ui = ui;
    root.dataset.fx = useGL() ? 'gl' : 'css';
    renderPlane(b, ui);
    renderRails(b, ui);
    renderInspector(b, ui);
    renderDocks(b, ui);
    renderPeek(b, ui);
    updateChrome(b, ui);
    renderOverlay(b, ui);
    relayout();
  }

  /* ------------------------------------------------------------ moments infrastructure */
  let token = 0;
  let inMoment = false;
  let cur = null;
  const alive = (my) => my === token;
  function momentOn(on) {
    inMoment = on;
    document.body.classList.toggle('moment', on);
    $$('.clock').forEach((c) => c.classList.toggle('paused', on));
  }
  function clearFx() {
    $('#fx').innerHTML = '';
    $$('.fly').forEach((f) => f.remove());
    if (SV.proj && SV.proj.available) SV.proj.clear();
  }
  /* Settled frame; in ?still mode, summon and damage show the projection at its peak. */
  async function staticFx(id) {
    const my = token;
    if (SV.proj) await SV.proj.ready;
    if (!alive(my) || S.id !== id) return;
    clearFx();
    if (reduced()) return;
    const gl = useGL();
    if (id === 'battle') {
      if (gl) SV.proj.attack(attackEls(true));
    }
    if (STILL && id === 'summon') {
      const zone = $('[data-z="y-m3"]');
      if (gl) SV.proj.summon({ zoneEl: zone, still: true, at: 0.8 });
      else cssSummon(zone, true);
    }
    if (STILL && id === 'damage') {
      const card = $('[data-z="o-m3"] .fc');
      if (card) {
        if (gl) SV.proj.shatter({ cardEl: card, still: true, at: 0.24 });
        else cssShatter(card, true);
      }
    }
  }
  function attackEls(still) {
    return { fromZone: $('[data-z="y-m3"]'), toZone: $('[data-z="o-m3"]'), fromCard: $('[data-z="y-m3"] .fc'), toCard: $('[data-z="o-m3"] .fc'), still };
  }

  function fly(src, from, to, dur = 320) {
    const el = document.createElement('div');
    el.className = 'fly';
    el.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;background-image:url(${src})`;
    document.body.appendChild(el);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const sx = to.width / from.width, sy = to.height / from.height;
    const anim = el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1, offset: 0.8 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
    );
    // bounded: never let a moment wait on an animation event that may not fire
    return Promise.race([anim.finished, sleep(dur + 40)]).then(() => el.remove(), () => el.remove());
  }

  /* CSS-only projection fallback (no WebGL): rings, cone and a scanline art card. */
  function cssSummon(zone, peak) {
    const r = zone.getBoundingClientRect();
    const s = Math.min(r.width, r.height);
    const bw = Math.max(70, Math.min(250, s * 1.62));
    const el = document.createElement('div');
    el.className = `cssproj ${peak ? 'still' : 'play'}`;
    el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    el.innerHTML = `${[1, 1.26, 1.56].map((f) => `<span class="ring" style="width:${s * f}px;height:${s * f * 0.94}px"></span>`).join('')}
      <span class="beam" style="width:${bw}px;height:${s * 0.64 + bw}px"></span>
      <span class="art" style="width:${bw}px;height:${bw}px;bottom:${r.height / 2 + s * 0.64}px;background-image:url(${ART(C.DM)});background-size:172% auto;background-position:50% 31%"></span>`;
    $('#fx').appendChild(el);
    return sleep(1100).then(() => { if (!peak) el.remove(); });
  }
  function cssShatter(card, peak) {
    const r = card.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = `cssshards ${peak ? 'still' : 'play'}`;
    const cols = 3, rows = 4;
    let h = '';
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const w = r.width / cols, hh = r.height / rows;
        const cx = (i + 0.5) / cols - 0.5, cy = (j + 0.5) / rows - 1;
        const dx = cx * 260 + ((i * 37 + j * 11) % 40) - 20, dy = cy * 200 - 40;
        const rot = ((i * 53 + j * 29) % 120) - 60;
        const clip = (i + j) % 2 ? 'polygon(0 0,100% 8%,92% 100%,6% 90%)' : 'polygon(8% 4%,100% 0,100% 94%,0 100%)';
        h += `<span class="cssshard" style="left:${r.left + i * w}px;top:${r.top + j * hh}px;width:${w}px;height:${hh}px;background-image:url(${ART(C.OX)});background-size:${r.width}px ${r.height}px;background-position:${-i * w}px ${-j * hh}px;clip-path:${clip};--dx:${dx}px;--dy:${dy}px;--rot:${rot}deg"></span>`;
      }
    }
    wrap.innerHTML = h;
    $('#fx').appendChild(wrap);
    return sleep(800).then(() => { if (!peak) wrap.remove(); });
  }

  function rollLP(seat, from, to, kind, dur = 700) {
    const el = $(`#lp-${seat}`);
    if (!el) return Promise.resolve();
    el.classList.add(kind === 'cost' ? 'hit-cost' : 'hit-dmg');
    if (reduced()) { el.textContent = to; return Promise.resolve(); }
    return new Promise((res) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
    });
  }
  function bignum(kind) {
    const pos = kind === 'cost' ? { a: '#plate-you', at: 'top', ma: '[data-z="y-s3"]' } : { a: '#plate-opp', at: 'bottom', ma: '[data-z="o-s3"]' };
    const el = document.createElement('div');
    el.className = `bignum ${kind} enter-rise`;
    el.dataset.anchor = pos.a; el.dataset.at = pos.at; el.dataset.gap = '4';
    el.dataset.mAnchor = pos.ma; el.dataset.mAt = 'center';
    el.innerHTML = kind === 'cost' ? '−4000<small>LP paid · Solemn Judgment</small>' : '−800<small>battle damage</small>';
    $('#overlay').appendChild(el);
    positionOverlay();
    return el;
  }

  /* ------------------------------------------------------------ entries (animated transitions into each state) */
  async function doNormalSummon(my) {
    renderState('m1', { set: { menu: null, sel: null } });
    const from = $(`[data-hand="${C.CG}"]`).getBoundingClientRect();
    renderState('m1b', { set: { hide: ['y-m2'] } });
    const card = $('[data-z="y-m2"] .fc');
    if (!reduced()) {
      await fly(ART(C.CG), from, card.getBoundingClientRect(), 300);
      if (!alive(my)) return;
      if (useGL()) SV.proj.ring({ el: $('[data-z="y-m2"]') });
    }
    card.classList.remove('hidden-for-fx');
    if (reduced()) $('[data-z="y-m2"]').classList.add('ring-flash');
  }

  const ENTER = {
    async m1() {
      renderState('m1', { set: { enter: true } });
    },
    async summon(my) {
      renderState('m1b', { set: { hide: [] } });
      await sleep(260);
      if (!alive(my)) return;
      const cut = SET.cutin === 'every' || !cutinPlayed;
      renderState('summon', { set: { hide: ['y-m3'] }, mutate: (b) => { b.you.dm.status = 'dmz'; } });
      const zone = $('[data-z="y-m3"]');
      const card = $('.fc', zone);
      const dockArt = isMobile() ? $('#railYou .dm-chip img') : $('#dockArt-you img');
      const from = dockArt.getBoundingClientRect();
      // the Deck Master leaves the dock: status flips to On field
      S.b.you.dm.status = 'field';
      renderDocks(S.b, S.ui);
      renderRails(S.b, S.ui);
      const st = $('#dmStatus-you');
      if (st) st.classList.add('flash');
      if (reduced() || !cut) {
        card.classList.remove('hidden-for-fx');
        zone.classList.add('ring-flash');
        return;
      }
      momentOn(true);
      const flying = fly(ART(C.DM), from, card.getBoundingClientRect(), 340);
      let done;
      if (useGL()) {
        const h = SV.proj.summon({ zoneEl: zone, onSettle: () => card.classList.remove('hidden-for-fx') });
        done = h.done;
      } else {
        setTimeout(() => card.classList.remove('hidden-for-fx'), 900);
        done = cssSummon(zone, false);
      }
      await Promise.all([done, flying]);
      cutinPlayed = true;
      if (!alive(my)) return;
      momentOn(false);
      renderState('summon');
    },
    async battle(my) {
      renderState('battle', { set: { enter: true } });
      if (reduced() || !SV.proj) return;
      await SV.proj.ready;
      if (!alive(my)) return;
      if (useGL()) {
        momentOn(true);
        await SV.proj.attack(attackEls(false)).done;
        if (alive(my)) momentOn(false);
      }
    },
    async chain(my) {
      renderState('chain', { set: { enter: true, cd: CD_TOTAL } });
      const bom = $('[data-z="o-s2"] .fc');
      if (bom && !reduced()) bom.classList.add('enter-flip');
      startCountdown(my);
      if (useGL()) await SV.proj.ring({ el: $('[data-z="o-s2"]') }).done;
    },
    async damage(my) {
      // Chain Link 2 activates; its cost is paid at once.
      renderState('chain', {
        set: { chain: 'activated', legalField: [], cd: null, fxCard: null, path: 'dim' },
        mutate: (b) => { b.you.s[1] = { id: C.SJ, face: 'up', link: 2 }; b.log.push({ t: 'Sulman activates Solemn Judgment (Chain Link 2) and pays 4000 LP.', who: 'you' }); },
      });
      const sj = $('[data-z="y-s2"] .fc');
      if (sj && !reduced()) sj.classList.add('enter-flip');
      if (useGL()) SV.proj.ring({ el: $('[data-z="y-s2"]'), color: 'purple' });
      momentOn(true);
      if (!reduced()) bignum('cost');
      await rollLP('you', 8000, 4000, 'cost');
      await sleep(reduced() ? 150 : 420);
      if (!alive(my)) return;
      // Link 2 resolves: Book of Moon is negated and destroyed. Link 1 does nothing.
      renderState('chain', {
        set: { chain: 'negating', legalField: [], cd: null, path: 'dim' },
        mutate: (b) => { b.you.s[1] = { id: C.SJ, face: 'up', link: 2 }; b.you.lp = 4000; b.opp.s[1] = null; b.opp.gy = [C.BOM]; },
      });
      $('#lp-you').classList.add('hit-cost');
      if (useGL()) SV.proj.ring({ el: $('[data-z="o-s2"]') });
      await sleep(reduced() ? 150 : 650);
      if (!alive(my)) return;
      // The attack continues: projection re-lights, Battle Ox shatters, Practice Bot takes 800.
      renderState('battle', {
        set: { attacker: 'y-m3', target: 'o-m3', chain: 'done', path: 'live', preview: false, offers: [], next: 'Damage step' },
        board: 'damage',
        mutate: (b) => { b.opp.m[2] = { id: C.OX, face: 'up', pos: 'atk' }; b.opp.gy = [C.BOM]; b.opp.lp = 8000; b.log.splice(-2); },
      });
      let beam = null;
      if (useGL()) {
        beam = SV.proj.attack(attackEls(false));
        await beam.done;
        if (!alive(my)) return;
      }
      const ox = $('[data-z="o-m3"] .fc');
      let shards;
      if (!reduced() && ox) {
        if (beam) beam.remove();
        shards = useGL() ? SV.proj.shatter({ cardEl: ox }).done : cssShatter(ox, false);
        ox.classList.add('hidden-for-fx');
      }
      bignum('dmg');
      const plate = $('#plate-opp');
      if (plate) plate.classList.add('shake');
      await Promise.all([rollLP('opp', 8000, 7200, 'dmg'), shards]);
      if (!alive(my)) return;
      momentOn(false);
      renderState('damage');
    },
    async m2(my) {
      renderState('m2', { set: { enter: true, placeFocus: false } });
      $$('.zone.place').forEach((z, i) => { if (!reduced()) z.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 260, delay: i * 50, easing: 'ease-out', fill: 'backwards' }); });
    },
    async end(my) {
      renderState('m2p', { set: { offers: [], next: 'End Phase' }, mutate: (b) => { b.phase = 'EP'; b.log.push({ t: 'End Phase.' }); } });
      await sleep(reduced() ? 60 : 420);
      if (!alive(my)) return;
      if (useGL()) {
        const plane = $('#plane').getBoundingClientRect();
        const zones = ['y-m2', 'y-m3'].map((z) => $(`[data-z="${z}"]`));
        const band = $('[data-z="emz-l"]').getBoundingClientRect();
        momentOn(true);
        SV.proj.powerDown({ zoneEls: zones, fromY: band.top + band.height / 2, toY: plane.bottom - 6, left: plane.left + 10, right: plane.right - 10 });
      }
      renderState('end', { set: { enter: true } });
      await sleep(reduced() ? 0 : 900);
      if (alive(my)) momentOn(false);
    },
  };

  let cdTimer = 0;
  function startCountdown(my) {
    clearInterval(cdTimer);
    if (STILL) return;
    let sec = CD_TOTAL;
    const c = 2 * Math.PI * 19;
    cdTimer = setInterval(() => {
      if (!alive(my) || S.id !== 'chain') return clearInterval(cdTimer);
      sec = Math.max(0, sec - 1);
      $$('#cdN, #cdM .cdn').forEach((n) => (n.textContent = sec));
      $$('#cdFg, #cdM .fg').forEach((fg) => (fg.style.strokeDashoffset = (c * (1 - sec / CD_TOTAL)).toFixed(2)));
      $('#cd') && $('#cd').setAttribute('aria-label', `${sec} seconds left to respond`);
      if (sec === 0) {
        clearInterval(cdTimer);
        toast('Response time is over. In a real duel the engine passes for you.');
      }
    }, 1000);
  }

  /* ------------------------------------------------------------ navigation */
  async function go(id, { animate = !STILL } = {}) {
    if (!UI[id]) id = 'm1';
    const my = ++token;
    clearInterval(cdTimer);
    momentOn(false);
    clearFx();
    closeSheets();
    cur = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
    $$('#devSteps button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.state === id)));
    if (!animate) {
      renderState(id);
      await staticFx(id);
      return;
    }
    try {
      await ENTER[id](my);
    } catch (e) {
      console.error(e);
    }
    if (alive(my)) {
      momentOn(false);
      if (S.id !== id && !(id === 'm2' && S.id === 'm2p')) renderState(id);
      await staticFx(S.id === 'm2p' ? 'm2p' : id); // battle redraws its frozen beam; others clear
    }
  }
  function skip() {
    if (!inMoment) return false;
    const id = cur;
    token++;
    momentOn(false);
    if (SV.proj && SV.proj.available) SV.proj.skipAll();
    clearFx();
    if (id === 'summon') cutinPlayed = true;
    renderState(id);
    staticFx(id);
    return true;
  }

  /* ------------------------------------------------------------ demo walkthrough */
  const demo = { run: null };
  async function playDemo() {
    const btn = $('#devPlay');
    if (demo.run) {
      demo.run = null;
      btn.textContent = 'Play demo';
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    const d = (demo.run = {});
    const on = () => demo.run === d;
    btn.textContent = 'Stop demo';
    btn.setAttribute('aria-pressed', 'true');
    const hold = async (ms) => { await sleep(ms); return on(); };
    cutinPlayed = false;
    SV.stChoice = 2;
    CLOCK.you = 192; CLOCK.opp = 238;
    try {
      await go('m1');
      if (!(await hold(1700))) return;
      const my = token;
      await doNormalSummon(my);
      if (!(await hold(900))) return;
      pulse('[data-act="dm-ss"]');
      if (!(await hold(700))) return;
      await go('summon');
      if (!(await hold(1100))) return;
      pulse('[data-ph="BP"]');
      if (!(await hold(450))) return;
      await go('battle');
      if (!(await hold(1700))) return;
      pulse('[data-act="attack"]');
      if (!(await hold(400))) return;
      await go('chain');
      if (!(await hold(2300))) return;
      pulse('[data-act="activate"]');
      if (!(await hold(400))) return;
      await go('damage');
      if (!(await hold(1700))) return;
      pulse('[data-ph="M2"]');
      if (!(await hold(400))) return;
      await go('m2');
      if (!(await hold(800))) return;
      setPlaceFocus(2);
      if (!(await hold(900))) return;
      await place(2);
      if (!(await hold(900))) return;
      pulse('[data-ph="EP"]');
      if (!(await hold(400))) return;
      await go('end');
      await hold(1500);
    } finally {
      if (demo.run === d) {
        demo.run = null;
        btn.textContent = 'Play demo';
        btn.setAttribute('aria-pressed', 'false');
      }
    }
  }
  function pulse(sel) {
    const el = $(sel);
    if (!el || reduced()) return;
    el.animate([{ boxShadow: '0 0 0 0 rgba(232,207,148,0.9)' }, { boxShadow: '0 0 0 10px rgba(232,207,148,0)' }], { duration: 420, easing: 'ease-out' });
  }

  /* ------------------------------------------------------------ interactions */
  function inspect(id, where) {
    if (!S.ui) return;
    S.ui = Object.assign({}, S.ui, { inspect: { id: +id, where: where || S.ui.inspect.where } });
    tab = 'card';
    renderInspector(S.b, S.ui);
    renderPeek(S.b, S.ui);
  }
  function whereOf(el) {
    const z = el.closest('[data-z]');
    const dock = el.closest('.dock');
    if (dock) return dock.classList.contains('mine') ? 'dmz' : 'odmz';
    if (!z) return 'hand';
    const id = z.dataset.z;
    if (WHERE[id]) return id;
    if (id === 'o-gy') return 'o-gy';
    if (/^y-s/.test(id)) return 'set';
    return id.startsWith('o') ? 'o-m3' : 'y-m3';
  }
  async function place(idx) {
    if (S.id !== 'm2') return;
    SV.stChoice = idx;
    token++;
    clearFx();
    renderState('m2p');
    const zone = $(`[data-z="y-s${idx + 1}"]`);
    if (useGL()) SV.proj.ring({ el: zone });
    else if (!reduced()) zone.classList.add('ring-flash');
  }
  function setPlaceFocus(idx) {
    $$('.zone.place').forEach((z) => {
      const on = +z.dataset.place === idx;
      z.classList.toggle('focus', on);
      const g = $('.ghost', z);
      if (g) g.style.display = on ? '' : 'none';
    });
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function act(a, el) {
    switch (a) {
      case 'ns':
        if (+el.dataset.card === C.CG) { const my = ++token; closeMenu(); doNormalSummon(my); }
        else toast('This prototype scripts the Normal Summon of Celtic Guardian.');
        break;
      case 'set':
      case 'act':
        toast('This prototype scripts Normal Summon here. Set and Activate are menu examples.');
        break;
      case 'dm-ss':
        go('summon');
        break;
      case 'attack':
        go('chain');
        break;
      case 'activate':
        go('damage');
        break;
      case 'pass':
        toast('The scripted demo follows Activate. On Pass, Book of Moon would resolve.');
        break;
      case 'cancel-place':
        cancelPlace();
        break;
    }
  }
  function cancelPlace() {
    if (S.id !== 'm2' || !S.ui.place) return;
    renderState('m2', {
      set: { place: false, legalHand: [C.FIS, C.TH], inspect: { id: C.TH, where: 'hand' }, next: 'Select Trap Hole to Set it again' },
      mutate: (b) => { b.you.hand = [C.BW, C.FIS, C.TH, C.SF]; b.placing = null; },
    });
  }
  function closeMenu() {
    const m = $('#overlay .amenu');
    if (m) m.remove();
  }

  document.addEventListener(
    'click',
    (e) => {
      if (inMoment) {
        e.preventDefault();
        e.stopPropagation();
        skip();
      }
    },
    true
  );
  document.addEventListener('click', (e) => {
    const t = e.target;
    const opts = $('#options');
    if (opts.classList.contains('open') && !t.closest('#options') && !t.closest('#tGear')) closeOptions();

    const actEl = t.closest('[data-act]');
    if (actEl) return act(actEl.dataset.act, actEl);
    const step = t.closest('#devSteps button');
    if (step) return go(step.dataset.state);
    if (t.closest('#devPlay')) return playDemo();
    const ph = t.closest('#pbTrack button.offer');
    if (ph) {
      const p = ph.dataset.ph;
      if (p === 'BP') return go('battle');
      if (p === 'M2') return go('m2');
      if (p === 'EP') return go('end');
      return;
    }
    const tb = t.closest('[data-tab]');
    if (tb && tb.closest('#insp')) {
      tab = tb.dataset.tab;
      return renderInspector(S.b, S.ui);
    }
    const sh = t.closest('[data-sheet]');
    if (sh) {
      if (sh.dataset.tab) tab = sh.dataset.tab;
      renderInspector(S.b, S.ui);
      return openSheet(sh.dataset.sheet);
    }
    if (t.closest('[data-close]') || t.closest('#scrim')) return closeSheets();
    const pl = t.closest('[data-place]');
    if (pl) return place(+pl.dataset.place);
    const hc = t.closest('[data-hand]');
    if (hc) {
      const id = +hc.dataset.hand;
      if (S.ui.quiet) return inspect(id, 'hand');
      if (S.id === 'm2' && !S.ui.place && id === C.TH) return go('m2');
      if (S.id === 'm1') {
        S.ui = Object.assign({}, S.ui, { sel: id, menu: id, inspect: { id, where: 'hand' }, enter: true });
        renderRails(S.b, S.ui);
        renderOverlay(S.b, S.ui);
        renderInspector(S.b, S.ui);
        renderPeek(S.b, S.ui);
        relayout();
        const first = $('#overlay .amenu button');
        if (first && e.detail === 0) first.focus();
        return;
      }
      return inspect(id, 'hand');
    }
    const fc = t.closest('.fc[data-card]');
    if (fc) {
      const z = fc.dataset.zone;
      if (S.id === 'battle' && z === 'o-m3') return go('chain');
      if (S.id === 'chain' && z === 'y-s2') { const b = $('[data-act="activate"]'); if (b) b.focus(); return inspect(C.SJ, 'set'); }
      return inspect(fc.dataset.card, whereOf(fc));
    }
    const ins = t.closest('[data-inspect]');
    if (ins) return inspect(ins.dataset.inspect, whereOf(ins));
    if (t.closest('#tMotion')) { SET.motion = reduced() ? 'full' : 'reduced'; applySettings(); return rerender(); }
    if (t.closest('#tSound')) { SET.sound = SET.sound === 'On' ? 'Off' : 'On'; return applySettings(); }
    if (t.closest('#tChain')) { SET.chain = { Auto: 'On', On: 'Off', Off: 'Auto' }[SET.chain]; return applySettings(); }
    if (t.closest('#tView')) return toggleView();
    if (t.closest('#tGear')) return opts.classList.contains('open') ? closeOptions() : openOptions();
    const seg = t.closest('.seg button');
    if (seg) {
      const k = seg.parentElement.dataset.opt, v = seg.dataset.v;
      if (k === 'view') { if (SET.view !== v) toggleView(); return; }
      SET[k] = v;
      applySettings();
      if (k === 'motion') rerender();
      return;
    }
    // click outside a menu closes it (m1)
    if (S.id === 'm1' && S.ui.menu && !t.closest('.amenu') && !t.closest('.devstrip')) {
      S.ui = Object.assign({}, S.ui, { menu: null, sel: null });
      renderRails(S.b, S.ui);
      renderOverlay(S.b, S.ui);
    }
  });

  // hover / focus on legal placement zones moves the ghost
  document.addEventListener('pointerover', (e) => {
    const pl = e.target.closest && e.target.closest('[data-place]');
    if (pl) setPlaceFocus(+pl.dataset.place);
  });
  document.addEventListener('focusin', (e) => {
    const pl = e.target.closest && e.target.closest('[data-place]');
    if (pl) setPlaceFocus(+pl.dataset.place);
  });

  // drag-to-attack (plus click on the target or the Attack button)
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    if (S.id !== 'battle' || inMoment) return;
    const fc = e.target.closest('[data-z="y-m3"] .fc');
    if (!fc) return;
    const r = fc.getBoundingClientRect();
    drag = { x0: r.left + r.width / 2, y0: r.top, moved: false };
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'dragline');
    s.innerHTML = '<path d=""/>';
    document.body.appendChild(s);
    drag.svg = s;
    fc.setPointerCapture && fc.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.moved = drag.moved || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8;
    const mx = (drag.x0 + e.clientX) / 2 + 40, my = (drag.y0 + e.clientY) / 2;
    $('path', drag.svg).setAttribute('d', `M${drag.x0} ${drag.y0} Q${mx} ${my} ${e.clientX} ${e.clientY}`);
    const over = document.elementFromPoint(e.clientX, e.clientY);
    $$('[data-z="o-m3"]').forEach((z) => z.classList.toggle('place', !!(over && over.closest('[data-z="o-m3"]'))));
  });
  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.svg.remove();
    const over = document.elementFromPoint(e.clientX, e.clientY);
    $$('[data-z="o-m3"]').forEach((z) => z.classList.remove('place'));
    if (d.moved && over && over.closest('[data-z="o-m3"]')) go('chain');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, textarea')) return;
    const k = e.key;
    if ((k === ' ' || k === 'Escape') && inMoment) {
      e.preventDefault();
      skip();
      return;
    }
    if (/^[1-7]$/.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      go(STATES[+k - 1]);
      return;
    }
    if (k === 'h' || k === 'H') {
      root.dataset.strip = root.dataset.strip === 'hidden' ? '' : 'hidden';
      setTimeout(relayoutAll, 30);
      return;
    }
    if (k === 'Escape') {
      if ($('#options').classList.contains('open')) return closeOptions();
      if (document.body.dataset.sheet) return closeSheets();
      if (S.id === 'chain') return act('pass');
      if (S.id === 'm2' && S.ui.place) return cancelPlace();
      if (S.id === 'm1' && S.ui.menu) {
        const id = S.ui.menu;
        S.ui = Object.assign({}, S.ui, { menu: null, sel: null });
        renderRails(S.b, S.ui);
        renderOverlay(S.b, S.ui);
        const h = $(`[data-hand="${id}"]`);
        if (h) h.focus();
      }
      return;
    }
    if (k === 'Enter' && S.id === 'battle' && !e.target.closest('button')) return go('chain');
    const menu = e.target.closest && e.target.closest('.amenu');
    if (menu && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      const items = $$('button', menu);
      const i = items.indexOf(e.target);
      items[(i + (k === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
    if (S.id === 'm1' && S.ui.menu && (k === 'n' || k === 'N')) act('ns', { dataset: { card: S.ui.menu } });
  });

  /* ------------------------------------------------------------ settings UI, sheets, view */
  function renderOptions() {
    const seg = (k, opts) => `<div class="seg" data-opt="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${SET[k] === v}">${l}</button>`).join('')}</div>`;
    $('#options').innerHTML = `<h2>Options</h2>
      <div class="opt-row"><span>Chain responses</span>${seg('chain', [['Auto', 'Auto'], ['On', 'On'], ['Off', 'Off']])}</div>
      <div class="opt-row"><span>Motion</span>${seg('motion', [['full', 'Full'], ['reduced', 'Reduced']])}</div>
      <div class="opt-row"><span>Summon cut-in</span>${seg('cutin', [['every', 'Every time'], ['once', 'Once per duel']])}</div>
      <div class="opt-row"><span>Board view</span>${seg('view', [['tilt', 'Tilt'], ['flat', 'Flat']])}</div>
      <div class="opt-row"><span>Sound</span>${seg('sound', [['On', 'On'], ['Off', 'Off']])}</div>
      <div class="opt-foot"><button class="btn" type="button">Copy invite</button><button class="btn danger" type="button">Surrender</button></div>`;
  }
  function openOptions() {
    const g = $('#tGear').getBoundingClientRect();
    const o = $('#options');
    o.classList.add('open');
    o.style.top = `${g.bottom + 8}px`;
    o.style.left = `${Math.max(8, g.right - o.offsetWidth)}px`;
    $('#tGear').setAttribute('aria-expanded', 'true');
    const f = $('button', o);
    if (f) f.focus();
  }
  function closeOptions() {
    $('#options').classList.remove('open');
    $('#tGear').setAttribute('aria-expanded', 'false');
  }
  function openSheet(name) {
    if (!isMobile()) return;
    document.body.dataset.sheet = name;
    document.body.classList.add('sheet-open');
  }
  function closeSheets() {
    delete document.body.dataset.sheet;
    document.body.classList.remove('sheet-open');
  }
  function toggleView() {
    SET.view = SET.view === 'flat' ? 'tilt' : 'flat';
    applySettings();
    clearFx();
    const t0 = performance.now();
    const follow = (now) => {
      relayout();
      if (now - t0 < 650) requestAnimationFrame(follow);
      else staticFx(S.id);
    };
    requestAnimationFrame(follow);
  }
  function rerender() {
    token++;
    momentOn(false);
    clearFx();
    renderState(S.id === 'm2p' ? 'm2p' : cur || 'm1');
    staticFx(cur);
  }
  let rT = 0;
  function relayoutAll() {
    SV.tiltDeg = parseFloat(getComputedStyle(root).getPropertyValue('--tilt')) || 0;
    relayout();
    clearTimeout(rT);
    if (STILL) staticFx(S.id); // redraw the projection frame for the new viewport at once
    else rT = setTimeout(() => { if (!inMoment) staticFx(S.id); }, 160);
  }
  addEventListener('resize', relayoutAll);
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id !== cur && UI[id]) go(id);
  });
  prefersReduced.addEventListener && prefersReduced.addEventListener('change', (e) => { SET.motion = e.matches ? 'reduced' : 'full'; applySettings(); rerender(); });

  // live turn clocks (paused during moments: animation time is not charged)
  if (!STILL) {
    setInterval(() => {
      if (inMoment || !S.b) return;
      const seat = S.b.acting;
      CLOCK[seat] = Math.max(0, CLOCK[seat] - 1);
      S.b[seat].time = CLOCK[seat];
      const c = $(`#clk-${seat}`);
      if (!c) return;
      $('.t', c).textContent = fmt(CLOCK[seat]);
      const fg = $('.ring-fg', c);
      const circ = 2 * Math.PI * 7;
      if (fg) fg.setAttribute('stroke-dashoffset', (circ * (1 - CLOCK[seat] / 240)).toFixed(2));
    }, 1000);
  }

  /* ------------------------------------------------------------ boot */
  function boot() {
    $('#devSteps').innerHTML = STATES.map((s, i) => `<button type="button" data-state="${s}" aria-current="false" title="${LABEL[s]} (key ${i + 1})">${i + 1}<span class="lbl"> ${LABEL[s]}</span></button>`).join('');
    $('#tGear').innerHTML = svg('gear');
    applySettings();
    const first = (location.hash || '#m1').slice(1);
    const id = UI[first] && STATES.includes(first) ? first : 'm1';
    renderState(id);
    if (SV.proj) {
      SV.proj.ready.then((ok) => {
        $('#devGl').textContent = ok ? 'WebGL: on' : `WebGL: off (CSS fallback${SV.proj.error ? ': ' + SV.proj.error : ''})`;
        root.dataset.fx = useGL() ? 'gl' : 'css';
      });
    }
    const start = () => {
      if (STILL) go(id, { animate: false });
      else go(id, { animate: id !== 'm1' });
    };
    const fontWait = document.fonts ? Promise.race([document.fonts.ready, sleep(1500)]) : Promise.resolve();
    const glWait = SV.proj ? Promise.race([SV.proj.ready, sleep(2500)]) : Promise.resolve();
    Promise.all([fontWait, glWait]).then(() => {
      applySettings();
      if (Q.has('demo') && !STILL) playDemo();
      else start();
    });
  }
  boot();
})();

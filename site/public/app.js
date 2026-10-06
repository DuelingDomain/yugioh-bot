/* Dueling Domain marketing page. No dependencies, no build step. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;
  // Enhance the complete static page only after this deferred script loads.
  root.classList.add('js');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('rm');
  var isRM = function () { return root.classList.contains('rm'); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var narrow = window.matchMedia('(max-width: 900px)');
  var startedAt = Date.now();

  /* ---------- reduced motion: follows the system setting only ---------- */
  var mqRM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function setRM(v) { root.classList.toggle('rm', v); }
  if (mqRM.addEventListener) mqRM.addEventListener('change', function (e) { setRM(e.matches); });

  /* ---------- gold dust in the hero ---------- */
  (function dust() {
    var host = $('#dust'), seed = 11, html = '';
    function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 20; i++) {
      html += '<i style="left:' + (narrow.matches ? 6 + r() * 88 : 48 + r() * 48).toFixed(1) + '%;top:' + (35 + r() * 62).toFixed(1) +
        '%;--d:' + (8 + r() * 8).toFixed(1) + 's;--dl:-' + (r() * 12).toFixed(1) + 's"></i>';
    }
    host.innerHTML = html;
  })();

  /* ---------- the email form (two copies, one state) ---------- */
  /* status: idle | sending | joined | exists | invalid | limited | error */
  var API = '/api/waitlist';
  var state = { status: 'idle', value: '', error: '' };
  var claims = [], active = null, inflight = 0;
  var DEFAULT_MSG = 'Email only. One pack per email.';
  var MSG = {
    limited: 'Too many tries. Try again in a few minutes.',
    error: "Couldn't reach the list. Try again."
  };
  var DONE = {
    joined: ["You're on the list.", "We'll email your invite and a sign-in link when your wave opens."],
    exists: ['Already on the list.', "One pack per email, and yours is already sealed. We'll email your invite and a sign-in link when your wave opens."]
  };

  function validEmail(v) { return v.length > 0 && v.length <= 254 && /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@.]+$/.test(v); }
  function errorFor(v) { return v.trim() ? "That doesn't look like an email. Check it and try again." : 'Enter your email to claim a pack.'; }

  $$('[data-claim]').forEach(function (el) {
    claims.push({
      key: el.getAttribute('data-claim'), el: el, form: $('form', el), input: $('input[name="email"]', el),
      source: $('input[name="source"]', el), hp: $('input[name="company"]', el), msg: $('[data-msg]', el),
      btn: $('.btn', el), btnLabel: $('.btn-label', el), live: $('[data-live]', el),
      doneT: $('[data-done-t]', el), doneS: $('[data-done-s]', el)
    });
  });

  function messageFor(s) { return s === 'invalid' ? (state.error || errorFor(state.value)) : (MSG[s] || DEFAULT_MSG); }

  function render() {
    var s = state.status, text = messageFor(s);
    claims.forEach(function (c) {
      c.el.dataset.state = s;
      c.el.classList.toggle('has-value', !!c.input.value);
      c.btn.disabled = s === 'sending';
      c.btn.setAttribute('aria-busy', String(s === 'sending'));
      c.btnLabel.textContent = s === 'sending' ? 'Sending…' : 'Claim your alpha pack';
      if (s === 'invalid' || s === 'limited' || s === 'error') c.input.setAttribute('aria-invalid', 'true'); else c.input.removeAttribute('aria-invalid');
      c.msg.textContent = text;
      if (DONE[s]) { c.doneT.textContent = DONE[s][0]; c.doneS.textContent = DONE[s][1]; }
      // announce once, from the form the visitor used
      var say = '';
      if (c === active) {
        if (s === 'sending') say = 'Sending.';
        else if (DONE[s]) say = DONE[s][0] + ' ' + DONE[s][1];
        else if (s === 'invalid' || s === 'limited' || s === 'error') say = text;
      }
      c.live.textContent = say;
    });
  }
  function setStatus(s) { state.status = s; if (s !== 'invalid') state.error = ''; render(); }

  function post(c, email) {
    var ticket = ++inflight;
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    setStatus('sending');
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: email, source: c.source.value === 'footer' ? 'footer' : 'hero', company: c.hp.value || '' }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) { return { status: res.status, body: body }; });
    }).then(function (r) {
      if (ticket !== inflight) return;
      var b = r.body || {};
      if (r.status === 201 && b.status === 'joined') { setStatus('joined'); openAll(); }
      else if (r.status === 200 && b.status === 'exists') { setStatus('exists'); }
      else if (r.status === 400 && b.error === 'invalid_email') { state.error = errorFor(email); state.status = 'invalid'; render(); c.input.focus(); }
      else if (r.status === 429) { setStatus('limited'); }
      else { setStatus('error'); }
    }).catch(function () {
      if (ticket !== inflight) return;
      setStatus('error');
    }).then(function () { clearTimeout(timer); });
  }

  claims.forEach(function (c) {
    c.input.addEventListener('input', function () {
      state.value = c.input.value;
      claims.forEach(function (o) { if (o !== c) o.input.value = state.value; });
      if (state.status === 'limited' || state.status === 'error' || (state.status === 'invalid' && validEmail(state.value.trim()))) state.status = 'idle';
      render();
    });
    c.form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.status === 'sending') return;
      active = c;
      var v = (c.input.value || '').trim();
      state.value = v;
      claims.forEach(function (o) { o.input.value = v; });
      if (!validEmail(v)) { state.error = errorFor(v); state.status = 'invalid'; render(); c.input.focus(); return; }
      post(c, v);
    });
    $('[data-again]', c.el).addEventListener('click', function () {
      active = c; state.value = ''; claims.forEach(function (o) { o.input.value = ''; });
      setStatus('idle'); c.input.focus();
    });
  });
  render();

  /* ---------- packs ---------- */
  var packs = [];
  function buildPack(mount, role) {
    var p = { role: role, mount: mount, el: $('.pack', mount), tilt: $('.pack-tilt', mount), open: false, markDone: false, sx: 0, sy: 0 };
    if (role === 'final') p.el.classList.add('pack--sm');
    packs.push(p); return p;
  }
  var heroPack = buildPack($('#heroPack'), 'hero');
  var finalPack = buildPack($('#finalPack'), 'final');
  var stage = $('.hero-stage');
  var grid = $('#fgrid');
  var dealt = false;

  /* The logo mark plays its entrance when a pack opens. If that pack is off screen, it waits until it is seen. */
  function playMark(p) {
    if (p.markDone || isRM()) return;
    function go() { if (p.markDone) return; p.markDone = true; p.el.classList.add('mark-play'); }
    if (!('IntersectionObserver' in window)) { go(); return; }
    var mio = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { mio.disconnect(); go(); }
    }, { threshold: 0.5 });
    mio.observe(p.el);
  }

  function openPack(p, instant) {
    if (p.open) return;
    p.open = true;
    if (instant) p.el.classList.add('instant', 'gave'); else playMark(p);
    p.el.classList.add('is-open');
    p.mount.classList.add('is-done');
    if (p === heroPack) {
      stage.classList.add('is-opened');
      p.mount.setAttribute('aria-label', 'Pack opened. Your five cards are below.');
    }
  }
  function openAll(instant) { openPack(heroPack, instant); openPack(finalPack, instant); if (instant) deal(heroPack, true); }

  function deal(fromPack, instant) {
    if (dealt) return;
    dealt = true;
    var cards = $$('.fcard', grid);
    if (instant || isRM()) { grid.classList.add('is-dealt'); fromPack.el.classList.add('gave'); return; }
    var pr = fromPack.el.getBoundingClientRect();
    var sx = pr.left + pr.width / 2, sy = pr.top + pr.height * 0.06;
    var rects = cards.map(function (c) { return c.getBoundingClientRect(); });
    grid.classList.add('is-dealt');
    cards.forEach(function (c, i) {
      var r = rects[i];
      var dx = sx - (r.left + r.width / 2), dy = sy - (r.top + r.height / 2);
      if (narrow.matches) { dx = 0; dy = clamp(dy, -320, 0); }
      var rot = (i - (cards.length - 1) / 2) * 9;
      var a = c.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.28) rotate(' + rot + 'deg)', opacity: 0 },
        { opacity: 1, offset: 0.18 },
        { transform: 'none', opacity: 1 }
      ], { duration: 700, delay: i * 75, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'both' });
      a.onfinish = function () { a.cancel(); };
    });
    setTimeout(function () { fromPack.el.classList.add('gave'); }, 120);
  }

  var featuresEl = $('#cards');
  function ripFromHero(withScroll, instant) {
    var already = heroPack.open;
    openPack(heroPack, instant);
    if (instant) deal(heroPack, true);
    else setTimeout(function () { deal(heroPack); }, isRM() ? 0 : (already ? 0 : 380));
    if (withScroll) {
      setTimeout(function () {
        featuresEl.scrollIntoView({ behavior: isRM() ? 'auto' : 'smooth', block: 'start' });
      }, isRM() ? 0 : 260);
    }
  }
  heroPack.mount.addEventListener('click', function (e) {
    e.preventDefault();
    if (heroPack.open && dealt) { featuresEl.scrollIntoView({ behavior: isRM() ? 'auto' : 'smooth', block: 'start' }); return; }
    ripFromHero(true);
  });
  heroPack.mount.addEventListener('keydown', function (e) {
    if (e.key === ' ') { e.preventDefault(); heroPack.mount.click(); }
  });
  finalPack.mount.addEventListener('click', function () { var c = claims[claims.length - 1]; if (c) c.input.focus(); });

  var heroEl = $('#hero');
  function pastHero() { return window.scrollY > heroEl.offsetHeight * 0.32; }
  function onScroll() {
    if (dealt && heroPack.open) return;
    if (!pastHero()) return;
    // A jump on arrival (restored scroll position, #join link) opens the pack with no show.
    ripFromHero(false, Date.now() - startedAt < 1200);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('load', function () { setTimeout(function () { if (pastHero() && !heroPack.open) ripFromHero(false, true); }, 80); });

  /* ---------- pack tilt toward the pointer (desktop) ---------- */
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var ptr = { x: 0, y: 0, active: false }, raf = 0;
  function tick() {
    raf = 0;
    var moving = false;
    packs.forEach(function (p) {
      var tx = 0, ty = 0;
      if (!isRM() && fine.matches) {
        var r = p.mount.getBoundingClientRect();
        if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
        if (ptr.active) {
          tx = clamp((ptr.x - (r.left + r.width / 2)) / (window.innerWidth * 0.38), -1, 1);
          ty = clamp((ptr.y - (r.top + r.height / 2)) / (window.innerHeight * 0.38), -1, 1);
        }
      }
      p.sx += (tx - p.sx) * 0.12; p.sy += (ty - p.sy) * 0.12;
      if (Math.abs(p.sx) < 0.001 && tx === 0) p.sx = 0;
      if (Math.abs(p.sy) < 0.001 && ty === 0) p.sy = 0;
      p.tilt.style.transform = 'rotateX(' + (-p.sy * 10).toFixed(2) + 'deg) rotateY(' + (p.sx * 10).toFixed(2) + 'deg)';
      p.el.style.setProperty('--sx', p.sx.toFixed(3)); p.el.style.setProperty('--sy', p.sy.toFixed(3));
      if (Math.abs(tx - p.sx) > 0.003 || Math.abs(ty - p.sy) > 0.003) moving = true;
    });
    if (moving) raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  window.addEventListener('pointermove', function (e) { if (e.pointerType !== 'mouse') return; ptr.x = e.clientX; ptr.y = e.clientY; ptr.active = true; kick(); }, { passive: true });
  document.addEventListener('pointerleave', function () { ptr.active = false; kick(); });

  /* ---------- feature card tilt and glint ---------- */
  $$('.fcard-in').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || isRM()) return;
      var r = c.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
      c.style.setProperty('--rx', ((0.5 - ny) * 9).toFixed(2) + 'deg');
      c.style.setProperty('--ry', ((nx - 0.5) * 11).toFixed(2) + 'deg');
      c.style.setProperty('--gx', ((nx - 0.5) * 66).toFixed(1) + '%');
    });
    c.addEventListener('pointerleave', function () {
      c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); c.style.removeProperty('--gx');
    });
  });

  /* mobile fan: position dots */
  var dots = $$('#fdots i'), slots = $$('.fslot', grid);
  function updateDots() {
    if (!narrow.matches) return;
    var mid = grid.scrollLeft + grid.clientWidth / 2, best = 0, bd = 1e9;
    slots.forEach(function (s, i) { var d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
    dots.forEach(function (d, i) { d.classList.toggle('on', i === best); });
  }
  grid.addEventListener('scroll', updateDots, { passive: true });

  /* ---------- reveal on scroll + flip the three step cards ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.15 }) : null;
  $$('.rv').forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); });

  var steps = $$('.step'), stepsEl = $('#steps'), flipped = false;
  function flipSequence() {
    if (flipped) return; flipped = true;
    steps.forEach(function (s, i) { setTimeout(function () { s.classList.add('is-up'); }, isRM() ? 0 : 250 + i * 480); });
  }
  if (io) {
    var sio = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { flipSequence(); sio.disconnect(); } }, { threshold: 0.5 });
    sio.observe(stepsEl);
  } else { flipSequence(); }
  steps.forEach(function (s) { s.addEventListener('click', function () { s.classList.toggle('is-up'); }); });

  /* ---------- trailer slot ---------- */
  var plate = $('#plate'), plateT = $('#plate-t'), plateS = $('#plate-s'), plateTimer = 0;
  $('#play').addEventListener('click', function () {
    plate.classList.remove('shake'); void plate.offsetWidth; if (!isRM()) plate.classList.add('shake');
    plateT.textContent = 'Not yet. Soon.'; plateS.textContent = 'The trailer is still being cut';
    clearTimeout(plateTimer);
    plateTimer = setTimeout(function () { plateT.textContent = 'Trailer: coming soon'; plateS.textContent = 'Reserved for the launch trailer'; }, 2200);
  });

  /* ---------- no-JS form fallback: the server redirects to /?waitlist=joined|exists|invalid|limited#join ---------- */
  (function fromRedirect() {
    var m = /[?&]waitlist=([a-z]+)/.exec(location.search);
    if (!m) return;
    var map = { joined: 'joined', exists: 'exists', invalid: 'invalid', limited: 'limited' };
    var s = map[m[1]];
    // Clean the URL once the browser has finished any #join scroll.
    var clean = function () { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } };
    if (document.readyState === 'complete') clean(); else window.addEventListener('load', function () { setTimeout(clean, 0); });
    if (!s) return;
    active = claims[claims.length - 1] || null;
    if (s === 'invalid') state.error = errorFor('');
    setStatus(s);
    if (s === 'joined' || s === 'exists') openAll(true);
  })();
})();

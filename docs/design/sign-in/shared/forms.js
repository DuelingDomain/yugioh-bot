/* Shared sign-in flow for the three mocks: screen copy, form markup, state switcher.
   URL: ?s=<screen>&shot=1 (shot hides the mock strip and prefills the focus states). */
(function () {
  var html = document.documentElement;
  var P = new URLSearchParams(location.search);
  var SHOT = P.has('shot');
  if (SHOT) html.classList.add('shot');
  var DD = window.DD = { email: 'sam@example.com', cur: null, hooks: [] };

  var JOIN = 'https://duelingdomain.com/#join';
  var PRIV = 'https://duelingdomain.com/privacy';
  var TERMS = 'https://duelingdomain.com/terms';

  var I = {
    discord: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 2.5 20h19Z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5 10 17.5 19 7"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  DD.icons = I;

  var em = '<span data-email>' + DD.email + '</span>';

  function pwField(id, label, opts) {
    opts = opts || {};
    var d = [];
    if (opts.err) d.push(id + '-err');
    if (opts.hint) d.push(id + '-hint');
    return '<div class="field' + (opts.err ? ' invalid' : '') + '"><label for="' + id + '">' + label + '</label>' +
      '<div class="input-wrap has-btn"><input id="' + id + '" name="' + (opts.name || 'password') + '" type="password" autocomplete="' + (opts.ac || 'current-password') + '"' +
      (opts.value ? ' value="' + opts.value + '"' : '') + (opts.err ? ' aria-invalid="true"' : '') + (d.length ? ' aria-describedby="' + d.join(' ') + '"' : '') + ' required>' +
      '<button type="button" class="reveal" aria-pressed="false" aria-controls="' + id + '" data-reveal><span>Show</span><span class="sr"> password</span></button></div>' +
      (opts.err ? '<p class="ferr" id="' + id + '-err" role="alert">' + I.warn + '<span>' + opts.err + '</span></p>' : '') +
      (opts.hint ? '<p class="hint" id="' + id + '-hint">' + opts.hint + '</p>' : '') + '</div>';
  }
  function discordBlock(id) {
    return '<button type="button" class="btn btn-alt" data-clerk="oauth-discord" data-go="signing" aria-describedby="' + id + '">' + I.discord + '<span>Continue with Discord</span></button>' +
      '<p class="fine" id="' + id + '">Discord shares your name, avatar and email. We can’t read or send messages as you.</p>';
  }
  function otpBlock() {
    return '<div class="otp" data-otp><span class="cell on"></span><span class="cell"></span><span class="cell"></span><span class="cell"></span><span class="cell"></span><span class="cell"></span>' +
      '<input class="otp-in" id="f-code" name="code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code" aria-describedby="code-help"></div>';
  }

  function signin(banner) {
    return '<form class="form" data-clerk="sign-in-start" novalidate>' +
      (banner ? '<div class="banner" role="alert">' + I.warn + '<span>Sign-in is having trouble. Try again in a minute.</span></div>' : '') +
      discordBlock('fine-discord') +
      '<div class="or" aria-hidden="true"><span>or</span></div>' +
      '<div class="field"><label for="f-email">Email address</label><input id="f-email" name="identifier" type="email" autocomplete="username" inputmode="email" placeholder="you@email.com" spellcheck="false" autocapitalize="off" required></div>' +
      '<button class="btn btn-primary" type="submit" data-go="password">Continue</button></form>';
  }
  function password(err) {
    return '<form class="form" data-clerk="sign-in-password" novalidate>' +
      '<div class="idrow"><span class="v">' + em + '</span><button type="button" class="link" data-go="signin">Change<span class="sr"> email</span></button></div>' +
      pwField('f-pw', 'Password', { err: err ? 'That password isn’t right. Check it and try again.' : '', hint: 'First time here with email? Use Forgot password to set one.', value: err ? 'wrongpass1' : '' }) +
      '<button class="btn btn-primary" type="submit" data-go="signing">Sign in</button>' +
      '<div class="alt-links"><button type="button" class="link" data-go="code">Forgot password?</button></div></form>';
  }
  function code() {
    return '<form class="form" data-clerk="verify-email-code" novalidate>' + otpBlock() +
      '<p class="hint" id="code-help" style="text-align:center">Paste works. The code expires in 10 minutes.</p>' +
      '<button class="btn btn-primary" type="submit" data-go="newpw">Continue</button>' +
      '<p class="resend" data-resend>Resend code in&nbsp;<b data-count>0:27</b></p>' +
      '<div class="alt-links"><button type="button" class="link" data-go="signin">Use a different email</button></div></form>';
  }
  function newpw() {
    return '<form class="form" data-clerk="reset-password" novalidate>' +
      pwField('f-np', 'New password', { ac: 'new-password', name: 'newPassword', hint: 'At least 8 characters.' }) +
      pwField('f-np2', 'Confirm password', { ac: 'new-password', name: 'confirm' }) +
      '<button class="btn btn-primary" type="submit" data-go="signing">Save password</button></form>';
  }
  function invite(uerr) {
    return '<form class="form" data-clerk="sign-up-continue" novalidate>' +
      '<div class="field"><label for="f-iem">Email address</label><div class="input-wrap locked"><input id="f-iem" name="emailAddress" type="email" value="' + DD.email + '" readonly aria-describedby="f-iem-h"><span class="lockic">' + I.lock + '<span class="sr">Locked</span></span></div><p class="hint" id="f-iem-h">From your invite. It can’t be changed.</p></div>' +
      '<div class="field' + (uerr ? ' invalid' : '') + '"><label for="f-un">Username</label><div class="input-wrap"><input id="f-un" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="off" placeholder="Pick a username"' + (uerr ? ' value="cardshark" aria-invalid="true" aria-describedby="f-un-err"' : ' aria-describedby="f-un-h"') + ' required></div>' +
      (uerr ? '<p class="ferr" id="f-un-err" role="alert">' + I.warn + '<span>That username is taken. Try another.</span></p>' : '<p class="hint" id="f-un-h">Other players see this. Letters, numbers and underscores.</p>') + '</div>' +
      pwField('f-cp', 'Create password', { ac: 'new-password', hint: 'At least 8 characters.' }) +
      '<label class="check"><input type="checkbox" name="legal" required><span class="box">' + I.tick + '</span><span>I agree to the <a href="' + TERMS + '">Terms</a> and <a href="' + PRIV + '">Privacy Policy</a></span></label>' +
      '<div class="captcha-slot" id="clerk-captcha" data-clerk="captcha">' + I.shield + '<span>Bot check loads here</span></div>' +
      '<button class="btn btn-primary" type="submit" data-go="signing">Create account</button>' +
      '<div class="or" aria-hidden="true"><span>or</span></div>' + discordBlock('fine-discord2') + '</form>';
  }
  function notInvited(kind) {
    return '<div class="form" data-clerk="' + (kind === 'signup' ? 'sign-up-no-invite' : 'identifier-not-found') + '">' +
      (kind === 'signin' ? '<div class="note-box"><span class="k">Email</span><span class="v">' + em + '</span></div>' : '') +
      '<a class="btn btn-primary" href="' + JOIN + '">Join the waitlist</a>' +
      '<button type="button" class="btn btn-alt" data-go="signin">' + (kind === 'signin' ? 'Try a different email' : 'Back to sign in') + '</button></div>';
  }
  function banned() {
    return '<div class="form" data-clerk="account-locked"><button type="button" class="btn btn-alt" data-go="signin">Back to sign in</button>' +
      '<a class="btn btn-alt" href="mailto:support@duelingdomain.com">Contact support</a></div>';
  }
  function signing() {
    return '<div class="form"><div class="signing" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>Opening Dueling Domain…</span></div></div>';
  }

  var MIN = 'min', FULL = 'full', INV = 'invite', NONE = 'none';
  /* face: front or back (only concept B uses it). name/type/code: concept B card parts. */
  DD.screens = {
    'signin':       { tab: 'Sign in',            face: 'front', eyebrow: 'Closed alpha', title: 'Welcome <em>back</em>', lede: 'Sign in to your drafts, decks and duels.', form: function () { return signin(false); }, foot: FULL, name: 'Sign in', type: '[Access: Alpha member]', code: 'S-01', noTitle: 1, clerk: 'Start: identifier + OAuth' },
    'password':     { tab: 'Password',           face: 'back',  eyebrow: 'Step 2 of 2', title: 'Enter your <em>password</em>', lede: '', form: function () { return password(false); }, foot: MIN, name: 'Password', type: '[Step: Password]', code: 'S-02', noTitle: 1, clerk: 'First factor: password' },
    'code':         { tab: 'Email code',         face: 'back',  eyebrow: 'Verify', title: 'Check your <em>email</em>', lede: 'We sent a 6-digit code to ' + em + '.', form: code, foot: MIN, name: 'Check email', type: '[Step: Email code]', code: 'S-03', clerk: 'Email code (verify / reset / new device)' },
    'newpw':        { tab: 'New password',       face: 'back',  eyebrow: 'Reset', title: 'Set a new <em>password</em>', lede: 'Choose a password for ' + em + '.', form: newpw, foot: MIN, name: 'New password', type: '[Step: Reset]', code: 'S-04', clerk: 'Reset password' },
    'invite':       { tab: 'Create account',     face: 'back',  eyebrow: 'Invite accepted', title: 'You’re in the <em>alpha</em>', lede: 'Finish your account to start drafting.', form: function () { return invite(false); }, foot: INV, name: 'Invite accepted', type: '[Invite: Alpha access]', code: 'R-01', rare: 1, clerk: 'Sign-up with invite ticket' },
    'err-username': { tab: 'Username taken',     face: 'back',  eyebrow: 'Invite accepted', title: 'You’re in the <em>alpha</em>', lede: 'Finish your account to start drafting.', form: function () { return invite(true); }, foot: INV, name: 'Invite accepted', type: '[Invite: Alpha access]', code: 'R-01', rare: 1, clerk: 'Sign-up field error' },
    'err-invite':   { tab: 'Not invited (sign in)', face: 'back', eyebrow: 'Closed alpha', title: 'This email isn’t in the <em>alpha</em> yet', lede: 'Access opens in waves. Join the waitlist and we’ll email you when it’s your turn.', form: function () { return notInvited('signin'); }, foot: MIN, name: 'Not invited yet', type: '[Access: Waitlist]', code: 'W-01', clerk: 'Identifier not found' },
    'err-signup':   { tab: 'Not invited (sign up)', face: 'back', eyebrow: 'Closed alpha', title: 'You’re not in the <em>alpha</em> yet', lede: 'Accounts are created from an invite. Join the waitlist and we’ll email you when your wave opens.', form: function () { return notInvited('signup'); }, foot: MIN, name: 'Not invited yet', type: '[Access: Waitlist]', code: 'W-02', clerk: 'Sign-up blocked (waitlist mode)' },
    'err-password': { tab: 'Wrong password',     face: 'back',  eyebrow: 'Step 2 of 2', title: 'Enter your <em>password</em>', lede: '', form: function () { return password(true); }, foot: MIN, name: 'Password', type: '[Step: Password]', code: 'S-02', noTitle: 1, clerk: 'Field error' },
    'err-banned':   { tab: 'Banned',             face: 'back',  eyebrow: 'Account', title: 'This account can’t sign in', lede: 'If you think that’s a mistake, reach out to the alpha team.', form: banned, foot: MIN, name: 'Locked', type: '[Account: On hold]', code: 'X-01', clerk: 'Locked / banned user' },
    'err-service':  { tab: 'Service error',      face: 'front', eyebrow: 'Closed alpha', title: 'Welcome <em>back</em>', lede: 'Sign in to your drafts, decks and duels.', form: function () { return signin(true); }, foot: FULL, name: 'Sign in', type: '[Access: Alpha member]', code: 'S-01', noTitle: 1, clerk: 'Global error banner' },
    'signing':      { tab: 'Signing in',         face: 'back',  eyebrow: 'One moment', title: 'Signing you <em>in</em>', lede: '', form: signing, foot: NONE, name: 'Signing in', type: '[Step: Opening]', code: 'S-05', clerk: 'Session created, redirect' }
  };
  DD.order = ['signin', 'password', 'code', 'newpw', 'invite', 'err-username', 'err-invite', 'err-signup', 'err-password', 'err-banned', 'err-service', 'signing'];

  function foot(kind) {
    if (kind === NONE) return '';
    var legal = '<p class="legal"><a href="' + PRIV + '">Privacy</a></p>';
    if (kind === FULL) return '<p>Not in the alpha yet? <a href="' + JOIN + '">Join the waitlist</a></p>' + legal;
    if (kind === INV) return '<p>Already have an account? <button type="button" class="link" data-go="signin">Sign in</button></p>' + legal;
    return legal;
  }

  /* concepts call DD.mount(containerFor, templateId) then DD.start() */
  DD.mount = function (containerFor, tplId) {
    var tpl = document.getElementById(tplId || 'tpl-screen');
    DD.order.concat(DD.extra || []).forEach(function (id) {
      var s = DD.screens[id];
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.setAttribute('data-screen', id);
      if (s.rare) node.setAttribute('data-rare', '');
      var slots = {
        eyebrow: s.eyebrow, title: s.title, lede: s.lede, name: s.name, type: s.type, code: s.code,
        form: s.form ? s.form() : '', foot: foot(s.foot)
      };
      node.querySelectorAll('[data-slot]').forEach(function (el) {
        var k = el.getAttribute('data-slot');
        if (k === 'lede' && !s.lede) { el.remove(); return; }
        if (k === 'title' && s.noTitle && el.hasAttribute('data-hide-if-notitle')) { el.remove(); return; }
        if (slots[k] !== undefined) el.innerHTML = slots[k];
      });
      (containerFor(id, s) || document.body).appendChild(node);
    });
  };

  function focusFirst(id) {
    var sec = document.querySelector('[data-screen="' + id + '"]');
    if (!sec) return;
    var f = sec.querySelector('input:not([readonly]):not([type=checkbox])');
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }

  DD.go = function (id, opts) {
    opts = opts || {};
    if (!DD.screens[id]) return;
    var prev = DD.cur;
    DD.cur = id;
    html.setAttribute('data-s', id);
    html.setAttribute('data-face', DD.screens[id].face);
    document.querySelectorAll('[data-screen]').forEach(function (el) {
      var on = el.getAttribute('data-screen') === id;
      el.hidden = !on; if (on) el.removeAttribute('inert'); else el.setAttribute('inert', '');
    });
    document.querySelectorAll('.mockbar button[data-to]').forEach(function (b) {
      b.setAttribute('aria-current', b.getAttribute('data-to') === id ? 'true' : 'false');
    });
    try { history.replaceState(null, '', '?s=' + id + (SHOT ? '&shot=1' : '')); } catch (e) {}
    startCountdown();
    DD.hooks.forEach(function (h) { h(id, prev, opts); });
    if (opts.focus) setTimeout(function () { focusFirst(id); }, 60);
  };

  /* resend countdown (frozen in shots) */
  var timer = null;
  function startCountdown() {
    clearInterval(timer);
    var left = 27;
    function paint() {
      document.querySelectorAll('[data-resend]').forEach(function (r) {
        if (left > 0) r.innerHTML = 'Resend code in&nbsp;<b data-count>0:' + (left < 10 ? '0' : '') + left + '</b>';
        else r.innerHTML = '<button type="button" class="link" data-resend-now>Resend code</button>';
      });
    }
    paint();
    if (SHOT || DD.cur !== 'code') return;
    timer = setInterval(function () { left--; paint(); if (left <= 0) clearInterval(timer); }, 1000);
  }

  function setEmail(v) {
    DD.email = v;
    document.querySelectorAll('[data-email]').forEach(function (e) { e.textContent = v; });
  }

  function updateOtp(wrap) {
    var inp = wrap.querySelector('input'); var v = inp.value.replace(/\D/g, '').slice(0, 6);
    if (inp.value !== v) inp.value = v;
    var cells = wrap.querySelectorAll('.cell');
    cells.forEach(function (c, i) {
      c.textContent = v[i] || '';
      c.classList.toggle('filled', !!v[i]);
      c.classList.toggle('on', i === Math.min(v.length, 5));
    });
    return v;
  }

  document.addEventListener('click', function (e) {
    var rev = e.target.closest('[data-reveal]');
    if (rev) {
      var inp = document.getElementById(rev.getAttribute('aria-controls'));
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      rev.setAttribute('aria-pressed', show ? 'true' : 'false');
      rev.firstElementChild.textContent = show ? 'Hide' : 'Show';
      return;
    }
    var mb = e.target.closest('.mockbar button[data-to]');
    if (mb) { DD.go(mb.getAttribute('data-to'), { focus: true }); return; }
    var g = e.target.closest('[data-go]');
    if (g && g.type !== 'submit') { e.preventDefault(); DD.go(g.getAttribute('data-go'), { focus: true, flow: true }); return; }
    if (e.target.closest('[data-resend-now]')) { e.preventDefault(); startCountdown(); }
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('[type=submit][data-go]');
    var to = btn ? btn.getAttribute('data-go') : null;
    var em1 = e.target.querySelector('#f-email');
    if (em1) {
      if (!em1.value.trim()) { em1.focus(); return; }
      setEmail(em1.value.trim());
      if (/nope|notinvited/i.test(em1.value)) to = 'err-invite';
    }
    var pw = e.target.querySelector('#f-pw');
    if (pw && /wrong/i.test(pw.value)) to = 'err-password';
    if (to) DD.go(to, { focus: true, flow: true });
  });

  document.addEventListener('input', function (e) {
    var w = e.target.closest('[data-otp]');
    if (!w) return;
    var v = updateOtp(w);
    if (v.length === 6 && !SHOT) setTimeout(function () { DD.go('newpw', { focus: true, flow: true }); }, 260);
  });
  document.addEventListener('focusin', function (e) { var w = e.target.closest && e.target.closest('[data-otp]'); if (w) updateOtp(w); });

  /* mock strip */
  function strip() {
    if (SHOT) return;
    var bar = document.createElement('nav');
    bar.className = 'mockbar'; bar.setAttribute('aria-label', 'Mock screens');
    var h = '<span class="mb-t">Mock states</span>';
    DD.order.concat(DD.extra || []).forEach(function (id) { h += '<button type="button" data-to="' + id + '">' + DD.screens[id].tab + '</button>'; });
    h += '<a href="../index.html">Workshop</a>';
    bar.innerHTML = h;
    document.body.appendChild(bar);
  }

  /* logo + mark symbols */
  function defs() {
    var d = document.createElement('div');
    d.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
      '<symbol id="dd-lockup" viewBox="18 12 455 72"><g fill="#C9A45C"><path fill-rule="evenodd" d="M18 12H56L78 34V62L56 84H18Z M33 26H55A3 3 0 0 1 58 29V67A3 3 0 0 1 55 70H33A3 3 0 0 1 30 67V29A3 3 0 0 1 33 26Z"/><path d="M44 41L51 48L44 55L37 48Z"/></g><g fill="#E8ECF4"><path transform="translate(120 32)" d="M0 0H16L24 8V24L16 32H0Z M6 6V26H13L18 21V11L13 6Z"/><path transform="translate(149 32)" d="M0 0H6V24L8 26H16L18 24V0H24V26L18 32H6L0 26Z"/><path transform="translate(178 32)" d="M0 0H22V6H6V13H19V19H6V26H22V32H0Z"/><path transform="translate(205 32)" d="M0 0H6V26H22V32H0Z"/><path transform="translate(232 32)" d="M0 0H6V32H0Z"/><path transform="translate(243 32)" d="M0 32V0H6L18 21V0H24V32H18L6 11V32Z"/><path transform="translate(272 32)" d="M6 0H24V6H9L6 9V23L9 26H18V19H12V13H24V32H6L0 26V6Z"/></g><g fill="#C9A45C"><path transform="translate(318 32)" d="M0 0H16L24 8V24L16 32H0Z M6 6V26H13L18 21V11L13 6Z"/><path transform="translate(347 32)" d="M6 0H18L24 6V26L18 32H6L0 26V6Z M8 6L6 8V24L8 26H16L18 24V8L16 6Z"/><path transform="translate(376 32)" d="M0 32V0H6L14 12L22 0H28V32H22V11L14 23L6 11V32Z"/><path transform="translate(409 32)" d="M0 32V8L8 0H16L24 8V32H18V21H6V32Z M6 15H18V10L14 6H10L6 10Z"/><path transform="translate(438 32)" d="M0 0H6V32H0Z"/><path transform="translate(449 32)" d="M0 32V0H6L18 21V0H24V32H18L6 11V32Z"/></g></symbol>' +
      '<symbol id="dd-mark" viewBox="6 6 84 84"><g fill="#C9A45C"><path fill-rule="evenodd" d="M18 12H56L78 34V62L56 84H18Z M33 26H55A3 3 0 0 1 58 29V67A3 3 0 0 1 55 70H33A3 3 0 0 1 30 67V29A3 3 0 0 1 33 26Z"/><path d="M44 41L51 48L44 55L37 48Z"/></g></symbol>' +
      '<clipPath id="dd-clip"><path fill-rule="evenodd" d="M18 12H56L78 34V62L56 84H18Z M33 26H55A3 3 0 0 1 58 29V67A3 3 0 0 1 55 70H33A3 3 0 0 1 30 67V29A3 3 0 0 1 33 26Z"/></clipPath>' +
      '<linearGradient id="dd-glint" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#FFF3D6" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '</defs></svg>';
    document.body.insertBefore(d.firstChild, document.body.firstChild);
  }

  DD.start = function () {
    defs();
    strip();
    var s = P.get('s');
    DD.go(DD.screens[s] ? s : 'signin');
    if (SHOT) {
      if (DD.cur === 'code') { var w = document.querySelector('[data-screen="code"] [data-otp]'); w.querySelector('input').value = '4829'; updateOtp(w); }
      if (DD.cur !== 'signin' && DD.cur !== 'err-service') setTimeout(function () { focusFirst(DD.cur); }, 40);
    }
  };
})();

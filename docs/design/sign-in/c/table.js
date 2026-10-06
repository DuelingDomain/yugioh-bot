/* Draws the faint duel table behind the panel. Pure SVG, regenerated on resize. */
(function () {
  var svg = document.getElementById('table');
  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e); return e;
  }
  function slot(g, cx, cy, w, h, cls) {
    return el('rect', { x: (cx - w / 2).toFixed(1), y: (cy - h / 2).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 5, class: 'ln dash' + (cls ? ' ' + cls : '') }, g);
  }
  function draw() {
    var W = window.innerWidth, H = window.innerHeight;
    var land = W > 700;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var cx = W / 2, pitch, zw, zh, rows;
    if (land) { pitch = Math.min(W / 9, 170); zh = Math.min(H * .115, 104); zw = zh * .686; rows = [.2, .365, .635, .8]; }
    else { pitch = Math.min(W / 5.5, 76); zh = pitch * 1.18; zw = zh * .686; rows = [.045, .135, .865, .955]; }
    var rim = land ? 22 : 10;
    var g0 = el('g', { class: 'grp', style: '--gd:0s' });
    el('rect', { x: rim, y: rim, width: W - rim * 2, height: H - rim * 2, rx: 18, class: 'ln rim' }, g0);
    el('rect', { x: rim + 7, y: rim + 7, width: W - rim * 2 - 14, height: H - rim * 2 - 14, rx: 12, class: 'ln rim' }, g0);
    var gm = el('g', { class: 'grp', style: '--gd:.15s' });
    el('line', { x1: rim + 7, y1: H / 2, x2: W / 2 - 26, y2: H / 2, class: 'ln mid' }, gm);
    el('line', { x1: W / 2 + 26, y1: H / 2, x2: W - rim - 7, y2: H / 2, class: 'ln mid' }, gm);
    el('path', { d: 'M' + (W / 2) + ' ' + (H / 2 - 7) + 'L' + (W / 2 + 7) + ' ' + (H / 2) + 'L' + (W / 2) + ' ' + (H / 2 + 7) + 'L' + (W / 2 - 7) + ' ' + (H / 2) + 'Z', class: 'gem' }, gm);
    var cardRows = land ? rows : [.80, .90];
    var hotRow = land ? 2 : 1;
    cardRows.forEach(function (ry, ri) {
      var g = el('g', { class: 'grp' + (ri % 2 === (land && ri > 1 ? 1 : 0) ? ' spell' : ''), style: '--gd:' + (.3 + ri * .12) + 's' });
      for (var i = -2; i <= 2; i++) {
        var hot = ri === hotRow && i === 2;
        var r = slot(g, cx + i * pitch, H * ry, zw, zh, hot ? 'hot' : '');
        if (hot) {
          var hx = cx + i * pitch, hy = H * ry;
          var im = el('image', { href: '../shared/card-back-main-hd.webp', x: (hx - zw / 2 + 3).toFixed(1), y: (hy - zh / 2 + 3).toFixed(1), width: (zw - 6).toFixed(1), height: (zh - 6).toFixed(1), class: 'land', preserveAspectRatio: 'xMidYMid slice' }, g);
          im.style.transformBox = 'fill-box'; im.style.transformOrigin = 'center';
        }
      }
    });
    if (land) {
      /* deck and graveyard stacks at the table sides */
      [[.2, -1], [.365, -1], [.635, 1], [.8, 1]].forEach(function (r, ri) {
        var g = el('g', { class: 'grp', style: '--gd:' + (.55 + ri * .1) + 's' });
        [-1, 1].forEach(function (side) {
          var x = cx + side * pitch * 3.6;
          if (ri === 1 || ri === 2) { slot(g, x, H * r[0], zw, zh); }
          else { for (var k = 2; k >= 0; k--) slot(g, x + side * k * 3, H * r[0] - k * 3, zw, zh); }
        });
      });
    }
  }
  draw();
  var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(draw, 120); });
})();

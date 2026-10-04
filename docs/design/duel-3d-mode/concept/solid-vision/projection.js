/* Solid Vision — projection layer (three.js).
   One full-viewport canvas, pointer-events: none, rendered ON DEMAND:
   the rAF loop runs only while a moment is playing, then stops.
   Positions come from the DOM board (getBoundingClientRect), so the DOM stays the truth.
   Loaded as a classic script; three.js arrives through the page importmap via dynamic import. */
(function () {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const P = (SV.proj = { available: false, failed: false, error: null });

  let THREE, renderer, scene, camera, canvas;
  let W = innerWidth;
  let H = innerHeight;
  const D = 1100; // camera distance in CSS px
  const moments = new Set();
  const live = new Set(); // every object currently in the scene
  let raf = 0;
  const TEX = {};

  const GOLD = [0.93, 0.8, 0.52];
  const GOLD_DEEP = [0.8, 0.64, 0.36];
  const PURPLE = [0.55, 0.44, 0.96];

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const eOut = (k) => 1 - Math.pow(1 - k, 3);
  const eExpo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const eInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  P.ready = (async function init() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.has('nogl')) throw new Error('WebGL disabled with ?nogl');
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');
      THREE = await import('three');
      THREE.ColorManagement.enabled = false;
      canvas = document.getElementById('proj');
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 10, 6000);
      resize();
      addEventListener('resize', resize);
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        P.available = false; P.failed = true; P.error = 'WebGL context lost';
        document.documentElement.dataset.gl = 'off';
      });
      await loadTextures();
      P.available = true;
      document.documentElement.dataset.gl = 'on';
      renderOnce();
      return true;
    } catch (err) {
      P.failed = true;
      P.error = String((err && err.message) || err);
      document.documentElement.dataset.gl = 'off';
      console.warn('[Solid Vision] CSS projection fallback:', P.error);
      return false;
    }
  })();

  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); // DPR cap
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = (2 * Math.atan(H / 2 / D) * 180) / Math.PI; // 1 world unit = 1 CSS px at z = 0
    camera.position.set(0, 0, D);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (!moments.size) renderOnce();
  }

  function loadTextures() {
    const src = window.SV_TEX || {};
    return Promise.all(
      Object.entries(src).map(
        ([k, url]) =>
          new Promise((res) => {
            const img = new Image();
            img.onload = () => {
              const t = new THREE.Texture(img);
              t.minFilter = THREE.LinearFilter;
              t.generateMipmaps = false;
              t.needsUpdate = true;
              TEX[k] = t;
              res();
            };
            img.onerror = () => res();
            img.src = url;
          })
      )
    );
  }

  /* ---------------------------------------------------------------- helpers */
  const V = (x, y, z = 0) => new THREE.Vector3(x - W / 2, H / 2 - y, z);
  function box(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, r };
  }
  const tilt = () => ((SV.tiltDeg || 0) * Math.PI) / 180;
  function add(obj, parent) {
    (parent || scene).add(obj);
    if (!parent) live.add(obj);
    return obj;
  }
  function dispose(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    live.delete(obj);
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  function renderOnce() {
    if (renderer) renderer.render(scene, camera);
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop(now) {
    raf = 0;
    for (const m of [...moments]) {
      const t = (now - m.t0) / 1000;
      if (t >= m.dur) end(m);
      else m.update(t);
    }
    renderer.render(scene, camera);
    if (moments.size) raf = requestAnimationFrame(loop); // no idle loop
  }
  function end(m) {
    if (!moments.has(m)) return;
    moments.delete(m);
    m.update(m.dur);
    if (m.finish) m.finish();
    if (m._res) m._res();
    renderOnce();
  }
  function run(m, still, at) {
    if (still) {
      m.update(at == null ? m.dur : at);
      renderOnce();
      return { still: true, done: Promise.resolve(), skip() {}, remove: m.remove || (() => {}) };
    }
    m.t0 = performance.now();
    moments.add(m);
    kick();
    const done = new Promise((r) => (m._res = r));
    return { done, skip: () => end(m), remove: m.remove || (() => {}) };
  }
  function syncSize() {
    // listeners may run before our own resize handler: never draw with a stale camera
    if (innerWidth !== W || innerHeight !== H) resize();
  }
  function tableGroup(x, y) {
    const g = new THREE.Group();
    g.position.copy(V(x, y, 0));
    g.rotation.x = -tilt(); // lie in the tilted table plane
    return add(g);
  }

  /* ---------------------------------------------------------------- materials */
  const RING_VS = `varying vec2 vP;
    void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const RING_FS = `uniform vec3 uColor; uniform float uAlpha, uR, uW, uSoft, uDash, uRot, uFill;
    varying vec2 vP;
    void main(){
      float r = length(vP);
      float d = abs(r - uR);
      float a = 1.0 - smoothstep(uW * 0.5, uW * 0.5 + uSoft, d);
      if (uDash > 0.0) {
        float f = fract((atan(vP.y, vP.x) + uRot) / 6.2831853 * uDash);
        a *= smoothstep(0.36, 0.42, f) * (1.0 - smoothstep(0.94, 1.0, f));
      }
      a += uFill * pow(1.0 - clamp(r / uR, 0.0, 1.0), 1.7);
      gl_FragColor = vec4(uColor, a * uAlpha);
    }`;
  function ring(R, o = {}) {
    const size = (R + (o.w || 2) + (o.soft || 1.2) + 6) * 2;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(...(o.color || GOLD)) },
          uAlpha: { value: 0 },
          uR: { value: R },
          uW: { value: o.w == null ? 2 : o.w },
          uSoft: { value: o.soft || 1.2 },
          uDash: { value: o.dash || 0 },
          uRot: { value: 0 },
          uFill: { value: o.fill || 0 },
        },
        vertexShader: RING_VS,
        fragmentShader: RING_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
  }

  const CONE_VS = `uniform float uBW, uTW, uH; varying vec2 vUv;
    void main(){
      float y01 = position.y + 0.5;
      float w = mix(uBW, uTW, y01);
      vUv = vec2(position.x + 0.5, y01);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x * w, y01 * uH, 0.0, 1.0);
    }`;
  const CONE_FS = `uniform vec3 uColor; uniform float uAlpha, uTime; varying vec2 vUv;
    void main(){
      float edge = smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x));
      float fall = pow(1.0 - vUv.y, 0.75);
      float streak = 0.76 + 0.24 * sin(vUv.x * 46.0 + uTime * 3.0) * sin(vUv.x * 11.0 - uTime * 1.7);
      float core = 1.0 - smoothstep(0.0, 0.2, abs(vUv.x - 0.5));
      gl_FragColor = vec4(uColor, (edge * fall * streak * 0.55 + core * fall * 0.2) * uAlpha);
    }`;
  function cone() {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(...PURPLE) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uBW: { value: 1 }, uTW: { value: 1 }, uH: { value: 0 } },
        vertexShader: CONE_VS,
        fragmentShader: CONE_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
  }

  const HOLO_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const HOLO_FS = `uniform sampler2D uMap; uniform float uTime, uReveal, uAlpha, uGlitch; uniform vec3 uGold, uTint;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      float bandY = fract(uTime * 0.7 + 0.15);
      float band = 1.0 - smoothstep(0.0, 0.045, abs(uv.y - bandY));
      uv.x += band * 0.01 * sin(uTime * 90.0) + uGlitch * 0.016 * sin(uv.y * 150.0 + uTime * 70.0);
      float off = 0.0022 + band * 0.004 + uGlitch * 0.004;
      vec3 c = vec3(texture2D(uMap, uv + vec2(off, 0.0)).r, texture2D(uMap, uv).g, texture2D(uMap, uv - vec2(off, 0.0)).b);
      c = mix(c, c * vec3(0.92, 0.88, 1.08) + uTint * 0.05, 0.5);
      c *= 0.8 + 0.2 * sin(gl_FragCoord.y * 1.6 - uTime * 26.0);
      c += uTint * (band * 0.14 + (1.0 - vUv.y) * 0.1);
      float ex = min(vUv.x, 1.0 - vUv.x);
      float ey = min(vUv.y, 1.0 - vUv.y);
      float frame = (1.0 - smoothstep(0.0, 0.011, min(ex, ey))) * smoothstep(0.0, 0.22, vUv.y);
      float fade = smoothstep(0.0, 0.03, ex) * smoothstep(0.0, 0.16, vUv.y) * smoothstep(0.0, 0.03, 1.0 - vUv.y);
      float below = 1.0 - smoothstep(uReveal - 0.025, uReveal, vUv.y);
      float line = (1.0 - smoothstep(0.0, 0.014, abs(vUv.y - uReveal))) * (1.0 - step(0.995, uReveal));
      vec3 col = c + uGold * (frame * 0.8 + line * 1.3);
      float a = max(fade * 0.9, frame * 0.9) * below + line;
      gl_FragColor = vec4(col, clamp(a * uAlpha, 0.0, 1.0));
    }`;
  function holo(tex) {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uTime: { value: 0 },
          uReveal: { value: 0 },
          uAlpha: { value: 0 },
          uGlitch: { value: 0 },
          uGold: { value: new THREE.Color(...GOLD) },
          uTint: { value: new THREE.Color(...PURPLE) },
        },
        vertexShader: HOLO_VS,
        fragmentShader: HOLO_FS,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
  }

  const BEAM_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const BEAM_FS = `uniform vec3 uColor; uniform float uAlpha, uProg, uTime; varying vec2 vUv;
    void main(){
      float along = vUv.x;
      float drawn = 1.0 - smoothstep(uProg - 0.015, uProg, along);
      float head = (1.0 - smoothstep(0.0, 0.05, abs(along - uProg))) * (1.0 - step(0.999, uProg));
      float pulse = pow(0.5 + 0.5 * sin((along - uTime * 0.9) * 16.0), 8.0) * 0.45;
      gl_FragColor = vec4(uColor + head * 0.3, (drawn * (0.78 + pulse) + head) * uAlpha);
    }`;
  function beamMat(color, alpha) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(...color) }, uAlpha: { value: alpha }, uProg: { value: 0 }, uTime: { value: 0 } },
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }
  function flatMat(color) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(...color) }, uAlpha: { value: 0 } },
      vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, uAlpha); }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }

  /* ---------------------------------------------------------------- moments */

  /* Signature: Deck Master summon. Rings form in the zone, a purple cone rises,
     the art builds bottom-up as a hologram, holds, then settles into the card. 1.15 s. */
  P.summon = function ({ zoneEl, still = false, at = 0.8, onSettle }) {
    syncSize();
    const Z = box(zoneEl);
    const s = Math.min(Z.w, Z.h);
    const bw = Math.max(70, Math.min(240, s * 1.5));
    const g = tableGroup(Z.x, Z.y);
    const rings = [0.5, 0.63, 0.78].map((f, i) => add(ring(s * f, { w: i === 1 ? 1.2 : 2, dash: i === 2 ? 40 : 0, color: i === 1 ? GOLD_DEEP : GOLD }), g));
    const disc = add(ring(s * 0.62, { w: 0.4, soft: 0.6, fill: 1, color: PURPLE }), g);
    const cn = add(cone());
    cn.position.copy(V(Z.x, Z.y, 0.5));
    const hb = add(holo(TEX.dm));
    const peakBottom = Z.y - s * 0.64;
    let settled = false;
    const m = {
      dur: 1.15,
      update(t) {
        rings.forEach((r, i) => {
          const a0 = 0.14 + i * 0.07;
          r.scale.setScalar(0.3 + 0.7 * eExpo(seg(t, a0, a0 + 0.36)));
          const out = 1 - seg(t, i === 0 ? 0.98 : 0.9, i === 0 ? 1.15 : 1.05);
          r.material.uniforms.uAlpha.value = (i === 1 ? 0.6 : 0.95) * seg(t, a0, a0 + 0.12) * out;
          r.material.uniforms.uRot.value = t * 1.3;
        });
        disc.material.uniforms.uAlpha.value = 0.3 * seg(t, 0.14, 0.4) * (1 - seg(t, 0.9, 1.12));
        const cu = cn.material.uniforms;
        cu.uBW.value = s * 0.66;
        cu.uTW.value = bw * 1.7;
        cu.uH.value = (Z.y - (peakBottom - bw)) * eOut(seg(t, 0.2, 0.55));
        cu.uAlpha.value = 0.9 * seg(t, 0.2, 0.38) * (1 - seg(t, 0.88, 1.06));
        cu.uTime.value = t;
        const rise = eExpo(seg(t, 0.3, 0.72));
        const settle = eInOut(seg(t, 0.9, 1.13));
        const start = Z.y - s * 0.12;
        let cy = start + (peakBottom - bw / 2 - start) * rise;
        const sc = 0.55 + 0.45 * rise;
        cy += (Z.y - cy) * settle;
        const wNow = bw * sc + (s * 0.6 - bw * sc) * settle;
        const hNow = bw * sc + (s * 0.875 - bw * sc) * settle;
        hb.position.copy(V(Z.x, cy, 90 * rise * (1 - settle)));
        hb.scale.set(wNow, hNow, 1);
        const hu = hb.material.uniforms;
        hu.uReveal.value = eOut(seg(t, 0.3, 0.7));
        hu.uAlpha.value = seg(t, 0.3, 0.4) * (1 - seg(t, 0.96, 1.13));
        hu.uTime.value = t;
        hu.uGlitch.value = (t > 0.74 && t < 0.79) || (t > 0.86 && t < 0.89) ? 1 : 0;
        if (!settled && t >= 0.9) {
          settled = true;
          if (onSettle) onSettle();
        }
      },
      finish() {
        dispose(g); dispose(cn); dispose(hb);
        if (!settled && onSettle) onSettle();
      },
    };
    return run(m, still, at);
  };

  /* Attack declaration: gold projection arc (lifted off the table) + attacker/target rings.
     Stays on screen as a frozen frame (no loop) until the state changes. */
  P.attack = function ({ fromZone, toZone, fromCard, toCard, still = false }) {
    syncSize();
    const A = box(fromCard), B = box(toCard);
    const ZA = box(fromZone), ZB = box(toZone);
    const S = V(A.x, A.y - A.h * 0.52, 0);
    const E = V(B.x, B.y + B.h * 0.6, 0);
    const dist = S.distanceTo(E);
    const C = new THREE.Vector3((S.x + E.x) / 2 + dist * 0.34, (S.y + E.y) / 2, Math.min(170, dist * 0.6));
    const curve = new THREE.QuadraticBezierCurve3(S, C, E);
    const core = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 1.7, 8, false), beamMat(GOLD, 1)));
    const halo = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 6, 10, false), beamMat(PURPLE, 0.2)));
    const tan = curve.getTangent(1).normalize();
    const head = add(new THREE.Mesh(new THREE.ConeGeometry(7, 18, 24), flatMat(GOLD)));
    head.position.copy(E).addScaledVector(tan, -7);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    const sa = Math.min(ZA.w, ZA.h), sb = Math.min(ZB.w, ZB.h);
    const ga = tableGroup(ZA.x, ZA.y), gb = tableGroup(ZB.x, ZB.y);
    const ra = add(ring(sa * 0.6, { w: 2, color: PURPLE }), ga);
    const rb = add(ring(sb * 0.6, { w: 2, color: GOLD }), gb);
    const rd = add(ring(sb * 0.72, { w: 1.4, dash: 28, color: GOLD }), gb);
    const m = {
      dur: 0.7,
      update(t) {
        ra.scale.setScalar(0.6 + 0.4 * eExpo(seg(t, 0, 0.3)));
        ra.material.uniforms.uAlpha.value = 0.9 * seg(t, 0, 0.15);
        const p = eOut(seg(t, 0.08, 0.55));
        [core, halo].forEach((b) => {
          b.material.uniforms.uProg.value = p;
          b.material.uniforms.uTime.value = t + 0.35;
        });
        head.material.uniforms.uAlpha.value = seg(t, 0.5, 0.58);
        rb.scale.setScalar(1.35 - 0.35 * eExpo(seg(t, 0.45, 0.7)));
        rb.material.uniforms.uAlpha.value = 0.95 * seg(t, 0.45, 0.55);
        rd.material.uniforms.uAlpha.value = 0.7 * seg(t, 0.5, 0.62);
        rd.material.uniforms.uRot.value = 0.4 + t * 1.6;
      },
      remove() {
        [core, halo, head, ga, gb].forEach(dispose);
        renderOnce();
      },
    };
    return run(m, still, null);
  };

  /* Destroy: the card breaks into textured shards that tumble toward the viewer, with gold sparks. */
  P.shatter = function ({ cardEl, still = false, at = 0.17, seed = 7 }) {
    syncSize();
    const R = cardEl.getBoundingClientRect();
    const rnd = rng(seed);
    const cols = 3, rows = 5;
    const pts = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        let u = i / cols, v = j / rows;
        if (i > 0 && i < cols) u += ((rnd() - 0.5) * 0.55) / cols;
        if (j > 0 && j < rows) v += ((rnd() - 0.5) * 0.55) / rows;
        pts.push([u, v]);
      }
    }
    const id = (i, j) => j * (cols + 1) + i;
    const tris = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
        if (rnd() < 0.5) tris.push([a, b, d], [a, d, c]);
        else tris.push([a, b, c], [b, d, c]);
      }
    }
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), cen = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3), spin = new Float32Array(n), bary = new Float32Array(n * 3), delay = new Float32Array(n);
    const impact = V(R.left + R.width / 2, R.bottom + R.height * 0.12);
    tris.forEach((tri, ti) => {
      const P3 = tri.map((k) => [R.left + pts[k][0] * R.width, R.top + pts[k][1] * R.height]);
      const cx = (P3[0][0] + P3[1][0] + P3[2][0]) / 3, cy = (P3[0][1] + P3[1][1] + P3[2][1]) / 3;
      const C = V(cx, cy);
      const dir = C.clone().sub(impact).normalize();
      const sp = 150 + rnd() * 380;
      const ax = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const sn = (rnd() - 0.5) * 14;
      const dl = (C.distanceTo(impact) / R.height) * 0.05;
      const vz = 120 + rnd() * 380;
      for (let k = 0; k < 3; k++) {
        const vi = ti * 3 + k;
        const w = V(P3[k][0], P3[k][1]);
        pos.set([w.x - C.x, w.y - C.y, 0], vi * 3);
        uv.set([pts[tri[k]][0], 1 - pts[tri[k]][1]], vi * 2);
        cen.set([C.x, C.y, 0], vi * 3);
        vel.set([dir.x * sp, dir.y * sp + 90, vz], vi * 3);
        axis.set([ax.x, ax.y, ax.z], vi * 3);
        spin[vi] = sn;
        bary.set([k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0], vi * 3);
        delay[vi] = dl;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1));
    geo.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
    geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    const DUR = 0.85;
    const shards = add(
      new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          uniforms: { uMap: { value: TEX.ox }, uT: { value: 0 }, uDur: { value: DUR }, uGold: { value: new THREE.Color(...GOLD) } },
          vertexShader: `uniform float uT;
            attribute vec3 aCenter, aVel, aAxis, aBary; attribute float aSpin, aDelay;
            varying vec2 vUv; varying vec3 vBary;
            vec3 rot(vec3 v, vec3 k, float a){ return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
            void main(){
              float t = max(0.0, uT - aDelay);
              vec3 p = aCenter + aVel * t + vec3(0.0, -820.0 * t * t, 0.0) + rot(position, aAxis, aSpin * t);
              vUv = uv; vBary = aBary;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
          fragmentShader: `uniform sampler2D uMap; uniform float uT, uDur; uniform vec3 uGold;
            varying vec2 vUv; varying vec3 vBary;
            void main(){
              vec3 c = texture2D(uMap, vUv).rgb;
              float k = uT / uDur;
              float flash = 1.0 - smoothstep(0.0, 0.2, k);
              float e = min(min(vBary.x, vBary.y), vBary.z);
              float edge = 1.0 - smoothstep(0.0, 0.06, e);
              c = mix(c, vec3(1.0, 0.94, 0.82), flash * 0.4) + uGold * edge * (0.95 - k * 0.6) * smoothstep(0.0, 0.03, uT);
              gl_FragColor = vec4(c, 1.0 - smoothstep(0.5, 1.0, k));
            }`,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        })
      )
    );
    // sparks
    const SN = 60;
    const sp = new Float32Array(SN * 3), sv = new Float32Array(SN * 3), ss = new Float32Array(SN);
    for (let i = 0; i < SN; i++) {
      const p = V(R.left + rnd() * R.width, R.bottom - rnd() * R.height * 0.5);
      sp.set([p.x, p.y, 2], i * 3);
      const a = Math.PI * (0.1 + rnd() * 0.8);
      const v = 180 + rnd() * 420;
      sv.set([Math.cos(a) * v, Math.sin(a) * v, rnd() * 200], i * 3);
      ss[i] = 2 + rnd() * 3.5;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    pg.setAttribute('aVel', new THREE.BufferAttribute(sv, 3));
    pg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    const sparks = add(
      new THREE.Points(
        pg,
        new THREE.ShaderMaterial({
          uniforms: { uT: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uColor: { value: new THREE.Color(...GOLD) } },
          vertexShader: `uniform float uT, uPR; attribute vec3 aVel; attribute float aSize;
            void main(){
              vec3 p = position + aVel * uT + vec3(0.0, -700.0 * uT * uT, 0.0);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
              gl_PointSize = aSize * uPR * (1.0 - clamp(uT / 0.7, 0.0, 1.0));
            }`,
          fragmentShader: `uniform vec3 uColor; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, 1.0 - smoothstep(0.15, 0.5, d)); }`,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );
    const B = { x: R.left + R.width / 2, y: R.top + R.height / 2 };
    const g = tableGroup(B.x, B.y);
    const fr = add(ring(Math.max(R.width, R.height) * 0.55, { w: 2.5, color: GOLD }), g);
    const m = {
      dur: DUR,
      update(t) {
        shards.material.uniforms.uT.value = t;
        sparks.material.uniforms.uT.value = t;
        fr.scale.setScalar(0.5 + 0.8 * eExpo(seg(t, 0, 0.4)));
        fr.material.uniforms.uAlpha.value = 1 - seg(t, 0.1, 0.45);
      },
      finish() {
        dispose(shards); dispose(sparks); dispose(g);
      },
    };
    return run(m, still, at);
  };

  /* Turn handoff: the projection on your side powers down (rings collapse, a gold line sweeps down). */
  P.powerDown = function ({ zoneEls, fromY, toY, left, right }) {
    syncSize();
    const groups = [];
    const rs = zoneEls.map((el) => {
      const Z = box(el);
      const g = tableGroup(Z.x, Z.y);
      groups.push(g);
      return add(ring(Math.min(Z.w, Z.h) * 0.6, { w: 2, color: PURPLE }), g);
    });
    const line = add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(...GOLD) }, uAlpha: { value: 0 } },
          vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
            void main(){
              float d = abs(vUv.y - 0.5) * 2.0;
              float core = 1.0 - smoothstep(0.0, 0.07, d);
              float soft = pow(1.0 - d, 3.0) * 0.3;
              float ends = smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.9, 1.0, vUv.x));
              gl_FragColor = vec4(uColor, (core + soft) * ends * uAlpha);
            }`,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );
    line.scale.set(right - left, 30, 1);
    const m = {
      dur: 0.9,
      update(t) {
        rs.forEach((r, i) => {
          const k = eOut(seg(t, 0.05 + i * 0.05, 0.6 + i * 0.05));
          r.scale.setScalar(1 - 0.8 * k);
          r.material.uniforms.uAlpha.value = 0.9 * (1 - k);
        });
        const k = eInOut(seg(t, 0.1, 0.85));
        line.position.copy(V((left + right) / 2, fromY + (toY - fromY) * k, 1));
        line.material.uniforms.uAlpha.value = 0.9 * seg(t, 0.1, 0.2) * (1 - seg(t, 0.7, 0.9));
      },
      finish() {
        groups.forEach(dispose);
        dispose(line);
      },
    };
    return run(m, false, null);
  };

  /* Generic activation ring (Normal Summon, card activation). */
  P.ring = function ({ el, color = 'gold', still = false }) {
    syncSize();
    const Z = box(el);
    const s = Math.min(Z.w, Z.h);
    const g = tableGroup(Z.x, Z.y);
    const c = color === 'purple' ? PURPLE : GOLD;
    const r1 = add(ring(s * 0.56, { w: 2, color: c }), g);
    const r2 = add(ring(s * 0.7, { w: 1.2, dash: 32, color: c }), g);
    const m = {
      dur: 0.55,
      update(t) {
        const k = eExpo(seg(t, 0, 0.4));
        r1.scale.setScalar(0.4 + 0.6 * k);
        r2.scale.setScalar(0.5 + 0.5 * k);
        r2.material.uniforms.uRot.value = t * 2;
        const a = seg(t, 0, 0.08) * (1 - seg(t, 0.3, 0.55));
        r1.material.uniforms.uAlpha.value = a;
        r2.material.uniforms.uAlpha.value = a * 0.7;
      },
      finish() {
        dispose(g);
      },
    };
    return run(m, still, 0.2);
  };

  P.busy = () => moments.size > 0;
  P.skipAll = () => [...moments].forEach(end);
  P.clear = function () {
    if (!P.available) return;
    [...moments].forEach(end);
    [...live].forEach(dispose);
    renderOnce();
  };
})();

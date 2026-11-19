/* THE CALLING — the /aris hero. Motes gather into a dense A; a click or
   the first scroll bursts them inside their sphere; they settle as the
   name. Then the writer can FEEL Aris: the left button stirs the motes
   off the word and Aris composes itself again within seconds; the right
   button pans & tilts; idle, the name sways like a pendulum, never a
   full turn.

   Palettes are the studio's own tokens (studio/src/generated/tokens.css)
   keyed off the site theme: <html data-theme="candlelight"> = emissive
   glow on the dark stage; absent (Paper) = rich inks on bone. The theme
   button flips mid-flight and the motes follow.

   prefers-reduced-motion: no journey, no physics — the name, formed,
   drawn once. */
(function () {
  'use strict';
  var cv = document.getElementById('calling');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var hero = cv.parentElement;
  var hintEl = document.querySelector('[data-calling-hint]');
  var lineEl = document.querySelector('[data-calling-line]');

  /* The motes are the same stars that fill the journey plates' skies —
     silver, cream, candle-gold — so the hero and the watercolor cards read
     as one night, not two apps meeting at a border. */
  var THEMES = {
    candlelight: {
      bg: '#0a1317', bgRGB: '10,19,23', fade: 'rgba(10,19,23,0.42)', comp: 'lighter',
      motes: ['#f2e9d8', '#cfd8d6', '#e8c87a', '#9fc3c9', '#e8eef0', '#f2e9d8'],
      baseAlpha: 0.25, alphaGain: 0.55, size: 1.0, grain: 0.1,
    },
    paper: {
      bg: '#eceee0', bgRGB: '236,238,224', fade: 'rgba(236,238,224,0.68)', comp: 'source-over',
      motes: ['#14607a', '#22333a', '#a87e2c', '#2f6f45', '#5d6d66', '#14607a'],
      baseAlpha: 0.72, alphaGain: 0.45, size: 0.6, grain: 0.14,
    },
  };
  var root = document.documentElement;
  var theme = function () { return root.getAttribute('data-theme') === 'candlelight' ? THEMES.candlelight : THEMES.paper; };
  var T = theme();
  new MutationObserver(function () { T = theme(); recolor(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  var N = 14000;
  var R_SHELL = 320;
  var DEPTH_A = 46, DEPTH_WORD = 14;
  /* Paced for a first-time visitor (V: "the user is not able to see what
     happened"): a ceremonial gathering, a burst that properly hangs, the
     name arriving gently — then, once it stands, the quick spring takes
     over so a stir recomposes Aris in seconds, not a slow ooze. */
  var K_SEEK_A = 0.005, K_WORD_ARRIVE = 0.008, K_SEEK_WORD = 0.016, DAMP_SEEK = 0.9;
  var BURST_MS = 4200, DAMP_COAST = 0.993, ARRIVE_MS = 7000;

  function textPoints(text, fontPx, depth) {
    var off = document.createElement('canvas');
    off.width = 1200; off.height = 500;
    var o = off.getContext('2d');
    o.fillStyle = '#fff';
    o.font = 'bold ' + fontPx + 'px Georgia, serif';
    o.textAlign = 'center'; o.textBaseline = 'middle';
    o.fillText(text, 600, 250);
    var img = o.getImageData(0, 0, 1200, 500).data;
    var hits = [];
    for (var y = 0; y < 500; y += 2) for (var x = 0; x < 1200; x += 2)
      if (img[(y * 1200 + x) * 4 + 3] > 90) hits.push([x - 600, y - 250]);
    var pts = [];
    for (var i = 0; i < N; i++) {
      var h = hits[(Math.random() * hits.length) | 0];
      pts.push({ x: (h[0] + Math.random() * 2) * 0.9, y: (h[1] + Math.random() * 2) * 0.9, z: (Math.random() - 0.5) * depth });
    }
    return pts;
  }
  var SHAPE_A = textPoints('A', 420, DEPTH_A);
  var SHAPE_WORD = textPoints('Aris', 260, DEPTH_WORD);

  var motes = [];
  for (var i = 0; i < N; i++) {
    var t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
    motes.push({
      x: R_SHELL * Math.sin(p) * Math.cos(t), y: R_SHELL * Math.sin(p) * Math.sin(t), z: R_SHELL * Math.cos(p),
      vx: 0, vy: 0, vz: 0,
      ci: (Math.random() * 6) | 0,
      s: Math.random() * 1.6 + 0.6,
    });
  }

  var W, H, DPR;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = hero.clientWidth; H = hero.clientHeight;
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    paintBg();
  }
  function paintBg() { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H); }
  function recolor() { paintBg(); if (still) drawOnce(); }
  window.addEventListener('resize', resize);

  var state = 'A', burstUntil = 0, wordSnapAt = Infinity;

  /* watercolor-paper grain, tiled over the sim each frame */
  var grainPat = null;
  (function () {
    var g = document.createElement('canvas');
    g.width = g.height = 160;
    var gc = g.getContext('2d');
    var id = gc.createImageData(160, 160);
    for (var i = 0; i < id.data.length; i += 4) {
      var v = 110 + ((Math.random() * 80) | 0);
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    gc.putImageData(id, 0, 0);
    grainPat = ctx.createPattern(g, 'repeat');
  })();
  function finishFrame() {
    // the paper tooth, then the hero dissolving into the page below it
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = T.grain;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var fade = ctx.createLinearGradient(0, H * 0.8, 0, H);
    fade.addColorStop(0, 'rgba(' + T.bgRGB + ',0)');
    fade.addColorStop(1, 'rgba(' + T.bgRGB + ',1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, H * 0.8, W, H * 0.2);
  }
  function call() {
    if (state !== 'A') return;
    state = 'burst';
    burstUntil = performance.now() + BURST_MS;
    for (var i = 0; i < N; i++) {
      var m = motes[i];
      var d = Math.hypot(m.x, m.y, m.z) || 1;
      var k = (7 + Math.random() * 11) / d;
      m.vx += m.x * k + (Math.random() - 0.5) * 6;
      m.vy += m.y * k + (Math.random() - 0.5) * 6;
      m.vz += m.z * k + (Math.random() - 0.5) * 6;
    }
    if (hintEl) hintEl.style.opacity = '0';
  }

  var yaw = 0, pitch = 0, autoSpin = true;
  var orbiting = false, pushing = false, moved = false, px = 0, py = 0, pushX = 0, pushY = 0;
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  cv.addEventListener('pointerdown', function (e) {
    moved = false; px = e.clientX; py = e.clientY;
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ }
    if (e.button === 2) { orbiting = true; cv.classList.add('dragging'); }
    else if (e.button === 0 && state === 'word') { pushing = true; pushX = e.clientX; pushY = e.clientY; }
  });
  cv.addEventListener('pointermove', function (e) {
    if (Math.abs(e.clientX - px) + Math.abs(e.clientY - py) > 3) moved = true;
    if (orbiting) {
      yaw += (e.clientX - px) * 0.005; pitch += (e.clientY - py) * 0.005;
      pitch = Math.max(-1.3, Math.min(1.3, pitch));
      autoSpin = false; px = e.clientX; py = e.clientY;
    } else if (pushing) { pushX = e.clientX; pushY = e.clientY; }
  });
  cv.addEventListener('pointerup', function (e) {
    cv.classList.remove('dragging');
    if (e.button === 0 && !pushing && !moved && state === 'A') call();
    orbiting = false; pushing = false;
  });
  var scrolled = false;
  window.addEventListener('wheel', function () {
    if (scrolled || state !== 'A') return;
    var r = hero.getBoundingClientRect();
    if (r.bottom > innerHeight * 0.4) { scrolled = true; call(); }
  }, { passive: true });

  var still = false;
  function project(m, cy, sy, cp, sp) {
    var x = m.x * cy + m.z * sy, z1 = -m.x * sy + m.z * cy;
    var y = m.y * cp - z1 * sp, z = m.y * sp + z1 * cp;
    var pz = 620 - z;
    if (pz < 60) return null;
    var s = (H * 1.35) / pz;
    return { sx: W / 2 + x * s, sy: H / 2 + y * s, s: s };
  }
  function drawMote(m, q) {
    var r = Math.max(m.s * T.size * q.s, 0.6);
    ctx.globalAlpha = Math.min(0.95, T.baseAlpha + q.s * T.alphaGain);
    ctx.fillStyle = T.motes[m.ci];
    ctx.fillRect(q.sx - r / 2, q.sy - r / 2, r, r);
  }
  function drawOnce() {
    paintBg();
    ctx.globalCompositeOperation = T.comp;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (var i = 0; i < N; i++) { var q = project(motes[i], cy, sy, cp, sp); if (q) drawMote(motes[i], q); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    finishFrame();
  }

  resize();

  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // the name, formed, at rest — no journey, no physics
    still = true;
    state = 'word';
    for (var j = 0; j < N; j++) { motes[j].x = SHAPE_WORD[j].x; motes[j].y = SHAPE_WORD[j].y; motes[j].z = SHAPE_WORD[j].z; }
    if (hintEl) hintEl.hidden = true;
    if (lineEl) lineEl.style.opacity = '1';
    drawOnce();
    return;
  }

  var last = performance.now();
  function tick(now) {
    var dt = Math.min((now - last) / 16.6, 2.5); last = now;
    var i, m;
    if (state === 'burst' && now > burstUntil) {
      state = 'word';
      wordSnapAt = now + ARRIVE_MS;
      if (lineEl) lineEl.style.opacity = '1';
      if (hintEl) { hintEl.textContent = 'left: stir the motes · right: pan & tilt'; hintEl.style.opacity = '1'; }
    }
    if (autoSpin && state === 'word') yaw += (Math.sin(now * 0.00022) * 0.12 - yaw) * 0.01 * dt;
    var target = state === 'A' ? SHAPE_A : state === 'word' ? SHAPE_WORD : null;
    var k = state === 'A' ? K_SEEK_A : now < wordSnapAt ? K_WORD_ARRIVE : K_SEEK_WORD;
    for (i = 0; i < N; i++) {
      m = motes[i];
      if (target) {
        var t = target[i];
        m.vx += (t.x - m.x) * k * dt; m.vx *= DAMP_SEEK;
        m.vy += (t.y - m.y) * k * dt; m.vy *= DAMP_SEEK;
        m.vz += (t.z - m.z) * k * dt; m.vz *= DAMP_SEEK;
      } else {
        m.vx *= DAMP_COAST; m.vy *= DAMP_COAST; m.vz *= DAMP_COAST;
      }
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      var d = Math.hypot(m.x, m.y, m.z);
      if (d > R_SHELL) {
        var c = R_SHELL / d;
        m.x *= c; m.y *= c; m.z *= c;
        m.vx *= -0.4; m.vy *= -0.4; m.vz *= -0.4;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = T.fade;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = T.comp;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var rect = pushing ? cv.getBoundingClientRect() : null;
    for (i = 0; i < N; i++) {
      m = motes[i];
      var q = project(m, cy, sy, cp, sp);
      if (!q || q.sx < -4 || q.sx > W + 4 || q.sy < -4 || q.sy > H + 4) continue;
      if (pushing) {
        var dx = q.sx - (pushX - rect.left), dy = q.sy - (pushY - rect.top);
        var dist = Math.hypot(dx, dy);
        if (dist < 140 && dist > 0.5) {
          var f = (1 - dist / 140) * 3.4 * dt, ux = dx / dist, uy = dy / dist;
          m.vx += f * (ux * cy + uy * sy * sp);
          m.vy += f * (uy * cp);
          m.vz += f * (ux * sy - uy * cy * sp);
        }
      }
      drawMote(m, q);
    }
    ctx.globalAlpha = 1;
    finishFrame();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

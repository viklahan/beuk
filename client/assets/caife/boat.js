/* The Caife moment on /support: a thank-you note drifts down over a
   dawn sea, folds itself into a paper boat and sails off toward the sun.

   Real-time WebGL on the vendored three.js r128 (client/assets/vendor/,
   SRI-pinned). Nothing here loads from another origin: the sky, the
   water and the paper are all drawn by the shaders and canvases below.

   window.BeukCaife.mount(canvas, { reduce }) returns null when WebGL is
   unavailable (the page keeps its painted fallback), otherwise
     play()    the whole moment, from the note falling to the boat leaving
     sailed()  the boat already out on the water (a return visit)
   and calls opts.onWords() when the thank-you should appear in the page.

   The scene is drawn to an offscreen buffer and then printed onto the
   page: a touch of sharpening, and the paper's tooth showing through the
   ink, so the plate reads as part of the page rather than a video on it. */
(function () {
  'use strict';

  function mount(canvas, opts) {
    opts = opts || {};
    if (!window.THREE) return null;
    var THREE = window.THREE;
    var reduce = !!opts.reduce;

    var renderer;
    try {
      // No antialiasing on the canvas itself: the scene is drawn into the
      // multisampled print buffer below, which smooths its edges.
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false });
    } catch (e) {
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1200);
    var SUN = new THREE.Vector3(0.22, 0.075, -1).normalize();
    // Every colour comes from the page's own palette (opts.palette: the
    // warmth pages' CSS tokens), so the plate reads as part of Beuk's
    // Paper page, not a photograph laid on it. With no tone mapping a
    // token renders as exactly that token: the horizon IS --paper.
    var P = opts.palette || {};
    function tok(v, fallback) {
      var c = new THREE.Color();
      try { c.setStyle(String(v || fallback).trim()); } catch (e) { c.setStyle(fallback); }
      return c.convertSRGBToLinear();
    }
    var COL = {
      paper: tok(P.paper, '#f8f4e9'),
      paperDeep: tok(P.paperDeep, '#eef0e2'),
      sky: tok(P.sky, '#dcebee'),
      accent: tok(P.accent, '#14607a'),
      ink: tok(P.ink, '#22333a')
    };
    function vec(c) { return new THREE.Vector3(c.r, c.g, c.b); }
    // The zenith is the accent-soft wash taken a step toward the accent;
    // the deep sea is the accent taken a step toward the ink.
    var zen = COL.sky.clone().lerp(COL.accent, 0.18);
    var deep = COL.accent.clone().lerp(COL.ink, 0.3);
    var shared = {
      uTime: { value: 0 }, uSun: { value: SUN },
      uHor: { value: vec(COL.paper) }, uMid: { value: vec(COL.paperDeep) }, uZen: { value: vec(zen) },
      uDeep: { value: vec(deep) }, uSea: { value: vec(COL.accent) }
    };

    // ---- sky: one function shared by the dome and the water's reflections ----
    var COMMON = [
      'uniform float uTime; uniform vec3 uSun; uniform vec3 uHor, uMid, uZen, uDeep, uSea;',
      'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
      '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
      'float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }',
      'vec3 skyCol(vec3 d){',
      '  float h = max(d.y, 0.0);',
      '  vec3 c = mix(uHor, uMid, smoothstep(0.02, 0.16, h));',
      '  c = mix(c, uZen, smoothstep(0.12, 0.7, h));',
      '  float s = max(dot(d, uSun), 0.0);',
      '  vec3 glow = lin(vec3(0.98, 0.93, 0.80));',
      '  c = mix(c, glow, pow(s, 10.0) * 0.55 + pow(s, 120.0) * 0.4);',
      '  if (d.y > 0.0) {',
      '    vec2 cp = d.xz / (d.y + 0.06);',
      '    float n = fbm(cp * vec2(0.35, 1.4) + vec2(uTime * 0.008, 0.0));',
      '    float cl = smoothstep(0.52, 0.80, n) * smoothstep(0.01, 0.07, d.y) * (1.0 - smoothstep(0.18, 0.42, d.y));',
      '    c = mix(c, mix(uMid, glow, pow(s, 4.0)), cl * 0.45);',
      '  }',
      '  c = mix(c, lin(vec3(1.0, 0.98, 0.93)), smoothstep(0.99986, 0.99993, s));',
      '  return c;',
      '}'
    ].join('\n');
    var OUT = '\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n';

    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: shared, side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: COMMON + '\nvarying vec3 vDir; void main(){ gl_FragColor = vec4(skyCol(normalize(vDir)), 1.0);' + OUT + '}'
      })
    );
    sky.renderOrder = -1;
    scene.add(sky);

    // ---- water: swell in the vertices (and in swellAt, so the boat rides
    // it), fine chop and ripples only in the per-pixel normal ----
    var RIPS = 6;
    var ripples = [];
    for (var r = 0; r < RIPS; r++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
    var SWELL = [
      [0.8, 0.6, 0.9, 0.035, 0.9],
      [-0.507, 0.862, 1.3, 0.025, 1.2],
      [0.196, -0.981, 2.1, 0.015, 1.7]
    ];
    function swellAt(x, z, t) {
      var h = 0;
      for (var i = 0; i < SWELL.length; i++) {
        var w = SWELL[i];
        h += w[3] * Math.sin((w[0] * x + w[1] * z) * w[2] + t * w[4]);
      }
      return h;
    }
    function glslNum(n) { return n.toFixed(3); }
    var swellGLSL = SWELL.map(function (w) {
      return 'h += ' + glslNum(w[3]) + ' * sin(dot(p, vec2(' + glslNum(w[0]) + ', ' + glslNum(w[1]) + ')) * ' + glslNum(w[2]) + ' + t * ' + glslNum(w[4]) + ');';
    }).join('\n');
    var swellNormGLSL = SWELL.map(function (w) {
      return 'wv(g, p, vec2(' + glslNum(w[0]) + ', ' + glslNum(w[1]) + '), ' + glslNum(w[2]) + ', ' + glslNum(w[3]) + ', ' + glslNum(w[4]) + ');';
    }).join('\n');

    var waterGeo = new THREE.PlaneGeometry(320, 320, 320, 320);
    waterGeo.rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uSun: shared.uSun, uHor: shared.uHor, uMid: shared.uMid, uZen: shared.uZen, uDeep: shared.uDeep, uSea: shared.uSea, uRip: { value: ripples } },
      vertexShader: [
        'uniform float uTime; varying vec3 vW;',
        'float swell(vec2 p, float t){ float h = 0.0;', swellGLSL, 'return h; }',
        'void main(){ vec3 p = position; p.y += swell(p.xz, uTime);',
        '  vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }'
      ].join('\n'),
      fragmentShader: COMMON + '\n' + [
        'uniform vec4 uRip[' + RIPS + ']; varying vec3 vW;',
        'void wv(inout vec2 g, vec2 p, vec2 dir, float f, float a, float sp){ g += dir * f * a * cos(dot(dir, p) * f + uTime * sp); }',
        'void main(){',
        '  vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;',
        '  vec2 p = vW.xz; vec2 g = vec2(0.0);',
        swellNormGLSL,
        '  float fine = exp(-dist * 0.035);',
        '  wv(g, p, vec2(0.953, 0.301), 4.7, 0.010*fine + 0.003, 2.4);',
        '  wv(g, p, vec2(-0.707, 0.707), 6.3, 0.007*fine + 0.002, 2.9);',
        '  wv(g, p, vec2(0.301, 0.953), 9.1, 0.005*fine, 3.6);',
        '  wv(g, p, vec2(-0.914, -0.406), 12.7, 0.0035*fine, 4.1);',
        '  wv(g, p, vec2(0.6, -0.8), 17.3, 0.0025*fine, 5.0);',
        '  wv(g, p, vec2(-0.2, -0.98), 23.9, 0.0018*fine, 6.1);',
        '  for (int i = 0; i < ' + RIPS + '; i++) {',
        '    vec4 r = uRip[i]; float age = uTime - r.z;',
        '    if (age < 0.0 || age > 7.0) continue;',
        '    vec2 d = p - r.xy; float rr = length(d) + 1e-4;',
        '    float env = r.w * exp(-age * 0.65) * exp(-pow((rr - age * 0.55) * 3.0, 2.0));',
        '    g += (d / rr) * env * cos(rr * 22.0 - age * 6.0) * 0.44;',
        '  }',
        '  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));',
        '  vec3 R = reflect(-V, N); R.y = abs(R.y);',
        '  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);',
        '  vec3 body = mix(uDeep, uSea, clamp(0.35 + (g.x + g.y) * 0.8, 0.0, 1.0));',
        '  vec3 col = mix(body, skyCol(R), fres);',
        '  float sd = max(dot(R, uSun), 0.0);',
        '  col += lin(vec3(1.0, 0.97, 0.88)) * (pow(sd, 800.0) * 3.0 + pow(sd, 90.0) * 0.35);',
        '  col = mix(col, skyCol(normalize(vec3(-V.x, 0.0, -V.z))), smoothstep(25.0, 150.0, dist));',
        '  gl_FragColor = vec4(col, 1.0);' + OUT,
        '}'
      ].join('\n')
    })));
    scene.fog = new THREE.Fog(COL.paper.clone(), 40, 170);

    // ---- light ----
    scene.add(new THREE.HemisphereLight(0xeef3ee, 0x4a6e72, 0.62));
    var sunLight = new THREE.DirectionalLight(0xfff1dc, 0.8);
    sunLight.position.copy(SUN).multiplyScalar(20);
    scene.add(sunLight);
    var fill = new THREE.DirectionalLight(0xfffaf0, 0.75);
    fill.position.set(0.4, 0.8, 1.0);
    scene.add(fill);

    // ---- the note that becomes a boat ----
    function paperTexture() {
      var c = document.createElement('canvas');
      c.width = 1024; c.height = 768;
      var g = c.getContext('2d');
      g.fillStyle = P.paper || '#f8f4e9'; g.fillRect(0, 0, 1024, 768);
      var img = g.getImageData(0, 0, 1024, 768), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = (Math.random() - 0.5) * 9;
        d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8;
      }
      g.putImageData(img, 0, 0);
      var vg = g.createRadialGradient(512, 384, 200, 512, 384, 700);
      vg.addColorStop(0, 'rgba(120,90,50,0)'); vg.addColorStop(1, 'rgba(120,90,50,0.10)');
      g.fillStyle = vg; g.fillRect(0, 0, 1024, 768);
      g.textAlign = 'center';
      g.fillStyle = P.accent || '#14607a';
      g.font = '600 22px Literata, Georgia, serif';
      g.fillText('B  E  U  K', 512, 86);
      g.fillRect(452, 104, 120, 1.5);
      g.fillStyle = P.ink || '#22333a';
      g.textAlign = 'left';
      g.font = 'italic 500 88px "Cormorant Garamond", "EB Garamond", Georgia, serif';
      g.fillText('For you,', 150, 252);
      g.fillText('for the caife.', 150, 360);
      g.fillText('Thank you, truly.', 150, 490);
      g.font = 'italic 500 62px "Cormorant Garamond", "EB Garamond", Georgia, serif';
      g.fillText('— Beuk', 560, 640);
      var tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }

    var NU = 64, NV = 48, HW = 1.0, HD = 0.75;
    var count = (NU + 1) * (NV + 1);
    var pos = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    var U = new Float32Array(count), Vv = new Float32Array(count);
    var idx = [], i, j;
    for (j = 0; j <= NV; j++) for (i = 0; i <= NU; i++) {
      var k = j * (NU + 1) + i;
      U[k] = -1 + 2 * i / NU; Vv[k] = -1 + 2 * j / NV;
      uv[k * 2] = (U[k] + 1) / 2; uv[k * 2 + 1] = (1 - Vv[k]) / 2;
    }
    for (j = 0; j < NV; j++) for (i = 0; i < NU; i++) {
      var a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, dd = c + 1;
      idx.push(a, c, b, b, c, dd);
    }
    var sheetGeo = new THREE.BufferGeometry();
    sheetGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sheetGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    sheetGeo.setIndex(idx);

    var paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, emissive: 0x15140f });
    var boat = new THREE.Group();
    boat.rotation.order = 'YXZ';
    var sheet = new THREE.Mesh(sheetGeo, paperMat);
    boat.add(sheet);
    boat.visible = false;
    scene.add(boat);

    // soft contact shadow on the water
    var sc = document.createElement('canvas'); sc.width = sc.height = 128;
    var sg = sc.getContext('2d'), rg = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(8,30,36,0.55)'); rg.addColorStop(1, 'rgba(8,30,36,0)');
    sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.95), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, opacity: 0 }));
    shadow.rotation.order = 'YXZ';
    scene.add(shadow);

    // The boat's shape: the band around v = 0 becomes the sail, the rest the hull.
    var L = 0.80, B = 0.30, HH = 0.30, S = 0.52, C = 0.36;
    function sstep(a, b, x) { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
    function easeIO(x) { x = Math.min(1, Math.max(0, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    var fp = { x: 0, y: 0, z: 0 };
    function folded(u, v) {
      var av = Math.abs(v), sv = v < 0 ? -1 : 1;
      var bp = Math.sqrt(Math.max(0, 1 - u * u));
      var rim = HH + 0.10 * Math.pow(u, 4);
      if (av < C) {
        var s = av / C, t1 = Math.min(1, s / 0.78);
        var prof = Math.max(0, 1 - Math.abs(u) / 0.64);
        fp.x = u * L * 0.92;
        fp.y = rim + (1 - t1) * S * prof;
        fp.z = sv * (0.014 * Math.min(1, s * 3) + (B * bp - 0.014) * sstep(0.78, 1, s));
      } else {
        var t = (av - C) / (1 - C);
        fp.x = u * L * (0.92 - 0.28 * t);
        fp.y = rim * (1 - t);
        fp.z = sv * B * bp * (1 - 0.72 * t);
      }
    }
    // F is the fold, 0 (flat page) to 1 (boat); the outer edges fold first
    // and the sail rises last.
    function shapeSheet(F, flutter, time) {
      for (var k = 0; k < count; k++) {
        var u = U[k], v = Vv[k], av = Math.abs(v);
        var e = easeIO((F - 0.45 * (1 - av)) / 0.55);
        var fx = u * HW, fz = v * HD;
        var fy = flutter * (0.07 * Math.sin(u * 2.2 + time * 2.1) + 0.05 * u * v * Math.sin(time * 1.6));
        folded(u, v);
        pos[k * 3] = fx + (fp.x - fx) * e;
        pos[k * 3 + 1] = fy + (fp.y - fy) * e + Math.sin(Math.PI * e) * 0.16 * (0.3 + (1 - av));
        pos[k * 3 + 2] = fz + (fp.z - fz) * e;
      }
      sheetGeo.attributes.position.needsUpdate = true;
      sheetGeo.computeVertexNormals();
    }

    // ---- timeline (seconds) ----
    var T = { fall: 2.4, hold: 4.6, fold: 7.6, touch: 8.3, sail: 8.5, words: 9.8 };
    var SAILED_AT = 17;
    var mode = 'idle', startAt = 0, nextRip = 0, ripSlot = 2, wordsSent = false;
    var touched = { a: false, b: false }, shapedFinal = false;
    var camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
    var tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
    function lerp3(out, p, q, k) { return out.set(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k); }
    function pathAt(tau) {
      var z = -0.78 * (tau - 2.2 * (1 - Math.exp(-tau / 2.2)));
      return { x: -z * 0.2 + 0.12 * Math.sin(tau * 0.35), z: z };
    }

    function update(t, g) {
      shared.uTime.value = g;
      if (mode === 'idle') {
        camera.position.set(0, 1.05, 3.1);
        camera.lookAt(0, 0.75, 0);
        sky.position.copy(camera.position);
        return;
      }
      var F = 0, flutter = 0, rx = Math.PI / 2, yaw = 0, roll = 0, pitch = 0;
      var x = 0, y, z = 0;

      if (t < T.hold) {
        var kf = 1 - Math.pow(1 - Math.min(1, t / T.fall), 3);
        y = 2.7 + (1.05 - 2.7) * kf + (t > T.fall ? 0.02 * Math.sin((t - T.fall) * 1.6) : 0);
        x = 0.16 * Math.sin(t * 1.3) * (1 - kf);
        flutter = 1 - kf * 0.75;
        roll = 0.03 * Math.sin(t * 1.1);
        pitch = 0.14 * Math.sin(t * 1.7) * (1 - kf);
      } else if (t < T.touch) {
        var k1 = sstep(T.hold, T.hold + 1.7, t);
        rx = Math.PI / 2 * (1 - k1);
        F = easeIO((t - T.hold - 0.5) / (T.fold - T.hold - 0.5));
        flutter = 0.25 * (1 - k1);
        y = 1.05 + (0.42 - 1.05) * sstep(T.hold, T.fold, t);
        if (t > T.fold) {
          var kt = (t - T.fold) / (T.touch - T.fold);
          y = 0.42 + (swellAt(0, 0, g) - 0.06 - 0.42) * kt * kt;
        }
      } else {
        F = 1; rx = 0;
        var p = pathAt(Math.max(0, t - T.sail));
        x = p.x; z = p.z;
        yaw = Math.PI / 2 * 0.62 * sstep(T.sail, T.sail + 4.5, t);
        y = swellAt(x, z, g) - 0.06;
        var fx = Math.cos(yaw), fz = -Math.sin(yaw);
        pitch = Math.atan2(swellAt(x + fx * 0.5, z + fz * 0.5, g) - swellAt(x - fx * 0.5, z - fz * 0.5, g), 1.0);
        roll = -Math.atan2(swellAt(x - fz * 0.3, z + fx * 0.3, g) - swellAt(x + fz * 0.3, z - fx * 0.3, g), 0.6);
      }

      if (t < T.touch + 0.1) { shapeSheet(F, flutter, t); shapedFinal = false; }
      else if (!shapedFinal) { shapeSheet(1, 0, t); shapedFinal = true; }
      boat.position.set(x, y, z);
      boat.rotation.set(rx + roll, yaw, pitch);

      // touch-down rings, then a quiet wake
      if (t >= T.touch && !touched.a) { touched.a = true; ripples[0].set(x, z, g, 1.0); }
      if (t >= T.touch + 0.55 && !touched.b) { touched.b = true; ripples[1].set(x, z, g, 0.6); }
      if (t > T.sail + 1.5 && g > nextRip) {
        ripples[ripSlot].set(x - Math.cos(yaw) * 0.7, z + Math.sin(yaw) * 0.7, g, 0.32);
        ripSlot = ripSlot >= RIPS - 1 ? 2 : ripSlot + 1;
        nextRip = g + 0.95;
      }

      shadow.position.set(x, swellAt(x, z, g) + 0.012, z);
      shadow.rotation.set(-Math.PI / 2, yaw, 0);
      shadow.material.opacity = (1 - sstep(0.4, 1.4, y)) * (t > T.hold ? 1 : 0.4);

      // camera: read the note, watch it fold, then let it go
      var kA = sstep(T.hold, T.fold, t), kB = sstep(T.sail, T.sail + 7, t);
      if (t < T.sail) lerp3(camPos, [0, 1.05, 3.1], [0.3, 0.92, 2.7], kA);
      else lerp3(camPos, [0.3, 0.92, 2.7], [0.55, 1.3, 3.7], kB);
      camPos.z += Math.min(0, z) * 0.12;
      lerp3(tmpA, [0, 1.0, 0], [0, 0.42, 0], kA);
      if (t >= T.sail) {
        tmpB.set(x * 0.7, 0.38 - 0.1 * kB, Math.min(0, z));
        tmpA.lerp(tmpB, sstep(T.sail, T.sail + 3, t));
      }
      camLook.copy(tmpA);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      sky.position.copy(camera.position);
      fill.intensity = 0.75 - 0.35 * kA;

      if (t > T.words && !wordsSent) {
        wordsSent = true;
        if (opts.onWords) opts.onWords();
      }
    }

    // ---- the print: the scene goes to a buffer (kept in sRGB, so the
    // shader below works on the colours as the page shows them), then one
    // full-screen pass sharpens it a little and lays the paper's tooth over
    // it. The tooth is fixed to the page, in CSS pixels, so it stays put
    // while the sea moves behind it, the way a printed plate would. ----
    var printBuf = renderer.capabilities.isWebGL2
      ? new THREE.WebGLMultisampleRenderTarget(1, 1)
      : new THREE.WebGLRenderTarget(1, 1);
    printBuf.texture.encoding = THREE.sRGBEncoding;
    var paperOnPage = new THREE.Color();
    try { paperOnPage.setStyle(String(P.paper || '#f8f4e9').trim()); } catch (e) { paperOnPage.setStyle('#f8f4e9'); }
    var printMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: printBuf.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDpr: { value: 1 },
        uPaper: { value: new THREE.Vector3(paperOnPage.r, paperOnPage.g, paperOnPage.b) },
        uSharp: { value: 0.7 }, uGrain: { value: 0.06 }, uSkip: { value: 0.22 }
      },
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tScene; uniform vec2 uTexel; uniform float uDpr, uSharp, uGrain, uSkip; uniform vec3 uPaper; varying vec2 vUv;',
        'float h21(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }',
        'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
        '  return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }',
        'void main(){',
        '  vec3 c = texture2D(tScene, vUv).rgb;',
        // unsharp mask over the four neighbours
        '  vec3 nb = texture2D(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(uTexel.x, 0.0)).rgb',
        '         + texture2D(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, uTexel.y)).rgb;',
        '  c = clamp(c + (c - nb * 0.25) * uSharp, 0.0, 1.0);',
        // the paper: fine tooth, a few long fibres, a faint mottle
        '  vec2 q = gl_FragCoord.xy / uDpr;',
        '  float tooth = mix(h21(floor(q)), vn(q * 0.7), 0.5);',
        '  float fibre = vn(q * vec2(0.06, 0.8) + vec2(0.0, vn(q * 0.02) * 6.0));',
        '  float mottle = vn(q * 0.012);',
        '  float grain = tooth * 0.6 + fibre * 0.25 + mottle * 0.15 - 0.5;',
        '  float lum = dot(c, vec3(0.299, 0.587, 0.114));',
        // ink takes the tooth most in its darker tones ...
        '  c += grain * (uGrain + uGrain * 1.6 * (1.0 - lum));',
        // ... and on the deepest, a little paper shows through
        '  c = mix(c, uPaper, smoothstep(0.62, 0.92, tooth) * (1.0 - lum) * uSkip);',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
      ].join('\n')
    });
    var printScene = new THREE.Scene();
    var printCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    printScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), printMat));
    var drawSize = new THREE.Vector2();

    // ---- sizing: the canvas fills its frame, whatever the frame's shape ----
    function resize() {
      var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(drawSize);
      printBuf.setSize(drawSize.x, drawSize.y);
      printMat.uniforms.uTexel.value.set(1 / drawSize.x, 1 / drawSize.y);
      printMat.uniforms.uDpr.value = renderer.getPixelRatio();
      camera.aspect = w / h;
      var halfV = 21 * Math.PI / 180;
      camera.fov = camera.aspect < 1.25 ? Math.min(78, 2 * Math.atan(Math.tan(halfV) * 1.25 / camera.aspect) * 180 / Math.PI) : 42;
      camera.updateProjectionMatrix();
      if (reduce) frame();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);

    // The scene keeps its own clock, which only runs while frames are drawn:
    // Ko-fi opens in a new tab, and when the writer comes back the note is
    // still waiting to fold rather than long gone.
    var clock = 0, lastTick = 0;
    function now() { return clock; }

    // Draw only while the plate is on screen and the tab is visible.
    var inView = true, running = false;
    function frame() {
      var g = reduce ? 6 : clock;
      var t = mode === 'sailed' ? SAILED_AT + (g - startAt) : g - startAt;
      update(reduce && mode !== 'idle' ? (mode === 'sailed' ? SAILED_AT : 15) : t, g);
      renderer.setRenderTarget(printBuf);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(printScene, printCam);
    }
    function loop(ts) {
      if (!inView || document.hidden || reduce) { running = false; return; }
      if (lastTick) clock += Math.min(0.1, (ts - lastTick) / 1000);
      lastTick = ts;
      frame();
      requestAnimationFrame(loop);
    }
    function wake() {
      if (reduce) { frame(); return; }
      if (!running && inView && !document.hidden) { running = true; lastTick = 0; requestAnimationFrame(loop); }
    }
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        inView = entries[entries.length - 1].isIntersecting;
        wake();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', wake);

    function reset(nextMode) {
      mode = nextMode;
      startAt = now();
      touched.a = touched.b = false;
      wordsSent = false;
      shapedFinal = false;
      for (var i = 0; i < RIPS; i++) ripples[i].set(0, 0, -100, 0);
      boat.visible = nextMode !== 'idle';
      shadow.visible = boat.visible;
      wake();
    }

    // The note is painted onto a canvas, so its faces must be loaded first;
    // asking now means they are ready long before anyone clicks.
    if (document.fonts && document.fonts.load) {
      document.fonts.load('italic 500 88px "Cormorant Garamond"').catch(function () {});
      document.fonts.load('600 22px Literata').catch(function () {});
    }
    var textured = false;
    function ensureTexture() {
      if (textured) return;
      textured = true;
      paperMat.map = paperTexture();
      paperMat.needsUpdate = true;
    }

    resize();
    reset('idle');

    return {
      play: function () {
        ensureTexture();
        reset('play');
        if (reduce && opts.onWords) opts.onWords();
      },
      sailed: function () {
        ensureTexture();
        reset('sailed');
        wordsSent = true;
      }
    };
  }

  window.BeukCaife = { mount: mount };
})();

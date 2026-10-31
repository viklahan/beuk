/* BEUK:lighthouse — the Help home's status as a night harbour (three.js r128,
   Beuk's vendored copy; nothing loads from another origin).

   The lighthouse is the server: its lamp breathes and its beam sweeps while
   /api/status/public answers, flickers amber when a part needs a look, and
   goes dark when the server does not answer. Each part the server reports is
   a named buoy: green up, orange needs a look (not set up included), red
   dead. Hover or tap a buoy for the server's own words; drag to turn the
   view a little; the button sends a shooting star.

   Kind to the machine: drawn only while the scene is on screen and the tab
   is visible, polled every 30 s only while visible, one still frame at a
   time for people who turn motion off. Without three.js or WebGL the
   server's plain reading underneath is opened instead. */
(function () {
  'use strict';
  function start() {
  var host = document.getElementById('lighthouse');
  if (!host) return;
  var reading = document.querySelector('.lh-reading');
  var meteorBtn = document.getElementById('lh-meteor');
  // Without three.js or WebGL the server's plain reading stands, opened.
  function plain() { host.hidden = true; if (reading) reading.open = true; if (meteorBtn) meteorBtn.hidden = true; }
  if (!window.THREE) { plain(); return; }
  var T = THREE;

  var POLL_MS = 30000;
  var STATUS_URL = host.getAttribute('data-status-url') || '/api/status/public';
  // Three colours: green up, orange needs a look, red dead. Not set up is not dead.
  var COL = { ok: 0x3ee87a, attention: 0xff9628, off: 0xff9628, down: 0xff3b30 };
  var WORD = { ok: 'up', attention: 'needs a look', off: 'needs a look', down: 'dead' };
  // The parts the server reports (src/ops/status.ts), in its order: used until the first answer.
  var PARTS = [
    { id: 'studio', name: 'Studio', state: 'ok', text: '' },
    { id: 'shelf', name: 'Shelf', state: 'ok', text: '' },
    { id: 'help', name: 'Help', state: 'ok', text: '' },
    { id: 'serverChecks', name: 'Server checks', state: 'ok', text: '' },
    { id: 'email', name: 'Email', state: 'ok', text: '' },
    { id: 'backups', name: 'Backups', state: 'ok', text: '' }
  ];
  var mode = 'up'; // up | warn (a part needs a look) | down (the server did not answer)
  var headline = '', lastAnswer = 0, nextLook = 0;
  function stateOf(p) {
    if (mode === 'down') return p.id === 'studio' ? 'attention' : 'down';
    return COL[p.state] !== undefined ? p.state : 'attention';
  }
  function tipText(p) {
    if (mode === 'down') return p.id === 'studio' ? 'Once it has loaded, the studio keeps working on your device without the server.' : 'No answer from the server right now.';
    return p.text;
  }

  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var onScreen = true, queued = false;
  function running() { return onScreen && !document.hidden; }
  function kick() { if (!queued && running() && typeof frame === 'function') { queued = true; requestAnimationFrame(frame); } }

  /* ---------------- renderer: MSAA plus supersampling for clean edges ---------------- */
  var renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { plain(); return; }
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 1.5, 2.5));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.insertBefore(renderer.domElement, host.firstChild);
  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(38, 2, 0.1, 600);
  var camAngle = 0, camTarget = 0, camDist = 27;
  function placeCamera() {
    camera.position.set(Math.sin(camAngle) * camDist, 6.2 + (camDist - 27) * 0.08, Math.cos(camAngle) * camDist);
    camera.lookAt(0, 3.6, 0);
  }

  var MOON = new T.Vector3(-0.42, 0.24, -1).normalize();

  /* ---------------- shared GLSL ---------------- */
  var NOISE = `
    float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
    vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    vec3 skyBase(vec3 d, vec3 moon, float dark){
      float y = clamp(d.y, -0.2, 1.0);
      vec3 zen = vec3(0.006, 0.018, 0.034);
      vec3 hor = mix(vec3(0.055, 0.115, 0.15), vec3(0.03, 0.06, 0.08), dark);
      vec3 c = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.45));
      float m = max(dot(d, moon), 0.0);
      c += vec3(0.22, 0.30, 0.36) * pow(m, 18.0) * 0.55 + vec3(0.10, 0.14, 0.17) * pow(m, 4.0) * 0.35;
      return c;
    }`;

  /* ---------------- sky: gradient, moon, stars, Milky Way, clouds, shooting star ---------------- */
  var skyU = { uTime: { value: 0 }, uMoon: { value: MOON }, uDark: { value: 0 },
    uMH: { value: new T.Vector3(0, 1, 0) }, uMT: { value: new T.Vector3(0, 1, 0) }, uMA: { value: 0 } };
  var sky = new T.Mesh(new T.SphereGeometry(400, 64, 32), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, toneMapped: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: NOISE + `
      uniform float uTime, uDark, uMA; uniform vec3 uMoon, uMH, uMT; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        vec3 c = skyBase(d, uMoon, uDark);
        float above = smoothstep(-0.01, 0.06, d.y);
        // Milky Way: a soft band across the sky, mottled with dust
        vec3 bandN = normalize(vec3(0.55, 0.35, 0.75));
        float band = exp(-pow(dot(d, bandN) / 0.16, 2.0));
        vec2 bp = d.xz / (d.y + 0.35) * 3.0;
        float dust = fbm(bp * 2.2) ; float lanes = smoothstep(0.45, 0.75, fbm(bp * 4.0 + 3.1));
        c += vec3(0.08, 0.09, 0.11) * band * dust * (1.0 - 0.7 * lanes) * above;
        // stars: one per cell at most, varied size and colour, twinkling
        float starAcc = 0.0; vec3 starCol = vec3(0.0);
        vec3 sp = d * 170.0;
        vec3 cell = floor(sp);
        for (int i = 0; i < 2; i++) {
          vec3 cc = cell + float(i) * vec3(0.5);
          vec3 h = hash33(floor(cc));
          float thresh = 0.965 - band * 0.05;
          if (h.x > thresh) {
            vec3 ctr = floor(cc) + 0.2 + 0.6 * hash33(floor(cc) + 7.0);
            float dist = length(sp - ctr);
            float size = mix(0.10, 0.34, pow(h.y, 3.0));
            float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h.z * 4.0) + h.y * 40.0);
            float s = smoothstep(size, 0.0, dist) * tw * mix(0.5, 1.6, h.z);
            starAcc += s;
            starCol += s * mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.7), h.y);
          }
        }
        float moonVeil = 1.0 - smoothstep(0.93, 0.995, dot(d, uMoon)) * 0.9;
        c += starCol * above * moonVeil * (1.0 - smoothstep(0.0, 0.25, 0.25 - d.y));
        // the moon: a disc with maria and a soft limb
        float md = acos(clamp(dot(d, uMoon), -1.0, 1.0));
        float disc = smoothstep(0.0215, 0.0195, md);
        vec3 mt = normalize(cross(uMoon, vec3(0, 1, 0))); vec3 mb = cross(mt, uMoon);
        vec2 mp = vec2(dot(d, mt), dot(d, mb)) / 0.02;
        float maria = fbm(mp * 2.3 + 4.0);
        vec3 moonCol = mix(vec3(1.0, 0.98, 0.92), vec3(0.72, 0.74, 0.76), smoothstep(0.45, 0.7, maria));
        moonCol *= 0.92 + 0.08 * (1.0 - length(mp) * 0.5);
        c = mix(c, moonCol * 1.25, disc);
        // clouds: thin drifting wisps, silvered near the moon
        vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
        float cl = smoothstep(0.52, 0.85, fbm(cp * 1.3) * 0.75 + fbm(cp * 4.1) * 0.35);
        float lit = pow(max(dot(d, uMoon), 0.0), 8.0);
        vec3 cloudCol = mix(vec3(0.05, 0.08, 0.10), vec3(0.42, 0.48, 0.52), lit);
        c = mix(c, cloudCol, cl * 0.75 * above * (1.0 - disc * 0.6));
        // shooting star: a short great-circle streak with a bright head and a fading tail
        if (uMA > 0.0) {
          vec3 ab = uMH - uMT; float s = clamp(dot(d - uMT, ab) / dot(ab, ab), 0.0, 1.0);
          float dd = length(d - (uMT + ab * s));
          float w = mix(0.0010, 0.0032, s);
          float m = smoothstep(w, 0.0, dd) * s * s;
          float head = exp(-length(d - uMH) / 0.0045) * 1.4;
          c += vec3(0.95, 0.97, 1.0) * (m * 2.4 + head) * uMA;
        }
        // haze at the horizon
        c = mix(c, skyBase(vec3(d.x, 0.0, d.z), uMoon, uDark) * 1.1, smoothstep(0.12, 0.0, d.y) * 0.85);
        gl_FragColor = vec4(c, 1.0);
      }`
  }));
  scene.add(sky);

  /* ---------------- sea ---------------- */
  var NL = 7;
  var seaU = {
    uTime: { value: 0 }, uMoon: { value: MOON }, uDark: { value: 0 },
    uBeamDir: { value: new T.Vector2(1, 0) }, uBeam: { value: 1 }, uBeamCol: { value: new T.Color(0xffd890) },
    uLP: { value: Array.from({ length: NL }, function () { return new T.Vector3(); }) },
    uLC: { value: Array.from({ length: NL }, function () { return new T.Vector3(); }) }
  };
  var sea = new T.Mesh(new T.PlaneGeometry(800, 800, 300, 300), new T.ShaderMaterial({
    uniforms: seaU, toneMapped: false,
    vertexShader: `
      uniform float uTime; varying vec3 vW;
      float swell(vec2 p, float t){
        return sin(dot(p, vec2(0.21, 0.13)) + t * 0.9) * 0.22 + sin(dot(p, vec2(-0.15, 0.27)) + t * 1.15) * 0.16 + sin(dot(p, vec2(0.41, -0.33)) + t * 1.7) * 0.06;
      }
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0);
        float fade = 1.0 / (1.0 + length(wp.xz) * 0.02);
        wp.y += swell(wp.xz, uTime) * fade; vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: NOISE + `
      uniform float uTime, uDark, uBeam; uniform vec3 uMoon; uniform vec2 uBeamDir; uniform vec3 uBeamCol;
      uniform vec3 uLP[${NL}]; uniform vec3 uLC[${NL}]; varying vec3 vW;
      float ripples(vec2 p, float t){
        float h = 0.0;
        h += vnoise(p * 0.9 + vec2(t * 0.35, t * 0.12)) * 0.5;
        h += vnoise(p * 2.1 - vec2(t * 0.25, -t * 0.4)) * 0.25;
        h += vnoise(p * 4.7 + vec2(-t * 0.6, t * 0.5)) * 0.12;
        h += vnoise(p * 9.3 + vec2(t * 0.9, t * 0.7)) * 0.06;
        return h;
      }
      void main(){
        vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
        // detail fades with distance so the far sea never shimmers
        float amp = 0.55 / (1.0 + dist * 0.045);
        float e = 0.06 + dist * 0.004;
        vec2 p = vW.xz;
        float hx = ripples(p + vec2(e, 0.0), uTime) - ripples(p - vec2(e, 0.0), uTime);
        float hz = ripples(p + vec2(0.0, e), uTime) - ripples(p - vec2(0.0, e), uTime);
        vec3 N = normalize(vec3(-hx * amp / e, 1.0, -hz * amp / e));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 refl = skyBase(R, uMoon, uDark);
        // the moon's path: a sharp glint on each ripple facing it
        float mg = pow(max(dot(R, uMoon), 0.0), 900.0) * 9.0 + pow(max(dot(R, uMoon), 0.0), 90.0) * 0.5;
        refl += vec3(1.0, 0.97, 0.9) * mg;
        vec3 deep = vec3(0.004, 0.022, 0.03);
        vec3 c = mix(deep, refl, fres);
        // lights on the water: the lamp and each buoy, drawn out into streaks by the ripples
        for (int i = 0; i < ${NL}; i++) {
          vec3 L = uLP[i] - vW; float ld = length(L); L /= ld;
          float sp = pow(max(dot(R, L), 0.0), 220.0) * 6.0 + pow(max(dot(R, L), 0.0), 30.0) * 0.25;
          c += uLC[i] * sp / (1.0 + ld * 0.08);
          c += uLC[i] * 0.06 / (1.0 + ld * ld * 0.12);
        }
        // the beam crossing the sea
        float r = length(vW.xz); vec2 dir = vW.xz / max(r, 0.001);
        float a = max(dot(dir, uBeamDir), 0.0);
        float beam = pow(a, 80.0) * smoothstep(90.0, 3.0, r) * uBeam;
        c += uBeamCol * beam * (0.18 + 0.6 * pow(max(N.y - 0.9, 0.0) * 10.0, 2.0)) * 0.6;
        // foam where the swell meets the rock
        float foamRing = smoothstep(7.4, 5.4, r) * smoothstep(4.6, 5.3, r);
        float foam = foamRing * smoothstep(0.45, 0.8, fbm(p * 1.6 + vec2(uTime * 0.2, -uTime * 0.15)));
        c = mix(c, vec3(0.32, 0.38, 0.4), foam * 0.55);
        // into the haze at the horizon
        vec3 hazeCol = skyBase(normalize(vec3(-V.x, 0.0, -V.z)), uMoon, uDark) * 1.1;
        c = mix(c, hazeCol, smoothstep(60.0, 300.0, dist));
        gl_FragColor = vec4(c, 1.0);
      }`
  }));
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);

  /* ---------------- light ---------------- */
  scene.add(new T.HemisphereLight(0x6f93a6, 0x050b0d, 0.45));
  var moonLight = new T.DirectionalLight(0xb9d3e6, 0.7);
  moonLight.position.copy(MOON).multiplyScalar(50); scene.add(moonLight);

  /* ---------------- the rock ---------------- */
  function n3(x, y, z) { return Math.sin(x * 1.7 + Math.sin(z * 1.3)) * 0.5 + Math.sin(z * 2.3 + x * 0.7) * 0.3 + Math.sin(y * 3.1 + x * 2.9 + z * 1.1) * 0.2; }
  var rockGeo = new T.SphereGeometry(1, 192, 96); // indexed, so its normals are smooth
  var pos = rockGeo.attributes.position, cols = [];
  for (var i = 0; i < pos.count; i++) {
    var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    var k = 1 + n3(x * 3, y * 3, z * 3) * 0.12 + n3(x * 9, y * 9, z * 9) * 0.045 + n3(x * 23, y * 23, z * 23) * 0.015;
    x *= 6.0 * k; z *= 6.0 * k; y = y > 0 ? y * 1.5 * k : y * 2.5;
    if (y > 0.9) y = 0.9 + (y - 0.9) * 0.25; // a flat top for the tower to stand on
    pos.setXYZ(i, x, y - 0.25, z);
    var wet = THREE.MathUtils.smoothstep(y, -0.1, 0.6);
    var g = 0.018 + 0.03 * wet + Math.max(0, n3(x * 4, y * 4, z * 4)) * 0.012;
    cols.push(g * 0.9, g * (0.95 + 0.25 * wet), g * 0.92);
  }
  rockGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
  rockGeo.computeVertexNormals();
  var rock = new T.Mesh(rockGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 }));
  scene.add(rock);

  /* ---------------- the lighthouse ---------------- */
  function seeded(n) { return function () { n = (n + 0x6D2B79F5) | 0; var t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function towerTextures() {
    var W = 1024, H = 2048, rnd = seeded(7);
    var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    var b = document.createElement('canvas'); b.width = W; b.height = H; var y = b.getContext('2d');
    var V = function (v) { return H * (1 - v); };
    // old lime plaster, never quite one colour
    x.fillStyle = '#ddd5c2'; x.fillRect(0, 0, W, H);
    y.fillStyle = '#808080'; y.fillRect(0, 0, W, H);
    for (var i = 0; i < 180; i++) { var px = rnd() * W, py = rnd() * H, pr = 30 + rnd() * 140; var g = x.createRadialGradient(px, py, 0, px, py, pr);
      var tone = rnd() < 0.5 ? '120,105,80' : (rnd() < 0.5 ? '235,230,215' : '150,150,135'); g.addColorStop(0, 'rgba(' + tone + ',' + (0.05 + rnd() * 0.08) + ')'); g.addColorStop(1, 'rgba(' + tone + ',0)'); x.fillStyle = g; x.fillRect(px - pr, py - pr, pr * 2, pr * 2); }
    // the red bands: faded, chalky, and peeling back to the plaster
    function band(v0, v1) {
      var top = V(v1), h = V(v0) - V(v1);
      x.fillStyle = '#8f2a22'; x.fillRect(0, top, W, h);
      for (var k = 0; k < 900; k++) { x.fillStyle = 'rgba(' + (rnd() < 0.5 ? '200,120,100' : '70,20,15') + ',' + (rnd() * 0.12) + ')'; x.fillRect(rnd() * W, top + rnd() * h, 3 + rnd() * 18, 2 + rnd() * 6); }
      for (var p = 0; p < 70; p++) { var fx = rnd() * W, fy = top + (rnd() < 0.5 ? rnd() * 18 : h - rnd() * 18 - 10) + (rnd() - 0.5) * h * 0.6, fw = 8 + rnd() * 40, fh = 4 + rnd() * 16;
        x.fillStyle = 'rgba(205,195,175,' + (0.6 + rnd() * 0.4) + ')'; x.beginPath(); x.ellipse(fx, fy, fw, fh, rnd() * 3, 0, Math.PI * 2); x.fill();
        y.fillStyle = 'rgba(40,40,40,.6)'; y.beginPath(); y.ellipse(fx, fy, fw, fh, rnd() * 3, 0, Math.PI * 2); y.fill(); }
      // ragged edges
      for (var e = 0; e < W; e += 6) { x.fillStyle = '#8f2a22'; x.fillRect(e, top - rnd() * 5, 6, 5); x.fillRect(e, top + h, 6, rnd() * 5); }
    }
    band(0.24, 0.37); band(0.6, 0.73);
    // masonry courses: the stone shows through the render as faint lines, deeper near the foot
    for (var cy = H; cy > 0; cy -= 34) {
      var low = cy / H;
      x.fillStyle = 'rgba(60,55,45,' + (0.05 + 0.12 * low * low) + ')'; x.fillRect(0, cy, W, 2);
      y.fillStyle = 'rgba(30,30,30,' + (0.35 + 0.4 * low) + ')'; y.fillRect(0, cy, W, 2.5);
      var off = (cy / 34) % 2 ? 0 : 60;
      if (low > 0.72) for (var jx = off; jx < W; jx += 120) { x.fillStyle = 'rgba(60,55,45,' + (0.08 + 0.1 * low) + ')'; x.fillRect(jx, cy - 34, 2, 34); y.fillStyle = 'rgba(30,30,30,.6)'; y.fillRect(jx, cy - 34, 2.5, 34); }
    }
    // windows and the door, then rust weeping from their sills
    function rust(rx, ry, len, wdt, a) { var gr = x.createLinearGradient(0, ry, 0, ry + len); gr.addColorStop(0, 'rgba(110,55,25,' + a + ')'); gr.addColorStop(1, 'rgba(110,55,25,0)'); x.fillStyle = gr; x.fillRect(rx, ry, wdt, len); }
    [[0.47, 0.25], [0.8, 0.75], [0.45, 0.75], [0.82, 0.25]].forEach(function (w) {
      var wx = w[1] * W, wy = V(w[0]);
      x.fillStyle = '#6e6a60'; x.fillRect(wx - 30, wy - 48, 60, 96);
      x.fillStyle = '#141b1d'; x.fillRect(wx - 21, wy - 39, 42, 78);
      x.fillStyle = 'rgba(255,205,120,0.35)'; x.fillRect(wx - 19, wy - 1, 38, 2); x.fillRect(wx - 1, wy - 37, 2, 74);
      y.fillStyle = '#303030'; y.fillRect(wx - 21, wy - 39, 42, 78); y.fillStyle = '#b0b0b0'; y.fillRect(wx - 30, wy + 40, 60, 8);
      for (var r = 0; r < 5; r++) rust(wx - 22 + rnd() * 44, wy + 46, 120 + rnd() * 260, 2 + rnd() * 5, 0.25 + rnd() * 0.3);
    });
    x.fillStyle = '#5c5850'; x.fillRect(W / 2 - 58, V(0.15), 116, H * 0.15 - 20);
    x.fillStyle = '#2b1f17'; x.fillRect(W / 2 - 46, V(0.15) + 12, 92, H * 0.15 - 32);
    for (var dpl = 0; dpl < 6; dpl++) { x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(W / 2 - 46, V(0.15) + 30 + dpl * 46, 92, 2); }
    // streaks from the gallery: salt and rust running down from the top
    for (var s2 = 0; s2 < 90; s2++) { var sx = rnd() * W; rust(sx, 0, 200 + rnd() * 700, 1.5 + rnd() * 4, 0.08 + rnd() * 0.18); }
    for (var s3 = 0; s3 < 60; s3++) { var gx = rnd() * W, gl = 300 + rnd() * 900; var sg = x.createLinearGradient(0, 0, 0, gl); sg.addColorStop(0, 'rgba(70,70,60,.12)'); sg.addColorStop(1, 'rgba(70,70,60,0)'); x.fillStyle = sg; x.fillRect(gx, 0, 3 + rnd() * 10, gl); }
    // hairline cracks
    for (var ck = 0; ck < 26; ck++) { var kx = rnd() * W, ky = H * (0.25 + rnd() * 0.7); x.strokeStyle = 'rgba(50,45,35,.45)'; y.strokeStyle = 'rgba(20,20,20,.9)'; x.lineWidth = y.lineWidth = 1.2;
      x.beginPath(); y.beginPath(); x.moveTo(kx, ky); y.moveTo(kx, ky);
      for (var seg = 0; seg < 8; seg++) { kx += (rnd() - 0.5) * 30; ky += 8 + rnd() * 22; x.lineTo(kx, ky); y.lineTo(kx, ky); } x.stroke(); y.stroke(); }
    // the sea's mark: a green-brown wet band at the foot, crusted with salt above it
    var tide = x.createLinearGradient(0, H * 0.78, 0, H); tide.addColorStop(0, 'rgba(70,80,55,0)'); tide.addColorStop(0.35, 'rgba(70,80,55,.35)'); tide.addColorStop(0.7, 'rgba(45,60,40,.7)'); tide.addColorStop(1, 'rgba(25,35,28,.92)'); x.fillStyle = tide; x.fillRect(0, H * 0.78, W, H * 0.22);
    for (var al = 0; al < 1400; al++) { var ax = rnd() * W, ay = H * (0.82 + rnd() * 0.18); x.fillStyle = 'rgba(' + (rnd() < 0.6 ? '40,70,40' : '80,70,40') + ',' + (0.1 + rnd() * 0.3) + ')'; x.beginPath(); x.arc(ax, ay, 2 + rnd() * 9, 0, Math.PI * 2); x.fill(); }
    for (var sl = 0; sl < 500; sl++) { var lx = rnd() * W, ly = H * (0.7 + rnd() * 0.12); x.fillStyle = 'rgba(245,245,235,' + (0.08 + rnd() * 0.2) + ')'; x.beginPath(); x.arc(lx, ly, 1 + rnd() * 6, 0, Math.PI * 2); x.fill(); }
    // fine grit everywhere
    for (var gr2 = 0; gr2 < 40000; gr2++) { var v = rnd(); x.fillStyle = 'rgba(' + (v < 0.5 ? '35,30,25' : '255,255,250') + ',' + (rnd() * 0.07) + ')'; x.fillRect(rnd() * W, rnd() * H, 2, 2); y.fillStyle = 'rgba(' + (v < 0.5 ? '60,60,60' : '170,170,170') + ',.25)'; y.fillRect(rnd() * W, rnd() * H, 2, 2); }
    var map = new T.CanvasTexture(c); map.encoding = T.sRGBEncoding; map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    var bump = new T.CanvasTexture(b); bump.anisotropy = map.anisotropy;
    return { map: map, bump: bump };
  }
  function stoneTextures() {
    var W = 1024, H = 128, rnd = seeded(11);
    var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
    var b = document.createElement('canvas'); b.width = W; b.height = H; var y = b.getContext('2d');
    x.fillStyle = '#4d4a43'; x.fillRect(0, 0, W, H); y.fillStyle = '#909090'; y.fillRect(0, 0, W, H);
    for (var row = 0; row < 3; row++) { var off = row % 2 ? 40 : 0;
      for (var bx = -off; bx < W; bx += 80 + rnd() * 30) { var bw = 70 + rnd() * 30, by = row * (H / 3);
        var t = 60 + rnd() * 40; x.fillStyle = 'rgb(' + t + ',' + (t - 3) + ',' + (t - 10) + ')'; x.fillRect(bx + 3, by + 3, bw - 6, H / 3 - 6);
        y.fillStyle = '#c0c0c0'; y.fillRect(bx + 3, by + 3, bw - 6, H / 3 - 6); } }
    var wet = x.createLinearGradient(0, 0, 0, H); wet.addColorStop(0, 'rgba(30,45,32,.2)'); wet.addColorStop(1, 'rgba(20,32,24,.7)'); x.fillStyle = wet; x.fillRect(0, 0, W, H);
    for (var i = 0; i < 4000; i++) { x.fillStyle = 'rgba(' + (rnd() < 0.5 ? '20,20,18' : '200,200,190') + ',' + (rnd() * 0.1) + ')'; x.fillRect(rnd() * W, rnd() * H, 2, 2); }
    var map = new T.CanvasTexture(c); map.encoding = T.sRGBEncoding; map.wrapS = T.RepeatWrapping; map.repeat.set(3, 1);
    var bump = new T.CanvasTexture(b); bump.wrapS = T.RepeatWrapping; bump.repeat.set(3, 1);
    return { map: map, bump: bump };
  }
  var tower = new T.Group(); tower.position.y = 0.62; scene.add(tower);
  var prof = []; for (var pi = 0; pi <= 24; pi++) { var v = pi / 24; prof.push(new T.Vector2(1.38 - 0.42 * v - 0.06 * Math.sin(v * Math.PI), v * 6.6)); }
  var tt = towerTextures();
  var body = new T.Mesh(new T.LatheGeometry(prof, 160), new T.MeshStandardMaterial({ map: tt.map, bumpMap: tt.bump, bumpScale: 0.035, roughness: 0.9 }));
  tower.add(body);
  var st = stoneTextures();
  var plinth = new T.Mesh(new T.CylinderGeometry(1.62, 1.8, 0.55, 128), new T.MeshStandardMaterial({ map: st.map, bumpMap: st.bump, bumpScale: 0.05, roughness: 0.85 })); plinth.position.y = -0.05; tower.add(plinth);
  var dark = new T.MeshStandardMaterial({ color: 0x23201c, roughness: 0.7, metalness: 0.5 });
  var deck = new T.Mesh(new T.CylinderGeometry(1.32, 1.12, 0.16, 96), dark); deck.position.y = 6.68; tower.add(deck);
  var rail = new T.Mesh(new T.TorusGeometry(1.26, 0.022, 10, 128), dark); rail.rotation.x = Math.PI / 2; rail.position.y = 7.18; tower.add(rail);
  var rail2 = rail.clone(); rail2.position.y = 6.95; tower.add(rail2);
  for (var r = 0; r < 28; r++) { var post = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.48, 8), dark); var ang = r / 28 * Math.PI * 2; post.position.set(Math.cos(ang) * 1.26, 6.98, Math.sin(ang) * 1.26); tower.add(post); }
  var base = new T.Mesh(new T.CylinderGeometry(0.78, 0.8, 0.34, 64), dark); base.position.y = 6.93; tower.add(base);
  var glassMat = new T.MeshStandardMaterial({ color: 0x223338, emissive: 0xffd36e, emissiveIntensity: 1.2, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 });
  var lantern = new T.Mesh(new T.CylinderGeometry(0.7, 0.7, 0.96, 64, 1, true), glassMat); lantern.position.y = 7.58; tower.add(lantern);
  var core = new T.Mesh(new T.SphereGeometry(0.2, 32, 16), new T.MeshBasicMaterial({ color: 0xffe6a8, toneMapped: false })); core.position.y = 7.58; tower.add(core);
  for (var m = 0; m < 10; m++) { var bar = new T.Mesh(new T.BoxGeometry(0.035, 0.98, 0.035), dark); var a2 = m / 10 * Math.PI * 2; bar.position.set(Math.cos(a2) * 0.71, 7.58, Math.sin(a2) * 0.71); tower.add(bar); }
  var band2 = new T.Mesh(new T.TorusGeometry(0.71, 0.025, 8, 96), dark); band2.rotation.x = Math.PI / 2; band2.position.y = 8.06; tower.add(band2);
  var roof = new T.Mesh(new T.ConeGeometry(0.95, 0.62, 96, 1), new T.MeshStandardMaterial({ color: 0x3f1a14, roughness: 0.65, metalness: 0.4 })); roof.position.y = 8.38; tower.add(roof);
  var vent = new T.Mesh(new T.SphereGeometry(0.13, 24, 16), dark); vent.position.y = 8.74; tower.add(vent);
  var rod = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.5, 6), dark); rod.position.y = 9.05; tower.add(rod);
  var lampLight = new T.PointLight(0xffd36e, 0.9, 18, 2); lampLight.position.y = 7.58; tower.add(lampLight);

  // a little soft glow around the lantern
  function glowTex() {
    if (glowTex.t) return glowTex.t;
    var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d');
    var gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); glowTex.t = new T.CanvasTexture(c); return glowTex.t;
  }
  var lampGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: 0xffd890, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
  lampGlow.scale.set(4.2, 4.2, 1); lampGlow.position.y = 7.58; tower.add(lampGlow);

  // the beam: two soft volumetric cones; their sides fade by the angle to the eye, so no hard edge
  var beamGroup = new T.Group(); beamGroup.position.y = 7.58; tower.add(beamGroup);
  var beamMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: new T.Color(0xffd890) }, uStrength: { value: 1 } },
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uStrength; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); float a = pow(vY, 2.0) * 0.55 * edge * uStrength; gl_FragColor = vec4(uColor * a, a); }'
  });
  [0, Math.PI].forEach(function (rot) {
    var cone = new T.Mesh(new T.ConeGeometry(4.2, 46, 64, 1, true), beamMat);
    cone.rotation.z = Math.PI / 2; cone.position.x = 23;
    var arm = new T.Group(); arm.rotation.y = rot; arm.add(cone); beamGroup.add(arm);
  });

  /* ---------------- a ship passing in the fog ---------------- */
  var HAZE = new T.Color(0x13242b);
  var ship = new T.Group();
  var shipMat = new T.MeshBasicMaterial({ color: 0x0b161b, fog: false });
  var hullShape = new T.Shape(); hullShape.moveTo(-9, 0.6); hullShape.lineTo(-8.2, -0.9); hullShape.lineTo(7.6, -0.9); hullShape.lineTo(9.6, 1.1); hullShape.lineTo(-9, 1.1); hullShape.lineTo(-9, 0.6);
  var hull = new T.Mesh(new T.ShapeGeometry(hullShape), shipMat); ship.add(hull);
  function box(w, h, x0, y0) { var m = new T.Mesh(new T.PlaneGeometry(w, h), shipMat); m.position.set(x0 + w / 2, y0 + h / 2, 0); ship.add(m); }
  box(3.2, 2.6, -8.4, 1.1); box(2.4, 1.0, -8.0, 3.7); box(0.7, 1.8, -6.6, 3.7);      // the bridge and funnel aft
  for (var cn = 0; cn < 5; cn++) box(2.4, 1.1 + (cn % 2) * 0.6, -4.4 + cn * 2.55, 1.1); // containers
  box(0.12, 4.2, 6.2, 1.1); box(0.12, 3.4, 0.4, 1.1);                                  // masts
  ship.position.set(-150, 0.4, -128); ship.scale.setScalar(1.15);
  scene.add(ship);
  function navLight(col, x0, y0, size) { var sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: col, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); sp.scale.set(size, size, 1); sp.position.set(x0, y0, 0.1); ship.add(sp); return sp; }
  var mastTop = navLight(0xfff2d0, 6.26, 5.4, 1.6), stern = navLight(0xff5040, -8.6, 2.0, 1.1);
  var portholes = []; for (var ph = 0; ph < 7; ph++) portholes.push(navLight(0xffc878, -7.6 + ph * 0.38, 2.6 + (ph % 2) * 0.55, 0.5));
  // the fog bank: a soft band of haze over the horizon, in front of the ship
  var fogMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uCol: { value: HAZE.clone() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: NOISE + 'uniform float uTime; uniform vec3 uCol; varying vec2 vUv; void main(){ float n = fbm(vec2(vUv.x * 9.0 + uTime * 0.03, vUv.y * 2.0)); float a = smoothstep(1.0, 0.15, vUv.y) * smoothstep(0.0, 0.08, vUv.y) * (0.45 + 0.5 * n); gl_FragColor = vec4(uCol * (0.9 + 0.3 * n), a * 0.85); }' });
  var fog = new T.Mesh(new T.PlaneGeometry(520, 12, 1, 1), fogMat); fog.position.set(0, 3.2, -118); scene.add(fog);
  var fog2 = new T.Mesh(new T.PlaneGeometry(520, 6, 1, 1), fogMat); fog2.position.set(0, 1.4, -140); scene.add(fog2);

  /* ---------------- buoys ---------------- */
  var buoys = [];
  var SPOTS = [[-12, 5], [-6.5, 10.5], [1.5, 13], [8.5, 9.5], [13, 3.5], [-15, -2.5]];
  var bprof = [[0, -0.5], [0.42, -0.45], [0.58, -0.1], [0.6, 0.15], [0.5, 0.35], [0.22, 0.5], [0.12, 0.62], [0, 0.64]].map(function (q) { return new T.Vector2(q[0], q[1]); });
  PARTS.forEach(function (p, i) {
    var g = new T.Group();
    var hull = new T.Mesh(new T.LatheGeometry(bprof, 64), new T.MeshStandardMaterial({ color: i % 2 ? 0x3d120e : 0x0e2a22, roughness: 0.6, metalness: 0.35 }));
    hull.position.y = 0.3; g.add(hull);
    var stripe = new T.Mesh(new T.TorusGeometry(0.6, 0.03, 8, 64), new T.MeshStandardMaterial({ color: 0x8c877a, roughness: 0.7 })); stripe.rotation.x = Math.PI / 2; stripe.position.y = 0.45; g.add(stripe);
    var mast = new T.Mesh(new T.CylinderGeometry(0.04, 0.05, 0.9, 12), new T.MeshStandardMaterial({ color: 0x2a3436, metalness: 0.6, roughness: 0.4 })); mast.position.y = 1.35; g.add(mast);
    var bulbMat = new T.MeshBasicMaterial({ color: COL.ok, toneMapped: false });
    var bulb = new T.Mesh(new T.SphereGeometry(0.15, 32, 16), bulbMat); bulb.position.y = 1.86; g.add(bulb);
    var cage = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.32, 24, 1, true), new T.MeshStandardMaterial({ color: 0x2a3436, wireframe: true })); cage.position.y = 1.86; g.add(cage);
    var glow = new T.PointLight(COL.ok, 0.35, 4, 2); glow.position.y = 1.86; g.add(glow);
    var halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: COL.ok, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    halo.scale.set(1.5, 1.5, 1); halo.position.y = 1.86; g.add(halo);
    g.position.set(SPOTS[i][0], 0, SPOTS[i][1]);
    g.userData = { part: p, bulbMat: bulbMat, glow: glow, halo: halo, phase: i * 1.3, idx: i + 1 };
    g.traverse(function (o) { o.userData.buoy = g; });
    g.userData.part = p; g.userData.bulbMat = bulbMat; g.userData.glow = glow; g.userData.halo = halo; g.userData.phase = i * 1.3; g.userData.idx = i + 1;
    scene.add(g); buoys.push(g);
  });

  /* ---------------- name tags ---------------- */
  buoys.forEach(function (b) {
    var el = document.createElement('div'); el.className = 'tag';
    el.innerHTML = '<i></i><span></span><small></small>'; host.appendChild(el); b.userData.tag = el;
  });

  /* ---------------- state ---------------- */
  var lineEl = document.getElementById('status-line'), sinceEl = document.getElementById('lh-since');
  function applyMode() {
    buoys.forEach(function (b) {
      var s = stateOf(b.userData.part), c = new T.Color(COL[s]);
      b.userData.state = s; b.userData.color = c;
      b.userData.bulbMat.color.copy(c); b.userData.glow.color.copy(c); b.userData.halo.material.color.copy(c);
      var tag = b.userData.tag, dot = tag.querySelector('i');
      dot.style.background = dot.style.color = '#' + c.getHexString();
      tag.querySelector('span').textContent = b.userData.part.name;
      tag.querySelector('small').textContent = s === 'ok' ? '' : ' · ' + (s === 'off' ? 'not set up' : WORD[s]);
    });
    if (lineEl) lineEl.textContent = mode === 'down'
      ? "The light is out. The server isn't answering. Anything already open in the studio keeps working on your device."
      : 'The light is on. ' + headline;
    kick();
  }
  function ago(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s' : Math.round(s / 60) + ' min'; }
  function tickSince() {
    if (!sinceEl) return;
    var now = Date.now();
    sinceEl.textContent = (lastAnswer ? (mode === 'down' ? 'last answer ' : 'checked ') + ago(now - lastAnswer) + ' ago' : 'no answer yet') +
      ' · next look in ' + ago(Math.max(0, nextLook - now));
  }
  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    var ctl = window.AbortController ? new AbortController() : null;
    var stop = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    fetch(STATUS_URL, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.components)) throw new Error('no reading');
        d.components.forEach(function (c) {
          var p = PARTS.filter(function (x) { return x.id === c.id; })[0];
          if (!p) return;
          p.name = String(c.name || p.name).replace(/\s*\(.*\)\s*$/, '');
          p.state = c.state; p.text = String(c.summary || '');
        });
        headline = String(d.headline || '');
        mode = d.overall === 'ok' ? 'up' : 'warn';
        lastAnswer = Date.now();
      })
      .catch(function () { mode = 'down'; })
      .then(function () {
        clearTimeout(stop);
        nextLook = Date.now() + POLL_MS;
        applyMode(); tickSince();
        if (!document.hidden) pollTimer = setTimeout(poll, POLL_MS);
      });
  }
  setInterval(function () { if (!document.hidden) tickSince(); }, 1000);

  /* ---------------- shooting stars ---------------- */
  var meteor = null, nextMeteor = 2.5;
  function launch(t) {
    var az = -Math.PI / 2 + (Math.random() - 0.5) * 1.1, el = 0.13 + Math.random() * 0.12;
    var start = new T.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    var side = Math.random() < 0.5 ? -1 : 1;
    var dir = new T.Vector3(side * 0.9, -0.28, (Math.random() - 0.5) * 0.3).normalize();
    meteor = { t0: t, dur: 0.75 + Math.random() * 0.5, start: start, dir: dir, len: 0.22 + Math.random() * 0.12 };
    nextMeteor = t + 6 + Math.random() * 9;
  }
  if (meteorBtn) { meteorBtn.hidden = false; meteorBtn.addEventListener('click', function () { launch(clock.getElapsedTime()); kick(); }); }

  /* ---------------- hover / tap ---------------- */
  var ray = new T.Raycaster(), mouse = new T.Vector2(), tip = document.getElementById('tip'), hovered = null;
  var pickables = []; buoys.forEach(function (b) { b.traverse(function (o) { if (o.isMesh) pickables.push(o); }); });
  function pick(ev) {
    var rc = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    var hit = ray.intersectObjects(pickables, false)[0];
    hovered = hit ? hit.object.userData.buoy : null;
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'grab';
    if (!hovered) { tip.classList.remove('show'); return; }
    var p = hovered.userData.part, s = hovered.userData.state;
    tip.textContent = ''; var hb = document.createElement('b'); hb.textContent = p.name + ' · ' + (s === 'off' ? 'not set up' : WORD[s]); tip.appendChild(hb); tip.appendChild(document.createTextNode(tipText(p)));
    tip.classList.add('show');
  }
  var drag = null;
  renderer.domElement.addEventListener('pointermove', function (ev) { kick(); if (drag !== null) camTarget = Math.max(-0.6, Math.min(0.6, drag.a + (ev.clientX - drag.x) * -0.004)); pick(ev); });
  renderer.domElement.addEventListener('pointerdown', function (ev) { drag = { x: ev.clientX, a: camTarget }; pick(ev); });
  window.addEventListener('pointerup', function () { drag = null; });
  renderer.domElement.addEventListener('pointerleave', function () { tip.classList.remove('show'); hovered = null; });

  /* ---------------- loop ---------------- */
  function size() { var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    // a narrow scene steps the camera back, so every buoy stays in frame
    var tanH = Math.tan(camera.fov * Math.PI / 360) * camera.aspect; camDist = Math.max(27, 20 / tanH); kick(); }
  window.addEventListener('resize', size); size();
  var clock = new T.Clock(), sweep = 0.6, v = new T.Vector3(), last = 0;
  var lampWorld = new T.Vector3();
  function frame() {
    queued = false;
    var t = clock.getElapsedTime(), dt = Math.min(t - last, 0.05); last = t;
    var tm = reduce ? 0 : t;
    camAngle += (camTarget - camAngle) * 0.08; placeCamera();
    skyU.uTime.value = tm; seaU.uTime.value = tm;
    var up = mode !== 'down';
    if (up && !reduce) sweep += (mode === 'warn' ? 0.95 : 0.55) * dt;
    beamGroup.rotation.y = sweep;
    seaU.uBeamDir.value.set(Math.cos(sweep), -Math.sin(sweep));
    var lamp = !up ? 0 : mode === 'warn' ? (0.5 + 0.5 * Math.abs(Math.sin(t * 7)) * (Math.sin(t * 1.3) > -0.2 ? 1 : 0.3)) : (0.86 + 0.14 * Math.sin(t * 2.4));
    var lampCol = new T.Color(mode === 'warn' ? 0xffb060 : 0xffd890);
    glassMat.emissive.copy(lampCol); glassMat.emissiveIntensity = 0.15 + lamp * 1.4;
    core.material.color.copy(lampCol).multiplyScalar(up ? 0.4 + lamp : 0.12);
    lampLight.color.copy(lampCol); lampLight.intensity = lamp * 0.9;
    lampGlow.material.color.copy(lampCol); lampGlow.material.opacity = lamp;
    beamMat.uniforms.uStrength.value = up ? lamp : 0; beamMat.uniforms.uColor.value.copy(lampCol);
    seaU.uBeam.value = up ? lamp : 0; seaU.uBeamCol.value.copy(lampCol);
    skyU.uDark.value = up ? 0 : 1; seaU.uDark.value = up ? 0 : 1;
    lampWorld.set(0, 7.58 + tower.position.y, 0);
    seaU.uLP.value[0].copy(lampWorld); seaU.uLC.value[0].set(lampCol.r, lampCol.g, lampCol.b).multiplyScalar(lamp * 1.4);
    buoys.forEach(function (b) {
      var ph = b.userData.phase, s = b.userData.state;
      b.position.y = Math.sin(tm * 1.3 + ph) * 0.16 - 0.05;
      b.rotation.z = Math.sin(tm * 1.05 + ph) * 0.09; b.rotation.x = Math.cos(tm * 0.85 + ph) * 0.07;
      var pulse = s === 'off' ? 0.08 : s === 'ok' ? (0.85 + 0.15 * Math.sin(t * 2 + ph)) : (0.35 + 0.65 * Math.abs(Math.sin(t * (s === 'bad' ? 4 : 2.5) + ph)));
      if (b === hovered) pulse = Math.max(pulse, 1.25);
      b.userData.bulbMat.color.copy(b.userData.color).multiplyScalar(0.25 + pulse);
      b.userData.glow.intensity = 0.35 * pulse; b.userData.halo.material.opacity = Math.min(1, pulse);
      v.set(0, 1.86, 0); b.localToWorld(v);
      seaU.uLP.value[b.userData.idx].copy(v);
      seaU.uLC.value[b.userData.idx].set(b.userData.color.r, b.userData.color.g, b.userData.color.b).multiplyScalar(pulse * 0.9);
    });
    // the ship: one slow crossing about every three minutes
    ship.position.x = -150 + ((tm * 1.6 + 105) % 300);
    mastTop.material.opacity = 0.55 + 0.45 * (Math.sin(t * 3.1) > 0.6 ? 1 : 0.35); fogMat.uniforms.uTime.value = tm;
    shipMat.color.copy(HAZE).multiplyScalar(0.62);
    // shooting star
    if (!reduce && t > nextMeteor && !meteor) launch(t);
    if (meteor) {
      var k = (t - meteor.t0) / meteor.dur;
      if (k >= 1) { meteor = null; skyU.uMA.value = 0; }
      else {
        var travel = 0.42 * k;
        var head = meteor.start.clone().addScaledVector(meteor.dir, travel).normalize();
        var tail = meteor.start.clone().addScaledVector(meteor.dir, Math.max(0, travel - meteor.len * Math.min(1, k * 2.5))).normalize();
        skyU.uMH.value.copy(head); skyU.uMT.value.copy(tail);
        skyU.uMA.value = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 1.1;
      }
    }
    buoys.forEach(function (b) {
      v.set(0, 2.35, 0); b.localToWorld(v); v.project(camera);
      var tag = b.userData.tag;
      if (v.z > 1) { tag.style.display = 'none'; return; }
      tag.style.display = '';
      tag.style.transform = 'translate(' + ((v.x + 1) / 2 * host.clientWidth) + 'px,' + ((1 - v.y) / 2 * host.clientHeight) + 'px) translate(-50%, -100%)';
    });
    if (hovered) {
      v.set(0, 2.2, 0); hovered.localToWorld(v); v.project(camera);
      tip.style.left = ((v.x + 1) / 2 * host.clientWidth) + 'px'; tip.style.top = ((1 - v.y) / 2 * host.clientHeight) + 'px';
    }
    renderer.render(scene, camera);
    if (!reduce || meteor || Math.abs(camTarget - camAngle) > 0.001) kick();
  }
  if (window.IntersectionObserver) new IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; kick(); }).observe(host);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { poll(); kick(); } });
  if (reduce && meteorBtn) meteorBtn.hidden = true;
  applyMode(); poll(); kick();
}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

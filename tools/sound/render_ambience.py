"""Render Beuk's own zen ambience loops offline: rain and wind.
(BEUK:sound) Deterministic: a fixed seed per scene, NumPy's PCG64 generator, so
the same command renders the same samples. Run inside a Debian container with
ffmpeg + python3-numpy + python3-scipy (see tools/sound/README.md).

usage: python3 -I tools/sound/render_ambience.py SCENE OUT_DIR [SEED]
       SCENE = rain | wind
Writes OUT_DIR/<scene>.wav (float, pad + loop + pad), OUT_DIR/<scene>.mp3 and
prints a JSON report (loudness, peaks, and the loop seam measured on the
decoded MP3).

Why it cannot sound like the old synth (white noise through one lowpass,
"someone blowing air"): every layer here is built from the physics of the
sound, and every layer is PERIODIC with the loop length by construction.
- Noise beds are made in the frequency domain over exactly one loop
  (random phase, shaped magnitude, inverse FFT), so sample N-1 runs into
  sample 0 like any other pair: no crossfade is needed and there is no seam.
- Slow modulations are random-phase sums of sinusoids, each with a whole
  number of cycles per loop, so they are irregular but periodic too.
- Individual events (rain drops, drips, leaf ticks) are placed on a circular
  time line: an event that starts near the loop end wraps into its head.

RAIN = soft bed (pink noise band-passed 200 Hz - 5 kHz, slow level drift) +
~480 individual drops per second, Poisson distributed with a slowly varying
rate, in three tiers: far (quiet, darker band-passed ticks), mid (ticks
2.5-9 kHz, some with an air-bubble ring: a decaying sine whose pitch rises,
the Minnaert resonance heard when a drop lands on water) and near (~10 / s:
a bright broadband tick with a short resonant body), each with a log-normal
size and a random stereo position + occasional larger drips from leaves +
a short diffuse room tail + a gentle roll-off above 12 kHz.

WIND = brown-tilted noise (high-passed at 120 Hz) shaped, frame by frame, by
five broad bands (about an octave wide, so nothing whistles) whose centres
sweep slowly and whose levels follow irregular gust envelopes (modulation
periods between 4 s and 40 s), with gentle stereo movement + a leaf-rustle
layer (tiny band-passed ticks, 1.8-7 kHz, whose density rises with the gusts).
"""
import sys, json, subprocess, re
import numpy as np
from scipy.signal import lfilter

SR = 44100
LOOP = 60.0
PAD = 0.5
TARGET = -27.0
BITRATE = "128k"
N = int(round(LOOP * SR))


# ---------------------------------------------------------------- helpers
def smooth_random(rng, fmax, fmin=1 / LOOP):
    """irregular slow modulator in [-1, 1]: random-phase components from fmin to fmax Hz,
    each a whole number of cycles per loop (so periodic), with a 1/f amplitude fall-off"""
    k0 = max(1, int(round(fmin * LOOP))); k1 = max(k0, int(round(fmax * LOOP)))
    spec = np.zeros(N // 2 + 1, dtype=complex)
    k = np.arange(k0, k1 + 1)
    spec[k] = rng.uniform(0.6, 1.0, len(k)) / np.sqrt(k) * np.exp(1j * rng.uniform(0, 2 * np.pi, len(k)))
    y = np.fft.irfft(spec, n=N)
    return y / (np.abs(y).max() + 1e-12)


def shaped_noise(rng, mag_fn, channels=2, corr=0.0):
    """periodic noise over one loop with magnitude spectrum mag_fn(f); corr = inter-channel correlation"""
    f = np.fft.rfftfreq(N, 1 / SR)
    mag = mag_fn(f)
    mag[0] = 0
    common = np.exp(1j * rng.uniform(0, 2 * np.pi, len(f)))
    out = []
    for _ in range(channels):
        own = np.exp(1j * rng.uniform(0, 2 * np.pi, len(f)))
        ph = np.sqrt(corr) * common + np.sqrt(1 - corr) * own
        out.append(np.fft.irfft(mag * ph, n=N))
    y = np.stack(out, axis=1)
    return y / (np.sqrt((y ** 2).mean()) + 1e-12)


def bandpass_mag(f, lo, hi, order_lo=2, order_hi=2):
    """smooth Butterworth-like magnitude: high-pass at lo, low-pass at hi"""
    fl = np.maximum(f, 1e-3)
    hp = 1 / np.sqrt(1 + (lo / fl) ** (2 * order_lo))
    lp = 1 / np.sqrt(1 + (fl / hi) ** (2 * order_hi))
    return hp * lp


def circ_add(buf, start, sig):
    """add sig into the periodic buffer at start, wrapping past the loop end"""
    n = len(sig)
    s = start % N
    end = s + n
    if end <= N:
        buf[s:end] += sig
    else:
        cut = N - s
        buf[s:] += sig[:cut]
        buf[:end - N] += sig[cut:]


def pan_gains(p):
    """constant-power pan, p in [-1, 1]"""
    a = (p + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def biquad_bp_burst(rng, n, fc, q):
    """a short noise burst through a 2-pole resonator (band-pass) at fc with quality q"""
    x = rng.standard_normal(n)
    w = 2 * np.pi * fc / SR
    r = np.exp(-w / (2 * q))
    return lfilter([1 - r], [1, -2 * r * np.cos(w), r * r], x)


def circ_convolve(x, ir):
    """circular convolution of each channel with ir (keeps the loop periodic)"""
    H = np.fft.rfft(np.concatenate([ir, np.zeros(N - len(ir))]))
    return np.stack([np.fft.irfft(np.fft.rfft(x[:, c]) * H, n=N) for c in range(x.shape[1])], axis=1)


# ---------------------------------------------------------------- rain
def render_rain(rng):
    t = np.arange(N) / SR
    # 1. bed: pink (1/sqrt f) band-passed 250 Hz - 11 kHz, mostly decorrelated stereo
    bed = shaped_noise(rng, lambda f: bandpass_mag(f, 200, 5000, 2, 2) / np.sqrt(np.maximum(f, 20)) * (1 + 0.5 * np.exp(-((np.log2(np.maximum(f, 1) / 1500)) ** 2) / 1.0)), corr=0.25)
    drift = 1 + 0.2 * smooth_random(rng, 0.08)
    bed *= drift[:, None]
    bed *= 0.09

    # 2. drops: Poisson process with a slowly varying rate (drops / s). Three tiers, the way rain
    #    reaches a listener: many far drops (quiet, darker: part of the texture), fewer mid drops,
    #    and a few near drops, bright broadband ticks with a short resonant body (a leaf, a stone).
    rate = 480 * (1 + 0.3 * smooth_random(rng, 0.1))
    counts = rng.poisson(rate / SR)
    starts = np.nonzero(counts)[0]
    starts = np.repeat(starts, counts[starts])
    ndrops = len(starts)
    sizes = rng.lognormal(mean=0.0, sigma=0.5, size=ndrops)   # relative drop size
    pans = np.clip(rng.normal(0, 0.55, ndrops), -1, 1)
    tier = rng.uniform(0, 1, ndrops)
    kinds = rng.uniform(0, 1, ndrops)
    drops = np.zeros((N, 2))
    tiers = {"near": 0, "mid": 0, "far": 0}
    for i in range(ndrops):
        s = sizes[i]
        if tier[i] < 0.02:      # ~10 / s near
            tiers["near"] += 1
            amp = 0.18 * s
            nc = int(rng.uniform(0.8, 2.5) * 1e-3 * SR * 6)
            click = rng.standard_normal(nc) * np.exp(-np.arange(nc) / (nc / 6))
            click = np.diff(np.concatenate([[0.0], click]))            # first difference: bright, broadband
            fc = rng.uniform(1500, 5500) / (0.8 + 0.2 * s)
            dec = rng.uniform(6, 18) * 1e-3
            nb = int(dec * SR * 5)
            body = biquad_bp_burst(rng, nb, fc, rng.uniform(3, 8)) * np.exp(-np.arange(nb) / (dec * SR))
            sig = np.zeros(max(nc, nb))
            sig[:nc] += click / (np.abs(click).max() + 1e-12)
            sig[:nb] += 0.4 * body / (np.abs(body).max() + 1e-12)
            sig[:8] *= np.linspace(0, 1, 8)
        elif tier[i] < 0.20:    # ~85 / s mid
            tiers["mid"] += 1
            amp = 0.085 * s
            fc = rng.uniform(2500, 9000) / (0.8 + 0.2 * s)
            dec = rng.uniform(1.5, 5.0) * 1e-3 * (0.8 + 0.4 * s)
            n = int(dec * SR * 6)
            env = np.exp(-np.arange(n) / (dec * SR)); env[:min(n, 10)] *= np.linspace(0, 1, min(n, 10))
            sig = biquad_bp_burst(rng, n, fc, rng.uniform(0.7, 2.0)) * env
            sig /= (np.abs(sig).max() + 1e-12)
            if kinds[i] > 0.7:
                # air-bubble ring (Minnaert): a decaying sine whose pitch rises, as when a drop hits water
                f0 = rng.uniform(2200, 6000) / (0.7 + 0.3 * s)
                bdec = rng.uniform(3.0, 8.0) * 1e-3
                nb = int(bdec * SR * 6); tt = np.arange(nb) / SR
                fr = f0 * (1 + rng.uniform(0.1, 0.6) * (1 - np.exp(-tt / (bdec * 2))))
                ring = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tt / bdec)
                ring[:10] *= np.linspace(0, 1, 10)
                full = np.zeros(max(n, nb)); full[:n] += sig; full[:nb] += 0.6 * ring
                sig = full
        else:                   # far: quiet and darker
            tiers["far"] += 1
            amp = 0.018 * s
            fc = rng.uniform(1200, 5000)
            dec = rng.uniform(1.0, 4.0) * 1e-3
            n = int(dec * SR * 6)
            env = np.exp(-np.arange(n) / (dec * SR)); env[:min(n, 12)] *= np.linspace(0, 1, min(n, 12))
            sig = biquad_bp_burst(rng, n, fc, rng.uniform(0.7, 2.0)) * env
            sig /= (np.abs(sig).max() + 1e-12)
        gl, gr = pan_gains(pans[i])
        st = int(starts[i])
        circ_add(drops[:, 0], st, sig * amp * gl)
        circ_add(drops[:, 1], st, sig * amp * gr)

    # 3. occasional larger drips from leaves (every ~0.8-3 s), soft and low
    drips = np.zeros((N, 2))
    pos = 0.0
    while True:
        pos += rng.uniform(0.8, 3.0)
        if pos >= LOOP: break
        f0 = rng.uniform(900, 1800)
        dec = rng.uniform(12, 25) * 1e-3
        n = int(dec * SR * 6)
        tt = np.arange(n) / SR
        f = f0 * (1 + 0.5 * (1 - np.exp(-tt / (dec * 1.5))))
        env = np.exp(-tt / dec)
        env[:20] *= np.linspace(0, 1, 20)
        sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * env
        sig[:int(0.002 * SR)] += 0.4 * rng.standard_normal(int(0.002 * SR)) * np.exp(-np.arange(int(0.002 * SR)) / 20)
        gl, gr = pan_gains(rng.uniform(-0.8, 0.8))
        amp = rng.uniform(0.04, 0.08)
        circ_add(drips[:, 0], int(pos * SR), sig * amp * gl)
        circ_add(drips[:, 1], int(pos * SR), sig * amp * gr)

    x = bed + drops + drips
    # 4. short diffuse room tail (decorrelated noise IR, 0.25 s), mixed low
    irn = int(0.25 * SR)
    for c in range(2):
        ir = rng.standard_normal(irn) * np.exp(-np.arange(irn) / (0.06 * SR))
        ir /= np.sqrt((ir ** 2).sum())
        x[:, c] = x[:, c] + 0.35 * circ_convolve(x[:, c:c + 1], ir)[:, 0]
    # tame the very top a touch (air absorption), periodic via FFT
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(N, 1 / SR)
    X *= (1 / np.sqrt(1 + (f / 12000) ** 4))[:, None]
    X[0] = 0
    return np.fft.irfft(X, n=N, axis=0), {"drops": int(ndrops), "dropsPerSecondMean": float(ndrops / LOOP), "tiers": tiers}


# ---------------------------------------------------------------- wind
def render_wind(rng):
    """broad bands swept over an STFT grid of the periodic loop"""
    hop, win = 1050, 4200  # 2646000 = 2520 * 1050: frames tile the loop exactly, circular framing
    w = np.hanning(win + 1)[:-1]
    f = np.fft.rfftfreq(win, 1 / SR)
    lf = np.log2(np.maximum(f, 10))
    # band set: (base centre Hz, width in octaves (sigma), sweep in octaves, gust periods)
    bands = [(300, 1.0, 0.5, 0.12), (600, 0.9, 0.6, 0.18), (1100, 0.9, 0.6, 0.2),
             (2000, 1.0, 0.6, 0.22), (3600, 1.1, 0.5, 0.25)]  # (centre Hz, sigma oct, sweep oct, modulator fmax Hz)
    tl = np.arange(N) / SR
    gust_master = 0.45 + 0.55 * (0.5 + 0.5 * smooth_random(rng, 0.25, 1 / 40))  # irregular gusts: periods 4-40 s
    band_curves = []
    for (c0, sig_oct, sweep, per) in bands:
        centre = np.log2(c0) + sweep * smooth_random(rng, per)
        level = (0.35 + 0.65 * (0.5 + 0.5 * smooth_random(rng, per, 1 / 30))) ** 1.6 * (0.5 + 0.5 * gust_master)
        panc = 0.35 * smooth_random(rng, 0.08)
        band_curves.append((centre, level, panc, sig_oct, c0))
    tilt = 1 / np.maximum(f, 60) ** 0.9  # brown-ish (-5.4 dB/oct) magnitude tilt
    tilt *= bandpass_mag(f, 120, 9000, 2, 2)
    out = np.zeros((N, 2))
    norm = np.zeros(N)
    nfr = int(np.ceil(N / hop))
    for k in range(nfr):
        s0 = k * hop
        idx = (np.arange(win) + s0) % N
        mid = (s0 + win // 2) % N
        gl_tot = np.zeros(len(f)); gr_tot = np.zeros(len(f))
        for (centre, level, panc, sig_oct, c0) in band_curves:
            g = level[mid] * np.exp(-0.5 * ((lf - centre[mid]) / sig_oct) ** 2)
            a, b = pan_gains(panc[mid])
            gl_tot += g * a; gr_tot += g * b
        gm = gust_master[mid]
        for c, gtot in ((0, gl_tot), (1, gr_tot)):
            spec = (rng.standard_normal(len(f)) + 1j * rng.standard_normal(len(f))) * tilt * gtot * gm
            fr = np.fft.irfft(spec, n=win) * w
            np.add.at(out[:, c], idx, fr)
        np.add.at(norm, idx, w ** 2)
    out /= np.maximum(norm, 1e-9)[:, None] ** 0.5
    out /= np.sqrt((out ** 2).mean())

    # leaf rustle: tiny high ticks, density rising steeply with the gusts
    rustle = np.zeros((N, 2))
    dens = 80 + 1600 * (gust_master - gust_master.min()) ** 2 / (np.ptp(gust_master) ** 2 + 1e-12)
    counts = rng.poisson(dens / SR)
    st = np.nonzero(counts)[0]
    for s in st:
        fc = rng.uniform(1800, 7000)
        dec = rng.uniform(0.6, 2.5) * 1e-3
        n = int(dec * SR * 5)
        env = np.exp(-np.arange(n) / (dec * SR)); env[:6] *= np.linspace(0, 1, 6)
        sig = biquad_bp_burst(rng, n, fc, rng.uniform(0.8, 2.0)) * env
        sig /= (np.abs(sig).max() + 1e-12)
        a, b = pan_gains(rng.uniform(-0.9, 0.9))
        amp = rng.lognormal(0, 0.5) * 0.02 * gust_master[s]
        circ_add(rustle[:, 0], int(s), sig * amp * a)
        circ_add(rustle[:, 1], int(s), sig * amp * b)
    x = out * 0.25 + rustle
    return x, {"rustleTicks": int(len(st))}


# ---------------------------------------------------------------- master, encode, verify
def lufs(x):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-i", "-", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True).stderr.decode()
    tail = p[p.rfind("Summary:"):]
    I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    return I, (float(tp.group(1)) if tp else None)


def decode(path, ch=2):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).astype(np.float64)


def seam(y, a, b):
    m = y.mean(axis=1)
    d = np.abs(np.diff(m[a:a + 44100]))
    w = int(0.05 * SR)
    r1 = np.sqrt((m[b - w:b] ** 2).mean()); r2 = np.sqrt((m[a:a + w] ** 2).mean())
    return {"jump": float(abs(m[a] - m[b - 1])), "typicalDiff": float(d.mean()), "p99Diff": float(np.percentile(d, 99)), "rmsStepDb": float(20 * np.log10(r1 / r2))}


def main():
    scene, outdir = sys.argv[1], sys.argv[2]
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else {"rain": 20261025, "wind": 20261026}[scene]
    rng = np.random.Generator(np.random.PCG64(seed))
    loop, info = (render_rain if scene == "rain" else render_wind)(rng)
    loop = loop - loop.mean(axis=0)
    I0, _ = lufs(np.concatenate([loop, loop]))
    g = 10 ** ((TARGET - I0) / 20)
    loop *= g
    I1, tp1 = lufs(np.concatenate([loop, loop]))
    pd = int(round(PAD * SR))
    padded = np.concatenate([loop[N - pd:], loop, loop[:pd]])
    wav = "%s/%s.wav" % (outdir, scene); mp3 = "%s/%s.mp3" % (outdir, scene)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-c:a", "pcm_f32le", wav], input=padded.astype(np.float32).tobytes(), check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", BITRATE, "-ar", str(SR), "-ac", "2", "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", mp3], check=True)
    y = decode(mp3)
    mref = padded.mean(axis=1); my = y.mean(axis=1)
    ref = mref[pd:pd + 16384]; best, lagbest = -1, 0
    for lag in range(-3000, 3001):
        if pd + lag < 0: continue
        s2 = my[pd + lag:pd + lag + 16384]
        c = float((ref * s2).sum() / np.sqrt((ref ** 2).sum() * (s2 ** 2).sum() + 1e-12))
        if c > best: best, lagbest = c, lag
    a = pd + lagbest; b = a + N
    wn = 8192
    c_per = float((my[a:a + wn] * my[b:b + wn]).sum() / np.sqrt((my[a:a + wn] ** 2).sum() * (my[b:b + wn] ** 2).sum()))
    I2, tp2 = lufs(y)
    print(json.dumps({"scene": scene, "seed": seed, "loop": LOOP, "pad": PAD, "bitrate": BITRATE, "info": info,
                      "lufsBefore": I0, "gainDb": float(20 * np.log10(g)), "lufsLoop": I1, "truePeakLoop": tp1,
                      "samplePeakDbfs": float(20 * np.log10(np.abs(loop).max())),
                      "seamSource": seam(np.concatenate([loop, loop]), N, N),
                      "decoded": {"samples": int(len(y)), "expected": int(len(padded)), "alignLag": lagbest, "alignCorr": best,
                                  "seam": seam(y, a, b), "periodicCorr": c_per, "lufs": I2, "truePeak": tp2}}, indent=1))


if __name__ == "__main__":
    main()

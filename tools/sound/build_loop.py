"""Build one seamless zen loop from an original recording.
(BEUK:sound) Run inside a Debian container with ffmpeg + python3-numpy; the exact
commands for the shipped files are in client/assets/sound/CREDITS.md.

usage: python3 -I tools/sound/build_loop.py SRC OUT_BASENAME START LOOP XFADE PAD TARGET_LUFS CHANNELS BITRATE [HPF_HZ]
Writes /s/build/<name>.wav (padded float), /s/build/<name>.mp3 and prints a JSON report.
"""
import sys, json, subprocess, numpy as np, re

src, name = sys.argv[1], sys.argv[2]
start, L, X, P, target = map(float, sys.argv[3:8])
ch = int(sys.argv[8]); br = sys.argv[9]
hpf = float(sys.argv[10]) if len(sys.argv) > 10 else 0
SR = 44100

def decode(path, channels):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(channels), "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).astype(np.float64)

def lufs(x):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", str(x.shape[1]), "-i", "-", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True).stderr.decode()
    tail = p[p.rfind("Summary:"):]
    I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    tp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    return I, (float(tp.group(1)) if tp else None)

x = decode(src, ch)
if hpf > 0:
    # gentle 2nd-order high-pass (rumble only), applied by ffmpeg to the whole original
    raw = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-", "-af", "highpass=f=%g:poles=2" % hpf, "-f", "f32le", "-"],
                         input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).astype(np.float64)

s0 = int(round(start * SR)); n = int(round(L * SR)); xf = int(round(X * SR)); pd = int(round(P * SR))
seg = x[s0:s0 + n + xf]
assert len(seg) == n + xf, "source too short for start+loop+xfade"
loop = seg[:n].copy()
k = np.arange(xf) / xf
fin = np.sin(0.5 * np.pi * k)[:, None]; fout = np.cos(0.5 * np.pi * k)[:, None]
# head of the loop = head of seg faded in + the material that followed the loop end faded out
loop[:xf] = seg[:xf] * fin + seg[n:n + xf] * fout

def seam(y, a, b):
    """discontinuity and RMS step where sample b-1 runs into sample a"""
    m = y.mean(axis=1)
    d = np.abs(np.diff(m[a:a + 44100]))
    jump = abs(m[a] - m[b - 1])
    w = int(0.05 * SR)
    r1 = np.sqrt((m[b - w:b] ** 2).mean()); r2 = np.sqrt((m[a:a + w] ** 2).mean())
    return {"jump": float(jump), "typicalDiff": float(d.mean()), "p99Diff": float(np.percentile(d, 99)), "rmsStepDb": float(20 * np.log10(r1 / r2))}

seam_raw = seam(seg[:n], 0, n)  # what a naive cut would do
seam_loop = seam(loop, 0, n)
I0, _ = lufs(loop)
g = 10 ** ((target - I0) / 20)
loop *= g
I1, tp1 = lufs(np.concatenate([loop, loop]))
peak = float(np.abs(loop).max())
padded = np.concatenate([loop[n - pd:], loop, loop[:pd]])
wav = "/s/build/%s.wav" % name
mp3 = "/s/build/%s.mp3" % name
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-", "-c:a", "pcm_f32le", wav], input=padded.astype(np.float32).tobytes(), check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", br, "-ar", str(SR), "-ac", str(ch), "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "1", mp3], check=True)

# verify the encoded file: decode, align to the padded source, then measure the loop seam on decoded samples
y = decode(mp3, ch)
mref = padded.mean(axis=1); my = y.mean(axis=1)
best, lagbest = -1, 0
ref = mref[pd:pd + 16384]
for lag in range(-3000, 3001):
    if pd + lag < 0: continue
    seg2 = my[pd + lag:pd + lag + 16384]
    c = float((ref * seg2).sum() / np.sqrt((ref ** 2).sum() * (seg2 ** 2).sum() + 1e-12))
    if c > best: best, lagbest = c, lag
a = pd + lagbest; b = a + n
seam_dec = seam(y, a, b)
# periodic copy check: decoded tail pad should equal decoded head of the loop
w = 8192
c_per = float((my[a:a + w] * my[b:b + w]).sum() / np.sqrt((my[a:a + w] ** 2).sum() * (my[b:b + w] ** 2).sum()))
I2, tp2 = lufs(y)
print(json.dumps({
    "name": name, "src": src.split("/")[-1], "start": start, "loop": L, "xfade": X, "pad": P, "channels": ch, "bitrate": br, "hpf": hpf,
    "lufsBefore": I0, "gainDb": float(20 * np.log10(g)), "lufsLoop": I1, "truePeakLoop": tp1, "samplePeakDbfs": float(20 * np.log10(peak)),
    "seamNaiveCut": seam_raw, "seamCrossfaded": seam_loop,
    "decoded": {"samples": int(len(y)), "expected": int(len(padded)), "extraSamples": int(len(y) - len(padded)), "alignLag": lagbest, "alignCorr": best,
                "seam": seam_dec, "periodicCorr": c_per, "lufs": I2, "truePeak": tp2},
}, indent=1))

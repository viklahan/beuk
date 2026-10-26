# tools/sound — how Zen's ambient loops are made

Two scripts, both run in a throw-away Debian container (nothing here is
needed at runtime; the studio only plays the finished MP3 files in
`client/assets/sound/`, whose sources and licences are in
`client/assets/sound/CREDITS.md`).

| Script | Makes | From |
|---|---|---|
| `build_loop.py` | a loop from a **recording** (rain, waves) | a CC0 / public-domain original you downloaded |
| `render_ambience.py` | a loop **rendered by us** (wind; a rain alternative) | nothing but a seed — Beuk's own work, released CC0 |

Both write the same shape: **0.5 s pad + 60 s loop + 0.5 s pad**, 44.1 kHz
stereo, −27 LUFS integrated (EBU R128), MP3 128 kb/s CBR with a Xing/LAME
header and no ID3 tags; the pads are the loop's own tail and head, so the
studio can loop `[0.5 s, 60.5 s)` of the decoded buffer seamlessly. Both
decode their own MP3 again and print the seam measured on the decoded
samples.

## The container

```sh
cat > Dockerfile <<'EOF'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-numpy python3-scipy && rm -rf /var/lib/apt/lists/*
EOF
docker build -t beuk-sound-tools .
```

The shipped files were made with FFmpeg 5.1.9, NumPy 1.24.2 and SciPy
1.10.1 (Debian bookworm packages). Other versions should render the same
sound; the bytes (and so the sha256 in CREDITS.md) may differ.

## Re-render wind (or the rain alternative)

```sh
mkdir -p out
docker run --rm -v "$PWD:/s" beuk-sound-tools sh -c \
  'cd /s && python3 -I tools/sound/render_ambience.py wind out'
# -> out/wind.wav (float, padded), out/wind.mp3, JSON report on stdout
```

`SCENE` is `rain` or `wind`; an optional third argument overrides the seed.
Default seeds: **rain 20261025**, **wind 20261026** (NumPy PCG64). With the
same seed and the same tool versions the output is byte-identical (checked:
two renders of wind gave the same WAV and MP3 sha256).

What the renderer models (details in the script's docstring):

- **Every layer is periodic with the 60 s loop.** Noise beds are built in
  the frequency domain over exactly one loop; slow modulators have a whole
  number of cycles per loop; individual events wrap from the loop end
  into its head. So the loop has no seam and needs no crossfade.
- **Wind:** brown-tilted noise shaped frame by frame (4200-sample frames,
  hop 1050 — they tile the loop exactly) by five broad bands (~300 Hz to
  3.6 kHz, each about an octave wide, so nothing whistles) whose centres
  sweep slowly and whose levels follow irregular gusts (modulation periods 4–40 s),
  with gentle stereo movement; plus a leaf-rustle layer of tiny
  band-passed ticks (1.8–7 kHz) whose density rises with the gusts. A
  high-pass at 120 Hz keeps out the low rumble that sounded like
  “someone blowing air” in the old synth.
- **Rain:** a soft pink-noise bed (200 Hz – 5 kHz, slow level drift) plus
  ~480 individual drops per second (Poisson, slowly varying rate) in three
  tiers — far (quiet, darker), mid (band-passed ticks 2.5–9 kHz, some with
  an air-bubble ring whose pitch rises), near (~10/s: a bright broadband
  tick with a short resonant body) — with random size and stereo position,
  occasional larger drips, a short diffuse room tail and a gentle
  12 kHz roll-off.

Parameters live at the top of each `render_*` function; change them,
re-render, listen, and update `CREDITS.md` (sha256, analysis, seed) and
`tests/sound.test.ts` keeps you honest.

## Rebuild a recording loop

```sh
python3 -I tools/sound/build_loop.py SRC NAME START LOOP XFADE PAD TARGET_LUFS CHANNELS BITRATE [HPF_HZ]
```

It writes `/s/build/NAME.wav` and `/s/build/NAME.mp3` (mount a folder
there). The exact commands for the shipped files are in CREDITS.md.

## After replacing a shipped file

1. Copy the MP3 over `client/assets/sound/<scene>.mp3` (same name).
2. Update `client/assets/sound/CREDITS.md`: the sha256 row, the file's
   section (source or render command, licence line, edits, analysis, seam).
3. Bump `BEUK_SOUND_CACHE` (`beuk-sound-v<N>`) in **both**
   `client/sw.js` and `client/assets/sw.js`: the sound cache is
   cache-first, so without a new name returning writers keep the old
   file. Activate deletes the older sound caches. Then update the
   expected name in `tests/sound.test.ts`.
4. Run the server tests and, in a browser, `window.runBeukAsyncSelfChecks()`
   (`zen.sound.files-decode`, `zen.sound.buffer-loop`).

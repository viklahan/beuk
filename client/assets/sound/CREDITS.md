# Zen ambient sound — sources and credits

Two of the three files in this folder are loops cut from **real field
recordings** whose recordists released them **CC0** or **into the public
domain** themselves; the third (wind) was **rendered offline for Beuk**
by `tools/sound/render_ambience.py` and is released **CC0** by Beuk. No
file needs attribution, every one may be redistributed, modified and
used commercially; the recordists are named below anyway, with thanks.
Nothing is synthesized in the browser: the studio only plays these files.

Round 6 (2026-10-25, BEUK:sound): the earlier rain and wind loops were
radio aporee uploads marked with the Creative Commons public-domain
*mark*. That mark labels a work as already free of copyright; it is not
the recordist's own waiver, so for a product that is sold those two were
replaced. Waves (Commons PD-self: the author's own public-domain release
with a fallback grant) stays.

## Shipped files

The sha256 below is of the file as shipped (tests/sound.test.ts checks
it, and that nothing else ships in this folder).

| File | sha256 (shipped) | Bytes | Length |
|---|---|---|---|
| `rain.mp3` | `cbae93f1898d752af13a21ae17dac35fc8641e92acc660d0fc892be5fc7fa35d` | 977187 | 61.0 s |
| `waves.mp3` | `059c5890d0c335ae23e2b1a341f8f9c76c70e9475d5d48bd41ff70f050707ddb` | 977187 | 61.0 s |
| `wind.mp3` | `2578760042c9439b1f0f54a0d2f792f0fa45ce6027e87f3ed1a67053ed8942c9` | 977187 | 61.0 s |

Every file has the same shape: **0.5 s pad + 60 s loop + 0.5 s pad**, 44.1 kHz
stereo MP3 at 128 kb/s CBR (LAME via FFmpeg 5.1.9, Xing/LAME header, no
ID3 tags). The first pad is the loop's last half-second and the last pad
is the loop's first half-second, so the audio is periodic across the
whole interior; the studio loops `[0.5 s, 60.5 s)` of the decoded buffer
(AudioBufferSourceNode `loopStart`/`loopEnd`). Whatever encoder delay or
padding a browser's MP3 decoder leaves in, that window is still exactly
one period, so the loop point stays seamless. Loudness: all three
mastered to **−27 LUFS integrated** (EBU R128, measured with FFmpeg
`ebur128`); the studio plays them at master gain 0.7. The service
worker keeps them in `beuk-sound-v2` (bumped from v1 when rain and wind
were replaced, so a returning writer never keeps the old files).

## rain.mp3

- Scene: Gentle rain (`zen.scene.rain`)
- Recording: “AMB Rain Loop 2” — steady rain, recorded on a GoPro Hero 12 Black with raw audio settings (submitted 2025-11-17)
- Author: Kresiek The Furry (OpenGameArt.org)
- Source page: https://opengameart.org/content/amb-rain-loop-2
- Direct download: https://opengameart.org/sites/default/files/amb_rain2.flac
- Licence: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Licence line seen: “License(s): CC0” (licence field of the submission page, linking to http://creativecommons.org/publicdomain/zero/1.0/, 2026-10-25); the page's description: “Recorded on a GoPro Hero 12 Black using raw audio settings.”
- Retrieved: 2026-10-25
- Original: FLAC 16-bit, 48 kHz stereo, 733.0 s, 75502454 bytes; sha1 `a4a0919a972b0a2350b6aed1c9effd249fc3111c`
- Original sha256: `c33d833842c88e9559882b35f6f149c3a96bbf236eb34491e36ea4cae8879985`
- Analysis of the original (whole file): no clipped samples (peak −0.04 dBFS, at a single hit near 202.9 s); −21.6 LUFS, LRA 3.5 LU; two broadband 10 s swells at ~48 s and ~178 s; only three 10 ms transients more than 12 dB over the 2 s median (+12.8 dB at 139.4 s, +12.2 dB at 202.9 s and 451.3 s); <200 Hz energy ≈ 6 %; no tonal lines (hum, voices, birdsong) 300 Hz–16 kHz; stereo correlation 0.75. In the section used (600–664 s): −22.6 LUFS, LRA 0.8 LU, peak −7.9 dBFS, 2 s RMS −28.5 to −27.4 dBFS, no 10 ms transient over +10 dB, <200 Hz ≈ 6 %, no tonal lines.
- Edits: decoded and resampled to 44.1 kHz (FFmpeg); cut 600.0–660.0 s; the 4 s that follow the loop end (660.0–664.0 s) equal-power crossfaded into the loop head (sin/cos); gain −4.4 dB to −27 LUFS (true peak −12.3 dBTP); 0.5 s periodic pads added; encoded MP3 128 kb/s CBR.
- Seam (decoded shipped file, FFmpeg): sample step across the loop point 0.018 vs typical step 0.0073 (p99 0.024, so within the file's normal range); RMS step 50 ms either side +0.40 dB (a naive cut: −0.48 dB); the padded tail repeats the head with r = 0.983.


## waves.mp3

- Scene: Soft waves on the shore (`zen.scene.waves`)
- Recording: “Waves.ogg” — water sounds recorded with a shotgun microphone on the shores of Lake Ontario, Webster, NY, autumn 2008
- Author: Dsw4 (Wikimedia Commons user)
- Source page: https://commons.wikimedia.org/wiki/File:Waves.ogg
- Direct download: https://upload.wikimedia.org/wikipedia/commons/1/1f/Waves.ogg
- Licence: Public domain (PD-self)
- Licence line seen: “I, the copyright holder of this work, release this work into the public domain.” and “I grant anyone the right to use this work for any purpose, without any conditions” (licence box of the file page, 2026-10-25)
- Retrieved: 2026-10-25
- Original: Ogg Vorbis, 44.1 kHz stereo, ~500 kb/s, 287.0 s, 17407459 bytes; sha1 `45b52a155db0b8bb22ce0ca8a5617acfa5d7a30f` (matches Commons)
- Original sha256: `8015cbcf2e8016ccdcaab103342cc53c105f2592e29c0fa754285c9b54bfaaba`
- Analysis of the original: no clipped samples (peak −3.65 dBFS). The file is a compilation with fades between takes (a near-silent dip at ~104–125 s and a hard edit at ~165.5 s), so one take was used. In 167–231 s: −23 to −31 dBFS RMS, only two 10 ms transients > 12 dB over the 2 s median (+13 dB at 176.3 s, +12 dB at 209.1 s, both wave splashes), no tonal lines; strong energy below 100 Hz with a 12 Hz infrasonic component.
- Edits: 2-pole high-pass at 40 Hz (removes the infrasonic rumble only); cut 167.0–231.0 s; the 4 s after the loop end (227.0–231.0 s) equal-power crossfaded into the loop head; gain −1.1 dB to −27 LUFS (true peak −10.1 dBTP); 0.5 s periodic pads; encoded MP3 128 kb/s CBR.
- Seam (decoded shipped file): sample step 0.0020 vs typical 0.0023 (p99 0.0080); RMS step +0.14 dB; a naive cut would jump 0.038 and step −4.0 dB.

## wind.mp3

- Made for Beuk: rendered offline by `tools/sound/render_ambience.py` (NumPy 1.24.2, SciPy 1.10.1, FFmpeg 5.1.9 in `debian:bookworm-slim`); there is no recording and no sample of anyone else's work in it
- Scene: Soft wind (`zen.scene.wind`)
- Author: Beuk
- Licence: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Licence line seen: “Beuk releases wind.mp3 and tools/sound/render_ambience.py under CC0 1.0 Universal.” (our own dedication, this file)
- Render: `python3 -I tools/sound/render_ambience.py wind <out_dir> 20261026`
- Seed: 20261026 (NumPy PCG64). Rendering twice gave byte-identical WAV and MP3 (the MP3's sha256 is the one above).
- What it is: brown-tilted noise shaped frame by frame (4200-sample frames, hop 1050, so the frames tile the 60 s loop exactly) by five broad bands centred near 300 Hz, 600 Hz, 1.1 kHz, 2 kHz and 3.6 kHz, each about an octave wide so nothing whistles, whose centres sweep slowly and whose levels follow irregular gust envelopes (modulation periods 4–40 s); gentle stereo movement; plus a leaf-rustle layer of 24004 tiny band-passed ticks (1.8–7 kHz) whose density rises with the gusts. Every layer is periodic with the 60 s loop by construction, so the loop needs no crossfade.
- Analysis (shipped file, decoded): −27.4 LUFS, LRA 7.2 LU, peak −13.6 dBFS, 2 s RMS −38.7 to −29.6 dBFS (the gusts), no 10 ms transient over +10 dB, <200 Hz energy ≈ 6 % (the low rumble that reads as “blowing into a microphone” is what this avoids), spectral centroid 907 Hz, no tonal lines 300 Hz–15.9 kHz (the only flagged line sits on the MP3 encoder's ~16 kHz cut-off edge), stereo correlation 0.0.
- Edits: none after rendering — gain −18.1 dB to −27 LUFS (true peak −13.1 dBTP), 0.5 s periodic pads and the MP3 128 kb/s CBR encode all happen inside the script.
- Seam (decoded shipped file): sample step 0.0080 vs typical 0.0031 (p99 0.0101); RMS step +0.32 dB; the padded tail repeats the head with r = 0.984. Before encoding the step is 0.0021 vs typical 0.0032 — the loop is periodic.

## How the files were made

`tools/sound/build_loop.py` (recordings) and `tools/sound/render_ambience.py`
(our renders), run with FFmpeg 5.1.9, NumPy 1.24.2 and SciPy 1.10.1 in a
`debian:bookworm-slim` container (originals never executed, only decoded).
`tools/sound/README.md` has the container and the steps.

```
python3 -I tools/sound/build_loop.py amb_rain2.flac rain  600.0 60 4 0.5 -27 2 128k
python3 -I tools/sound/build_loop.py Waves.ogg      waves 167.0 60 4 0.5 -27 2 128k 40
python3 -I tools/sound/render_ambience.py wind <out_dir> 20261026
```

`build_loop.py` crossfades, normalises, pads, encodes, then decodes its
own MP3 again and measures the seam on the decoded samples;
`render_ambience.py` renders, normalises, pads, encodes and measures the
same way.

## Considered and not used

| Candidate | Licence | Why not |
|---|---|---|
| Beuk's own rain render (`render_ambience.py rain`, seed 20261025) | CC0 (ours) | Kept for V to audition: a pink-noise bed plus ~480 drops/s in three tiers (far, mid, near: broadband ticks with a short resonant body, some with a rising air-bubble ring) and slow drips. A CC0 recording passed the cleanliness analysis clearly, so the recording ships. |
| Previous rain: radio aporee “Telaya, Veracruz, Mexico - Light Rain” (Felix BLUME) | PD Mark | Replaced in round 6: a public-domain mark is a label, not the recordist's waiver. |
| Previous wind: radio aporee “Utena, Lithuania, old willow tree in wind” (alas23/sala) | PD Mark | Replaced in round 6, same reason. |
| OpenGameArt “AMB Rain Loop 1” (Kresiek The Furry) | CC0 | 88.6 s at an odd 37453 Hz sample rate; the author calls it “not the best quality”. |
| OpenGameArt “Rain (Ambient, Not Loopable)”, long version (OveMelaa) | CC0 | Near-mono (L/R correlation 0.98), LRA 15.5 LU, 31 % of the energy below 200 Hz, centroid 916 Hz — dull and uneven. |
| OpenGameArt “Rain (loopable)” (Ylmir) | CC0 | 25–45 s takes from one mono window mic “processed to sound stereo”, Vorbis 160 kb/s — too short for a 60 s loop. |
| OpenGameArt “Wind” (IgnasD) | CC0 | Three clips of 1.7–6.7 s. |
| OpenGameArt “wind1”–“wind5” (Luke.RUSTLTD) | CC0 | Synthesized in PureData, mono — no better than our own render. |
| OpenGameArt “Mild Wind Background Noise”, “windy ambient noise” | CC0 | Bags shaking in the background / “atonal notes” in the wind, by their own descriptions. |
| Commons “245286 dbspin grunewald.wav” (dbspin, Freesound mirror) | CC0 | Forest ambience, not wind: 100 transients over +12 dB, 69 % of the energy below 200 Hz, −44 LUFS. |
| Commons “Rain.ogg” | PD | 10.3 s, mono. |
| archive.org Soundica mirror “Rain in the Vietnam” (ltruong267, Freesound 812780) | CC0 | Mono AAC, LRA 10.9 LU over the first 10 min, transients to +15 dB. |
| archive.org Soundica mirrors of Freesound 430765 “long easy rain 08” and 447408 “binaural wind sounds birds woods” | CC0 | Each mirror states its file is Freesound's public MP3 preview, not the original — previews are not shipped. |
| Freesound CC0 previews (analysis only; downloading originals needs an account): 695619 “Forestia RainOnLeaves”, 200273 “Rain light 2 (rural)”, 554419 “light rain”, 397636 “Gentle suburb rain”, 664162, 767061, 523391; wind 669113, 844818, 653946, 523372 | CC0 (per Freesound's licence filter) | Rain: 13 transients to +18 dB (695619), mono (200273, 767061), 35–73 % of the energy below 200 Hz (554419, 397636, 664162, 767061), or −64 LUFS (523391). Wind: 83–84 % below 200 Hz (669113, 844818), a horse at 203 s (653946), birds (523372). None is cleaner than what ships. |
| Commons rain/wind files by Gravity Sound, Robert EA Harvey, Acabashi, Zuvji, Sage Ross, W.carter, Missvain and others | CC BY / CC BY-SA / FAL | Attribution or share-alike licences are out of scope. |
| Commons “Light Rain Distant Thunder July 5th 2016.wav” (kvgarlic) | CC0 | Description says individual raindrops hit the microphone windscreens: 24 transients 14–29 dB over the bed, peaks to −2 dBFS (handling-type thumps); thunder in 0–30 s; a singing bird. |
| Commons “Rain (1).ogg” (ezwa, via pdsounds) | PD | Mono, 45 s, transcoded twice (MP3 → Vorbis); spectrally flat steady hiss with no drop detail — would sound like the old noise bed. |
| Commons “Rain against the window.ogg” (cori, via pdsounds) | PD | Mono, double-lossy; 40–98 % of each second’s energy below 200 Hz (wind rumble). |
| archive.org “Dharamshala Rain” (AugustSandberg, Freesound mirror) | CC0 | Clean, but heard through a closed window: energy almost all below 2.4 kHz, a muffled bed close to the old low-passed sound. Kept as the fallback if V rejects the rain scene. |
| Commons “Ocean Waves on a Tropical Beach.ogg” | CC0 | Uploaded 2026 as “own work” with author names that disagree (“Jarrod stanley” / “J.D. Savanyu”), a hard 16 kHz brick-wall typical of a lossy re-encode, 50 clipped samples — provenance not trustworthy. |
| Commons “Beach sounds South Carolina.ogg” | PD | Usable (MiniDisc, 61 s) but only 61 s and ATRAC-band-limited; Waves.ogg's take is longer and cleaner. |
| Commons “On a pebble beach.ogg”, “Water over rocks as tide recedes.ogg” | PD | Pebble rattle / babbling, 10–22 dB transients, 30–40 s, double-lossy. |
| Commons “Howling wind.ogg” | CC0 | Wind howling inside a building, 16 kHz mono — howling is excluded. |
| Commons “Vento fisterra.ogg” (Escoitar.org) | PD | A 4-minute crescendo from silence to a roar centred below 1.5 kHz, 280 clipped samples. |
| Commons “Killiney Hill Storm Floris…ogg” | CC0 | Storm gusts with mic buffeting (≈80 % energy < 200 Hz), 298 clipped samples. |
| Commons “Breeze birds and geese.ogg” | PD | Birdsong and geese throughout. |
| OpenGameArt “park ambiences” wind track (Thimras) | CC0 | 90–100 % of energy below 200 Hz (wind on the microphone) and many short chirp-like marks at 3–10 kHz after 170 s in the spectrogram. |
| archive.org aporee “Wind in the Trees”, Colorado Springs | PD Mark | Low-frequency buffeting dominates, 352 clipped samples. |
| archive.org aporee “wind in the forest trees” (john grzinich) | PD Mark | Clean, but described by its author as “white noise”, transients ≤ 3 dB — too close to the old sound. |
| archive.org aporee “Trees in the wind, toward the valley”, “Poplar leaves in the wind”, “wind in rushes” | PD Mark | Rumble-dominated (70–90 % < 200 Hz), or sparse leaf clicks at −40 dBFS, or flat 5 kHz hiss. |
| archive.org aporee “rain in the forest” (Pačkėnai) | PD Mark | Good, but 20 transients up to +28 dB (drips) in the usable stretch. |

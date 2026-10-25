# Zen ambient sound — sources and credits

Every file in this folder is a loop cut from a **real field recording**
that its author released into the **public domain**. No file needs
attribution and every one may be redistributed and modified; the authors
are named below anyway, with thanks. Nothing here is synthesized.

Retrieved and processed on 2026-10-25 (BEUK:sound). The licence of each
recording was read on the recording's own page (quoted below). Files
from *radio aporee ::: maps* are mirrored by the project to the Internet
Archive with the licence the recordist chose at upload; radio aporee's
own info page says that choice is "one of 6 creative commons licences,
and public domain" and that it cannot be changed later
(https://aporee.org/maps/info/).

## Shipped files

The sha256 below is of the file as shipped (tests/sound.test.ts checks
it, and that nothing else ships in this folder).

| File | sha256 (shipped) | Bytes | Length |
|---|---|---|---|
| `rain.mp3` | `5dbdc4cc06b010ecf26a913aaac58564f8f490e2616b86382b09dbf60dcf01dc` | 977187 | 61.0 s |
| `waves.mp3` | `059c5890d0c335ae23e2b1a341f8f9c76c70e9475d5d48bd41ff70f050707ddb` | 977187 | 61.0 s |
| `wind.mp3` | `b5b78cba9241b8c47d78cb92f3c84157cf4ab4d07ce523d7453dbd3f52af0140` | 977187 | 61.0 s |

Every file has the same shape: **0.5 s pad + 60 s loop + 0.5 s pad**, 44.1 kHz
stereo MP3 at 128 kb/s CBR (LAME via FFmpeg 5.1.9, Xing/LAME header, no
ID3 tags). The first pad is the loop's last half-second and the last pad
is the loop's first half-second, so the audio is periodic across the
whole interior; the studio loops `[0.5 s, 60.5 s)` of the decoded buffer
(AudioBufferSourceNode `loopStart`/`loopEnd`). Whatever encoder delay or
padding a browser's MP3 decoder leaves in, that window is still exactly
one period, so the loop point stays seamless. Loudness: all three
mastered to **−27 LUFS integrated** (EBU R128, measured with FFmpeg
`ebur128`); the studio plays them at master gain 0.7.

## rain.mp3

- Scene: Gentle rain (`zen.scene.rain`)
- Recording: “Telaya, Veracruz, Mexico - Light Rain” — light rain in a field of banana trees, AB pair of B&K 4006, 2020-02-04
- Author: Felix BLUME (radio aporee ::: maps)
- Source page: https://archive.org/details/aporee_48133_54753
- Direct download: https://archive.org/download/aporee_48133_54753/LegerepluiechampdebananesAB2016271296860567MX200201T04.mp3
- Licence: Public domain (Public Domain Mark 1.0, https://creativecommons.org/publicdomain/mark/1.0/)
- Licence line seen: “Public Domain Mark 1.0” (licence field of the item page, 2026-10-25)
- Retrieved: 2026-10-25
- Original: MP3, 48 kHz stereo, 320 kb/s, 600.1 s, 24009024 bytes; sha1 `d2d574a659c9787f4fb9a18f8010368f7afadf87` (matches the Archive's file list)
- Original sha256: `6a91521597d25e154863f4ac9341459395b52221bded06098551807b7c4df2ea`
- Analysis of the original: no clipped samples (peak −0.56 dBFS); steady −33 to −37 dBFS RMS in 2 s blocks; 10 ms transients over the 2 s median stay ≤ 15 dB in the section used (one +24 dB event at 134.4 s and a short ~7 kHz chirp at ~258.5 s lie outside it); <200 Hz energy ≈ 2 %; no tonal lines (hum, voices, birdsong) found 300 Hz–16 kHz in 196–260 s.
- Edits: decoded and resampled to 44.1 kHz; cut 192.0–256.0 s; the 4 s that follow the loop end (252.0–256.0 s) equal-power crossfaded into the loop head (sin/cos); gain +0.9 dB to −27 LUFS (true peak −1.9 dBTP); 0.5 s periodic pads added; encoded MP3 128 kb/s CBR.
- Seam (decoded shipped file, FFmpeg): sample step across the loop point 0.0012 vs typical step 0.0053 (p99 0.0206); RMS step 50 ms either side −2.2 dB; a naive cut would step −5.8 dB.

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

- Scene: Soft wind (`zen.scene.wind`)
- Recording: “Utena, Lithuania, old willow tree in wind”, 2020-05-16 — wind in an old willow, small microphones placed in cracks of the bark
- Author: alas23/sala (radio aporee ::: maps)
- Source page: https://archive.org/details/aporee_49170_56039
- Direct download: https://archive.org/download/aporee_49170_56039/zilvitistree.wav
- Licence: Public domain (Public Domain Mark 1.0, https://creativecommons.org/publicdomain/mark/1.0/)
- Licence line seen: “Public Domain Mark 1.0” (licence field of the item page, 2026-10-25)
- Retrieved: 2026-10-25
- Original: WAV PCM 16-bit, 44.1 kHz stereo, 292.3 s, 51569536 bytes; sha1 `7cf42e8acbfc5951ab0c151f666ced658d315a37` (matches the Archive's file list)
- Original sha256: `7493815e69df7b1b3a1308201bd0e550d8dd634f46128e518279e7675f6bb967`
- Analysis of the original: no clipped samples (peak −0.7 dBFS); gusts as slow broadband swells, 10 ms transients over the 2 s median ≤ 9 dB across the whole file and none > 10 dB in 130–210 s; no tonal lines in 138–206 s (a faint 120 Hz line in 20–120 s was avoided); energy concentrated below 300 Hz.
- Edits: 2-pole high-pass at 80 Hz (takes out low gust rumble, the part that reads as “blowing into a microphone”); cut 140.0–204.0 s; the 4 s after the loop end (200.0–204.0 s) equal-power crossfaded into the loop head; gain −3.6 dB to −27 LUFS (true peak −11.3 dBTP); 0.5 s periodic pads; encoded MP3 128 kb/s CBR.
- Seam (decoded shipped file): sample step 0.0029 vs typical 0.0018 (p99 0.0058); RMS step +1.0 dB; a naive cut would step −3.1 dB.

## How the files were made

`tools/sound/build_loop.py`, run with FFmpeg 5.1.9 and NumPy 1.24.2 in a
`debian:bookworm-slim` container (originals never executed, only decoded):

```
python3 -I tools/sound/build_loop.py <original> rain  192.0 60 4 0.5 -27 2 128k
python3 -I tools/sound/build_loop.py Waves.ogg   waves 167.0 60 4 0.5 -27 2 128k 40
python3 -I tools/sound/build_loop.py <original> wind  140.0 60 4 0.5 -27 2 128k 80
```

The script crossfades, normalises, pads, encodes, then decodes its own
MP3 again and measures the seam on the decoded samples.

## Considered and not used

| Candidate | Licence | Why not |
|---|---|---|
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

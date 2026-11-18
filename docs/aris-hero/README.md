# The Calling — Aris hero launchpad (Blender + live demo)

Direction C from the 2026-11-18 mockup session: vivid motes in chaos that
answer the call and form a shape. V's storyboard: a dense **A** → a click
or scroll bursts it inside its sphere → the motes settle as the name
**Aris** → the visitor orbits it 360°. These files are V's playground;
the /aris page gets built around what comes out of here.

## The live demo (the page engine, proven)

`the_calling_demo.html` — self-contained, no dependencies, double-click
to run (or serve it; both work). 22k motes, the full storyboard, drag
with either button to orbit. **Theme-aware with the studio's own tokens**
(studio/src/generated/tokens.css): `?theme=candlelight` = emissive glow
on the dark stage; `?theme=paper` = rich inks on bone (additive light is
impossible on a light page, so Paper gets a pointillist telling of the
same calling); no query = the OS decides. Knobs at the top of the file:
`N`, `R_SHELL`, `THEMES` (palettes), fonts in the two `textPoints` calls,
spring constant `0.014` for settle speed.

## Files

| File | What |
|---|---|
| `the_calling.blend` | Open this. Built by the script below, Blender 4.4. |
| `the_calling_launchpad.py` | Rebuilds the .blend from scratch (headless or Scripting tab). Edit + rerun freely — the .blend is disposable. |
| `aris-laurel.svg` | The product glyph as clean SVG (File > Import > SVG). |
| `proof8_word_0120.png` | Motes formed as the word **Aris** (Georgia). |
| `proof7_mid_0070.png` | Mid-calling swarm around the laurel. |
| `proof2_*.png` | Earlier laurel-formed / swarm proofs. |
| `proof_*.png`, `proof3-6_*` | The debugging trail, kept honest: AgX wash-out, flat text, the Domain Size / Sample Curve dead ends. |

## The two controls (the .blend)

Word-only since 2026-11-18 (V's call). On **Motes → modifier “TheCalling”**:

- **Calling** — `0.0` chaos cloud → `1.0` formed. Keyframed 1→120; play = the calling.
- **Target** — object dropdown, default **WordAris**. Any curve object
  works; the laurel is one line away in the script (`build_laurel()`).

## How it works (one idea)

The motes ARE the target's points: target curves → Resample by length
(`DENSITY` in the script, 0.005 ⇒ ~3.5k motes on the laurel, more on the
word) → every point becomes an emissive mote; "Calling" mixes each mote
between an Index-seeded random chaos position and its home on the curve.
No cross-geometry sampling — two measuring nodes (Domain Size, Sample
Curve) returned zeros in this graph on 4.4 headless, so the architecture
avoids them entirely.

Text targets are **converted to plain curve objects** at build time —
font objects evaluate through fill machinery that Resample skips. To
change the text: edit `build_text_target("WordAris", "Aris", …)` in the
script and rerun it (or add your own text object, Object > Convert >
Curve, and point Target at it).

## Colors

`MoteLight` material → ColorRamp: gold / cyan / green / violet stops over
the per-mote `hue` attribute. Renders currently skew cyan/pink — regrade
to taste. Emission 2.2; view transform is **Standard** (AgX desaturates
bright emission to white — the first bake proved it).

## Known coarse edges (yours to play with)

- Chaos cloud is a uniform box — a noise-driven drift or vortex beats it.
- Formed motes sit exactly ON the curve — tiny noise displace adds shimmer.
- The laurel object stays visible during chaos; keyframe its visibility
  or emission against Calling if the guardian should only appear when called.
- No camera move; a slow dolly-in over the calling sells the launch.
- Georgia is hard-wired in the script; swap the font path or assign any
  font before converting.

## Getting it back into /aris (when you're happy)

1. **Rendered** — frame sequence or WebM; the page scroll-scrubs it.
   Heaviest fidelity, zero runtime cost.
2. **Live** — the page re-does the motes in code (the HTML mockup already
   proves the particle engine) using your Blender grade as reference.

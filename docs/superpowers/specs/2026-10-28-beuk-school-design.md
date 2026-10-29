# Beuk School — design (first pass)

Date: 2026-10-28. Decisions are V's unless marked *my call*.

## What it is

A free learning site at **beuk.studio/school**, linked as a **School** tab in
the public site's nav (beside Ramp). Courses about the studio, delivered as
**Watch** (narrated screen recording), **Listen** (narration audio +
transcript) and **Read** (steps + screenshots). Nothing inside the studio
changes; lessons link out to `/studio` in a new tab.

## Decided

| | Decision |
|---|---|
| Address | `beuk.studio/school` (same site, same Caddy) |
| Price | Free, all of it |
| Media | Hosted on the Hetzner box (Caddy `file_server`, range requests) |
| Voice | AI-generated |
| Progress | Saved only for signed-in writers; anonymous visitors keep nothing |
| Languages | English this pass; content lives under `content/school/en/` so others slot in later |
| School agent | Back-burner; not in this pass |

## Shape

- **Content as data** (like Help): `content/school/en/<course>/course.md` +
  `content/school/en/<course>/NN-<lesson>.md`. A lesson's front matter names
  the Help guide it builds on (optional), its narration script, and a
  **shot list** — the studio actions the recorder performs.
- **Pages** are server-rendered by the app (Caddy proxies `/school*`), in the
  public site's shell (site.css, self-hosted fonts, the site nav).
- **Progress**: `school_progress` table (user, course, lesson, completed_at).
  `GET/POST /api/school/progress` behind `requireAuth`. The page script only
  calls it when signed in; a 401 means "keep nothing". A lesson is marked done
  when the writer presses "Mark lesson done" — labelled as that, not as
  anything Beuk observed. *(my call)*
- **Media pipeline** (`tools/school-media/`, runs anywhere Docker runs):
  1. `beuk-school-voice` image: Kokoro-82M (Apache-2.0 weights) via
     kokoro-onnx (MIT), CPU only — speaks each narration line to WAV and
     reports its duration.
  2. `record.mjs`: Playwright drives the **live studio** through the shot
     list, holding each step on screen exactly as long as its narration, with
     `recordVideo` on; takes one screenshot per step. A step whose control
     cannot be found **fails the lesson** — no lesson ships describing UI that
     isn't there.
  3. ffmpeg muxes video + narration → `video.mp4`, narration → `audio.mp3`.
  Output: `school-media/en/<course>/<lesson>/` (git-ignored), served at
  `/school/media/...`. A lesson whose media is missing simply hides that tab.
- The narration is labelled "AI voice" on the page. *(my call)*

## Out of scope this pass

Other languages, the publishing-craft and craft-on-the-page shelves (only
courses that exist are listed), the School agent, quizzes beyond Read/Watch/
Listen, email courses.

## First course

**Maiden Voyage** — the studio end to end, built only from features verified
in the live studio on 2026-10-28 and the existing Help guides.

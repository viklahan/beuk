# Beuk Weekly drafter — the Legion side

The drafter writes the next Beuk Weekly issue every Thursday on V's Legion
and uploads it to the Beuk server, which emails V a preview. Nothing
publishes until V presses **Approve and publish** on that preview. The
runbook is `docs/weekly-press.md`; this file covers the tools here.

| File | What it does |
|---|---|
| `SKILL.md` | The drafter's brief, handed to `claude -p` (V's subscription login, never an API key) |
| `draft.ps1` | One run: status, sent-back notes, write, pictures, checks, upload, log |
| `register-task.ps1` | Registers the `BeukWeeklyDrafter` scheduled task |
| `check-draft.ts` | The server's own upload checks, run on a folder before upload |
| `upload.ts` | Uploads a folder, or reports a failed run (`--failed`) |
| `images.ts` | The picture seam: inbox → local model → Gemini / Muse placeholders |
| `illustrate.py` | Draws illustrations with the local model |

## The local image model: not chosen yet

`BEUK_WEEKLY_IMAGE_MODEL` is unset, so the `local` provider reports "not
configured". A story without a picture from V's inbox then goes out with
no picture, and the draft email says so. Nothing is faked.

The spec requires an open-weights model whose licence allows commercial
use, checked before it's picked, that fits the Legion's GPU. That GPU is an
NVIDIA GeForce RTX 3080 Laptop GPU with 16384 MiB (`nvidia-smi`,
2026-10-29). Here's what each candidate's own page said, fetched
2026-10-29:

| Model | Licence, as its page states it | Commercial use | Size | Access |
|---|---|---|---|---|
| [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) ([LICENSE.md](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md)) | CreativeML Open RAIL++-M License dated July 26, 2023 | **Not stated.** The grant is royalty-free, and "Licensor claims no rights in the Output You generate". The model card also says "The model is intended for research purposes only." | 3B params | Open |
| [black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | apache-2.0 | "can be used for personal, scientific, and commercial purposes" | 12B params; needs CPU offload or quantization to fit 16 GB | **Gated**: accept the terms with a Hugging Face account |
| [stabilityai/stable-diffusion-3.5-medium](https://huggingface.co/stabilityai/stable-diffusion-3.5-medium) | Stability Community License | "Free for research, non-commercial, and commercial use" for those "with less than $1M in total annual revenue" | 2B params | **Gated**: accept the terms with a Hugging Face account |

SDXL is not used: its page does not say commercial use is allowed. Either
gated model needs V to accept its terms with his own Hugging Face account
(and `hf auth login` on the Legion). The full Stability Community License
text has not been read here, and has to be before that model is chosen.

To switch the local model on, once V has chosen:

1. Accept the model's terms on its page, then run `hf auth login` on the Legion.
2. Install the Python packages: `pip install diffusers accelerate`.
   torch with CUDA is already installed.
3. Set `BEUK_WEEKLY_IMAGE_MODEL` to the model id (user environment
   variable). If `python` is not the right interpreter, also set
   `BEUK_WEEKLY_PYTHON`.
4. Run it once by hand:
   `python tools/weekly/illustrate.py --prompt-file p.json --out out --seed 1 --count 3 --model <id>`.
   The first run downloads the weights; check the size on the model's
   "Files" tab. Look at the three candidates.
5. Add the model, its licence and the date to the table above.

## Gemini and Muse

Both are placeholders. They report "placeholder: no account route yet
(V, 2026-10-29)" and never produce a file. A consumer chat subscription
has no supported way to make images unattended. For a picture from one of
them, make it there by hand and drop it into `content/weekly/inbox/` as
`<story-slug>.jpg` (or `.png` / `.webp`). Inbox pictures always win.

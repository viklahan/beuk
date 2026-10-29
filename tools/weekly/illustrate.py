"""Beuk Weekly drafter: draw illustrations with the local open-weights model.

    python illustrate.py --prompt-file p.json --out DIR --seed N --count 3 --model MODEL

p.json is {"prompt": "..."}: the skill's picture prompt for one story. Every
candidate is drawn in the one house style (an engraving / woodcut look, black
ink on white, after the 1920s broadsheet) and must not show a real person,
product, logo, book cover or app screen (spec rule 6); those go into the
negative prompt, and V judges the result on the preview page.

Writes candidate-<i>.png, candidate-<i>.jpg (at most 1600 px wide) and
meta.json: {"model", "prompt", "styled_prompt", "candidates": [{"seed", "png", "jpg"}]}.

MODEL is a Hugging Face model id V has chosen and whose licence is recorded in
tools/weekly/README.md. Nothing here picks a model on its own.
"""

import argparse
import json
import os
import sys

HOUSE_STYLE = "engraving, woodcut, black ink on white, 1920s newspaper illustration, cross-hatching, no colour"
NEGATIVE = (
    "photograph, photo, real person, face of a real person, celebrity, logo, brand, trademark, product, "
    "book cover, text, letters, words, screenshot, user interface, app screen, computer screen, colour"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--count", type=int, default=3)
    ap.add_argument("--model", required=True)
    ap.add_argument("--steps", type=int, default=None)
    a = ap.parse_args()

    with open(a.prompt_file, encoding="utf-8") as f:
        prompt = json.load(f)["prompt"].strip()
    if not prompt:
        print("empty prompt", file=sys.stderr)
        return 2
    styled = f"{prompt}. {HOUSE_STYLE}"

    import torch
    from diffusers import AutoPipelineForText2Image

    if not torch.cuda.is_available():
        print("torch sees no CUDA GPU", file=sys.stderr)
        return 3
    pipe = AutoPipelineForText2Image.from_pretrained(a.model, torch_dtype=torch.bfloat16)
    # Keeps a 16 GB card inside its memory: each part moves to the GPU only while it runs.
    pipe.enable_model_cpu_offload()

    os.makedirs(a.out, exist_ok=True)
    candidates = []
    for i in range(a.count):
        seed = a.seed + i
        kwargs = {"prompt": styled, "generator": torch.Generator("cpu").manual_seed(seed)}
        if a.steps:
            kwargs["num_inference_steps"] = a.steps
        try:
            image = pipe(negative_prompt=NEGATIVE, **kwargs).images[0]
        except TypeError:
            # Some pipelines (distilled ones such as FLUX.1-schnell) take no negative prompt.
            image = pipe(**kwargs).images[0]
        png = f"candidate-{i}.png"
        jpg = f"candidate-{i}.jpg"
        image.save(os.path.join(a.out, png))
        small = image.convert("RGB")
        if small.width > 1600:
            small = small.resize((1600, round(small.height * 1600 / small.width)))
        small.save(os.path.join(a.out, jpg), quality=88)
        candidates.append({"seed": seed, "png": png, "jpg": jpg})

    with open(os.path.join(a.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"model": a.model, "prompt": prompt, "styled_prompt": styled, "candidates": candidates}, f, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

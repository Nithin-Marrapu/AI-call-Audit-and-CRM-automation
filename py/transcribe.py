"""Transcribe one audio file and write segments as JSON.

Usage:
  python py/transcribe.py <audio> <out.json> --backend mlx|openai \
      --model <name> [--language en] [--prompt "domain words"]

Both backends return the same shape, so the Node side never cares
which one ran. Per-segment avg_logprob / no_speech_prob are kept:
they are the transcript's own confidence signals.
"""

import argparse
import json
import sys


def run_mlx(audio, model, language, prompt):
    import mlx_whisper

    return mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        language=language,
        initial_prompt=prompt,
        # Bad phone audio makes Whisper loop on its own previous text.
        condition_on_previous_text=False,
        # False = show a progress bar on stderr (the app reads it).
        verbose=False,
    )


def run_openai(audio, model, language, prompt):
    import whisper

    return whisper.load_model(model).transcribe(
        audio,
        language=language,
        initial_prompt=prompt,
        condition_on_previous_text=False,
        verbose=False,
        fp16=False,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("out")
    parser.add_argument("--backend", choices=["mlx", "openai"], default="mlx")
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default=None)
    parser.add_argument("--prompt", default=None)
    args = parser.parse_args()

    language = None if args.language in (None, "", "auto") else args.language
    runner = run_mlx if args.backend == "mlx" else run_openai
    result = runner(args.audio, args.model, language, args.prompt or None)

    segments = [
        {
            "start": round(float(s["start"]), 2),
            "end": round(float(s["end"]), 2),
            "text": s["text"].strip(),
            "avg_logprob": round(float(s.get("avg_logprob", 0.0)), 3),
            "no_speech_prob": round(float(s.get("no_speech_prob", 0.0)), 3),
        }
        for s in result.get("segments", [])
        if s["text"].strip()
    ]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            {
                "backend": args.backend,
                "model": args.model,
                "language": result.get("language"),
                "segments": segments,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        sys.exit(f"Missing package: {e}. See README setup.")

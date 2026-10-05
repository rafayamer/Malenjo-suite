#!/usr/bin/env python3
"""MALENJO optional PaddleOCR worker.

This worker is intentionally separate from the desktop shell. It is loaded only
when the optional Python/PaddleOCR pack is installed and an OCR job requests it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def flatten_text(value):
    texts = []
    confidences = []

    def walk(node):
        if isinstance(node, dict):
            for key, item in node.items():
                lowered = str(key).lower()
                if lowered in {"text", "rec_text", "transcription"} and isinstance(item, str):
                    texts.append(item)
                elif lowered in {"score", "confidence", "rec_score"} and isinstance(item, (int, float)):
                    confidences.append(float(item))
                else:
                    walk(item)
        elif isinstance(node, (list, tuple)):
            # Legacy PaddleOCR shape: [box, (text, score)]
            if (
                len(node) == 2
                and isinstance(node[1], (list, tuple))
                and len(node[1]) >= 2
                and isinstance(node[1][0], str)
                and isinstance(node[1][1], (int, float))
            ):
                texts.append(node[1][0])
                confidences.append(float(node[1][1]))
                return
            for item in node:
                walk(item)
        else:
            # Newer result objects sometimes expose a serializable json/res attribute.
            for attr in ("json", "res"):
                if hasattr(node, attr):
                    try:
                        walk(getattr(node, attr))
                    except Exception:
                        pass

    walk(value)
    confidence = sum(confidences) / len(confidences) if confidences else 0.0
    return "\n".join(text for text in texts if text.strip()), confidence


def run(image_path: Path, language: str):
    from paddleocr import PaddleOCR

    # Prefer the current predict API, but retain compatibility with older OCR APIs.
    try:
        engine = PaddleOCR(lang=language)
        result = engine.predict(str(image_path))
    except Exception:
        engine = PaddleOCR(use_angle_cls=True, lang=language)
        result = engine.ocr(str(image_path), cls=True)

    text, confidence = flatten_text(result)
    return {"text": text, "confidence": confidence}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    image_path = Path(args.input)
    if not image_path.is_file():
        raise RuntimeError("Input image does not exist.")

    payload = run(image_path, args.lang)
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise

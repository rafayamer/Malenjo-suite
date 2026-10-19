#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ALLOWED_ROLES = {"system", "user", "assistant"}
MAX_MESSAGES = 32
MAX_CONTENT_CHARS = 50000


def fail(path: Path, line_no: int, message: str) -> None:
    raise SystemExit(f"{path}:{line_no}: {message}")


def validate_record(path: Path, line_no: int, record: object) -> None:
    if not isinstance(record, dict):
        fail(path, line_no, "record must be an object")

    messages = record.get("messages")
    metadata = record.get("metadata")
    if not isinstance(messages, list) or not (2 <= len(messages) <= MAX_MESSAGES):
        fail(path, line_no, f"messages must contain 2..{MAX_MESSAGES} turns")
    if not isinstance(metadata, dict):
        fail(path, line_no, "metadata is required")
    if metadata.get("approved") is not True:
        fail(path, line_no, "metadata.approved must be true")
    if metadata.get("sensitive") is not False:
        fail(path, line_no, "metadata.sensitive must be false")
    for key in ("provenance", "license"):
        value = metadata.get(key)
        if not isinstance(value, str) or not value.strip():
            fail(path, line_no, f"metadata.{key} is required")

    seen_user = False
    seen_assistant = False
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            fail(path, line_no, f"messages[{index}] must be an object")
        role = message.get("role")
        content = message.get("content")
        if role not in ALLOWED_ROLES:
            fail(path, line_no, f"messages[{index}].role is invalid")
        if not isinstance(content, str) or not content.strip():
            fail(path, line_no, f"messages[{index}].content must be non-empty")
        if len(content) > MAX_CONTENT_CHARS:
            fail(path, line_no, f"messages[{index}].content exceeds {MAX_CONTENT_CHARS} chars")
        if role == "user":
            seen_user = True
        elif role == "assistant":
            seen_assistant = True

    if not seen_user or not seen_assistant:
        fail(path, line_no, "record must include user and assistant turns")
    if messages[-1].get("role") != "assistant":
        fail(path, line_no, "final turn must be assistant")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: validate_dataset.py <dataset.jsonl> [...]")

    total = 0
    for raw in sys.argv[1:]:
        path = Path(raw)
        if not path.is_file():
            raise SystemExit(f"dataset not found: {path}")
        with path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    fail(path, line_no, f"invalid JSON: {exc}")
                validate_record(path, line_no, record)
                total += 1

    if total == 0:
        raise SystemExit("no training records found")
    print(f"MALENJO AI dataset OK: {total} approved record(s)")


if __name__ == "__main__":
    main()

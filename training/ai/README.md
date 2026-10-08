# MALENJO Phi-4 post-training

MALENJO uses one reviewed local model: `microsoft/Phi-4-mini-instruct` (MIT), served in the application through the reviewed Ollama Q4_K_M runtime profile.

This directory is a **post-training workflow**, not a claim that a 3.8B local model can be made equivalent to GPT-5.6. MALENJO quality is built from several layers:

1. the Phi-4 Mini base model;
2. MALENJO instruction tuning (LoRA/QLoRA);
3. versioned system/prompt policy;
4. local RAG over user documents;
5. conversation/notebook memory;
6. controlled document tools;
7. evaluation and safety gates.

## Why LoRA/QLoRA

Full retraining of a 3.8B model is expensive and unnecessary for MALENJO product behavior. The training script keeps the MIT base model fixed and trains a small adapter. That makes updates cheap, auditable, and reversible.

The default script uses 4-bit QLoRA and requires an NVIDIA CUDA GPU. It deliberately refuses ordinary CPU training because a Codespace CPU run would be impractically slow.

## Data policy

Training data is never harvested automatically from user documents or chats.

Every JSONL record must contain:

- `messages`: chat-format system/user/assistant turns;
- `metadata.approved: true`;
- `metadata.provenance`: where the example came from;
- `metadata.license`: the data license/permission;
- `metadata.sensitive: false`.

The validator rejects unapproved or sensitivity-marked records. A future feedback workflow may export user-approved examples, but it must remain explicit opt-in.

The checked-in `data/seed.jsonl` is MALENJO-authored synthetic smoke data only. It is intentionally too small to be considered a production training corpus.

## Install

Use a GPU training machine, not the normal Codespaces runtime:

```bash
python -m venv .venv-ai-train
source .venv-ai-train/bin/activate
pip install -r training/ai/requirements.txt
```

Microsoft's model card documents Phi-4 Mini support in Transformers 4.49 and provides an upstream fine-tuning sample. MALENJO keeps its own small training script so dataset/provenance policy is under product control.

## Validate data

```bash
python training/ai/validate_dataset.py training/ai/data/seed.jsonl
```

## Train a smoke adapter

```bash
python training/ai/train_phi4_lora.py \
  --train training/ai/data/seed.jsonl \
  --output .build/ai/phi4-malenjo-adapter \
  --epochs 1
```

For a real release, replace the seed dataset with a reviewed, sufficiently large instruction corpus and run the full AI evaluation suite before any adapter is approved.

## Output provenance

Every training run writes `malenjo-training-manifest.json` beside the adapter. It records:

- base model + revision;
- base license;
- training dataset SHA-256;
- hyperparameters;
- package versions;
- timestamp;
- adapter output path.

The manifest intentionally does **not** automatically declare the trained artifact releasable. Release licensing still depends on every dataset component being cleared for that use.

## Target MALENJO behaviors

A production training set should cover at least:

- natural multi-turn conversation;
- concise/direct answers;
- tutoring and Socratic teaching;
- PDF/document Q&A with citations;
- multi-document comparison and synthesis;
- source-grounded uncertainty/refusal;
- summaries, extraction, classification and rewriting;
- flashcards and quizzes;
- prompt-injection resistance;
- English + Urdu + other target-language quality;
- tool-selection examples without allowing the model to bypass application authorization.

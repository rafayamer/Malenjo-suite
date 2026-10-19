#!/usr/bin/env python3
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import datasets
import peft
import torch
import transformers
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)

BASE_MODEL = "microsoft/Phi-4-mini-instruct"
BASE_REVISION = "cfbefac"
BASE_LICENSE = "MIT"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="QLoRA fine-tuning for the MALENJO Phi-4 model.")
    parser.add_argument("--train", required=True, type=Path)
    parser.add_argument("--eval", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--seed", type=int, default=17)
    return parser.parse_args()


def require_cuda() -> None:
    if not torch.cuda.is_available():
        raise SystemExit(
            "CUDA GPU required. MALENJO refuses CPU fine-tuning because Phi-4 Mini training "
            "would be impractically slow. Use a GPU runner/workstation."
        )


def load_jsonl(path: Path):
    if not path.is_file():
        raise SystemExit(f"dataset not found: {path}")
    return load_dataset("json", data_files=str(path), split="train")


def render_dataset(dataset, tokenizer, max_length: int):
    def render(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        encoded = tokenizer(
            text,
            truncation=True,
            max_length=max_length,
            padding=False,
        )
        encoded["labels"] = list(encoded["input_ids"])
        return encoded

    return dataset.map(
        render,
        remove_columns=list(dataset.column_names),
        desc="Tokenizing MALENJO SFT data",
    )


def write_manifest(config: argparse.Namespace, output: Path) -> None:
    payload = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "baseModel": BASE_MODEL,
        "baseRevision": BASE_REVISION,
        "baseLicense": BASE_LICENSE,
        "trainingData": {
            "path": str(config.train),
            "sha256": sha256(config.train),
        },
        "evaluationData": (
            {"path": str(config.eval), "sha256": sha256(config.eval)}
            if config.eval
            else None
        ),
        "method": "QLoRA",
        "adapterOnly": True,
        "releaseApproved": False,
        "hyperparameters": {
            "epochs": config.epochs,
            "learningRate": config.learning_rate,
            "batchSize": config.batch_size,
            "gradientAccumulation": config.gradient_accumulation,
            "maxSeqLength": config.max_seq_length,
            "loraR": config.lora_r,
            "loraAlpha": config.lora_alpha,
            "seed": config.seed,
            "quantization": "4bit-nf4-double-quant",
        },
        "packages": {
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "peft": peft.__version__,
            "datasets": datasets.__version__,
        },
        "notes": (
            "Training output is not automatically approved for redistribution. "
            "Review every dataset license/provenance entry and pass MALENJO AI evaluation gates first."
        ),
    }
    (output / "malenjo-training-manifest.json").write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    config = parse_args()
    require_cuda()
    torch.manual_seed(config.seed)
    config.output.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(
        BASE_MODEL,
        revision=BASE_REVISION,
        trust_remote_code=True,
    )
    tokenizer.model_max_length = config.max_seq_length
    tokenizer.pad_token = tokenizer.unk_token
    tokenizer.pad_token_id = tokenizer.convert_tokens_to_ids(tokenizer.pad_token)
    tokenizer.padding_side = "right"

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
    )

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        revision=BASE_REVISION,
        trust_remote_code=True,
        quantization_config=quantization,
        device_map={"": torch.cuda.current_device()},
        torch_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(
        model,
        LoraConfig(
            r=config.lora_r,
            lora_alpha=config.lora_alpha,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules="all-linear",
        ),
    )

    train_dataset = render_dataset(load_jsonl(config.train), tokenizer, config.max_seq_length)
    eval_dataset = (
        render_dataset(load_jsonl(config.eval), tokenizer, config.max_seq_length)
        if config.eval
        else None
    )

    train_args = TrainingArguments(
        output_dir=str(config.output),
        overwrite_output_dir=True,
        num_train_epochs=config.epochs,
        learning_rate=config.learning_rate,
        per_device_train_batch_size=config.batch_size,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=config.gradient_accumulation,
        gradient_checkpointing=True,
        warmup_ratio=0.05,
        logging_steps=5,
        save_strategy="epoch",
        evaluation_strategy="epoch" if eval_dataset is not None else "no",
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        report_to=[],
        seed=config.seed,
        remove_unused_columns=False,
    )

    trainer = Trainer(
        model=model,
        args=train_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    trainer.save_model(str(config.output))
    tokenizer.save_pretrained(str(config.output))
    write_manifest(config, config.output)
    print(f"MALENJO Phi-4 adapter saved to {config.output}")


if __name__ == "__main__":
    main()

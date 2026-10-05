# Local AI / RAG security corpus

Phase 5 automated tests in `src/suite/ai/rag.test.ts` cover:

- relevant local-passage retrieval;
- stable citation IDs;
- Lite Mode memory bounds;
- oversized-corpus truncation;
- hostile source text containing prompt-injection language such as "IGNORE PREVIOUS INSTRUCTIONS";
- explicit labeling of retrieved text as untrusted data.

Future synthetic cases should include HTML/Markdown injection, fake system prompts, data-exfiltration requests, conflicting documents, long repetitive documents and multilingual retrieval.

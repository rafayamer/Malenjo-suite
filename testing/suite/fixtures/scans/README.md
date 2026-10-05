# Scanner/OCR test corpus

Phase 4 automated tests cover:

- image MIME/byte/pixel bounds;
- perspective-coordinate normalization;
- identity quadrilateral mapping;
- OCR character-accuracy scoring;
- cancellation/resource-limit constants in the native worker.

Future redistributable synthetic fixtures should add skew, perspective distortion, low contrast, blur, mixed fonts, tables, handwriting, multilingual text, very large dimensions and malformed image headers.

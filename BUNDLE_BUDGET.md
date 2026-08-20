# Production bundle budget

The budget is enforced after every production build by
`scripts/checkBundleBudget.mjs`. Raw and gzip totals include the JavaScript and
CSS in each route's static import closure; dynamically imported format engines
are measured separately and are not counted as ordinary route downloads.

| Route                      |  Raw budget | Gzip budget |     2026-08-20 baseline |
| -------------------------- | ----------: | ----------: | ----------------------: |
| Landing `/`                |   140,000 B |    55,000 B |    117,832 B / 45,099 B |
| About `/about`             |   150,000 B |    60,000 B |    128,669 B / 48,612 B |
| CAT workspace `/app`       | 1,320,000 B |   400,000 B | 1,198,884 B / 359,796 B |
| Translation memories `/tm` |   480,000 B |   160,000 B |   433,318 B / 139,102 B |
| Term bases `/tb`           |   480,000 B |   160,000 B |   432,187 B / 138,858 B |

File-level limits are 750,000 B raw / 230,000 B gzip for a static JavaScript
chunk, 1,300,000 B raw / 410,000 B gzip for a dynamic JavaScript chunk, and
24,000,000 B raw / 6,000,000 B gzip for an emitted asset. These intentionally
leave limited headroom over the measured build rather than normalizing future
growth.

## Reviewed large artifacts

- `ort-wasm-simd-threaded.asyncify.wasm` is about 23.6 MB raw and 5.8 MB gzip.
  It belongs only to the dynamic Hugging Face transcription entry. The manifest
  gate fails if that engine or asset enters any route's static closure; model
  weights remain remote until the user explicitly starts local transcription.
- The PDF worker is about 2.38 MB, and the PDF.js worker JavaScript entry is about
  1.23 MB. Both remain dynamic and load only for PDF validation/import/export.
- Reamkit is about 1.15 MB and remains a dynamic legacy-Office conversion parser;
  it is requested only after a signed legacy Office file selects that workflow.
- PDF-lib (about 519 KB), Transformers (about 516 KB), XLSX (about 493 KB), and
  the DOCX generator (about 316 KB) remain feature-scoped dynamic entries.
  Tesseract's loader is also dynamic; its worker, OCR core, and language data are
  requested only after local OCR starts.
- The `/app` route node remains the largest static chunk at about 724 KB raw / 215
  KB gzip because upload detection, adapter metadata, safe validation, project
  migration, and all delivery policies must be available before a user selects or
  reopens a local project. It has an explicit per-chunk and route budget; heavy
  parsers and conversion engines are not part of this static closure.

The DOCX library contains an optional Node stream branch with `require("buffer")`,
but Open TLC uses its browser `Packer.toBlob` path. The build logger suppresses
only that reviewed dependency warning; a matching unit test prevents the policy
from hiding first-party `buffer` imports.

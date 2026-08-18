# Constrained file-format workflows

Open TLC distinguishes native, round-trip-capable formats from conversion,
source-only, consent-based, and read-only workflows. A recognized extension is
not advertised in the upload picker until the corresponding workflow is
actually available.

## Legacy Office and RTF

Binary Word (`.doc`), Excel (`.xls`), and PowerPoint (`.ppt`) use OLE Compound
File storage. RTF (`.rtf`) is a legacy rich-text interchange syntax. Open TLC
recognizes their signatures but deliberately does not parse them in the browser.

Use a trusted, patched local copy of Microsoft Office or LibreOffice:

1. Work on a copy and keep the original authoritative file.
2. Save `.doc`/`.rtf` as DOCX, `.xls` as XLSX, or `.ppt` as PPTX. Renaming the
   extension is not conversion.
3. Reopen the result locally and inspect layout, tracked changes, fields,
   formulas, charts, macros, links, fonts, animations, and embedded objects.
4. Upload the converted file. Open TLC preserves supported modern-package parts,
   but cannot repair losses introduced by conversion.

No remote conversion endpoint is configured or contacted. Public converter
websites should not receive confidential files. A future isolated converter must
be opt-in, disclose retention and subprocess isolation, enforce time/size limits,
scan outputs, and return provenance plus conversion warnings before these legacy
extensions can be added to the picker.

## Capability labels

- **Native round trip:** import and export the same format with declared fidelity.
- **Source only:** extract source context and export a new review/accessibility
  artifact; never claim layout-identical reconstruction.
- **Conversion required:** no project is created until the user supplies a safe,
  supported converted copy.
- **External service required:** disabled until an explicit service, consent,
  privacy policy, and reproducible test profile are configured.
- **Read-only package:** inspect supported members without writing the vendor
  container back.

## PDF source-only extraction

PDF is a final-form page-description format, not an editable document model.
Open TLC uses the locally bundled PDF.js parser to extract positioned text from
selected pages. Each unit records its source page and PDF user-space bounding
box. Pages with raster images but no text are reported as requiring OCR; they
are never silently treated as blank or sent to a service.

PDF projects have `roundTrip: false`. Export creates a standalone, accessible,
script-free bilingual HTML review grouped by source page. It deliberately does
not write a replacement PDF or promise matching line breaks, reading order,
fonts, forms, annotations, signatures, accessibility tags, or layout. Embedded
scripts, actions, attachments, forms, and links are not executed. Passworded
files must be decrypted locally first.

## OCR images and audio/video transcription

PNG, JPEG, and TIFF images require OCR; WAV, MP3, Ogg, FLAC, MP4, MOV, and WebM
media require transcription. Open TLC recognizes representative container
signatures so a renamed executable or arbitrary binary cannot be routed by its
extension alone. These extensions remain absent from the upload picker because
no audited extraction provider is configured.

The provider boundary is deliberately separate from format adapters. A local
provider must declare a pinned model version, modalities, and file-size limit,
must not declare an endpoint, and must not send bytes off-device. A remote
provider must additionally use HTTPS, disclose its privacy and retention
policies, acknowledge that bytes leave the device, and require consent bound to
the exact provider, file name, file size, policy, and retention statement.

Results are accepted only when they identify the provider and pinned model,
report detected-language confidence, and retain review context. OCR units need
one-based pages and finite bounding boxes; transcript units need ordered
millisecond timestamps. Every unit needs confidence in the inclusive 0–1 range.
Low-confidence text must remain reviewable rather than being silently promoted
to authoritative source text. Until an implementation supplies this contract,
its consent UI, confidence review UI, and reproducible pinned-model fixtures,
Open TLC performs no upload and creates no project from image or media input.

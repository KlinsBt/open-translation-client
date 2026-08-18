# Constrained file-format workflows

Open TLC distinguishes native round trips, derived output, local extraction,
return packages, and manifest-driven archive workflows. A recognized extension
is advertised only when its implementation and validator are available.

## Legacy Office and RTF

Binary Word (`.doc`), Excel (`.xls`), and PowerPoint (`.ppt`) use OLE Compound
File storage. Open TLC validates that signature and parses them locally with a
dedicated browser library. RTF (`.rtf`) uses a native text skeleton.

- RTF imports and exports RTF while preserving control syntax outside translated
  fragments.
- XLS imports selected text cells and writes a translated binary XLS workbook.
- DOC imports paragraph runs and writes DOCX, the strongest document output the
  browser implementation provides without LibreOffice.
- PPT imports text runs and writes translated HTML because a dependable legacy
  PPT writer is unavailable in the browser.

The original is retained locally in IndexedDB. No conversion endpoint receives
the source file. Embedded objects, macros, advanced fields, animations, charts,
and vendor-only layout details may exceed the browser parser and should still be
reviewed after export.

## Capability labels

- **Native round trip:** import and export the same format with declared fidelity.
- **Source only:** extract source context and export a new review/accessibility
  artifact; never claim layout-identical reconstruction.
- **Derived output:** local import is available, but export deliberately uses a
  different format whose capabilities are stated in the UI.
- **Local extraction:** source bytes remain on-device while browser code/models
  produce translatable units.
- **Return package:** update bilingual members and preserve the surrounding CAT
  container.

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

PNG, JPEG, and TIFF use Tesseract in the browser. OCR units retain confidence
and bounding boxes and can be grouped by paragraph or line. WAV, MP3, M4A, Ogg,
FLAC, MP4, MOV, and WebM are decoded locally and transcribed with a browser-run
Whisper model; units retain ordered timestamps and export as WebVTT.

The browser may download and cache OCR language data and transcription model
assets. The image, audio, or video itself is not sent to a provider. Because no
source upload occurs, there is no remote-processing consent gate. Original
files remain in the local project skeleton, and spoofed extensions are rejected
when their binary signature does not match.

## Proprietary CAT packages

Trados Studio project/return packages (`.sdlppx`, `.sdlrpx`), WorldServer
packages (`.wsxz`), and memoQ handoff/archive packages (`.mqout`, `.mqback`,
`.mqxlz`) are ZIP containers whose manifests, workflow state, checksums, and
binary databases belong to their originating CAT tools. Open TLC updates only
the bilingual XLIFF-family members and preserves the rest of the container.

Detection requires both a safe ZIP structure and matching internal bilingual
members/markers. Import uses the shared archive limits: traversal, duplicate
paths, encryption, ZIP64/spanned archives, excessive entry counts, expanded
size, and compression bombs are rejected. Selected XLIFF-family members are
parsed with the existing protected vendor profiles. Member paths are retained
as source context, existing targets may be included or deliberately omitted,
and every unknown package entry remains byte-preserved in the stored skeleton.
Nested archives and non-XLIFF databases are never opened or executed.

Return export rebuilds selected bilingual members, preserves locked units and
copies every other entry unchanged. SDLPPX work packages export as SDLRPX return
packages, MQOUT handoffs export as MQBACK, and SDLRPX, WSXZ, MQBACK, and MQXLZ
retain their extensions. Generated packages are reopened by the automated suite
to verify target text and preserved resources.

## Manifest-driven ZIP batches

An ordinary `.zip` is never guessed into a translation project. A supported
batch has exactly one `opentlc-project.json` file at its root. Version 1 uses
this shape:

```json
{
	"schemaVersion": 1,
	"kind": "open-tlc-format-batch",
	"members": [
		{
			"path": "locales/messages.json",
			"format": "json",
			"mimeType": "application/json",
			"required": true,
			"options": { "pathSelectors": "messages.**" }
		}
	]
}
```

Paths and registered round-trip format IDs are exact; Open TLC does not infer a
different adapter from a member extension. Paths must exist, be unique and
relative, and may not target the manifest itself. PDF, proprietary CAT packages,
and nested `zip-project` manifests are excluded because they cannot provide a
same-format child round trip. A batch is limited to 100 declared members and 25
one-level ZIP-based document members. Each child and the outer archive retain
the shared size, entry, expansion-ratio, collision, encryption, ZIP64 and
traversal defenses.

The default `reject-batch` policy processes every declaration and returns a
path/format/status report if any fails. `skip-optional` may skip only a failing
member explicitly marked `"required": false`; its report remains in project
metadata. Successful members keep independent filter options and skeletons.
Export returns the exact original ZIP when no target changed; otherwise it
rebuilds only changed declared members with their own adapter and preserves the
manifest and all undeclared entries byte-for-byte. Cross-member split/join is
rejected at export because it would invalidate deterministic member ownership.

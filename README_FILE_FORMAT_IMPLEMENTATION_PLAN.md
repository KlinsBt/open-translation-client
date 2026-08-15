# Open TLC file-format implementation plan

Status: proposed roadmap, researched 2026-08-15. A checked item means that the
implementation, review, and test gates in this document all passed. Existing
code is recorded as a starting point, but is not marked complete until it meets
the same gates.

## Goal and ordering

Open TLC should import translatable content, retain enough structure to edit it
safely, and export a usable file without damaging content that was not
translated. Breadth matters, but trustworthy round trips matter more than an
extension appearing in the upload dialog.

Comparable public usage figures for CAT file formats are scarce. Priority here
uses a practical popularity proxy: overlap in the official format lists for
Phrase TMS, Smartcat, memoQ, and Okapi; importance to CAT interoperability; and
frequency in office, web, and software-localization workflows. The ordering is
therefore directional rather than a claim of market share.

The sequence is:

1. Build one safe, testable filter architecture.
2. Finish the CAT exchange formats XLIFF, TMX, and TBX.
3. Harden common Office and web formats already present in Open TLC.
4. Add common software-localization and subtitle formats.
5. Add publishing, technical-authoring, and specialist formats.
6. Treat lossy, legacy, or proprietary formats as explicit conversion paths.

## Current baseline (not yet the completion matrix)

| Area               | Present in the repository                                    | Main gap before it is production-grade                                           |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Source documents   | TXT, JSON, DOCX, XLSX, HTML                                  | Each uses a separate path; preservation and coverage vary                        |
| Project exchange   | Open TLC JSON, XLIFF 1.2, XLIFF 2.0                          | Inline codes, standard metadata, validation, and foreign-extension preservation  |
| Translation memory | TMX 1.4 import/export and merge                              | TMX 1.4b Level 2, streaming, metadata, and multilingual edge cases               |
| Terminology        | TBX import/export and merge, including `martif` handling     | Explicit dialect/version support, validation, references, and lossless metadata  |
| Tests              | Parser, output, storage, segmentation, and consistency tests | Per-format conformance corpora, round trips, malformed inputs, and browser flows |

The upload UI currently advertises legacy `.xls` in places even though the
implementation reads ZIP-based XLSX. That is a false-positive format claim and
must be removed until a real XLS converter exists.

## Architecture required before adding more extensions

- [ ] **FF-000 — Introduce a format-adapter registry.** Replace MIME switches,
      the hard-coded `Type` union, and the export `if` chain with adapters that
      declare IDs, extensions, MIME types, signature sniffing, capabilities,
      import options, importer, exporter, and validator. Keep MIME and extension
      hints, but never trust either without content sniffing.
- [ ] **FF-001 — Define a rich neutral document model.** Represent stable unit
      IDs, source and target fragments, paired/standalone inline codes, context,
      notes, state, plural/variant relationships, translatability, whitespace,
      language, and source location. Do not flatten protected codes into plain
      strings.
- [ ] **FF-002 — Separate skeleton preservation from segment content.** Store
      untouched source bytes/package parts plus explicit replacement locations.
      Export by patching the skeleton, preserving unknown elements, namespaces,
      relationships, order, encodings where practical, and binary assets.
- [ ] **FF-003 — Add configurable filter options.** Support format-specific
      choices such as spreadsheet columns, JSON/YAML selectors, XML XPath/ITS
      rules, HTML attributes, subtitle limits, and whether existing targets are
      imported. Persist options with the project so re-export is deterministic.
- [ ] **FF-004 — Centralize safe input handling.** Add size and entry-count
      limits, ZIP expansion-ratio limits, cancellation, progress, encoding and
      BOM detection, XML parsing with external entities disabled, duplicate-path
      checks, and useful typed errors. Never execute imported scripts, PHP,
      formulas, macros, or archive contents.
- [ ] **FF-005 — Support large files without whole-document DOM copies.** Add
      streaming/SAX-style XML and incremental text paths for TMX, TBX, XLIFF,
      CSV, and other large formats; batch IndexedDB writes and keep the UI
      responsive through workers where measurement justifies them.
- [ ] **FF-006 — Correct existing format detection.** Remove misleading `.doc`
      and `.xls` acceptance, distinguish OOXML/ODF/EPUB ZIP packages by their
      entries, handle generic XML MIME types, make extension checks exact and
      case-insensitive, and report detected format plus confidence to the user.
- [ ] **FF-007 — Add shared inline-code and placeholder QA.** Detect missing,
      duplicated, reordered, or malformed tags and placeholders; support paired
      nesting constraints and format-specific reorder rules before export.
- [ ] **FF-008 — Version stored project data.** Add migrations so richer format
      metadata can be introduced without invalidating existing IndexedDB saves,
      Open TLC JSON backups, joins/splits, TMs, or termbases.
- [ ] **FF-009 — Build a reusable filter test harness.** It must run extraction
      snapshots, identity and translated round trips, semantic package diffs,
      validators, malformed-input tests, Unicode tests, performance fixtures,
      and browser import/edit/export smoke tests for every adapter.

## Phase 1 — CAT interoperability and current high-use formats

Complete these in order after FF-000 through FF-009.

- [ ] **FF-100 — XLIFF 1.2 (`.xlf`, `.xliff`).** Import and export standard
      bilingual files, multiple `<file>` elements, groups, `trans-unit` IDs,
      source/target languages, `approved` and state data, notes, alt-trans,
      segmentation, `translate`, `xml:space`, and inline `g`, `x`, `bx`/`ex`,
      `bpt`/`ept`, `it`, and `ph` content. Preserve unknown namespaced
      extensions and validate against the official schema.
- [ ] **FF-101 — XLIFF 2.0 and 2.1 (`.xlf`, `.xliff`).** Support units with
      multiple segments/ignorables, original data, inline `ph`, `pc`, `sc`/`ec`,
      `mrk`, notes, states, order, canResegment, and core preservation rules.
      Preserve unsupported modules losslessly; then add metadata, glossary,
      candidates, validation, and size/length modules as model capabilities
      land. XLIFF 1.x and 2.x need separate conforming serializers.
- [ ] **FF-102 — Vendor XLIFF profiles.** Add fixture-led adapters/profiles for
      SDLXLIFF, MQXLIFF, MXLIFF, WordPress/Drupal XLIFF, and common e-learning
      XLIFF. Preserve vendor namespaces and skeleton data. Never emit a vendor
      profile until an exported file opens successfully in its originating tool.
- [ ] **FF-103 — TMX 1.4b (`.tmx`).** Upgrade current support to Level 1 and
      Level 2: multilingual TUVs, `xml:lang`, inline `bpt`/`ept`/`it`/`ph`,
      notes, props, stable `tuid`, dates, usage metadata, encodings, and source
      language rules. Stream large memories, expose deterministic merge/dedupe
      policies, and validate against the TMX 1.4b DTD without resolving network
      entities.
- [ ] **FF-104 — TBX (`.tbx`).** Make support explicit for TBX-Core/TBX-Min v3
      and commonly encountered legacy TBX-Basic/`martif` data. Preserve the
      concept-oriented hierarchy, languages, multiple terms, status, part of
      speech, definitions, notes, administrative metadata, IDs, and cross
      references. Distinguish DCA and DCT styles and validate against the
      selected dialect's local schema/constraint files.
- [ ] **FF-105 — DOCX family (`.docx`, later `.docm`, `.dotx`, `.dotm`).**
      Harden current round trips across paragraphs split into runs, styles,
      tabs/breaks, hyperlinks, fields, tracked changes policy, tables, headers,
      footers, footnotes/endnotes, comments, text boxes, content controls, and
      drawings. Preserve relationships and every untouched ZIP part. Macro
      packages may only preserve VBA bytes; Open TLC must never execute them.
- [ ] **FF-106 — XLSX family (`.xlsx`, later `.xlsm`, `.xltx`, `.xltm`).**
      Harden shared and inline strings across every worksheet; preserve formulas,
      numbers, dates, rich-text runs, comments, hyperlinks, hidden sheets,
      tables, charts, drawings, styles, and workbook relationships. Add column,
      row, sheet, key/value, and multilingual-column import modes. Never replace
      formulas with their cached display strings.
- [ ] **FF-107 — PPTX family (`.pptx`, later `.pptm`, `.potx`, `.potm`, `.ppsx`).**
      Add slides in relationship order, grouped shapes, tables, charts, SmartArt
      text where safely addressable, masters/layouts, notes, comments, alt text,
      and run-level formatting. Preserve media, animations, links, themes, and
      macro parts; test that PowerPoint and LibreOffice can reopen output.
- [ ] **FF-108 — HTML and XHTML (`.html`, `.htm`, `.xhtml`).** Harden the current
      filter for malformed HTML, entities, inline tags, comments, whitespace,
      language/direction, `translate=no`, ITS metadata, and configurable
      translatable attributes such as `alt`, `title`, and placeholders. Exclude
      script/style/code by policy and prevent DOM serialization from rewriting
      unrelated markup when a targeted patch is possible.
- [ ] **FF-109 — Plain text (`.txt`).** Finish encoding/BOM and newline
      preservation, configurable line/paragraph/sentence modes, empty lines,
      Unicode normalization policy, bidirectional text, and byte-safe export.
- [ ] **FF-110 — SRX 2.0 segmentation rules (`.srx`).** Import/export language
      maps and ordered break/no-break rules, validate the schema, and connect
      selected rules to deterministic project segmentation. Test cascade order,
      regular-expression compatibility, language-code matching, abbreviations,
      and round trips. Treat SRX as a workflow asset, not a translatable source.

## Phase 2 — Common structured content and software localization

- [ ] **FF-200 — CSV and TSV (`.csv`, `.tsv`).** Add delimiter, quote, escape,
      encoding, header, multiline-field, source/target/key/context column, and
      multilingual-column options. Preserve row order and nontranslated cells;
      test commas, tabs, CRLF, embedded newlines, formulas-as-data, and CSV
      injection warnings.
- [ ] **FF-201 — JSON families (`.json`, `.arb`, i18next/Chrome/locJSON profiles).**
      Replace value-coercing traversal with a lossless syntax tree. Configure
      translatable paths and key/context fields; preserve ordering, indentation,
      numbers, booleans, nulls, arrays, duplicate-key warnings, ICU messages,
      placeholders, plurals, and metadata. Add ARB and well-known JSON profiles
      only after generic JSON is safe.
- [ ] **FF-202 — YAML 1.2 (`.yaml`, `.yml`).** Preserve comments, anchors,
      aliases, tags, scalar styles, block chomping, document boundaries, key
      order, and non-string types through a concrete syntax tree. Default to
      values-only selection and reject unsafe/custom object construction.
- [ ] **FF-203 — GNU gettext (`.po`, `.pot`).** Support headers, contexts,
      singular and plural messages, every `msgstr[n]`, translator/extracted
      comments, references, flags, previous/obsolete entries, continued strings,
      charsets, and format placeholders. Validate plural counts and run gettext
      checks where available; POT is source/template import, not a translated
      deliverable by default.
- [ ] **FF-204 — XML plus ITS 2.0 (`.xml`).** Provide safe generic XML extraction
      configured by XPath-like selectors and ITS translate, elements-within-text,
      preserve-space, ID, locale, terminology, and localization-note data. Keep
      namespaces, CDATA, entities, processing instructions, attribute order where
      possible, and untouched nodes. Profiles below should reuse this adapter.
- [ ] **FF-205 — Android resources (`strings.xml`).** Support `<string>`, string
      arrays, plurals, comments, `translatable=false`, formatted flags, markup,
      escapes, positional printf tokens, and `<xliff:g>` placeholders. Preserve
      resource keys and reject target placeholder/plural regressions.
- [ ] **FF-206 — Apple localization (`.strings`, `.stringsdict`, `.xcstrings`).**
      Support encodings, comments, escapes, keys, substitutions, plural/device
      variations, extraction states, and source-language metadata. Treat
      `.xcstrings` as a structured catalog rather than generic JSON.
- [ ] **FF-207 — Java and Mozilla properties (`.properties`).** Preserve comments,
      separators, continuations, escapes, key order, encodings, duplicate keys,
      and MessageFormat/printf placeholders. Do not treat keys as translatable by
      default.
- [ ] **FF-208 — .NET resources (`.resx`).** Translate string `<data>` values
      while preserving names, comments, type/mimetype metadata, aliases, headers,
      whitespace, and non-string serialized resources. Never deserialize or
      instantiate embedded objects.
- [ ] **FF-209 — Qt Linguist (`.ts`).** Support contexts, IDs, source,
      translation states, comments, locations, length variants, numerus forms,
      inline markup, and vanished/obsolete messages. Validate XML and placeholder
      parity.
- [ ] **FF-210 — INI and desktop/resource text (`.ini`, `.desktop`, `.lang`).**
      Preserve sections, comments, whitespace, duplicate keys, locale suffixes,
      escapes, and ordering; require a profile or user selection for
      translatable keys.
- [ ] **FF-211 — PHP localization arrays (`.php`).** Parse a deliberately limited
      static array grammar or a mature AST; never use `eval`, import, or execute.
      Preserve keys, comments, nesting, escapes, and placeholders, and reject
      dynamic expressions with a precise diagnostic.
- [ ] **FF-212 — Markdown and AsciiDoc (`.md`, `.markdown`, `.adoc`, `.asciidoc`).**
      Preserve front matter, code, URLs, references, directives, attributes,
      tables, embedded HTML, inline markup, hard line breaks, and protected spans.
      Segment rendered prose without corrupting source syntax.
- [ ] **FF-213 — Subtitles (`.srt`, `.vtt`, then `.sbv`).** Preserve cue IDs,
      timecodes, settings, comments/notes, inline cue markup, line breaks, and
      ordering. Add QA for start/end validity, overlap policy, characters per
      line, lines per cue, reading speed, and target expansion without silently
      retiming cues.

## Phase 3 — Publishing and technical-authoring formats

- [ ] **FF-300 — OpenDocument (`.odt`, `.ods`, `.odp`).** Reuse package and rich
      segment infrastructure while preserving ODF styles, manifests, metadata,
      formulas, drawings, notes, tracked changes policy, and embedded assets.
      Test with LibreOffice round trips and ODF validators.
- [ ] **FF-301 — EPUB 2/3 (`.epub`).** Read the container, package manifest,
      spine, navigation, XHTML/SVG content, metadata, and media overlays; reuse
      HTML/XML filters and preserve CSS, fonts, media, scripts, accessibility,
      and the required uncompressed/first `mimetype` entry. Validate exported
      books with EPUBCheck.
- [ ] **FF-302 — SVG (`.svg`).** Translate text, selected accessibility
      attributes, titles/descriptions, and text-path content while preserving
      namespaces, transforms, styling, geometry, and scripts as inert bytes.
      Provide XML profile controls because many SVG strings are not visible.
- [ ] **FF-303 — DITA and DITAMAP (`.dita`, `.ditamap`).** Add DITA-aware inline
      elements, conrefs/keyrefs, topic IDs, maps, profiling attributes, translate
      controls, whitespace, and multi-file package handling. Preserve references
      and validate the complete map, not isolated topics only.
- [ ] **FF-304 — DocBook (`.xml`, `.dbk`).** Add version-aware block/inline rules,
      IDs/xrefs, entities, code, index terms, metadata, and whitespace behavior;
      preserve extensions and validate against the declared schema.
- [ ] **FF-305 — Adobe IDML and ICML (`.idml`, `.icml`).** Preserve story order,
      paragraph/character styles, anchored objects, tables, notes, XML tags,
      cross-references, and package relationships. Use small legally shareable
      fixtures and require successful reopen/preflight in Adobe InDesign before
      declaring export support.
- [ ] **FF-306 — TeX/LaTeX (`.tex`).** Protect commands, environments, math,
      labels, citations, references, verbatim/code, and comments while exposing
      prose and selected command arguments. Make macro rules configurable and
      test compile the result where a TeX engine is available.
- [ ] **FF-307 — TTML (`.ttml`, `.dfxp`).** Add namespace/profile-aware timed-text
      handling, nested spans, styling, regions, frame/tick rates, timing
      expressions, language, and whitespace. Validate against the selected TTML
      profile and reuse subtitle QA without assuming WebVTT timing rules.
- [ ] **FF-308 — MIF, Windows RC, and Qt/QML specialist resources.** Implement as
      separate adapters in that order, with grammar-aware token preservation and
      real-tool reopen/compile tests. Do not use broad regex replacements for
      syntax-bearing files.

## Phase 4 — Explicitly constrained and conversion-based support

- [ ] **FF-400 — Legacy Office (`.doc`, `.xls`, `.ppt`, `.rtf`).** Do not parse
      old binary formats in the browser. Offer a documented conversion workflow
      to DOCX/XLSX/PPTX, or an optional isolated conversion service with clear
      privacy and fidelity warnings. Only advertise an extension when that
      converter is actually available.
- [ ] **FF-401 — PDF (`.pdf`) as source-only extraction.** Clearly label PDF as
      lossy, distinguish born-digital text from OCR, retain page/bounding-box
      context, and export translation to a new accessible document or bilingual
      review format rather than promising layout-identical PDF round trips.
- [ ] **FF-402 — OCR image input (`.png`, `.jpg`, `.tiff`) and media transcription.**
      Keep this outside core format adapters until a local or consent-based
      service architecture, privacy model, language detection, timestamp/layout
      model, confidence UI, and reproducible tests exist.
- [ ] **FF-403 — Proprietary CAT packages (`.sdlppx`, `.sdlrpx`, `.wsxz`, memoQ
      packages).** Start read-only and fixture-led. Preserve all unknown package
      entries, defend against archive traversal/bombs, document unsupported
      workflow metadata, and add export only after round-trip testing in the
      owning CAT tool and confirmation that licensing permits implementation.
- [ ] **FF-404 — Generic ZIP projects.** Add only as a manifest-driven batch
      container over already supported adapters. Preserve paths and bytes,
      prevent traversal/collisions, cap recursion and expansion, and report each
      member's result instead of guessing silently.

## Definition of done for every format task

The implementing LLM must complete and record every item below for the selected
task before changing its roadmap checkbox from `[ ]` to `[x]`. Work on one
format task per commit or pull request unless a shared foundation change is
explicitly separated.

- [ ] Document the normative version/profile, supported capabilities, import
      options, deliberate exclusions, fidelity limits, and security assumptions.
- [ ] Add the adapter, content sniffing, import, export (or clearly labelled
      input-only behavior), typed errors, UI wiring, persistence, and migration.
- [ ] Add minimal, typical, complex, Unicode/RTL, malformed, adversarial, and
      generated-large fixtures. Fixtures committed to Git should normally stay
      below 1 MiB; generate stress files during tests or use an approved external
      corpus with pinned checksums. Never recommit files above GitHub's limit.
- [ ] Add unit tests for detection, extraction, metadata, inline codes,
      placeholders, options, serialization, error paths, cancellation, and joins
      or splits at protected boundaries.
- [ ] Add an identity round trip and a translated round trip. Assert exact bytes
      for untouched resources and semantic equivalence where containers,
      attribute order, or compression make byte equality inappropriate.
- [ ] Run the format's official or widely accepted offline validator when one
      exists, plus reopen/compile tests in at least one independent application.
      For vendor formats, include the originating CAT tool when accessible.
- [ ] Add browser integration coverage for upload, detection, project creation,
      editing, save/reload, export, download name/MIME, and helpful rejection.
- [ ] Measure a generated large file for time, peak memory, cancellation, and UI
      responsiveness; record the baseline and guard against severe regressions.
- [ ] Review XXE, entity expansion, ZIP bombs/path traversal, unsafe
      deserialization, formula/CSV injection, script execution, and untrusted
      HTML risks applicable to the format.
- [ ] Run `npm run verify`, inspect the final diff, update the current support
      matrix and user-facing format list, then have a second LLM review the task
      against this definition of done. Record remaining caveats next to the
      checked task rather than hiding them.

## Test corpus and automation layout

Use a predictable structure when the first adapter is implemented:

```text
src/lib/formats/<format>/
  adapter.ts
  detect.ts
  import.ts
  export.ts
  validate.ts
  <format>.spec.ts
tests/fixtures/formats/<format>/
  minimal/
  typical/
  complex/
  malformed/
tests/format-roundtrip/
tests/browser/file-formats/
```

Each fixture needs a short provenance/license note and an expectation manifest:
format/profile, encoding, languages, expected unit count, expected warnings, and
which properties must survive. Prefer synthetic or permissively licensed files.
Large TMX/TBX/CSV performance data should be deterministically generated during
the test instead of stored in Git.

## Important implementation risks

- **Plain strings are insufficient.** XLIFF, TMX, Office, PO, Android, Apple,
  and publishing formats all carry protected inline structure, variants, or
  context. The neutral model must land before broad format work.
- **Import success is not round-trip support.** A format is export-capable only
  after structure, metadata, and untouched resources survive validation and an
  independent reopen test.
- **XML is a family, not one filter.** XLIFF, TBX, Android, RESX, DITA, DocBook,
  SVG, and TTML need profiles on shared safe XML infrastructure.
- **ZIP is only a container.** DOCX, XLSX, PPTX, ODF, EPUB, IDML, and CAT
  packages have different manifests and relationship rules; extension or ZIP
  detection alone is unsafe.
- **Plural and placeholder models differ by ecosystem.** PO formulas, Android
  quantities, Apple variations, ICU messages, printf, MessageFormat, and .NET
  placeholders need typed QA rather than one regular expression.
- **Source editing and segmentation can invalidate anchors.** Every adapter must
  define which splits/joins are legal and how replacement locations remain
  stable after editing.
- **Browser memory is finite.** Large TMX/TBX and package formats require
  streaming, bounded decompression, batched storage, progress, and cancellation.
- **Proprietary and lossy formats need honest labels.** PDF, OCR, legacy Office,
  and vendor packages must not imply fidelity that the implementation cannot
  demonstrate.

## Research basis

The tool lists below overlap strongly on modern Office, XLIFF, XML/HTML, JSON,
PO, resource bundles, subtitles, and publishing formats. Okapi's design also
supports the adapter direction: filters convert native documents to common
events and reconstruct the original format.

- [Phrase TMS supported formats](https://support.phrase.com/hc/en-us/articles/5709621471516-Supported-File-Formats-TMS)
- [Smartcat supported formats](https://help.smartcat.com/supported-file-formats/)
- [memoQ supported source-document formats](https://docs.memoq.com/9-12/en/Things/things-supported-source-document-form.html)
- [Okapi filter architecture and supported formats](https://www.okapiframework.org/wiki/index.php?title=Filters)
- [OASIS XLIFF 2.1 core and modules](https://docs.oasis-open.org/xliff/xliff-core/v2.1/xliff-core-v2.1.html)
- [OASIS XLIFF 1.2 specification](https://docs.oasis-open.org/xliff/v1.2/os/xliff-core.html)
- [TMX 1.4b specification](https://www.ttt.org/oscarStandards/tmx/tmx14b.html)
- [OSCAR exchange standards, including SRX 2.0](https://www.ttt.org/oscarStandards/)
- [ISO 30042:2019 TBX overview](https://www.iso.org/standard/62510.html)
- [W3C ITS 2.0](https://www.w3.org/TR/its20/)
- [Microsoft Open XML package overview](https://learn.microsoft.com/en-us/office/open-xml/about-the-open-xml-sdk)
- [GNU gettext PO format](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html)
- [Android string resources](https://developer.android.com/guide/topics/resources/string-resource)
- [Apple string catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog)
- [YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/)
- [OpenDocument specification](https://www.oasis-open.org/standard/opendocumentv1-2/)
- [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [W3C WebVTT](https://www.w3.org/TR/webvtt1/)

This roadmap should be re-reviewed when major standards, browser capabilities,
or the supported-format lists of the surveyed CAT tools change.

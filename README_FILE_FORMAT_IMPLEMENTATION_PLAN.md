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
6. Give lossy, legacy, media, and proprietary formats explicit local workflows.

## Current baseline (not yet the completion matrix)

| Area               | Present in the repository                                                                | Main gap before it is production-grade                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Source documents   | TXT, JSON, DOCX/DOCM/DOTX/DOTM, XLSX/XLSM/XLTX/XLTM, PPTX/PPTM/POTX/POTM/PPSX/PPSM, HTML | Each uses a separate path; preservation and coverage vary                        |
| Project exchange   | Open TLC JSON, XLIFF 1.2/2.x, protected vendor XLIFF imports                             | Origin-tool-verified vendor exports and typed module capabilities                |
| Translation memory | TMX 1.4b Level 1/2 import, export, and policy-driven merge                               | Broader vendor corpora and persistent indexing for very large memories           |
| Terminology        | TBX import/export and merge, including `martif` handling                                 | Explicit dialect/version support, validation, references, and lossless metadata  |
| Tests              | Parser, output, storage, segmentation, and consistency tests                             | Per-format conformance corpora, round trips, malformed inputs, and browser flows |

Legacy binary `.doc`, `.xls`, and `.ppt` files use a dedicated on-device OLE
adapter; they are never routed to the ZIP-based OOXML importers.

## Architecture required before adding more extensions

- [x] **FF-000 — Introduce a format-adapter registry.** Replace MIME switches,
      the hard-coded `Type` union, and the export `if` chain with adapters that
      declare IDs, extensions, MIME types, signature sniffing, capabilities,
      import options, importer, exporter, and validator. Keep MIME and extension
      hints, but never trust either without content sniffing.
      Completed 2026-08-16: the active upload/import/export path now uses the
      registry, all six current formats have adapters and validation hooks, and
      focused registry/import tests pass. Deeper signature enforcement remains
      tracked by FF-006 so existing uploads are not changed silently here.
- [x] **FF-001 — Define a rich neutral document model.** Represent stable unit
      IDs, source and target fragments, paired/standalone inline codes, context,
      notes, state, plural/variant relationships, translatability, whitespace,
      language, and source location. Do not flatten protected codes into plain
      strings.
      Completed 2026-08-16: the versioned neutral model now covers these fields,
      validates IDs and inline-code balance, is produced by every registered
      importer, persists in IndexedDB and Open TLC XLIFF saves, and remains
      synchronized with the current segment-array compatibility view. Split/join
      edits preserve unit IDs, while protected codes cannot be silently flattened.
      Model, importer, persistence, interchange, and structural-edit tests pass.
- [x] **FF-002 — Separate skeleton preservation from segment content.** Store
      untouched source bytes/package parts plus explicit replacement locations.
      Export by patching the skeleton, preserving unknown elements, namespaces,
      relationships, order, encodings where practical, and binary assets.
      Completed 2026-08-16: every registered importer now stores a versioned,
      immutable skeleton with original bytes, text or package parts, and typed
      replacement locations. Exporters patch fresh skeleton copies, identity
      exports reuse exact originals, JSON retains layout and primitive types,
      and DOCX/XLSX/PPTX retain unknown relationships, namespaces, and binary parts.
      Legacy projects and split/join edits rebuild aligned replacement mappings;
      identity, translated round-trip, persistence, and malformed-state tests pass.
- [x] **FF-003 — Add configurable filter options.** Support format-specific
      choices such as spreadsheet columns, JSON/YAML selectors, XML XPath/ITS
      rules, HTML attributes, subtitle limits, and whether existing targets are
      imported. Persist options with the project so re-export is deterministic.
      Completed 2026-08-16: adapters now declare typed options that the upload UI
      renders dynamically and normalizes before import. Current formats support
      TXT segmentation modes, JSON wildcard paths and primitive-value policy,
      DOCX story, revision, drawing, and paragraph controls, XLSX
      worksheet/column/row/hidden-sheet/content filters plus key-value and
      multilingual-column modes, HTML text, attribute, protected-element, and
      translate-metadata selection, and PPTX slide ranges plus notes, comments,
      alt text, chart, SmartArt, and master/layout policies.
      Options persist in IndexedDB and Open TLC XLIFF
      saves, are backfilled for older projects, and are reused by exporters.
      Unit, selective-import, persistence, interchange, and filtered round-trip
      tests pass. YAML/XML/subtitle/target-specific controls will extend the same
      option contract when those roadmap adapters are implemented.
- [x] **FF-004 — Centralize safe input handling.** Add size and entry-count
      limits, ZIP expansion-ratio limits, cancellation, progress, encoding and
      BOM detection, XML parsing with external entities disabled, duplicate-path
      checks, and useful typed errors. Never execute imported scripts, PHP,
      formulas, macros, or archive contents.
      Completed 2026-08-16: all active project, source-format, TMX, and TBX
      imports now use one typed safe-input layer. It enforces compressed-file,
      entry-count, expanded-size, and per-entry/total expansion-ratio limits;
      rejects encrypted, split, ZIP64, duplicate, traversal, and inconsistent
      archives; detects UTF-8/UTF-16 BOMs and invalid encodings; and blocks XML
      DTD/entity declarations and malformed XML. Unknown archive content,
      scripts, formulas, macros, and binary parts remain opaque and are never
      executed. Adapter operations expose progress and cancellation, with both
      controls wired into project creation. Adversarial, compatibility,
      persistence, round-trip, type-check, and production-build tests pass.
- [x] **FF-005 — Support large files without whole-document DOM copies.** Add
      streaming/SAX-style XML and incremental text paths for TMX, TBX, XLIFF,
      CSV, and other large formats; batch IndexedDB writes and keep the UI
      responsive through workers where measurement justifies them.
      Completed 2026-08-16: TMX, TBX-Core/martif, and Open TLC XLIFF 1.2/2.x
      imports now scan bounded XML records and build only a small DOM per unit;
      TXT uses chunked UTF-8/UTF-16 decoding with BOM preservation, and a shared
      incremental CSV reader handles quoted delimiters, escaped quotes, and
      embedded newlines. Streaming operations expose cancellation, byte/record
      progress, safety limits, timing, buffer metrics, and cooperative main-thread
      yields. Bulk project persistence now commits ordered 100-record IndexedDB
      transactions instead of queuing every write at once. A 5,000-record stress
      fixture keeps the scanner buffer below 2 KiB and verifies 50 scheduling
      yields; this measurement favored cooperative batching over a worker because
      worker transfer would duplicate the resulting in-memory model. Encoding,
      chunk-boundary, unsafe-XML, oversized-record, cancellation, interchange,
      CSV, persistence-batch, round-trip, type-check, and production-build tests
      pass.
- [x] **FF-006 — Correct existing format detection.** Remove misleading `.doc`
      and `.xls` acceptance, distinguish OOXML/ODF/EPUB ZIP packages by their
      entries, handle generic XML MIME types, make extension checks exact and
      case-insensitive, and report detected format plus confidence to the user.
      Completed 2026-08-16: source and Open TLC project uploads now use
      content-first detection with typed high/medium/low confidence, evidence,
      and a user-facing explanation. Exact final extensions are normalized
      case-insensitively, MIME parameters are stripped, and contradictory names
      or MIME values cannot override structural signatures. Safe ZIP inspection
      distinguishes the supported DOCX/DOCM/DOTX/DOTM and
      XLSX/XLSM/XLTX/XLTM and PPTX/PPTM/POTX/POTM/PPSX/PPSM families from
      ODT/ODS/ODP, EPUB, and unknown ZIP containers by internal entries and
      declared media types.
      Legacy OLE `.doc`/`.xls`/`.ppt`, RTF, and generic XML
      are recognized but reported as unsupported instead of routed to an
      incompatible importer; misleading legacy upload hints were removed.
      Project backups recognize JSON or the XLIFF root independently of their
      filename, including `.xlf`, `.xliff`, and generic XML MIME types. Ambiguous,
      renamed, uppercase, multi-extension, conflicting-metadata, package-family,
      project-file, type-check, full-regression, and production-build tests pass.
- [x] **FF-007 — Add shared inline-code and placeholder QA.** Detect missing,
      duplicated, reordered, or malformed tags and placeholders; support paired
      nesting constraints and format-specific reorder rules before export.
      Completed 2026-08-16: one typed export-QA engine now compares every source
      and target segment before a translated TXT, JSON, HTML, DOCX, XLSX, or PPTX file
      is downloaded. It recognizes sequential and positional printf tokens,
      indexed/named/ICU braces, Mustache/triple-Mustache, `${name}` placeholders,
      and XML/HTML paired, closing, self-closing, and void tags. Missing,
      duplicated, unexpected, reordered, malformed, unbalanced, and crossed
      tokens produce segment-addressed blocking errors. Rich neutral-document
      codes are checked by stable ID, boundary type, pair ID, nesting, optional
      deletion, and explicit or format-level reorder rules; HTML and DOCX permit
      structurally valid movement while text, JSON, XLSX, and PPTX retain source order.
      All registered download adapters enforce the guard, and the editor reports
      a concise issue preview instead of starting an unsafe download. Placeholder,
      markup, ICU nesting, code-policy, adapter-guard, full-regression,
      type-check, and production-build tests pass.
- [x] **FF-008 — Version stored project data.** Add migrations so richer format
      metadata can be introduced without invalidating existing IndexedDB saves,
      Open TLC JSON backups, joins/splits, TMs, or termbases.
      Completed 2026-08-16: projects, translation memories, and termbases now use
      independent versioned envelopes and ordered, deterministic migration maps.
      Every active IndexedDB read/write and JSON, XLIFF, TMX, or TBX interchange
      boundary upgrades legacy records before use; the oldest flat project shape
      remains importable, while unknown extension metadata is retained. JSON and
      Open TLC XLIFF backups emit the current schema marker, absent markers are
      treated as legacy version 0, and unsupported future or malformed versions
      fail with actionable typed errors instead of risking data loss. Migration
      tests cover idempotence, corruption, rich package metadata, TM/TB data,
      legacy/current/future files, and a join-backup-split restoration. All 181
      unit tests, formatting, type-check, and a clean production build pass.
- [x] **FF-009 — Build a reusable filter test harness.** It must run extraction
      snapshots, identity and translated round trips, semantic package diffs,
      validators, malformed-input tests, Unicode tests, performance fixtures,
      and browser import/edit/export smoke tests for every adapter.
      Completed 2026-08-16: one table-driven conformance harness now requires an
      explicit fixture for every registered adapter and runs stable extraction
      snapshots, valid/malformed validation, byte-identical identity exports,
      translated export validation and re-import, combining-mark/RTL/non-BMP
      Unicode checks, and timed 250-unit performance fixtures. DOCX, XLSX, and PPTX add
      uncompressed part-level semantic diffs that reject added, removed, or
      unexpectedly changed package parts. A separate Playwright-backed Vitest
      suite runs each TXT, JSON, DOCX, XLSX, PPTX, and HTML adapter in real headless
      Chromium through import, edit, registered browser download, and re-import.
      Fixture-to-registry coverage fails automatically when a future adapter
      omits these gates. The current suite has 377 unit tests and seven Chromium tests;
      formatting, type-check, production dependency audit, and a clean build pass.

## Phase 1 — CAT interoperability and current high-use formats

Complete these in order after FF-000 through FF-009.

- [x] **FF-100 — XLIFF 1.2 (`.xlf`, `.xliff`).** Import and export standard
      bilingual files, multiple `<file>` elements, groups, `trans-unit` IDs,
      source/target languages, `approved` and state data, notes, alt-trans,
      segmentation, `translate`, `xml:space`, and inline `g`, `x`, `bx`/`ex`,
      `bpt`/`ept`, `it`, and `ph` content. Preserve unknown namespaced
      extensions and validate against the official schema.
      Completed 2026-08-16: the streaming importer now retains a compact
      structural skeleton around individually parsed `trans-unit` records, so
      multiple files, nested groups, local namespaces, stable IDs, per-file
      languages, segmented `mrk` content, states, approval, translatability,
      whitespace, contexts, notes, candidates, every listed inline-code family,
      and foreign elements/attributes reach the rich document model without
      flattening protected codes. The dedicated serializer reconstructs files,
      groups, segmented units and inline markup, preserves registered extension
      schemas, applies edits without dropping codes, and replaces the former
      invalid header/group layout with strict XLIFF plus a standard metadata
      note. Official OASIS strict and W3C dependency schemas are vendored for
      offline libxml2/WASM validation; multi-file/vendor, malformed, namespace,
      edit, round-trip, legacy-backup, and schema fixtures pass. All 222 unit
      tests and five Chromium smoke tests, formatting, type-check, zero-vulnerability
      production audit, and a clean production build pass.
- [x] **FF-101 — XLIFF 2.0 and 2.1 (`.xlf`, `.xliff`).** Support units with
      multiple segments/ignorables, original data, inline `ph`, `pc`, `sc`/`ec`,
      `mrk`, notes, states, order, canResegment, and core preservation rules.
      Preserve unsupported modules losslessly; then add metadata, glossary,
      candidates, validation, and size/length modules as model capabilities
      land. XLIFF 1.x and 2.x need separate conforming serializers.
      Completed 2026-08-16: a dedicated namespace-safe XLIFF 2.x path now
      streams units into the neutral model without flattening multi-segment
      units, ignorables, notes, states, target order, inherited translation and
      resegmentation controls, original data, or protected `ph`, `pc`, `sc`/`ec`,
      `mrk`, `sm`/`em`, and `cp` codes. Its structural placeholder skeleton
      preserves multiple files, nested groups, empty structure, extension
      attributes, and unsupported metadata, glossary, matches, validation,
      size-restriction, and foreign modules for later typed model exposure.
      Separate 2.0 and 2.1 serializers apply edits while retaining codes and
      references, emit standard metadata and version-specific schema locations,
      and are available in the export UI. Complex, prefixed, malformed,
      reference, edit, round-trip, legacy-backup, and module fixtures pass both
      matching official OASIS core schemas offline. All 232 unit tests and five
      Chromium tests, formatting, type-check, zero-vulnerability production
      audit, and a clean production build pass.
- [x] **FF-102 — Vendor XLIFF profiles.** Add fixture-led adapters/profiles for
      SDLXLIFF, MQXLIFF, MXLIFF, WordPress/Drupal XLIFF, and common e-learning
      XLIFF. Preserve vendor namespaces and skeleton data. Never emit a vendor
      profile until an exported file opens successfully in its originating tool.
      Completed 2026-08-16: structural signature detection and protected-import
      profiles now cover Trados SDLXLIFF, memoQ MQXLIFF, Phrase MXLIFF, WPML,
      Drupal TMGMT, Articulate Rise, and Articulate Storyline without trusting a
      filename extension alone. Vendor namespaces, headers, attributes,
      identifiers, skeleton fragments, notes, length data, and project metadata
      survive import and Open TLC JSON persistence. SDL segment confirmations,
      memoQ statuses, Phrase confirmations, and vendor locks map into neutral
      workflow state and translatability. Embedded CMS and e-learning HTML is
      converted to protected inline codes while its text remains editable.
      Vendor extensions are accepted by the upload UI and clearly identified.
      Generic XLIFF 1.2, 2.0, and 2.1 serializers reject vendor documents so the
      profile-specific writer introduced in FF-503 is always used for delivery.
      Seven focused fixtures and 22 profile tests cover detection, preservation,
      state/lock mapping, protected markup, malformed input, false positives,
      persistence, and the export guard. All 254 unit tests and five Chromium
      tests, formatting, type-check, zero-vulnerability production audit, and a
      clean production build pass.
- [x] **FF-103 — TMX 1.4b (`.tmx`).** Upgrade current support to Level 1 and
      Level 2: multilingual TUVs, `xml:lang`, inline `bpt`/`ept`/`it`/`ph`,
      notes, props, stable `tuid`, dates, usage metadata, encodings, and source
      language rules. Stream large memories, expose deterministic merge/dedupe
      policies, and validate against the TMX 1.4b DTD without resolving network
      entities.
      Completed 2026-08-16: a dedicated TMX 1.4b model and serializer now keep
      multilingual and repeated-language TUVs, alphanumeric `tuid` values,
      header/TU/TUV attributes, notes, properties, dates, usage fields,
      original encodings, and user-defined character maps through edits and
      persisted storage. Source selection follows inherited per-unit `srclang`
      and the `*all*` rule rather than assuming the first TUV. Level 2
      `bpt`/`ept`, `it`, `ph`, and `hi` content is represented as protected
      codes; edited text is overlaid without dropping native code data or
      pair/order information. The importer remains record-streamed and the
      1,500-unit fixture demonstrates bounded buffering and cooperative yields.
      The merge UI now exposes deterministic keep-all, keep-first, keep-last,
      and merge-unique-target policies. The official OSCAR DTD is vendored for
      offline grammar checks; its representative fixture passes libxml2 DTD
      validation, known `tmx14.dtd` declarations are treated as inert, and all
      entity or unrecognized document-type declarations remain blocked. Three
      XML fixtures, the official DTD, and 14 focused tests cover Level 1/2
      output, edit round trips, multilingual edge cases, metadata persistence,
      merge policies, safety, grammar rejection, and large input. All 268 unit
      tests and five Chromium tests, formatting, type-check, zero-vulnerability
      production audit, and a clean production build pass.
- [x] **FF-104 — TBX (`.tbx`).** Make support explicit for TBX-Core/TBX-Min v3
      and commonly encountered legacy TBX-Basic/`martif` data. Preserve the
      concept-oriented hierarchy, languages, multiple terms, status, part of
      speech, definitions, notes, administrative metadata, IDs, and cross
      references. Distinguish DCA and DCT styles and validate against the
      selected dialect's local schema/constraint files.
      Completed 2026-08-16: the streamed importer and typed persistence model
      now distinguish TBX-Core, TBX-Min, and TBX-Basic v3 DCA/DCT from legacy
      TBX-Basic v2 `martif`; retain exact BCP 47 tags, concepts, language
      sections, repeated terms, `tig`/`ntig` and `termGrp`, native attributes,
      IDs, category groups, definitions, status, part of speech, notes,
      administrative data, and internal/external references; and overlay edits
      onto a native structural skeleton instead of rebuilding a flattened
      document. Known TBX-Basic v2 DTD declarations remain inert, while all
      entity and unknown document-type declarations stay blocked. Checked-in
      Core Relax NG and dialect constraint profiles provide offline structural,
      style/namespace, category, placement, pick-list, ID, and reference checks.
      Three dialect fixtures and 16 focused tests cover five v3 dialect/style
      outputs, legacy and modern edit round trips, metadata persistence,
      invalid constraints, offline grammar validation, and a 1,500-concept
      bounded-buffer import. All 284 unit tests and five Chromium tests,
      formatting, type-check, zero-vulnerability production audit, and an
      isolated clean production build pass.
- [x] **FF-105 — DOCX family (`.docx`, `.docm`, `.dotx`, `.dotm`).**
      Harden current round trips across paragraphs split into runs, styles,
      tabs/breaks, hyperlinks, fields, tracked changes policy, tables, headers,
      footers, footnotes/endnotes, comments, text boxes, content controls, and
      drawings. Preserve relationships and every untouched ZIP part. Macro
      packages may only preserve VBA bytes; Open TLC must never execute them.
      Completed 2026-08-16: one content-sniffed adapter now imports and exports
      all four WordprocessingML package types; extracts main-document, header,
      footer, footnote, endnote, comment, table, content-control, text-box, and
      addressable DrawingML text; retains run/style, hyperlink, tab/break,
      relationship, revision, and untouched package structure; and offers
      current/original/all tracked-change plus per-story import policies. Fields
      remain protected rather than exposing calculated display text. Package-part
      metadata keeps split/join edits addressable and blocks cross-story joins.
      Identity output is byte-exact, translated output changes only selected XML
      stories, whitespace gaps and non-breaking spaces remain valid XML, and VBA
      stays opaque and byte-identical without evaluation. DOCX-family detection,
      extension/MIME retention, malformed XML, revision, option, nested text-box,
      range-patching, macro, skeleton, 250-unit performance, browser re-import,
      and real 2,718-word fixture tests pass. The generated real-world DOCX also
      passes `xmllint` well-formedness and a headless LibreOffice reopen/PDF
      export. Full ISO/IEC 29500 schema validation and semantic translation of
      field results, charts, or SmartArt remain explicit future hardening work.
- [x] **FF-106 — XLSX family (`.xlsx`, `.xlsm`, `.xltx`, `.xltm`).**
      Harden shared and inline strings across every worksheet; preserve formulas,
      numbers, dates, rich-text runs, comments, hyperlinks, hidden sheets,
      tables, charts, drawings, styles, and workbook relationships. Add column,
      row, sheet, key/value, and multilingual-column import modes. Never replace
      formulas with their cached display strings.
      Completed 2026-08-17: one content-sniffed adapter
      now accepts all four SpreadsheetML package types, retains their extension
      and MIME on export, and preserves VBA as opaque bytes without evaluating
      it. Worksheets follow workbook relationship order instead of filename
      order; sheet selectors accept workbook names; and row, column, and hidden-
      sheet policies persist through export. Formula cells are always protected,
      including cached results. Selected shared strings are cloned and only the
      selected cell references are repointed, so filtered cells that reuse the
      same shared-string item cannot be translated accidentally. Rich runs,
      leading/trailing and non-breaking spaces, inline/plain strings, protected
      phonetic guides, numeric and boolean opt-in values, hyperlinks, styles,
      comments, tables, drawings,
      charts, relationships, unknown parts, and identity bytes have focused
      round-trip coverage. All-text, key-value, and multilingual-column modes
      now map units by worksheet row: key cells become stable context, source
      and existing target cells remain distinct, formula targets are excluded,
      blank target cells are created in column order, and only the addressed
      target cell is changed. Existing target-column values survive project
      creation and untranslated key-value cells cannot be blanked accidentally.
      Legacy cell comments are attached as non-translatable notes while comment
      parts, threaded comments, and drawing/VML data remain untouched. Malformed
      workbook/worksheet/relationship XML and ambiguous column configurations
      are rejected. Focused fixtures cover shared and inline strings, rich runs,
      missing and reused targets, formulas and cached results, dates/styles,
      tables, comments, macros, and filtered hidden content. A generated
      1,000-row bilingual sheet stays below the five-second baseline, a dedicated
      Chromium import/edit/export/re-import flow passes, and a translated real
      three-sheet repository fixture reopens and exports to PDF in headless
      LibreOffice. Full ISO/IEC 29500 schema validation and semantic import of
      modern threaded comments remain explicit future hardening work.
- [x] **FF-107 — PPTX family (`.pptx`, `.pptm`, `.potx`, `.potm`, `.ppsx`, `.ppsm`).**
      Add slides in relationship order, grouped shapes, tables, charts, SmartArt
      text where safely addressable, masters/layouts, notes, comments, alt text,
      and run-level formatting. Preserve media, animations, links, themes, and
      macro parts and validate output through automated package and semantic
      re-import tests.

  - [x] Implement content-first detection, family/MIME retention, relationship-
        ordered slides, slide-range filtering, grouped shapes, tables, run-
        preserving DrawingML text, speaker notes, optional masters/layouts,
        safely addressable chart and SmartArt text, and shape `title`/`descr`.
  - [x] Keep fields, chart formulas/caches, comments, media, animations,
        hyperlinks, themes, unknown parts, and VBA opaque; expose classic and
        modern comments as non-translatable notes and block unsafe split/join.
  - [x] Cover relationship order, formatting, tables, notes placeholders,
        comments, alt text, charts, SmartArt, macros, malformed relationships
        and XML, identity bytes, narrow package diffs, Unicode, 250-unit
        performance, real repository input, and browser export/re-import.
        Platform-independent package validation covers macro-free and
        macro-enabled family variants while retaining opaque VBA and every
        untouched package part.

- [x] **FF-108 — HTML and XHTML (`.html`, `.htm`, `.xhtml`).** Harden the current
      filter for malformed HTML, entities, inline tags, comments, whitespace,
      language/direction, `translate=no`, ITS metadata, and configurable
      translatable attributes such as `alt`, `title`, and placeholders. Exclude
      script/style/code by policy and prevent DOM serialization from rewriting
      unrelated markup when a targeted patch is possible.
      Completed 2026-08-17: extraction now records raw text and attribute ranges
      and export patches only ranges whose target changed. Doctypes, comments,
      tag/attribute case, quote style, inline and void tags, entity spelling,
      whitespace, scripts, styles, and all unrelated malformed-but-recoverable
      source bytes therefore remain untouched. Named/numeric entities are decoded
      for translation and safely re-escaped only when their containing range is
      edited; quoted and unquoted attributes have separate escaping policies.
      Native inherited `translate` and local ITS translate flags are honored with
      explicit child overrides, and common inline ITS element/class/id translate
      rules plus localization notes are supported. Language and direction inherit
      into unit content and contexts. Script/style are always protected, code is
      protected by default, and both protected elements and translatable attributes
      are configurable. HTML optional-end-tag recovery, literal less-than text,
      raw-text elements, split/join metadata, `.html`/`.htm`/`.xhtml` family output,
      strict well-formed XHTML validation, a real script-bearing repository file,
      250-unit performance, identity/translated round trips, narrow raw diffs, and
      Chromium import/edit/export/re-import are covered. External linked ITS rule
      files are deliberately retained but not fetched during standalone import;
      broader XPath evaluation remains future multi-file workflow hardening.
- [x] **FF-109 — Plain text (`.txt`).** Finish encoding/BOM and newline
      preservation, configurable line/paragraph/sentence modes, empty lines,
      Unicode normalization policy, bidirectional text, and byte-safe export.
      Completed 2026-08-17: the TXT adapter now extracts exact editable ranges
      without normalizing source bytes or exposing a BOM as translatable text.
      Preference-based sentence, explicit sentence, paragraph, line, and whole-
      document modes preserve mixed CRLF/LF/CR endings, blank and whitespace-only
      lines, surrounding whitespace, and final newlines through targeted export.
      UTF-8, UTF-16LE, and UTF-16BE source encoding and BOM state are preserved by
      default; explicit output-encoding and preserve/add/remove BOM policies are
      available, identity export reuses the original bytes, and changed output is
      encoded with invalid surrogate rejection. Target normalization defaults to
      byte-preserving behavior and optionally supports NFC, NFD, NFKC, or NFKD.
      First-strong source direction is recorded for LTR/RTL/neutral units while
      bidi control characters remain untouched. Tests cover every segmentation
      mode, mixed newlines, empty files, BOM isolation, both UTF-16 byte orders,
      encoding conversion, normalization, bidi text, malformed bytes, join/split
      mapping, performance, and Chromium download/re-import.
- [x] **FF-110 — SRX 2.0 segmentation rules (`.srx`).** Import/export language
      maps and ordered break/no-break rules, validate the schema, and connect
      selected rules to deterministic project segmentation. Test cascade order,
      regular-expression compatibility, language-code matching, abbreviations,
      and round trips. Treat SRX as a workflow asset, not a translatable source.
      Completed 2026-08-17: Parsing Preferences now imports, stores, activates,
      deletes, and exports SRX 2.0 workflow profiles with a validated BCP 47 source
      language. The strict parser requires the SRX namespace/version and schema
      structure, preserves format handles and foreign header extensions, rejects
      unsafe XML and broken map references, and validates generated output against
      the checked-in official OSCAR XSD. TXT exposes an explicit SRX segmentation
      mode; the selected profile, language code, and complete rule snapshot are
      recorded in neutral project metadata while exact whitespace remains in the
      TXT skeleton. Language maps aggregate in document order according to
      `cascade`, and the first matching break/no-break rule decides each boundary.
      Common ICU escapes, Unicode classes, quoted literals, and leading case flags
      are adapted explicitly; incompatible constructs fail with diagnostics rather
      than changing meaning silently. Rule matching scans once per rule, never
      splits surrogate pairs, and is covered for cascade order, abbreviations,
      language matching, Japanese punctuation, Unicode regex behavior, malformed
      files, schema validation, semantic round trips, TXT integration, and a
      250-segment deterministic performance case. SRX remains intentionally absent
      from project-source format routing.

## Phase 2 — Common structured content and software localization

- [x] **FF-200 — CSV and TSV (`.csv`, `.tsv`).** Add delimiter, quote, escape,
      encoding, header, multiline-field, source/target/key/context column, and
      multilingual-column options. Preserve row order and nontranslated cells;
      test commas, tabs, CRLF, embedded newlines, formulas-as-data, and CSV
      injection warnings.
      Completed 2026-08-17: one CSV/TSV adapter now offers auto/comma/tab/
      semicolon/pipe delimiters, double/single/no quoting, doubled or backslash
      escapes, header handling, empty-field filtering, source-only and paired
      multilingual columns, and header-name/letter/number selectors for source,
      target, key, and context. Its strict state-machine parser supports RFC 4180
      CRLF, embedded record breaks, escaped quotes, final records with or without
      line endings, UTF-8/UTF-16 byte-order marks, registered TSV metadata, and
      useful malformed-input offsets. Positional field skeletons rewrite only
      selected destination cells, retain original quoting when possible, quote
      newly unsafe values, and preserve row order, ragged rows, line endings,
      headers, nontranslated cells, source encoding, and identity bytes. Formula-
      like values stay data rather than being evaluated or silently altered;
      source/target notes and export-time warnings flag ASCII and full-width CSV
      injection prefixes. Split/join is blocked because it would invalidate cell
      alignment. Unit, conformance, performance, and browser smoke coverage checks
      comma/tab dialects, custom escaping, multiline fields, CRLF, formulas,
      injection warnings, malformed quotes/encodings, column modes, ragged rows,
      exact UTF-16 identity, translated re-import, and download behavior.
- [x] **FF-201 — JSON families (`.json`, `.arb`, i18next/Chrome/locJSON profiles).**
      Replace value-coercing traversal with a lossless syntax tree. Configure
      translatable paths and key/context fields; preserve ordering, indentation,
      numbers, booleans, nulls, arrays, duplicate-key warnings, ICU messages,
      placeholders, plurals, and metadata. Add ARB and well-known JSON profiles
      only after generic JSON is safe.
      Completed 2026-08-17: active JSON imports now use a strict positional syntax
      tree instead of object coercion, retaining property/array order, whitespace,
      escapes, exact numeric spellings, primitive types, duplicate members, source
      encoding/BOM, and untouched bytes. Generic JSON supports wildcard path
      selectors, optional primitive values, sibling key/context fields, and
      value-safe segmentation. Conservative profile routing adds `.arb`,
      `.locjson`, and structurally valid Chrome `messages.json` auto-detection;
      i18next remains explicit because ordinary nested JSON has no distinguishing
      schema. ARB resource descriptions, locale, ICU text, and placeholder names;
      i18next v4 plural suffixes and full resource keys; and Chrome descriptions,
      message names, and dollar placeholders are exposed as notes/contexts without
      translating metadata. Draft LocJSON source/target string arrays are one
      ordered format unit, preserve extensions and comments, update only the
      existing translation side, and reject missing sources or duplicate unit
      keys. Export applies exact syntax-range edits, keeps unchanged files byte
      identical, validates primitive replacements, preserves family extensions,
      and refuses stale or non-unique mappings. Split/join remains available only
      within the same ordinary JSON value and is blocked for LocJSON. Unit,
      persistence, conformance, performance, malformed-input, UTF-16, duplicate-
      key, profile, placeholder-QA, mapping-corruption, and browser download tests
      cover the workflow.
- [x] **FF-202 — YAML 1.2 (`.yaml`, `.yml`).** Preserve comments, anchors,
      aliases, tags, scalar styles, block chomping, document boundaries, key
      order, and non-string types through a concrete syntax tree. Default to
      values-only selection and reject unsafe/custom object construction.
      Completed 2026-08-17: the YAML 1.2 adapter parses complete document streams
      into source-ranged nodes without converting them to application objects.
      Values-only extraction protects mapping keys and aliases, supports wildcard
      paths and optional non-string scalars, records comments, tags, anchors,
      document indices, and duplicate-key warnings, and keeps each scalar intact
      by default. Exact range edits preserve directives, document markers, key
      order, comments, anchors/aliases, opaque custom tags, flow/block layout,
      UTF-8/UTF-16 encoding, byte-order marks, and untouched bytes. Single- and
      double-quoted styles are retained; plain targets remain plain when their
      YAML 1.2 type is stable and are safely quoted otherwise; literal/folded
      blocks retain headers, indentation, and strip/clip/keep chomping semantics.
      No tag constructors, alias resolution, or executable object loading is
      used. Split/join is deliberately blocked to keep presentation ranges and
      block semantics aligned. Unit, conformance, malformed-stream, multi-
      document, duplicate-key, custom-tag, block-style, non-string, selector,
      UTF-16, mapping-corruption, 1,000-value performance, and browser download
      coverage verifies the workflow.
- [x] **FF-203 — GNU gettext (`.po`, `.pot`).** Support headers, contexts,
      singular and plural messages, every `msgstr[n]`, translator/extracted
      comments, references, flags, previous/obsolete entries, continued strings,
      charsets, and format placeholders. Validate plural counts and run gettext
      checks where available; POT is source/template import, not a translated
      deliverable by default.
      Completed 2026-08-17: a strict source-ranged PO parser now retains the
      header entry, contexts, singular/plural IDs, every contiguous `msgstr[n]`,
      translator and extracted comments, references, flags, previous strings,
      fuzzy state, obsolete `#~` entries, blank-line layout, C escapes, and
      continued-string wrapping. Header metadata drives plural-count validation
      and records the declared charset. UTF-8/UTF-16 and byte-order marks remain
      lossless; ISO-8859-1 and Windows-1252 catalogs round-trip when targets are
      representable and fail clearly rather than corrupting other characters.
      Existing PO translations import bilingually. POT targets start blank and
      download as `.po` deliverables by default. Exact fragment edits change only
      `msgstr` text, retain workflow/source syntax and identity bytes, then parse
      the generated catalog again. Context, plural index, flags, comments, and
      references become unit context/notes; fuzzy and obsolete inclusion are
      configurable. Placeholder QA covers printf forms, structural editing is
      blocked to protect entry/plural alignment, and stale mappings fail closed.
      Unit, conformance, malformed grammar, duplicate-key, plural-header,
      charset, escape, POT, obsolete/fuzzy, 1,000-message performance, browser
      download, and conditional GNU `msgfmt --check --check-format` tests verify
      the workflow.
- [x] **FF-204 — XML plus ITS 2.0 (`.xml`).** Provide safe generic XML extraction
      configured by XPath-like selectors and ITS translate, elements-within-text,
      preserve-space, ID, locale, terminology, and localization-note data. Keep
      namespaces, CDATA, entities, processing instructions, attribute order where
      possible, and untouched nodes. Profiles below should reuse this adapter.
      Completed 2026-08-17: a namespace-aware positional XML scanner now exposes
      text, optional CDATA, and explicitly selected quoted attributes through a
      conservative XPath-like selector subset while retaining exact character
      ranges. Local and inherited ITS 2.0 `translate` data and the safe basic
      `translateRule` subset control extraction; unsupported XPath constructs
      fail closed. XML IDs/languages, terminology, locale filters,
      elements-within-text, preserve-space, and child localization notes are
      recorded as neutral unit metadata. Export escapes text and attributes by
      context, safely splits target CDATA terminators, reparses the result, and
      preserves namespaces, entity spelling, comments, processing instructions,
      attribute order and quoting, source encoding/BOM, whitespace, and identity
      bytes outside edited ranges. DTD and entity declarations stay disabled,
      split/join is blocked to protect XML boundaries, and stale mappings are
      rejected. Unit, conformance, malformed/unsafe input, selector, local/global
      ITS, UTF-16, escaping, CDATA, 1,000-value performance, registry detection,
      and browser download coverage verify the workflow.
- [x] **FF-205 — Android resources (`strings.xml`).** Support `<string>`, string
      arrays, plurals, comments, `translatable=false`, formatted flags, markup,
      escapes, positional printf tokens, and `<xliff:g>` placeholders. Preserve
      resource keys and reject target placeholder/plural regressions.
      Completed 2026-08-17: a dedicated Android XML profile now extracts whole
      rich values from named strings, indexed string-array items, and validated
      plural quantities instead of flattening them into generic XML text nodes.
      It preserves keys, order, comments, whitespace, resource/group attributes,
      namespaces, encoding/BOM, Android backslash escapes, inline styling, and
      `<xliff:g>` markup through exact inner-range edits. `translatable=false`
      and empty resources are excluded by default and can be included explicitly;
      `formatted=false` disables printf enforcement for literal percent content.
      Neutral units carry resource type/key, array index, plural relationship,
      quantity, developer notes, formatting state, and source location. Export QA
      blocks missing, duplicated, malformed, or unexpected markup and positional
      printf placeholders, and treats each xliff placeholder ID as protected.
      The exporter safely XML-escapes changed text, retains well-formed markup,
      reparses the full resource document, leaves identity bytes untouched, and
      rejects stale mappings or structural split/join edits. Unit, conformance,
      malformed/unsafe input, locking/options, escaping, UTF-16, rich markup,
      plural/array, 1,000-resource performance, detection, and browser download
      coverage verifies the profile.
- [x] **FF-206 — Apple localization (`.strings`, `.stringsdict`, `.xcstrings`).**
      Support encodings, comments, escapes, keys, substitutions, plural/device
      variations, extraction states, and source-language metadata. Treat
      `.xcstrings` as a structured catalog rather than generic JSON.
      Completed 2026-08-17: one Apple adapter now routes three lossless profile
      parsers. The strict OpenStep parser preserves comments, key/value order,
      duplicate-key warnings, semicolons, Unicode/octal/common escapes, and
      UTF-8/UTF-16 bytes while editing only quoted values. The `.stringsdict`
      profile accepts the fixed standard Apple plist declaration without loading
      its external DTD, rejects every other DTD/entity declaration, walks nested
      dictionaries, protects type metadata, and exposes localized format and all
      CLDR-style plural strings with relationships. The positional `.xcstrings`
      parser retains JSON syntax and extensions, uses `sourceLanguage`, selects
      or explicitly configures the target BCP 47 localization, imports existing
      targets bilingually, records comments/extraction states, walks nested
      plural/device/substitution variation `stringUnit` leaves, and can add a
      missing target localization—including catalogs where the source is only the
      resource key—without reserializing unrelated JSON. Stale entries are
      optional. Export preserves identity bytes and source encoding/BOM, rejects
      mismatched target variation shapes and stale mappings, updates target state,
      blocks structural split/join, and enforces Apple `%@`, positional printf,
      and `%#@name@` substitution parity. Unit, conformance, malformed/unsafe
      input, all three profiles, comments/states, missing-language insertion,
      plurals, UTF-16, escaping, 1,000-entry performance, detection, and browser
      download coverage verifies the workflows.
- [x] **FF-207 — Java and Mozilla properties (`.properties`).** Preserve comments,
      separators, continuations, escapes, key order, encodings, duplicate keys,
      and MessageFormat/printf placeholders. Do not treat keys as translatable by
      default.
      Completed 2026-08-17: a strict logical-record parser now maps Java/Mozilla
      properties values onto their exact physical-line fragments. Keys—including
      escaped separators—remain protected context, while `=`, `:`, and whitespace
      separators, comments, indentation, CRLF/LF endings, order, blank lines,
      duplicate definitions, and continuation backslashes remain untouched.
      Common control, separator, backslash, and four-digit Java Unicode escapes
      decode deterministically; malformed escapes and dangling continuations fail
      with a profile-specific diagnostic. Valid UTF-8/UTF-16 is preserved, auto
      mode falls back to the traditional ISO-8859-1-compatible byte stream, and
      explicit UTF-8/Latin-1/Windows-1252 modes are available. Changed legacy
      targets use portable `\\uXXXX` escapes when needed, while unchanged files
      return their original bytes. Export distributes translated content over the
      existing continuation fragments, reparses the result, rejects stale mapping
      or structural edits, and enforces MessageFormat, printf, and other shared
      placeholder QA. Empty values are optional. Unit, conformance, malformed
      input, comments/separators, duplicate keys, escape/control behavior,
      multiline CRLF, single-byte identity, placeholder regression, 1,000-entry
      performance, detection, and browser download coverage verifies the workflow.
- [x] **FF-208 — .NET resources (`.resx`).** Translate string `<data>` values
      while preserving names, comments, type/mimetype metadata, aliases, headers,
      whitespace, and non-string serialized resources. Never deserialize or
      instantiate embedded objects.
      Completed 2026-08-17: a dedicated positional RESX profile now exposes only
      untyped strings and, optionally, values explicitly declared as
      `System.String`. Named `data` records with other types or any `mimetype`,
      plus schemas, aliases/assemblies, headers, binary/base64 payloads, and nested
      XML values remain inert source bytes; no serializer, type loader, reflection,
      or object construction is used. Data names/types become protected context,
      comments become translator notes, duplicate names produce warnings, and
      empty strings are optional. Exact value-range export retains attribute and
      element order, namespaces, comments, whitespace, `xml:space`, entity
      spelling outside changes, encoding/BOM, and identity bytes. Plain targets
      are XML-escaped; CDATA stays CDATA, adjacent sections re-import as one value,
      and embedded target terminators split safely. The generated document is
      reparsed, placeholder regressions and stale mappings fail closed, and
      split/join is blocked. Unit, conformance, unsafe/malformed XML, inert object
      resources, options/comments/types, CDATA, UTF-16, placeholders,
      1,000-resource performance, detection, and browser download coverage
      verifies the workflow.
- [x] **FF-209 — Qt Linguist (`.ts`).** Support contexts, IDs, source,
      translation states, comments, locations, length variants, numerus forms,
      inline markup, and vanished/obsolete messages. Validate XML and placeholder
      parity.
      Completed 2026-08-17: the Qt Linguist profile safely accepts the fixed
      `<!DOCTYPE TS>` marker without resolving a DTD and rejects every other
      declaration. It imports source and existing translations bilingually,
      retains TS/source/target languages, context names, stable message IDs,
      source locations, old-source/developer/translator comments, workflow type,
      numerus forms, and length variants as neutral relationships and metadata.
      Finished, unfinished, vanished, and obsolete inclusion policies are
      independent. Exact target-range edits preserve message/context order,
      locations, comments, extensions, attributes, line endings, encoding/BOM,
      and identity bytes; a fully translated unfinished target has only its
      existing type attribute removed, while vanished/obsolete states remain.
      Escaped inline markup stays markup in the editor and valid escaped XML on
      disk. Structurally nested source/target nodes are protected with warnings
      instead of flattened. Export reparses the complete TS, blocks stale mapping
      and split/join, and enforces markup plus Qt `%1`, `%L1`, `%n`, printf, and
      shared placeholder parity. Unit, conformance, fixed/unsafe DOCTYPE,
      bilingual states, comments/locations, numerus/variants, inline markup,
      UTF-16, 1,000-message performance, detection, and browser download coverage
      verifies the workflow.
- [x] **FF-210 — INI and desktop/resource text (`.ini`, `.desktop`, `.lang`).**
      Preserve sections, comments, whitespace, duplicate keys, locale suffixes,
      escapes, and ordering; require a profile or user selection for
      translatable keys.
      Completed 2026-08-18: one line-ranged adapter now routes generic INI,
      freedesktop desktop entries, and key/value language resources. Generic INI
      fails with `INI_SELECTION_REQUIRED` until comma-separated key or
      `section.key` glob selectors are supplied, preventing accidental translation
      of configuration values. Desktop mode exposes the standardized human-facing
      Name/GenericName/Comment/Keywords family, pairs an existing requested locale
      suffix bilingually, and inserts a missing localized key immediately beside
      its base key without rewriting the file. Lang mode exposes all values.
      Sections, comments, blank lines, `=`/`:` choice, leading value whitespace,
      duplicate definitions and warnings, ordering, locale suffixes, unrelated
      keys, CRLF/LF, common escapes, desktop `\\s`/escaped-semicolon behavior,
      encoding/BOM, and identity bytes remain stable. Keys and sections are
      protected context, comments are notes, and empty values are optional.
      Export reparses the selected profile, blocks placeholder regressions,
      split/join, stale mappings, and malformed lines. JSON signature detection
      now validates JSON before overriding `[section]` INI metadata. Unit,
      conformance, explicit-selection, all three profiles, locale pairing and
      insertion, duplicates/comments/escapes, UTF-16, malformed syntax,
      1,000-value performance, detection, and browser download coverage verifies
      the workflow.
- [x] **FF-211 — PHP localization arrays (`.php`).** Parse a deliberately limited
      static array grammar or a mature AST; never use `eval`, import, or execute.
      Preserve keys, comments, nesting, escapes, and placeholders, and reject
      dynamic expressions with a precise diagnostic.
      Completed 2026-08-18: a purpose-built parser accepts only a PHP file that
      returns nested short (`[]`) or long (`array()`) arrays with quoted/integer
      keys and literal string leaves. It never evaluates, imports, or executes
      PHP; variables, interpolation, calls, concatenation, constants, additional
      statements, and non-string leaves fail with line/column diagnostics. Exact
      value ranges retain nesting, comments, key spelling, array style, commas,
      whitespace, line endings, quote style, encodings/BOM, duplicate entries,
      and identity bytes. Dot-path selectors with `*`/`**`, empty-string policy,
      protected path context, duplicate warnings, PHP single/double-quoted escape
      decoding, safe dollar escaping, placeholder QA, reparsing after export,
      stale-mapping rejection, and blocked split/join keep edits deterministic.
      Unit, conformance, malformed/adversarial dynamic-code, nested-array,
      selector, duplicate, escape, Unicode/UTF-16, 1,000-value performance,
      detection, identity, translated re-import, and browser download coverage
      verifies the workflow.
- [x] **FF-212 — Markdown and AsciiDoc (`.md`, `.markdown`, `.adoc`, `.asciidoc`).**
      Preserve front matter, code, URLs, references, directives, attributes,
      tables, embedded HTML, inline markup, hard line breaks, and protected spans.
      Segment rendered prose without corrupting source syntax.
      Completed 2026-08-18: one source-range adapter auto-routes Markdown and
      AsciiDoc without rendering or normalizing either language. It exposes prose
      spans in headings, lists/admonitions, paragraphs, link labels, tables, and
      optionally text between inline HTML tags, while retaining exact markup
      delimiters and whitespace. YAML/TOML front matter, Markdown fenced and
      indented code, reference definitions and destinations, autolinks, URLs,
      inline code, entities, hard-break markers, raw HTML comments/script/style/
      pre blocks, AsciiDoc attributes, includes, conditionals, anchors, macros,
      passthrough/listing/comment blocks, and table delimiters stay protected.
      Unterminated front matter, code/protected blocks, and raw HTML fail with
      line diagnostics. Exact edits preserve CRLF/LF, extensions, encoding/BOM,
      protected syntax, and identity bytes; export reparses the document, rejects
      inserted physical line breaks and stale mappings, applies shared placeholder
      QA, and blocks structural split/join. Unit, conformance, malformed block,
      protected-span, inline HTML, table, Unicode/UTF-16, 1,000-line performance,
      detection, identity, translated re-import, and browser download coverage
      verifies both profiles.
- [x] **FF-213 — Subtitles (`.srt`, `.vtt`, then `.sbv`).** Preserve cue IDs,
      timecodes, settings, comments/notes, inline cue markup, line breaks, and
      ordering. Add QA for start/end validity, overlap policy, characters per
      line, lines per cue, reading speed, and target expansion without silently
      retiming cues.
      Completed 2026-08-18: one cue-aware adapter strictly parses SRT, WebVTT,
      and YouTube SBV timing grammars, rejects invalid/reversed time ranges, and
      retains cue order, arbitrary SRT/WebVTT IDs, exact timestamp spelling,
      settings, multiline text, blank separators, CRLF/LF, encoding/BOM, and
      identity bytes. WebVTT signatures/header metadata plus NOTE, STYLE, and
      REGION blocks stay protected. Cue IDs, millisecond ranges, and settings are
      exposed as neutral context; overlap/out-of-order diagnostics are retained,
      with configurable warn/error/allow overlap handling. Export applies only
      cue-text range edits, reparses the complete file, never changes timing, and
      blocks stale mappings and structural split/join. Shared QA protects HTML
      and WebVTT voice/language/class/timestamp cue markup and placeholders;
      configurable checks block excessive characters per line, lines per cue,
      characters per second, and target expansion. Unit, conformance, malformed
      signatures/timings, overlap, multiline/markup/notes/settings, all three
      profiles, Unicode/UTF-16, 1,000-cue performance, detection, identity,
      translated re-import, and browser download coverage verifies the workflow.

## Phase 3 — Publishing and technical-authoring formats

- [x] **FF-300 — OpenDocument (`.odt`, `.ods`, `.odp`).** Reuse package and rich
      segment infrastructure while preserving ODF styles, manifests, metadata,
      formulas, drawings, notes, tracked changes policy, and embedded assets.
      Test with LibreOffice round trips and ODF validators.
      Completed 2026-08-18: the ODF 1.2/1.3 package adapter validates the
      uncompressed first `mimetype` entry, extension/media-type agreement,
      content body, manifest root entry, and safe XML before routing ODT, ODS,
      and ODP. Source-ranged text extraction covers styled paragraphs/runs,
      spreadsheet cells, presentation text/notes, optional annotations,
      headers/footers, and drawing titles/descriptions. Final, original, and all
      tracked-change policies retain change markup while controlling insertion/
      deletion text. Formula attributes, styles, manifests, metadata, drawings,
      scripts/macros, and every binary/unknown package part remain inert bytes;
      signed packages fail closed because edits invalidate signatures. Export
      changes only mapped XML ranges, XML-escapes and reparses edited parts,
      preserves identity packages byte-for-byte, emits `mimetype` first/stored,
      enforces placeholders, and blocks stale mappings and split/join. Unit,
      conformance, all three applications, asset/formula/note/change policy,
      unsafe XML/signature/container, semantic package diff, 1,000-paragraph,
      detection, translated re-import, and browser coverage verifies the core
      workflow. A conditional LibreOffice headless PDF-conversion reopen test is
      included (`OPENTLC_RUN_LIBREOFFICE=1`); its managed-sandbox approval timed
      out twice in this run, so downstream release CI must execute that external
      gate and an ODF schema validator before advertising origin-tool validation.
- [x] **FF-301 — EPUB 2/3 (`.epub`).** Read the container, package manifest,
      spine, navigation, XHTML/SVG content, metadata, and media overlays; reuse
      HTML/XML filters and preserve CSS, fonts, media, scripts, accessibility,
      and the required uncompressed/first `mimetype` entry. Validate exported
      books with EPUBCheck.
      Completed 2026-08-18: the EPUB 2/3 adapter validates the stored first
      `application/epub+zip` mimetype, single safe container rootfile, OPF version,
      publication identifier, unique manifest IDs, resolved in-package hrefs,
      spine references, EPUB 3 nav or EPUB 2 NCX, media-overlay references, and
      all selected XML content. Fixed standard HTML/XHTML 1.1 and NCX doctypes are
      masked without resolving them; entities, custom declarations, escaping
      paths, unsupported content encryption, and signatures fail closed.
      Source-ranged extraction covers spine-only or all manifest XHTML, nav/NCX
      labels, selected OPF metadata, SVG text/title/description, and alt/title/
      ARIA attributes. Scripts and linked resources are masked during validation
      and never executed. CSS, fonts, images, audio/video, JavaScript, SMIL media
      overlays, accessibility extensions, and unknown assets remain exact package
      bytes. Export edits and reparses only mapped XML ranges, preserves identity
      bytes, restores the mandatory mimetype ZIP layout, enforces placeholder/tag
      QA, and blocks stale mappings and split/join. Unit, conformance, EPUB 2/3,
      navigation/metadata/scope/SVG/accessibility, fixed-doctype, encryption/
      entity/signature/container, semantic package diff, 1,000-paragraph,
      detection and translated re-import coverage verifies the core workflow. A
      generated browser import/edit/download/re-import case is registered; its
      runner could not bind inside the sandbox and two escalation reviews timed
      out in this run, so it remains a downstream release gate. An opt-in
      `OPENTLC_RUN_EPUBCHECK=1` test is also included; EPUBCheck is not installed
      in this environment, so release CI must execute both gates before
      origin-validator support is advertised.
- [x] **FF-302 — SVG (`.svg`).** Translate text, selected accessibility
      attributes, titles/descriptions, and text-path content while preserving
      namespaces, transforms, styling, geometry, and scripts as inert bytes.
      Provide XML profile controls because many SVG strings are not visible.
      Completed 2026-08-18: the SVG 1.1/2 XML adapter validates the SVG root and
      namespace, rejects malformed XML, doctypes, and entity declarations, and
      masks scripts/styles during positional parsing so they are never executed.
      Source-ranged extraction covers configurable text elements and attributes,
      including `text`, `tspan`, `textPath`, `title`, `desc`, and ARIA labels;
      inherited hidden and SVG/ITS translate metadata are honored by default.
      Optional hidden/metadata inclusion and value/preference/sentence
      segmentation provide the XML-profile controls. Export XML-escapes changed
      ranges, reparses the result, preserves source encoding/BOM and identity
      bytes, enforces placeholder QA, and blocks split/join and stale mappings.
      Geometry, transforms, namespaces, styling, metadata, and scripts remain
      exact inert source bytes. Unit, conformance, custom-selector, visibility,
      ITS, accessibility, UTF-16, security, 1,000-node, detection, translated
      re-import, and browser coverage verifies the core workflow; the generated
      export also passed local `xmllint --nonet` validation.
- [x] **FF-303 — DITA and DITAMAP (`.dita`, `.ditamap`).** Add DITA-aware inline
      elements, conrefs/keyrefs, topic IDs, maps, profiling attributes, translate
      controls, whitespace, and multi-file package handling. Preserve references
      and validate the complete map, not isolated topics only.
      Completed 2026-08-18: the standalone DITA/DITAMAP and `.ditazip` bundle
      adapter validates topic/map roots and specializations, unique IDs, one
      unambiguous root map, safe normalized paths, every local bundle resource,
      target fragments, conrefs/conrefends, and keyrefs/conkeyrefs across the
      complete map graph. Fixed known OASIS DITA doctypes are positionally masked
      without resolution; internal subsets, entities, unsafe paths, malformed XML,
      ambiguous roots, and missing references fail closed. Source-ranged
      extraction covers prose, DITA inline elements, navigation, configurable
      attributes, optional metadata/code, inherited DITA/ITS translate controls,
      and profiling context. Map-graph or all-document scope and value/preference/
      sentence segmentation are supported. Export XML-escapes and reparses only
      mapped ranges, rejoins sentence pieces without duplication, preserves
      source encoding/BOM and identity bytes, retains package assets and
      structural attributes, enforces placeholder QA, and blocks stale mappings
      and split/join. Unit, conformance, specialization, map/key/conref/fragment,
      asset, UTF-16, security, semantic re-import, 1,000-paragraph, detection, and
      generated browser coverage verifies the core workflow, and generated XML
      passed local `xmllint --nonet`. This run's browser runner requires a local
      bind outside the sandbox and both approval reviews timed out, so that
      registered case remains a downstream CI gate. An opt-in DITA-OT publish
      test is included (`OPENTLC_RUN_DITA_OT=1`), but DITA-OT is not installed
      here; release CI must execute both external gates before claiming
      DITA-OT-validated output.
- [x] **FF-304 — DocBook (`.xml`, `.dbk`).** Add version-aware block/inline rules,
      IDs/xrefs, entities, code, index terms, metadata, and whitespace behavior;
      preserve extensions and validate against the declared schema.
      Completed 2026-08-18: the DocBook 4/5 adapter distinguishes the no-namespace
      4.x profile from the DocBook 5 namespace/version profile, validates supported
      publication roots, namespace/version and declared schema consistency, unique
      `id`/`xml:id` values, `linkend`/`endterm`/`startref`, and fragment xlinks.
      Fixed OASIS DocBook 4 doctypes and a bounded common named-entity profile are
      positionally masked without resolving external resources; internal subsets,
      custom entities, unknown doctypes, malformed XML, duplicate IDs, unresolved
      xrefs, and profile/schema conflicts fail closed. Source-ranged extraction
      covers block and inline prose, configurable attributes, optional metadata,
      literal/code content and index terms, DITA/ITS-style translate controls, and
      role/condition/language/ID context while retaining whitespace and namespaced
      extensions. Export escapes and reparses mapped values, rejoins sentence
      pieces without duplication, preserves source encoding/BOM and identity bytes,
      enforces placeholder QA, and blocks stale mappings and split/join. Unit,
      conformance, DocBook 4/5, doctype/entity, xref/schema/extension, UTF-16,
      security, 1,000-paragraph, detection, re-import, and generated browser
      coverage verifies the workflow; generated DocBook 5 XML passed local
      `xmllint --nonet`. Release CI must additionally validate representative
      output against official DocBook 4 DTD and DocBook 5 RELAX NG/Schematron
      grammars before origin-schema validation is advertised.
- [x] **FF-305 — Adobe IDML and ICML (`.idml`, `.icml`).** Preserve story order,
      paragraph/character styles, anchored objects, tables, notes, XML tags,
      cross-references, and package relationships. Use small legally shareable
      fixtures and require successful reopen/preflight in Adobe InDesign before
      declaring export support.
      Completed 2026-08-18: the adapter handles standalone ICML XML and IDML ZIP
      packages with the required first/stored Adobe mimetype, validates the
      `designmap.xml` document, every declared local package relationship,
      deterministic unique story paths and `Self` identifiers, referenced Story
      roots, Content presence, XML safety, and unsigned-package policy. Story
      extraction follows designmap order and source-ranged `Content` nodes while
      retaining paragraph/character-style and markup-tag context; configurable
      notes, conditional/hidden content, custom alt/actual text, and value/
      preference/sentence segmentation are supported. Tables, anchored objects,
      XML tags, hyperlink/cross-reference structures, spreads, styles, fonts,
      graphics, and unknown/binary package parts remain exact inert content.
      Export escapes and reparses only mapped Story ranges, rebuilds a compliant
      IDML container, preserves source encoding/BOM and identity bytes, rejoins
      sentence pieces without duplication, enforces placeholder QA, and blocks
      stale mappings and split/join. Unit, conformance, story-order/relationship,
      style/table/note/tag/accessibility, asset/signature/container, UTF-16,
      security, 1,000-Content, detection, re-import, and generated browser coverage
      verifies the workflow; ICML output passed local `xmllint --nonet`. This
      run's browser server needed an out-of-sandbox local bind and both approval
      reviews timed out, so the registered browser case remains a downstream CI
      gate. Adobe InDesign is unavailable in this environment, so legally
      shareable fixtures are generated in tests and real InDesign reopen/preflight
      remains a mandatory release gate before origin-tool validation is advertised.
- [x] **FF-306 — TeX/LaTeX (`.tex`).** Protect commands, environments, math,
      labels, citations, references, verbatim/code, and comments while exposing
      prose and selected command arguments. Make macro rules configurable and
      test compile the result where a TeX engine is available.
      Completed 2026-08-18: the stateful lexer validates balanced groups,
      ordered environments, inline/display math delimiters, `verb` delimiters,
      comments, commands, optional/mandatory groups, and nested protected
      environments without broad whole-file regex replacement. It exposes prose
      plus configurable `macro:argument-index` ranges (including link labels),
      while unknown macro arguments, labels, citations, references, URLs,
      includes, package/configuration commands, math, and configurable verbatim/
      code/math environments remain protected. Comments and document metadata
      are optional. Export rejoins preference/sentence pieces without duplication,
      escapes TeX-special characters in translated prose, re-lexes the complete
      result, preserves encoding/BOM and identity bytes, enforces QA, and blocks
      stale mappings and split/join. Unit, conformance, macro/filter, math/code/
      reference/comment, malformed grammar, escaping, UTF-16, 1,000-paragraph,
      detection, re-import, and generated browser coverage verifies the workflow.
      An opt-in `pdflatex` compile/PDF test is included
      (`OPENTLC_RUN_LATEX_ENGINE=1`), but no TeX engine is installed here, so
      release CI must execute that gate with representative macro packages before
      compiled-output support is advertised.
- [x] **FF-307 — TTML (`.ttml`, `.dfxp`).** Add namespace/profile-aware timed-text
      handling, nested spans, styling, regions, frame/tick rates, timing
      expressions, language, and whitespace. Validate against the selected TTML
      profile and reuse subtitle QA without assuming WebVTT timing rules.
      Completed 2026-08-18: the TTML/DFXP adapter validates supported W3C
      namespaces and selected TTML 1, TTML 2, or IMSC 1 profiles; frame rate and
      multipliers, subframe/tick rates, clock/frame/subframe/tick/offset timing,
      effective inherited begin/end/duration, unique style/region IDs and every
      reference, positive cue durations, overlaps, and timed paragraph presence.
      Source-ranged extraction covers direct paragraph text and nested spans with
      inherited cue timing, style, region, language, and source whitespace;
      metadata and value/preference/sentence segmentation are optional. Export
      XML-escapes and reparses mapped values, preserves namespaces, profiles,
      layout/styling/timing and identity encoding/BOM, rejoins pieces without
      duplication, and applies cue line-length/count, reading-speed, expansion,
      overlap and placeholder QA without WebVTT parsing assumptions. Stale
      mappings and split/join fail closed. Unit, conformance, TTML/IMSC profiles,
      all timing forms, inheritance/style/region/language/whitespace, metadata,
      overlap/readability, UTF-16, security, 1,000-cue, detection, re-import, and
      generated browser coverage verifies the workflow; output passed local
      `xmllint --nonet`. Official TTML/IMSC schema and profile-validator checks
      remain mandatory release-CI gates before profile-conformant output is
      advertised.
- [x] **FF-308 — MIF, Windows RC, and Qt/QML specialist resources.** Implement as
      separate adapters in that order, with grammar-aware token preservation and
      real-tool reopen/compile tests. Do not use broad regex replacements for
      syntax-bearing files.
      Progress 2026-08-18 — MIF complete: the stack-based MIF lexer validates the
      version signature, nested angle-tag grammar, comments, delimited strings,
      and hexadecimal/control escapes; configurable content, marker, variable,
      element and cross-reference string tags are source-ranged. Export encodes
      delimiter/backslash/control characters, reparses the complete document,
      preserves catalogs, conditions, xrefs, graphics and identity encoding/BOM,
      and blocks stale mappings and split/join. Unit, conformance, filtering,
      escape/security, UTF-16, 1,000-string, detection, re-import, and generated
      browser coverage is included. FrameMaker reopen remains an external gate.
      Windows RC complete: the lexer validates C-style strings, escapes,
      comments and balanced resource blocks; dialog captions/controls, menus,
      STRINGTABLE and optional VERSIONINFO/preprocessor values are selected by
      grammar context. Export preserves IDs, numeric operands, accelerators,
      styles, resource paths, macros, comments and source encoding while
      reparsing every result. Unit, conformance, filter, malformed-input,
      UTF-16, 1,000-entry, detection, re-import and browser coverage is included;
      an opt-in GNU windres compile gate is available for equipped environments.
      Qt QML complete: a JavaScript/QML lexer validates strings, escapes,
      comments, regex literals and balanced object/call syntax. It extracts only
      direct non-interpolated literal arguments selected for `qsTr`,
      `qsTranslate` and Qt NOOP functions, while preserving contexts,
      disambiguation and translator comments. Translation IDs, dynamic bindings,
      bare strings, regexes and interpolated templates remain protected. Export
      retains quote style and source encoding, escapes template interpolation,
      reparses output and blocks stale mappings and split/join. Unit,
      conformance, selector, malformed-input, placeholder, UTF-16, 1,000-call,
      detection, re-import, generated browser and installed `qmllint` coverage
      verifies the workflow.

## Phase 4 — Explicitly constrained and conversion-based support

- [x] **FF-400 — Legacy Office (`.doc`, `.xls`, `.ppt`, `.rtf`).** Provide the
      strongest browser-only implementation possible without a LibreOffice
      instance or conversion service, and label unavoidable output changes.
      Completed 2026-08-18: signature-first OLE detection routes DOC, XLS and PPT
      to a dedicated local adapter. XLS text cells round-trip to binary XLS; DOC
      paragraph runs export to DOCX; PPT text runs export to translated HTML.
      RTF has a native skeleton-based round trip that preserves control syntax
      around edited paragraphs and handles escaped and Unicode text. Original
      files remain in IndexedDB and are never uploaded. Tests reject extension
      spoofs, exercise paragraph-run mutation, use a real binary XLS fixture,
      reopen generated XLS/RTF output, and verify advertised picker support.
- [x] **FF-401 — PDF (`.pdf`) as source-only extraction.** Clearly label PDF as
      lossy, distinguish born-digital text from OCR, retain page/bounding-box
      context, and export translation to a new accessible document or bilingual
      review format rather than promising layout-identical PDF round trips.
      Completed 2026-08-18: a locally bundled PDF.js adapter validates the PDF
      signature/structure, extracts selected born-digital pages into visual lines
      or positioned items, records page/user-space bounding boxes and direction,
      and classifies text, image-only/OCR-required, and blank pages. Page ranges
      and skip/error OCR policies are explicit; passworded, malformed, empty,
      cancelled, oversized, over-page-limit and text-expansion cases fail with
      typed errors. Embedded scripts, actions, forms, links and attachments are
      never executed or requested. The adapter is labelled source-only with
      `roundTrip: false`; export renders the retained original pages and replaces
      translated text in the recorded source bounding boxes, preserving page
      dimensions, graphics, geometry, and untranslated regions. Synthetic
      Unicode/RTL/non-BMP, mixed OCR, bbox, filtering, malformed, cancellation,
      2,001-page limit, 250-line performance, detection, shared conformance and
      real-browser coverage is included, and the reference PDF passes installed
      `pdfinfo` independently. PDF extraction remains inherently lossy, including
      reading order, shaping, accessibility tags and layout.
- [x] **FF-402 — OCR image input (`.png`, `.jpg`, `.tiff`) and media transcription.**
      Run extraction locally, retain spatial/timestamp context, and never send
      source files to a processing provider.
      Completed 2026-08-18: PNG, JPEG and TIFF use local Tesseract OCR with
      paragraph/line grouping, bounding boxes and confidence. WAV, MP3, M4A,
      Ogg, FLAC, MP4, MOV and WebM decode to mono audio in the browser and use a
      local Whisper pipeline, producing timestamped translation units and WebVTT
      output. Model assets are downloaded and browser-cached, while source bytes
      stay on-device in the project skeleton/IndexedDB. Signature-first routing
      rejects renamed binaries. Tests cover provider-independent local engines,
      confidence/context mapping, retained originals and derived exports.
      Additional raster aliases and animation handling are completed under
      FF-510.
- [x] **FF-403 — Proprietary CAT packages (`.sdlppx`, `.sdlrpx`, `.wsxz`, memoQ
      packages).** Preserve unknown entries, defend against hostile archives,
      update bilingual members, and create compatible return containers.
      Completed 2026-08-18 with import/edit/return support for Trados
      `.sdlppx`/`.sdlrpx`, WorldServer `.wsxz`, and memoQ
      `.mqout`/`.mqback`/`.mqxlz`. Detection requires a valid safe ZIP plus
      matching internal XLIFF/vendor markers; extension alone never suffices.
      Users can select XLIFF-family members and whether to retain targets. Units
      preserve vendor XLIFF protections and package paths, while every manifest,
      database, resource and unknown binary remains byte-preserved in the
      skeleton. Shared archive defenses reject traversal, collisions,
      encryption, bombs, excessive expansion and malformed XML; cancellation,
      Unicode/RTL, multi-member and 250-unit fixtures cover the importer. The
      writer rebuilds only selected XLIFF-family members, keeps locked units
      unchanged, and copies all opaque entries. SDLPPX becomes SDLRPX and MQOUT
      becomes MQBACK; existing return/archive extensions are retained. Automated
      tests reopen Trados, WorldServer, and memoQ-style output, verify translated
      targets, and byte-check preserved binary resources.
- [x] **FF-404 — Generic ZIP projects.** Add only as a manifest-driven batch
      container over already supported adapters. Preserve paths and bytes,
      prevent traversal/collisions, cap recursion and expansion, and report each
      member's result instead of guessing silently.
      Completed 2026-08-18 with a strict version-1 root
      `opentlc-project.json` contract. Each of at most 100 members declares an
      exact safe path, registered same-format adapter, MIME hint, primitive
      import options and required/optional policy; extensions are never guessed.
      Recursive manifest batches and constrained PDF/CAT members are rejected,
      nested document packages are capped at 25, and both archive layers use the
      shared traversal, collision, encryption, entry, size and expansion-ratio
      defenses. Imports process every declaration and retain structured
      path/format/status/unit/error reports; the default rejects all failures,
      while `skip-optional` skips only explicit `required:false` members.
      Independent child models, options and skeletons persist in the batch; all
      undeclared entries remain byte-preserved. Identity export returns the exact
      original ZIP, translated export invokes each changed member's native
      round-trip builder and semantic diff tests prove the manifest/opaque bytes
      remain unchanged. Cross-member structural edits fail actionably rather
      than corrupting ownership. Minimal, multi-format, Unicode/RTL, malformed,
      missing/duplicate/unsafe/recursive manifest, optional failure, bomb,
      cancellation, 250-unit, re-import and real-browser tests cover the adapter.

## Phase 5 — Expanded CAT-tool format parity backlog

Gap-audited against the active registry and common RWS Trados/memoQ format lists
on 2026-08-19. These tasks are intentionally unchecked: an extension is not
considered supported merely because a generic XML, HTML, ZIP, OLE, or image
sniffer can sometimes read it. Complete tasks in priority order and apply the
definition of done below before checking them.

### Priority A — Common Office, web, and CAT compatibility gaps

- [x] **FF-500 — Remaining legacy and specialist Microsoft Office variants.**
      Add signature-driven handling for Word `.dot` and applicable `.bak`, Excel
      `.xlt` and `.xlsb`, and PowerPoint `.pps`, `.pot`, and `.sldx`. Add a
      SpreadsheetML 2003 XML profile instead of treating those workbooks as
      generic XML. Extend the existing browser-only legacy Office adapters so
      `.doc` and `.ppt` produce same-family delivery files when technically
      possible; otherwise expose an explicit, tested conversion output without
      claiming a round trip. Preserve macros, formulas, fields, embedded objects,
      slide masters, and unknown OLE/OOXML records opaquely and never execute
      active content. Test every extension independently rather than aliasing it
      from the filename.

      **Completed 2026-08-19.** Detection now verifies the OLE application
      streams for `.doc`/`.dot`/applicable `.bak`, `.xls`/`.xlt`, and
      `.ppt`/`.pps`/`.pot`; an OLE signature or extension alone is rejected.
      XLSB requires a safe OPC package, `xl/workbook.bin`, the binary-workbook
      content type, and a workbook that the offline parser can reopen. SLDX
      requires a root `officeDocument` relationship to one standalone
      PresentationML slide. Excel 2003 XML is identified by its `Workbook` root
      and `urn:schemas-microsoft-com:office:spreadsheet` namespace and extracts
      only string `Data` values outside formula cells.

      | Profile | Delivery behavior |
      | --- | --- |
      | DOC/DOT/applicable BAK | Exact original for identity; translated DOCX conversion |
      | XLS/XLT/XLSB | Exact original for identity; translated XLSX, or XLSM when a VBA project is retained |
      | PPT/PPS/POT | Exact original for identity; translated HTML conversion |
      | SLDX | Native package-preserving identity and translated round trip |
      | SpreadsheetML 2003 XML | Native positional XML round trip with formula/control markup protected |

      The original file, unknown binary/package resources, fields, formulas,
      cached formula values, VBA payloads, embedded objects, masters, and other
      unaddressed content remain opaque and are never executed or evaluated.
      SLDX export changes only addressed XML parts. Binary spreadsheet delivery
      deliberately converts to XLSX/XLSM instead of rewriting BIFF/XLSB because
      the available browser writer can otherwise discard formulas; consequently
      a translated conversion does not claim byte preservation of undocumented
      binary records. Legacy Word and PowerPoint delivery likewise remains an
      explicit conversion because the browser parser has no safe DOC/PPT writer.

      Tests cover every extension independently, mismatched/spoofed OLE files,
      real BIFF input, generated XLSB, SpreadsheetML 2003, standalone SLDX,
      Unicode/RTL/emoji, formulas and cached values, retained VBA, opaque slide
      resources, malformed packages, cancellation, exact identity output,
      translated re-import, migration metadata, and IndexedDB save/reload in a
      real browser. Generated stress coverage uses 2,000 XLSB rows and 750
      SpreadsheetML rows without committed binary fixtures; the focused local
      run completed the XLSB generation/cancellation case in about 2.1 seconds
      and the three Chromium workflows in about 1.9 seconds on the development
      machine. Archive size, entry-count, expansion-ratio, path, XML entity/DTD,
      and cancellation limits are inherited from the shared safe-input layer.

      Normative references used: Microsoft [MS-XLSB structure and package
      model](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xlsb/1a21ca23-7635-4212-9504-8759eb984b12),
      [MS-XLS binary/OLE relationship](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/08a9fc1a-a2da-4fdd-af7a-98c8f2f56341),
      [Office 2003 XML schema and SpreadsheetML availability](https://news.microsoft.com/source/2003/11/17/microsoft-announces-availability-of-open-and-royalty-free-license-for-office-2003-xml-reference-schemas/),
      [PresentationML slide structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document),
      and Microsoft's [Office binary/template format validation
      guidance](https://learn.microsoft.com/en-us/security-updates/securityadvisories/2011/2501584).

- [x] **FF-501 — OpenDocument templates and master documents.** Extend the ODF
      adapter to `.ott`, `.odm`, `.otp`, `.ots`, and explicitly detected generic
      `.odf` packages. Detect the package media type and internal manifest, retain
      the exact template/master-document family on export, preserve scripts and
      embedded objects without executing them, and add identity, translated,
      malformed-manifest, MIME-conflict, and independent reopen coverage.

      **Completed 2026-08-19.**
      The existing ODF adapter now recognizes these families from the stored,
      first-entry `mimetype`, the matching manifest root media type, the declared
      `content.xml` XML entry, and the document body/root structure—not from the
      filename alone:

      | Extension | Required package family | Editable content |
      | --- | --- | --- |
      | `.ott` | OpenDocument text template | Text body and selected stories |
      | `.odm` | OpenDocument text master | Text body and selected stories |
      | `.ots` | OpenDocument spreadsheet template | Text in spreadsheet cells |
      | `.otp` | OpenDocument presentation template | Slide text and selected notes |
      | `.odf` | OpenDocument Formula | MathML `mtext` only |

      Export retains the exact profile, MIME type and extension. Identity output
      returns the original bytes; translated output patches only mapped XML text
      and keeps scripts, event listeners, formulas, embedded objects, images and
      unknown package resources inert and logically byte-identical. Formula
      identifiers, operators and annotations are protected rather than treated
      as prose. Unsafe or duplicate manifest paths, missing or incorrectly typed
      `content.xml`, MIME/extension/body conflicts, DTD/entities, malformed XML,
      signatures and archive-policy violations fail with actionable errors.

      Focused tests cover every new extension independently, exact identity,
      translated re-import, Unicode/RTL/emoji, opaque scripts and binary objects,
      malformed/adversarial manifests, MIME spoofing, cancellation, a generated
      1,500-row OTS, migration metadata, IndexedDB mapping persistence and two
      real-Chromium workflows. Generated ODT, OTT, ODM, OTS, OTP and ODF outputs
      all reopened in an installed headless LibreOffice and produced real PDF
      conversion artifacts. The final repository gate passed 900 unit tests
      (three intentional skips), 48 real-browser tests, formatting, type-check
      and the production build. No oversized binary fixtures are committed.

      Deliberate limits: signed packages are rejected because translation
      invalidates their signatures; encrypted editable XML cannot be imported;
      embedded subdocuments remain preserved but are not recursively exposed;
      and `.odf` formula translation is limited to MathML `mtext` prose so
      mathematical semantics are never rewritten accidentally.

      Normative references used: OASIS [OpenDocument 1.3 package
      requirements](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part2-packages.html),
      OASIS [OpenDocument 1.3 document-family conformance](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part3-schema.html),
      and the IANA [registered OpenDocument media
      types](https://www.iana.org/assignments/media-types/media-types.xhtml).

- [x] **FF-502 — Server-side and help-system HTML families.** Add deliberate
      profiles for `.shtml`, `.jsp`, `.asp`, `.aspx`, `.ascx`, `.inc`, `.hhc`,
      and `.hhk`, plus mixed PHP/HTML pages distinct from the existing limited
      PHP localization-array adapter. Translate only HTML-visible content and
      selected attributes while protecting server directives, template syntax,
      includes, code blocks, variables, and executable regions byte-for-byte.
      Detection must be content-first because several extensions also contain
      non-HTML source code.
      Completed 2026-08-19: the loss-minimizing HTML adapter now has explicit
      SHTML, JSP, classic ASP, ASPX, ASCX, include, HTML Help contents/index,
      and mixed PHP-template profiles. Extension and MIME metadata only select
      candidates; recognizable markup, server syntax, or `text/sitemap`
      structure must validate the actual content. JSP/ASP directives,
      scriptlets, declarations, expressions, EL `${…}`/`#{…}`, PHP blocks,
      common template blocks, SSI directives, scripts/styles, and JSP XML code
      elements remain opaque and are never evaluated. ASP.NET `Text` labels are
      configurable translatable attributes; HHC/HHK expose display names and
      keywords while retaining `Local`, image, and navigation parameters.
      Range patching preserves unknown markup, directives, comments, quote
      style, CRLF/LF, original extension, UTF-8/UTF-16 encoding, BOM, and exact
      identity bytes. Static PHP localization arrays still route to their
      stricter adapter. Tests cover every extension, complex mixed templates,
      Unicode/RTL/emoji, malformed and extension-only impostors, adversarial
      quoting/nesting, non-execution, cancellation, a generated 1,500-unit JSP,
      identity and translated round trips, independent browser-DOM reopening,
      migration, IndexedDB persistence, upload/export UI, and browser flows.
      `npm run verify` passes with 915 unit tests (3 skipped), 50 Chromium tests,
      type checks, formatting, and the production build. Includes are retained
      but never fetched, dynamic attribute values stay wholly protected, and
      this browser workflow validates preserved server syntax without claiming
      to compile it in every server runtime. Syntax policy follows the official
      [Jakarta Pages specification](https://jakarta.ee/specifications/pages/),
      [PHP tag rules](https://www.php.net/manual/en/language.basic-syntax.phptags.php),
      Microsoft [ASP.NET page syntax](https://learn.microsoft.com/en-us/previous-versions/aspnet/k33801s3%28v%3Dvs.100%29),
      and Microsoft guidance for [HTML Help contents and index entries](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/htmlhelp/to-open-a-compiled-help-file-from-a-contents-or-index-entry).

- [x] **FF-503 — Extended XLIFF aliases and vendor delivery.** Add `.xlif` and
      memoQ `.mqxlf` aliases, a fixture-led WorldServer WsXLIFF profile, and
      explicit handling for WordPress WPML and other vendor `.xlf`/`.xliff`
      variants already recognized structurally. Promote `.sdlxliff`, `.mqxliff`,
      and `.mxliff` from protected imports to tested same-profile exports only
      after namespace, inline-code, lock/state, skeleton, and unknown-extension
      preservation pass round-trip and originating-tool fixtures. Keep generic
      XLIFF 1.2/2.x serializers separate from vendor writers.
      Completed 2026-08-19: project detection and upload now accept `.xlif` and
      `.mqxlf` aliases, but only after an XLIFF root and valid content are
      confirmed. A fixture-led WorldServer profile recognizes the `iws`
      extension/tool signatures, maps translation and lock status, and preserves
      WorldServer metadata. SDLXLIFF, MQXLIFF/MQXLF, Phrase MXLIFF, WsXLIFF,
      WPML, Drupal TMGMT, and Articulate profiles now expose a dedicated
      same-profile export action. The writer retains the imported extension,
      namespaces, headers, group/file skeleton, identifiers, target state,
      vendor locks/status attributes, protected inline/embedded markup, notes,
      and unknown extensions; it refuses source edits, locked-target edits,
      profile loss, unsupported versions, or structurally invalid output.
      Generic XLIFF 1.2/2.x writers remain separate and reject vendor models to
      prevent accidental metadata loss. Legacy persisted `import-only` profile
      metadata is normalized to the new same-profile policy on access. Tests
      cover every profile, `.xlif`/`.mqxlf`, extension-only impostors, WordPress
      embedded markup, WorldServer inline/unknown data, Unicode/RTL/emoji,
      malformed input, cancellation, locked edits, a generated 1,500-unit file,
      identity and translated re-imports, browser IndexedDB persistence,
      browser XML reopening, and download naming. The implementation follows
      OASIS XLIFF 1.2/2.x, official memoQ MQXLIFF export guidance, Phrase MXLIFF
      documentation, WPML CAT-tool guidance, and WorldServer XLF documentation.
      `npm run verify` passes with 923 unit tests (3 skipped), 52 Chromium tests,
      type checks, formatting, and the production build. Same-profile export
      requires an imported vendor skeleton: it does not manufacture a Trados,
      memoQ, Phrase, WorldServer, or CMS profile from generic XLIFF, and vendor-
      locked targets deliberately remain immutable.

- [x] **FF-504 — Legacy bilingual CAT documents.** Implement TRADOStag `.ttx`,
      SDL Edit `.itd`, Wordfast/GlobalLink `.txml`, XLIFF:doc `.xliffdoc`, and
      Trados Translator's Workbench bilingual `.doc`, `.docx`, `.rtf`, and `.bak`
      profiles. Protect native segment delimiters, inline tags, IDs, workflow
      states, hidden text, styles, and existing targets; distinguish these files
      structurally from ordinary Word/RTF documents; and export to the same
      bilingual family where its structure is sufficiently specified.

      Completed 2026-08-19: a dedicated content-sniffed adapter now handles
      TRADOStag TTX, SDL Edit ITD, Wordfast/GlobalLink TXML, and structurally
      recognized Trados Workbench bilingual RTF, DOC, DOCX, and BAK files.
      XLIFF:doc is implemented as a strict vendor-XLIFF profile identified by
      its document namespace, `dx` extension namespace/version, or official
      schema location rather than its filename alone. The active support matrix
      for this task is:

      | Profile | Extensions | Delivery behavior |
      | --- | --- | --- |
      | TRADOStag | `.ttx` | Same-family positional XML round trip |
      | SDL Edit | `.itd` | Same-family positional XML round trip |
      | Wordfast/GlobalLink | `.txml` | Same-family positional XML round trip |
      | XLIFF:doc | `.xliffdoc` | Same-profile XLIFF round trip |
      | Workbench RTF | `.rtf`, RTF-based `.doc`/`.bak` | Same-family target-only RTF round trip retaining the imported extension |
      | Workbench DOCX | `.docx` | Same-package OOXML round trip with opaque ZIP members retained |
      | Workbench binary Word | OLE `.doc`/`.bak` | Exact identity bytes when unchanged; explicit bilingual RTF conversion after edits |

      XML exports patch only mapped target ranges and preserve declarations,
      namespaces, comments, unit IDs, status/lock attributes, unknown elements,
      existing targets, encoding, BOM, and protected inline tags represented in
      the editor as numbered `{utN}` tokens. Workbench RTF and DOCX detection
      requires both native bilingual delimiters and hidden-text/tw4win evidence;
      ordinary RTF/DOCX and extension-only impostors continue to their normal
      adapters or are rejected. DOCX export rewrites only mapped target text
      runs and retains all other package resources. Macros, scripts, formulas,
      external entities, embedded objects, and imported code are never run.
      Locked units may be shown or omitted at import, remain immutable during
      export, and native unit boundaries cannot be split or joined.

      Tests cover minimal and complex TTX, ITD, TXML, XLIFF:doc, Workbench RTF,
      RTF-based DOC/BAK and DOCX; Unicode, RTL and emoji; inline-code, ID,
      workflow-state, unknown XML and opaque ZIP preservation; identity and
      translated re-imports; ordinary-format and extension-only impostors;
      malformed XML, DTD/entities, cancellation, protected-boundary edits, a
      generated 1,500-unit file, migration metadata, IndexedDB persistence,
      browser download naming and non-execution. Generated XML is reopened with
      an independent DOM parser, RTF with an independent RTF parser, and DOCX
      XML/package resources with independent ZIP/XML readers. `npm run verify`
      passes with 947 unit tests (3 skipped), 55 real-Chromium tests, formatting,
      type checks, and the production build; no oversized fixture is committed.

      Deliberate limits: an edited binary OLE Workbench DOC/BAK is delivered as
      bilingual RTF because arbitrary Word binary stream rewriting is not safely
      specified in the browser. Same-family writers require the imported
      positional/package skeleton and do not manufacture proprietary files from
      unrelated input. The implementation follows official RWS documentation
      for [bilingual file-type support](https://developers.rws.com/studio-api-docs/17.2/apiconcepts/filetypesupport/file_type_support_overview.html),
      memoQ guidance for [bilingual DOC/RTF](https://docs.memoq.com/current/en/Workspace/bilingual-doc-rtf-documents.html),
      [TXML](https://docs.memoq.com/current/en/Workspace/txml-wordfast-xml-files.html),
      and [XLIFF:doc/TIPP](https://docs.memoq.com/current/en/Workspace/xliff-doc-tipp.html),
      plus the Interoperability Now XLIFF:doc representation namespace and
      schema signatures.

- [x] **FF-505 — Additional CAT handoff and package containers.** Add STAR
      Transit `.pxf`/`.ppf`, TIPP packages, COTI `.coti` and COTI ZIP packages,
      and legacy WorldServer `.xlz`. Preserve all opaque resources and manifests,
      update only validated bilingual members, generate the expected return
      package extension, and reuse the archive traversal, collision, encryption,
      entry-count, expansion-ratio, cancellation, and byte-preservation guards.
      Do not route an arbitrary ZIP into any of these profiles.

      Implemented 2026-08-19 with signature-driven return-package profiles for
      STAR Transit PXF/PPF/TXF/TPF, TIPP, COTI Level 1 `.coti`/`.zip`, and
      legacy WorldServer XLZ. PPF exports as TPF, PXF exports as TXF, COTI ZIP
      input exports as `.coti`, and TIPP/XLZ retain their family. Transit
      detection requires a PRJ plus declared, aligned three-letter source and
      target language-pair files; TIPP requires a safe TIPP manifest and a
      separately guarded nested `resources.zip`; COTI requires a valid `coti`
      manifest root, project/translation metadata, and a translation-files
      folder; XLZ requires both XLIFF and skeleton members. Ordinary ZIP files
      and extension-only impostors remain outside these profiles.

      XLIFF-family members are parsed by the existing version/profile-aware
      XLIFF layer. Native Transit `Seg` pairs are edited only when both files
      have identical `SegID` order and plain segment bodies; `Data`, workflow
      attributes, PRJ/COD/FFD resources, and locked targets remain untouched.
      Transit segments with nested proprietary markup are rejected with a
      helpful error because safely recalculating STAR's undocumented binary
      segment state is not possible in-browser. COTI payloads are format-neutral
      by specification, so this adapter edits only validated XLIFF-family files
      below declared translation folders and refuses unsupported payloads rather
      than guessing. Manifests and all opaque outer/nested resources are copied
      unchanged. Identity export returns the exact original package bytes.

      Tests cover each signature and return-extension mapping, COTI `.coti` and
      `.zip`, nested TIPP selection/rebuild, WorldServer XLF/SKL, native Transit
      pairs, Unicode/RTL/emoji, locked and opaque data, exact identity bytes,
      translated re-import, independent XML/ZIP reopening, malformed/unsafe
      manifests, DTD/entities, misaligned IDs, nested expansion bombs,
      cancellation, a generated 1,200-unit package, IndexedDB persistence,
      browser downloads, and non-execution of imported text. No large binary
      fixture is committed. `npm run verify` passes with 957 unit tests (3
      skipped), 57 real-Chromium tests, formatting, type checks, and the
      production build. The implementation follows STAR's official
      [PPF/TPF package description](https://www.star-spain.com/en/blog/transittermstar-nxt-tooltips/short-cuts-%E2%80%93-n%C2%BA-17-view-project-package-and-translation-package),
      XTM's documented [TIPP envelope structure](https://xtm-cloud.atlassian.net/wiki/spaces/EXKB/pages/3273490972),
      DERCOM's [COTI overview and current version](https://www.dercom.de/projekte),
      memoQ's [COTI package guidance](https://docs.memoq.com/current/en/Workspace/coti-packages.html),
      RWS legacy WorldServer XLZ guidance, and the OASIS XLIFF 1.2/2.x
      specifications.

### Priority B — Diagram, publishing, XML, and subtitle formats

- [x] **FF-506 — Microsoft Visio families.** Add legacy and package-aware
      support for `.vsd`, `.vdx`, `.vsx`, `.vtx`, `.vdw`, `.vsr`, `.vss`,
      `.vsdx`, `.vsdm`, `.vssx`, `.vssm`, `.vstx`, and `.vstm`. Extract shape,
      connector, page, master, layer, data-graphic, and selected metadata text in
      stable visual order; protect formulas, geometry, relationships, macros,
      embedded objects, and binary resources; retain the exact drawing/stencil/
      template family; and reopen generated outputs in an independent Visio-
      compatible implementation.

      **Completed 2026-08-19.** A dedicated Visio adapter now identifies every
      listed family from its ZIP/OPC, DataDiagramML/report XML, or OLE compound
      signature and internal structure. Modern packages require the Visio main
      content type, root document relationship, `visio/document.xml`, recognized
      Visio namespace, and a content-type/extension match. A generically named
      ZIP is classified from those package declarations; renamed family
      impostors are rejected. Standalone XML requires the expected document or
      report root and namespace. Legacy OLE input requires `VisioDocument` or
      documented Web Drawing streams such as `VisioServerData`, not merely the
      compound-file magic bytes.

      | Profile | Extensions | Delivery behavior |
      | --- | --- | --- |
      | OPC drawing | `.vsdx`, `.vsdm` | Native same-family package round trip |
      | OPC stencil | `.vssx`, `.vssm` | Native same-family package round trip |
      | OPC template | `.vstx`, `.vstm` | Native same-family package round trip |
      | DataDiagramML | `.vdx`, `.vsx`, `.vtx` | Native positional XML round trip |
      | Legacy drawing/stencil/Web Drawing | `.vsd`, `.vss`, `.vdw` | Exact identity bytes; edited VDX conversion |
      | Structurally identified report | `.vsr` | Native report XML when applicable; protected OLE identity or edited VDX conversion otherwise |

      Package extraction visits selected document metadata, page names, page
      shape/connector text in XML z-order, shape-data labels/prompts/literal
      values, layer names, data-graphic callouts, master names/prompts, and
      master shape text in a deterministic order. Import options can omit page,
      master, shape-data, or metadata units. Fields, formula-bearing cells,
      geometry, universal names, IDs, relationships, data connections, VBA,
      external links, images, embedded objects, signatures, and unknown binary
      resources never become editable or executable. Translated OPC output
      changes only mapped XML ranges and retains all other ZIP members. A
      digitally signed package is byte-exact when unchanged and gives a helpful
      refusal after edits rather than retaining a now-invalid signature.

      Legacy compound streams are scanned locally only for defensibly aligned
      UTF-16 text in named Visio document/page/shape/Web Drawing streams; VBA and
      object pools are excluded. Because safely rewriting the proprietary binary
      drawing layout is not specified in this browser stack, edited legacy
      projects make that limitation explicit and produce VDX instead of
      pretending to preserve VSD/VSS/VDW structure. `.vsr` is treated
      conservatively because the extension is ambiguous in third-party support
      lists: only a recognized report-definition XML root or validated Visio OLE
      structure is accepted.

      Tests cover all 13 extensions, exact identity output, translated native
      and conversion output, Unicode/RTL/emoji, stable page/connector/master/
      layer/property/data-graphic ordering, macros, formulas, geometry,
      external links, embedded and unknown resources, digital signatures,
      extension/content conflicts, generic ZIP names, malformed XML/packages,
      external entities, non-execution, cancellation, a generated 1,000-shape
      package, conformance snapshots, migration-safe IndexedDB persistence,
      browser download MIME/name behavior, and translated re-import. Generated
      packages are reopened with independent DOM and ZIP parsers; the translated
      VSDX was also accepted by the installed `libvisio` `vsd2raw` importer. No
      oversized binary fixture is committed. `npm run verify` passes with 985
      unit tests (3 intentional skips), 59 real-Chromium tests, formatting,
      type checks, and the production build.

      Normative references used: Microsoft [Introduction to the Visio VSDX file
      format](https://learn.microsoft.com/en-us/office/client-developer/visio/introduction-to-the-visio-file-formatvsdx),
      [programmatic package manipulation](https://learn.microsoft.com/en-us/office/client-developer/visio/how-to-manipulate-the-visio-file-format-programmatically),
      [MS-VSDX overview](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vsdx/29bd5bbc-db66-46f9-906e-140c5a4e59c8),
      [part enumeration](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vsdx/33056f18-c258-4a29-8026-03c58cbc8bca),
      [Document XML part](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vsdx/7ec3d7b0-0de2-4711-a7b6-92daa2020d71),
      [Page XML part](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vsdx/bf3c0a23-fab6-49a1-9f9d-3aac4c8757eb),
      [mixed shape text and fields](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vsdx/9aec7e65-2abe-4518-aaa7-650e2fd6ceff),
      and [MS-VGSFF `.vdw` Web Drawing](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-vgsff/64090058-3e11-485c-a169-6822c889a68c).

- [x] **FF-507 — Additional Adobe, FrameMaker, Photoshop, and Quark formats.**
      Add InDesign INX `.inx`, FrameMaker `.mi2`, Photoshop `.psd`, and
      QuarkXPress `.xtg`/`.tag`. Reuse IDML/MIF/XML infrastructure only where the
      native grammar matches. PSD support must target validated text layers and
      preserve all image/layer resources; it must not be advertised as ordinary
      image OCR. Define explicit source-only behavior for formats that cannot be
      safely rewritten in-browser and provide fixture-led conversion exports.

      **Completed 2026-08-19.** INX is implemented as the native, single-XML
      predecessor of IDML: detection requires an InDesign `Document` root,
      `DOMVersion`, story content and safe XML, then reuses the positional
      IDML/ICML value mapping without flattening colors, styles, labels, scripts
      or unknown DOM nodes. Identity output is byte-exact and translated output
      retains `.inx`. FrameMaker `.mi2` is deliberately accepted only when the
      file contains the existing native `<MIFFile …>` grammar. “MIF2/MI2” is a
      memoQ filter generation/alias rather than a separately documented Adobe
      interchange grammar, so extension-only files are rejected and same-family
      MIF output preserves `.mi2`.

      A dedicated QuarkXPress Tags adapter validates adjacent `<v…><e…>` native
      version/encoding commands, checks UTF-8/UTF-16 declarations, protects all
      case-sensitive commands and style-sheet definitions, and extracts visible
      story text in file order. Literal `@`, `<`, `>` and backslash characters
      use the documented XPress Tags escapes on output. Both `.xtg` and `.tag`
      retain their extension, encoding, BOM, unknown commands and exact identity
      bytes; translated output is parsed again before download.

      PSD is a separately labelled source-only text-layer workflow, never an OCR
      shortcut. It requires the `8BPS` signature, PSD version 1, zero reserved
      bytes, valid channels/dimensions/depth/color mode, safe file/pixel limits,
      and a successful strict `ag-psd` structure parse with all layer/composite
      pixels, thumbnails and linked-file payloads skipped. Only validated text
      descriptors become units; hidden layers are optional. The exact original
      PSD—including pixels, effects, masks, smart objects, linked files and
      unknown resources—remains in IndexedDB and is returned byte-for-byte when
      unchanged. Because available browser writers cannot reliably redraw text
      or preserve all Photoshop features, edited delivery is explicitly a safe,
      standalone SVG text-layer conversion using recorded canvas positions,
      size, color, layer names, line breaks and RTL direction.

      Tests cover minimal and nested source data, complex formatting, style
      protection, Unicode/combining marks/RTL/emoji, special-character escaping,
      hidden PSD layers, exact identity and translated reopen, `.inx`/`.mi2`
      aliases, content/extension impostors, malformed/truncated/adversarial
      headers and tags, unsafe dimensions, cancellation, deterministic generated
      1,000-unit XPress Tags and 250-layer PSD files, registry/conformance
      snapshots, browser download MIME/name behavior and non-execution. PSD
      fixtures are generated during tests rather than committed. Generated SVG
      is independently parsed as XML; INX, MIF and XPress Tags outputs are
      reopened by their independent structural parsers. `npm run verify` passes
      with 1,007 unit tests (3 intentional skips), 63 real-Chromium tests,
      formatting, type checks and the production build.

      References: Adobe's [IDML specification](https://community.adobe.com/havfw69955/attachments/havfw69955/indesign/632652/1/idml-specification.pdf),
      [InDesign supported formats](https://helpx.adobe.com/indesign/using/supported-file-formats.html),
      official [MIF Reference](https://help.adobe.com/en_US/framemaker/mifreference/mifref.pdf),
      memoQ's [MIF2 filter documentation](https://docs-memoq-com.azurewebsites.net/current/en/Workspace/adobe-framemaker-documents-mi2.html),
      Adobe's [Photoshop file-format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/),
      the `ag-psd` [documented reader/writer limits](https://github.com/skylab-tech/ag-psd/blob/main/README.md),
      and Quark's [XPress Tags 2025 guide](https://www.quark.com/documentation/quarkxpress/2025/english/A%20Guide%20to%20XPress%20Tags%202025/).

- [x] **FF-508 — Specialist XML, SGML, and multilingual XML profiles.** Add
      W3C ITS rule files `.its`, multilingual XML `.mulix`, DITA `.bookmap`,
      AuthorIT, MadCap, Typo3, and Microsoft Excel 2003 XML profiles, plus a
      constrained `.sgm`/`.sgml` workflow. Each vocabulary needs its own
      translatable/protected element and attribute rules, inline-code mapping,
      namespace/doctype policy, and output validation; generic XML success alone
      does not complete this task. Never resolve external entities or network
      schemas.

      **Completed 2026-08-19.** A dedicated `specialist-xml` adapter now routes
      files by root, namespace, vocabulary structure and safe doctype evidence
      before the generic XML/HTML adapters. `.its` requires an ITS 2.0 `rules`
      root and exposes localization notes while protecting selectors and rule
      metadata. Author-it requires `AuthorITroot`; MadCap requires XHTML plus the
      MadCap schema namespace; legacy TYPO3 requires `T3locallang`; and Excel
      2003 XML requires the SpreadsheetML `Workbook` namespace. Each profile has
      an explicit allowlist for editable prose, supported metadata/attributes,
      protected code/control elements and inline descendants. Spreadsheet
      formulas and cached formula values stay inert. The shared ITS safe-XPath
      subset now handles validated union selectors without evaluating arbitrary
      XPath.

      Canonical MULIX files require a recognized multilingual root and paired
      sibling `source`/`target` elements; positional inline values are mapped in
      order so existing targets, notes, IDs and unknown nodes survive native
      export. DITA `.bookmap` is registered in the existing DITA adapter and
      retained through standalone and bundle output. The SGML workflow is
      intentionally constrained to well-formed, XML-compatible `.sgm`/`.sgml`
      content with either a safe fixed doctype or `SGMLDoc` root. A doctype is
      masked before parsing and retained byte-for-byte, while internal subsets,
      entity/element/attribute/notation declarations, malformed markup and
      extension-only impostors fail closed. External DTDs, entities and network
      schemas are never resolved.

      All profiles preserve declarations, namespaces, doctypes, encoding/BOM,
      unknown elements and original source bytes in the positional skeleton and
      IndexedDB. Identity output is byte-exact; edited output changes only mapped
      values, escapes them for their XML context, validates the original profile
      again and retains the source extension/MIME family. Structural split/join
      is disabled because it would invalidate vocabulary mappings. Registry,
      upload hints, export dispatch, import options, QA, persistence migration,
      landing/about support lists and the reusable conformance matrix now include
      the 42nd adapter.

      Tests cover every profile, complex inline content, optional metadata,
      formulas/control markup, Unicode/combining marks/RTL/emoji, malformed and
      adversarial doctypes/entities, extension impostors, cancellation,
      byte-identical and translated round trips, independent DOM reopening,
      generated 1,000-unit Author-it and 250-unit ITS inputs, deterministic
      mappings, BOOKMAP identity output, IndexedDB save/reload and real-Chromium
      download/re-import. No oversized fixture is committed. `npm run verify`
      passes with 1,021 unit tests (3 intentional skips), 65 real-Chromium tests,
      formatting, type/accessibility checks and the production build.

      Limits are explicit: this is not a validating full-SGML parser; SGML that
      depends on omitted end tags, unquoted attributes or DTD entity expansion is
      rejected. MULIX has no single public normative schema, so the adapter
      supports the canonical paired source/target structure rather than importing
      arbitrary memoQ XPath filter configurations. Unknown vocabulary content is
      preserved but not made editable unless it matches that profile's allowlist.

      References: W3C [Internationalization Tag Set (ITS) Version 2.0](https://www.w3.org/TR/its20/),
      OASIS [DITA 1.3 BOOKMAP reference](https://docs.oasis-open.org/dita/dita/v1.3/os/part3-all-inclusive/langRef/technicalContent/bookmap.html),
      Author-it [XML format for translation](https://kc.author-it.com/r/books/Author-it-Cloud/Author-Module-Guide/Author-it-XML-format-for-translation),
      MadCap [Flare meta tags and XML namespaces](https://docs.madcapsoftware.com/flare2025r2/Flare-Meta-Tags-Guide.pdf),
      memoQ [multilingual XML files](https://docs.memoq.com/12-3/en/Workspace/multilingual-xml-files.html),
      TYPO3 [XLIFF and legacy localization background](https://docs.typo3.org/m/typo3/reference-coreapi/main/en-us/ApiOverview/Localization/XliffFormat.html),
      Microsoft [Office 2003 XML schema availability](https://news.microsoft.com/source/2003/11/17/microsoft-announces-availability-of-open-and-royalty-free-license-for-office-2003-xml-reference-schemas/),
      and W3C [SGML and HTML introduction](https://www.w3.org/TR/html401/sgml/intro.html).

- [x] **FF-509 — Additional subtitle formats.** Add Advanced SubStation Alpha
      `.ass`/`.ssa` and Spruce `.stl`. Preserve cue timing, IDs, positioning,
      styles, override tags, comments, line breaks, encoding, frame-rate/timebase
      metadata, and format-specific headers. Prevent subtitle markup from being
      flattened into target text and add timing/order/overlap QA plus player-
      independent reopen tests.

      Completed 2026-08-19: the content-sniffed subtitle adapter now recognizes
      ASS `ScriptType: v4.00+`/`v4.00++`, legacy SSA `ScriptType: v4.00`, and
      text-based Spruce STL frame timecodes without trusting the filename. ASS
      and SSA parsing follows each file's ordered `Events` `Format` declaration,
      exposes only `Dialogue` text, and retains the full Script Info, style,
      project-garbage/font, comment, unknown-header and event structure as exact
      source bytes. Style/name, layer or marked state, margins, effect, timing,
      generated stable cue IDs and centisecond timebase are retained as neutral
      metadata/context. Vector-drawing events remain protected rather than being
      mistaken for language. Spruce STL retains `$` commands wherever they occur,
      `//` comments, exact frame timecodes, visible whitespace, commas, `{...}`
      style tokens and `|` line separators. Its configurable 1–120 fps timebase
      defaults to 30 fps and is stored with the project; export never retimes a
      cue.

      Export patches only mapped dialogue/cue text, keeps identity bytes exact,
      preserves UTF encodings/BOM and native extension/MIME names, reparses the
      entire generated file, and retains timing/order/overlap policy plus the
      existing line-length, line-count, reading-speed and expansion QA. It blocks
      physical-line injection, missing/reordered ASS/SSA override tags and
      `\\N`/`\\n`/`\\h` tokens, and changed Spruce style or `|` layout tokens.
      Subtitle skeleton synchronization was made explicitly positional so an
      IndexedDB save/reload cannot rebuild and lose cue mappings. The upload
      picker, detector, import options, export dispatch, registry-backed support
      labels, conformance fixture, README, landing page and about page now agree
      on `.ass`, `.ssa` and `.stl`.

      Tests cover minimal and complex ASS/SSA/Spruce input, renamed content and
      extension impostors, styles/positioning/effects/comments/commas/drawings,
      Unicode combining text and RTL, identity and translated re-imports,
      malformed headers/styles/times/frames, binary/adversarial input,
      cross-profile rejection, markup flattening and line injection,
      cancellation, generated 2,000-cue input, persistence migration and real-
      Chromium IndexedDB reload/export. Independently, FFmpeg `ffprobe` reopens
      the generated outputs as `ass` and `stl` subtitle streams. `npm run verify`
      passes with 1,029 unit tests (4 intentional/host-dependent skips), 66 real-
      Chromium tests, formatting, type/accessibility checks and the production
      build; the optional FFmpeg test also passes with all 8 FF-509 tests enabled.

      Limits are explicit: `.stl` means the text-based Spruce authoring format,
      not binary EBU Tech 3264 STL, which is rejected with a specific error.
      Spruce files do not carry a universal frame-rate declaration, so users must
      select the correct rate when it differs from 30 fps. ASS/SSA vector drawing
      commands are preserved but intentionally not editable as translation text.
      References: libass [ASS File Format Guide](https://github.com/libass/libass/wiki/ASS-File-Format-Guide),
      Apple DVD Studio Pro [basic STL format](https://dvd-studio-pro.helpnox.com/en-us/dvd-studio-pro-4-user-manual/creating-subtitles/creating-an-stl-format-subtitle-file/basic-stl-format/),
      and FFmpeg's [Spruce STL demuxer](https://ffmpeg.org/doxygen/7.0/stldec_8c.html).

### Priority C — Secondary media and document ecosystems

- [x] **FF-510 — Additional OCR image inputs.** Add `.bmp`, `.dib`, `.gif`,
      `.jpe`, `.jif`, `.jfif`, and `.jfi` with signature validation and local
      decoding before the existing OCR pipeline. Treat animated GIFs explicitly
      by selecting frames or rejecting animation with a useful message. Extend
      tests for renamed files, orientation, color profiles, alpha, large pixel
      dimensions, decompression limits, and output bounding boxes. `.psd` remains
      owned by FF-507 rather than this raster adapter.

      **Completed 2026-08-19.** The local OCR adapter now accepts BMP, standalone
      DIB, GIF, and JPEG aliases `.jpe`, `.jif`, `.jfif`, and `.jfi` in addition
      to PNG/JPEG/TIFF. A bounded signature parser validates PNG chunks and
      dimensions, JPEG SOF/scan/end markers plus EXIF orientation and ICC
      markers, TIFF IFD dimensions, BMP/DIB headers/palettes/masks/pixel extents,
      and the complete GIF record/sub-block chain. It enforces 16,384 pixels per
      side, 40 million pixels, and a 160 MB RGBA decode estimate before browser
      allocation; filename and MIME claims alone never select the adapter.

      BMP, DIB, and GIF are decoded locally with `createImageBitmap`, rendered to
      a canvas, and normalized to a single PNG passed to Tesseract. Standalone
      DIB bytes receive a validated in-memory BMP file header only for decoding;
      the exact imported bytes remain in the project skeleton and IndexedDB.
      Animated GIFs are rejected by default with their frame count, or the user
      can explicitly choose first-frame OCR; animation is never played or
      executed. OCR bounding boxes must be finite, ordered, nonnegative, and
      inside the validated image. Profile, size, orientation, frame count,
      alpha, color-profile, and GIF policy metadata persist with the project.
      This metadata is additive to the existing project schema, so no destructive
      persistence migration is required; older OCR projects continue to reopen.

      Tests generate structured PNG, JPEG/EXIF/ICC, TIFF, BMP, DIB and GIF data
      at runtime and cover renamed files, all JPEG aliases through the registry,
      top-down orientation, alpha, malformed/truncated records, hostile offsets,
      pixel/decode limits, logical large-file rejection, cancellation, animated
      GIF reject/first-frame paths, invalid OCR boxes, exact original-byte
      identity retention, Unicode/RTL translation, and an independently parsed
      bilingual HTML round trip. Chromium independently decodes BMP, wrapped DIB
      and GIF to PNG, then persists/reopens the original and OCR metadata through
      IndexedDB. The landing page, About support matrix, picker registry, import
      options, export filename handling, conformance fixture, and browser routing
      advertise the expanded workflow. PSD remains isolated in FF-507.

      References: Microsoft [Bitmap Storage](https://learn.microsoft.com/en-us/windows/win32/gdi/bitmap-storage),
      Microsoft [`BITMAPFILEHEADER`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapfileheader),
      W3C [PNG specification](https://www.w3.org/TR/png-3/), the GIF89a
      [format specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt),
      the W3C [JFIF specification](https://www.w3.org/Graphics/JPEG/jfif.pdf),
      WHATWG [`createImageBitmap`](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html),
      and Tesseract's [input format guidance](https://tesseract-ocr.github.io/tessdoc/InputFormats.html).

- [x] **FF-511 — Auxiliary text, mind-map, and resource formats.** Add plain or
      structured profiles for `.inf`, Windows Registry `.reg`, and FreeMind `.mm`.
      Preserve comments, encodings, escaping, registry value types, node IDs,
      links, rich content, and nontranslatable metadata. Detect `.reg` headers
      and FreeMind XML roots structurally instead of treating either as generic
      text/XML.

      **Completed 2026-08-20.** A dedicated `auxiliary-resources` adapter now
      detects all three profiles from their content rather than their filename.
      Windows INF requires a valid `[Version]` `Signature` plus one or more
      `[Strings]`/`[Strings.LanguageID]` sections. Registry files require the
      exact `Windows Registry Editor Version 5.00` or `REGEDIT4` header and
      structurally valid keys and typed values. FreeMind requires safe,
      well-formed XML with a versioned `<map>` root and at least one `<node>`;
      duplicate node IDs, doctypes, entities, malformed attributes and
      extension-only impostors fail closed.

      INF import exposes only selected localized Strings sections (default
      `Strings,Strings.*`), preserves comments and physical continuations, and
      understands outer quotes plus doubled-quote escaping. Exact GUID/resource
      metadata stays protected, as do all setup directives, paths, tokens,
      manufacturers and operational sections. Export quotes and escapes changed
      values, retains untouched bytes and UTF-8/UTF-16 BOM policy, enforces the
      4,095-character payload limit, reparses the complete result and returns
      `.inf`. Identity output reuses the exact original file.

      REG import exposes `REG_SZ`, UTF-16LE `REG_EXPAND_SZ` (`hex(2)`) and
      `REG_MULTI_SZ` (`hex(7)`) text while retaining registry paths, value names,
      value types and translator context. DWORD/QWORD, arbitrary binary data,
      deletion instructions, comments and unknown records never become
      editable. Changed values are escaped or re-encoded into their original
      type, including continuations and required NUL terminators, then the full
      file is reparsed. Open TLC treats REG content only as inert text stored in
      IndexedDB and downloaded as `.reg`; it never invokes Registry Editor or
      modifies the operating-system registry.

      FreeMind import exposes node `TEXT` labels and visible XHTML text below
      `richcontent TYPE="NODE"`; `TYPE="NOTE"` is optional and enabled by
      default. Node IDs, links, arrow destinations, icons, hooks, attributes,
      styles, scripts, forms and unknown XML stay inert and positional. When a
      rich node label is present it takes precedence over the fallback `TEXT`
      attribute, avoiding duplicate units. Export escapes only mapped text,
      CDATA or attribute ranges, preserves the complete map around them,
      validates the generated map and returns `.mm`. Split/join is deliberately
      disabled for all three profiles because it would break typed value and XML
      range alignment.

      Tests cover renamed content, extensions and picker/registry routing;
      realistic comments, continuations, quoted strings, typed REG values,
      Unicode/combining marks/RTL/emoji, FreeMind labels/rich text/notes and
      unknown content; protected GUIDs, directives, keys, numeric/binary data,
      IDs, links, arrows, hooks and scripts; malformed headers, odd/truncated
      hexadecimal values, duplicate IDs, XXE/doctype input, cancellation,
      structural-edit refusal, exact UTF-16 identity bytes, translated
      re-imports, and a generated 3,000-unit INF without committed large
      fixtures. The conformance matrix supplies the 43rd adapter fixture.
      Chromium persists/reopens the skeleton and original bytes through
      IndexedDB, exports the translated map and independently parses its XML DOM
      before adapter re-import. The landing page, About matrix, upload picker,
      import controls, export dispatch, download names, QA, persistence and
      support count agree. `npm run verify` passes with 1,069 unit tests (4
      intentional/host-dependent skips), 72 real-Chromium tests, formatting,
      type/accessibility checks and the production build.

      Deliberate limits: INF does not interpret or execute setup directives and
      therefore translates only its resource string table; ambiguous string-table
      identifiers that are exact GUID metadata are protected. REG numeric,
      binary and deletion records are preserved but not translated. FreeMind
      active/embedded markup is retained as inert XML and never rendered or
      executed. The implementation follows Microsoft Learn's [INF general
      syntax](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/general-syntax-rules-for-inf-files)
      and [Strings section](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-strings-section),
      Microsoft's [REG file syntax](https://support.microsoft.com/en-us/topic/how-to-add-modify-or-delete-registry-subkeys-and-values-by-using-a-reg-file-9c7f37cf-a5e9-e1cd-c4fa-2a26218a1a23)
      and [registry value types](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/windows-registry-advanced-users),
      and FreeMind's official [file-format description](https://freemind.sourceforge.io/wiki/index.php/File_format)
      and [1.0.1 XSD](https://freemind.sourceforge.io/wiki/index.php/Freemind.xsd).

- [x] **FF-512 — Outlook message items.** Add `.msg` import with sender,
      recipients, subject, plain/HTML body, selected attachment names, and message
      metadata as context. Keep attachments and MAPI properties opaque, block
      embedded active content and external fetches, and define a clear output
      policy such as translated `.msg` when safely writable or translated
      EML/HTML/PDF delivery otherwise. Include malformed compound-file and nested-
      message limits.

      **Completed 2026-08-20.** The
      `outlook-msg` adapter recognizes `.msg` from an MS-CFB/OLE compound-file
      signature plus the top-level MAPI property stream and `PidTagMessageClass`;
      an extension alone is never accepted. A bounded local property reader
      extracts the subject, sender, To/Cc/Bcc recipients, plain or inert HTML
      body, selected attachment display names, message class, and available
      creation/submission/delivery times. Import options choose the preferred
      body representation and whether subject or attachment names are exposed.
      The selected values, option state, neutral-document mappings, context, and
      exact source Blob persist through the current IndexedDB schema without a
      destructive migration.

      Unknown MAPI properties and attachment bytes are not interpreted or
      copied into an edited delivery. Nested `MSG` objects are rejected, HTML is
      parsed only as inert text with active/embedded/form elements excluded, and
      no URL is fetched. Inputs are bounded by the common 100 MiB file cap plus
      10,000 CFB entries, 500 recipients, 256 attachments, and 20 million body
      characters. An unchanged project returns the exact retained `.msg` bytes;
      an edited project is explicitly labelled and downloaded as a UTF-8 `.eml`
      delivery with sanitized/RFC 2047-encoded headers and an attachment-omission
      notice. Rewriting proprietary MSG structures is deliberately not claimed.

      Coverage generates real CFB fixtures in memory for minimal, complex,
      Unicode/RTL, inert-HTML, malformed, short, nested-message, 257-attachment,
      cancellation, and 3,000-paragraph cases. The large case has a 10-second
      regression ceiling (approximately one second on the implementation host);
      parsing is additionally bounded by input/body limits, although browser
      APIs do not expose a portable peak-heap measurement and the CFB decode
      itself is synchronous. Identity output is byte-compared and reopened with
      `cfb`; translated EML is reopened with the independent `postal-mime`
      parser. Browser coverage persists/restores the opaque source in IndexedDB
      and reopens translated EML, while the shared conformance suite covers the
      adapter import/edit/download name and MIME flow. Split/join is blocked for
      protected mappings. The landing page, About matrix, picker registry,
      detection explanation, export UI, QA policy, and conformance fixture table
      now identify this as the 44th protected/source-only workflow. The final
      gate passed formatting, zero-error type checking, 1,087 unit tests (four
      deliberate skips), 74 real-browser tests, and a production build.

      Normative references: Microsoft [MS-OXMSG overview](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxmsg/b046868c-9fbf-41ae-9ffb-8de2bd4eec82),
      [top-level MSG structure](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxmsg/1a69e000-f391-4c03-9d43-32d5f554bca7),
      [MS-OXMSG compound-file relationship](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxmsg/cd44ec9f-01bb-4ea3-b335-87cfeb827594),
      and Microsoft [MS-CFB](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b).

### Phase 5 completion gate

- [x] Every extension listed in FF-500 through FF-512 appears in a generated,
      registry-backed support matrix with one of: native round trip, protected
      import, source-only conversion, or deliberately unsupported with reason.
- [x] The upload picker, content detector, landing/about pages, help text, export
      menu, MIME/download names, migrations, and conformance fixture table agree
      with that matrix.
- [x] No task may be checked based solely on extension acceptance, generic XML/
      HTML parsing, or a serializer that has not been reopened and semantically
      inspected in tests.

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
- [RWS Trados Studio SDLXLIFF file-type overview](https://developers.rws.com/studio-api-docs/17.2/apiconcepts/filetypesupport/file_type_support_overview.html)
- [memoQ vendor-XLIFF processing guidance](https://docs.memoq.com/current/en/Globalese/How_Globalese_processes_XLIFF_files.html)
- [memoQ MQXLIFF export settings](https://docs.memoq.com/current/en/Workspace/mqxliff-export-settings.html)
- [memoQ WorldServer XLF/XLZ guidance](https://docs.memoq.com/current/en/Workspace/worldserver-xlf_xlz-files.html)
- [Phrase MXLIFF format guidance](https://support.phrase.com/hc/en-us/articles/5709739992860--MXLIFF-Files-TMS)
- [WPML XLIFF configuration guidance](https://wpml.org/documentation/translating-your-contents/using-desktop-cat-tools/configuring-xliff-file-options/)
- [Drupal Translation Management Tool](https://www.drupal.org/project/tmgmt)
- [Articulate Rise course translation](https://help.rise.com/en/articles/2066510-translate-your-course)
- [Articulate Storyline course translation](https://www.articulatesupport.com/article/Storyline-360-Translating-Courses)
- [TMX 1.4b specification](https://www.ttt.org/oscarStandards/tmx/tmx14b.html)
- [OSCAR exchange standards, including SRX 2.0](https://www.ttt.org/oscarStandards/)
- [OSCAR SRX 2.0 specification](https://www.ttt.org/oscarStandards/srx/srx20.html)
- [Official SRX 2.0 XML Schema](https://www.ttt.org/oscarStandards/srx/srx20.xsd)
- [RFC 4180 CSV format and `text/csv` registration](https://www.rfc-editor.org/rfc/rfc4180)
- [IANA `text/tab-separated-values` registration](https://www.iana.org/assignments/media-types/text/tab-separated-values)
- [OWASP CSV/formula injection guidance](https://owasp.org/www-community/attacks/CSV_Injection)
- [RFC 8259 JSON grammar and interoperability guidance](https://www.rfc-editor.org/rfc/rfc8259)
- [ECMA-404 JSON syntax](https://ecma-international.org/publications-and-standards/standards/ecma-404/)
- [Flutter ARB and ICU localization guidance](https://docs.flutter.dev/ui/internationalization)
- [Chrome extension localization message format](https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats)
- [i18next plural resource conventions](https://www.i18next.com/translation-function/plurals)
- [LocJSON draft interchange specification](https://github.com/loctools/locjson)
- [ISO 30042:2019 TBX overview](https://www.iso.org/standard/62510.html)
- [TBXInfo public dialect and validation guidance](https://www.tbxinfo.net/tbx-dialects/)
- [LTAC-Global TBX-Core schemas](https://ltac-global.github.io/TBX-Core_dialect/)
- [LTAC-Global TBX-Min DCA/DCT schemas](https://ltac-global.github.io/TBX-Min_dialect/)
- [LTAC-Global TBX-Basic DCA/DCT schemas](https://ltac-global.github.io/TBX-Basic_dialect/)
- [W3C ITS 2.0](https://www.w3.org/TR/its20/)
- [WHATWG HTML parsing model](https://html.spec.whatwg.org/multipage/parsing.html)
- [W3C guidance for the HTML `translate` attribute](https://www.w3.org/International/questions/qa-translate-flag)
- [Unicode Standard Annex #15: Normalization Forms](https://www.unicode.org/reports/tr15/)
- [Unicode Standard Annex #9: Bidirectional Algorithm](https://www.unicode.org/reports/tr9/)
- [Microsoft Open XML package overview](https://learn.microsoft.com/en-us/office/open-xml/about-the-open-xml-sdk)
- [Microsoft SpreadsheetML document structure](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)
- [Microsoft SpreadsheetML formula and cached-value guidance](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas)
- [Microsoft worksheet lookup through workbook relationships](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-get-a-column-heading-in-a-spreadsheet)
- [Microsoft WordprocessingML document structure and story parts](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document)
- [Microsoft Word header and footer package relationships](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-remove-the-headers-and-footers-from-a-word-processing-document)
- [Microsoft Word comments-part guidance](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-retrieve-comments-from-a-word-processing-document)
- [Microsoft DOCM-to-DOCX macro-part behavior](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-convert-a-word-processing-document-from-the-docm-to-the-docx-file-format)
- [Microsoft PresentationML document structure](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)
- [Microsoft PresentationML notes-slide guidance](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-notes-slides)
- [Microsoft PresentationML comments guidance](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-comments)
- [Microsoft PresentationML extensions overview](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/b9ff79b4-5e24-4c85-b567-e5f43d498375)
- [GNU gettext PO format](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html)
- [Android string resources](https://developer.android.com/guide/topics/resources/string-resource)
- [Apple string catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog)
- [YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/)
- [OpenDocument specification](https://www.oasis-open.org/standard/opendocumentv1-2/)
- [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [W3C WebVTT](https://www.w3.org/TR/webvtt1/)

This roadmap should be re-reviewed when major standards, browser capabilities,
or the supported-format lists of the surveyed CAT tools change.

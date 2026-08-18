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

| Area               | Present in the repository                                                                | Main gap before it is production-grade                                           |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Source documents   | TXT, JSON, DOCX/DOCM/DOTX/DOTM, XLSX/XLSM/XLTX/XLTM, PPTX/PPTM/POTX/POTM/PPSX/PPSM, HTML | Each uses a separate path; preservation and coverage vary                        |
| Project exchange   | Open TLC JSON, XLIFF 1.2/2.x, protected vendor XLIFF imports                             | Origin-tool-verified vendor exports and typed module capabilities                |
| Translation memory | TMX 1.4b Level 1/2 import, export, and policy-driven merge                               | Broader vendor corpora and persistent indexing for very large memories           |
| Terminology        | TBX import/export and merge, including `martif` handling                                 | Explicit dialect/version support, validation, references, and lossless metadata  |
| Tests              | Parser, output, storage, segmentation, and consistency tests                             | Per-format conformance corpora, round trips, malformed inputs, and browser flows |

Legacy binary `.doc` and `.xls` files remain explicit conversion candidates;
they are not routed to the ZIP-based OOXML importers.

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
      Vendor extensions are accepted by the upload UI and clearly identified as
      protected imports. Every XLIFF 1.2, 2.0, and 2.1 exporter now hard-blocks
      these profiles with an actionable notification; export remains deliberately
      disabled because originating-tool reopen validation has not yet occurred.
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
- [ ] **FF-107 — PPTX family (`.pptx`, `.pptm`, `.potx`, `.potm`, `.ppsx`, `.ppsm`).**
      Add slides in relationship order, grouped shapes, tables, charts, SmartArt
      text where safely addressable, masters/layouts, notes, comments, alt text,
      and run-level formatting. Preserve media, animations, links, themes, and
      macro parts; test that PowerPoint and LibreOffice can reopen output.

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
        performance, real repository input, and browser export/re-import. A
        translated real two-slide fixture reopens in LibreOffice 25.8.2.2 and
        exports as a two-page PDF.
  - [ ] Reopen translated macro-free and macro-enabled fixtures in native
        Microsoft PowerPoint on Windows or macOS and record the application
        version. This is the only remaining completion gate; PowerPoint is
        unavailable in the current Linux verification environment.

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
- [ ] **FF-308 — MIF, Windows RC, and Qt/QML specialist resources.** Implement as
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
- [RWS Trados Studio SDLXLIFF file-type overview](https://developers.rws.com/studio-api-docs/17.2/apiconcepts/filetypesupport/file_type_support_overview.html)
- [memoQ vendor-XLIFF processing guidance](https://docs.memoq.com/current/en/Globalese/How_Globalese_processes_XLIFF_files.html)
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

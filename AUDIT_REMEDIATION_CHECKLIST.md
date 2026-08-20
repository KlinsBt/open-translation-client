# Open TLC audit remediation checklist

This checklist tracks the repository-wide functional audit performed on
2026-08-20. An item may be checked only after its implementation and regression
tests pass. The final gate is `npm run verify` on a clean worktree.

## Data integrity and persistence

- [x] AUD-001 Preserve stable TM unit identities while filtering so edit, add,
      and delete operations always modify the displayed unit.
- [x] AUD-002 Preserve stable TB concept identities while filtering so edit,
      add, and delete operations always modify the displayed concept.
- [x] AUD-003 Make project, TM, and TB IndexedDB writes transaction-complete,
      awaited, serialized where necessary, and visible to the UI on failure.
- [x] AUD-004 Debounce segment autosaves and remove full-library reloads from
      the per-keystroke persistence path.
- [x] AUD-005 Prevent empty TM/TB structures from crashing editors or exports,
      and never announce an export that did not complete.
- [x] AUD-006 Clear or repair project references when a TM or TB is deleted and
      disable resource actions when no valid resource is loaded.

## CAT editor behavior

- [x] AUD-007 Enforce segment locks across typing, Fill, TM, TB, bulk fill,
      split, join, and keyboard mutation paths.
- [x] AUD-008 Scope editor shortcuts away from inputs/contenteditable controls
      and preserve standard browser shortcuts such as Find and the address bar.
- [x] AUD-009 Make keyboard navigation expand the virtualized segment window
      before focusing an off-screen segment.
- [x] AUD-010 Replace unbounded per-candidate TM matching with normalized,
      bounded matching and improve terminology matching with Unicode word-aware
      boundaries.
- [x] AUD-011 Warn before translated-document export when target segments are
      empty or unconfirmed, while retaining an explicit user override.

## Import, detection, export, and project validation

- [x] AUD-012 Require a non-empty project name, reject identical source/target
      languages, and expose clear validation messages.
- [x] AUD-013 Make upload drop zones keyboard-operable.
- [x] AUD-014 Remove extension/MIME-only supported detection; low-confidence
      files must pass an adapter content validator before being accepted.
- [x] AUD-015 Improve PDF delivery fidelity by preserving original PDF pages
      where possible and by wrapping/clipping translated text predictably in its
      source box; document unavoidable limitations.
- [x] AUD-016 Make the supported-format content on the landing page, About page,
      and upload UI derive from one registry-backed source.

## UI, accessibility, quality, and delivery

- [x] AUD-017 Add modal focus trapping, initial focus, focus restoration,
      background isolation, and scroll locking.
- [x] AUD-018 Replace non-keyboard interactive result rows and remove invalid or
      duplicated editor/app CSS discovered by the audit.
- [x] AUD-019 Make optional native-validator tests report an explicit skip when
      their tool is unavailable rather than silently passing.
- [x] AUD-020 Add real route-level browser tests for project creation/import,
      editor locking/navigation/export warnings, TM/TB filtered editing, modal
      keyboard behavior, and persistence failure handling.
- [x] AUD-021 Add a logic lint/static-analysis gate in addition to formatting.
- [x] AUD-022 Resolve or contain production dependency advisories and keep heavy
      OCR/transcription code out of ordinary application entry chunks.
- [x] AUD-023 Review large-file storage amplification, preflight browser quota,
      and return helpful quota/cancellation failures.

## Final verification

- [x] `npm run verify` passes.
- [x] `npm audit --omit=dev` has no unaccepted high/critical production finding.
- [x] Roadmap Definition of Done accurately distinguishes automated, optional
      native-tool, and manual interoperability validation.
- [x] Every item above is backed by an implementation or an explicit,
      user-visible constrained behavior and test.

## Completion evidence

- Completed on 2026-08-20.
- `npm run verify` passed: formatting and logic lint passed, `svelte-check`
  reported 0 errors and 0 warnings, 1,091 unit tests passed across 83 files,
  81 browser tests passed across 18 files, and the production build completed.
- Eleven native-application checks were reported as explicit conditional skips
  because their external validators are unavailable in this environment; no
  optional validator silently passed.
- `npm audit --omit=dev` reported 0 production vulnerabilities.
- Browser regressions cover real TXT project creation, validation, modal focus,
  locked-segment mutation prevention, virtualized navigation, incomplete-export
  confirmation, filtered TM/TB editing, quota preflight, transaction completion,
  and stale resource-reference repair.
- Adapter/catalog parity tests ensure every registered format is represented
  exactly once in the shared landing, About, and upload support catalog.
- PDF output is reopened with PDF.js in browser tests; translated PDF exports
  retain source pages/resources and place translated text in mapped source
  regions. Native application fidelity beyond the retained PDF structure remains
  subject to the source file's extractable text and bounding-box quality.

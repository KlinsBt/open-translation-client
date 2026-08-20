# Open TLC audit remediation checklist

This checklist tracks the repository-wide functional audit performed on
2026-08-20 and reopened after the independent follow-up audit on 2026-08-20.

> **Current status: REOPENED — not complete.** The first completion pass relied
> too heavily on broad task wording and tests that still encoded flawed legacy
> behavior. In particular, `checked[]` was accepted as both the segment-lock and
> workflow-confirmation state. A task may now be checked only when every explicit
> acceptance criterion beneath it passes and the cited regression test would
> fail against the pre-fix implementation. Passing unrelated tests is not
> completion evidence.

The final gate is `npm run verify` on a clean worktree, the absence of unexpected
runtime/build warnings, and a manual review of the evidence recorded beneath
every reopened task.

## Data integrity and persistence

- [x] AUD-001 Preserve stable TM unit identities while filtering so edit, add,
      and delete operations always modify the displayed unit.
- [x] AUD-002 Preserve stable TB concept identities while filtering so edit,
      add, and delete operations always modify the displayed concept.
- [ ] AUD-003 **REOPENED:** Make project, TM, and TB IndexedDB writes
      transaction-complete, awaited, serialized where necessary, and visible to
      the UI on failure. Editor persistence wrappers must reject on failure;
      callers must not announce success, close a modal, or retain an
      unpersisted optimistic mutation unless they explicitly roll it back.
- [ ] AUD-004 **REOPENED:** Debounce segment autosaves and remove full-library
      reloads from the per-keystroke persistence path. Additionally flush or
      durably queue the last edit during blur, route navigation, `pagehide`, and
      component destruction, with a browser regression for an immediate exit
      inside the debounce window.
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
- [ ] AUD-010 **REOPENED:** Replace unbounded per-candidate TM matching with
      normalized, bounded matching that preserves order and token frequency for
      long segments. Canonicalize BCP 47 language tags and define intentional
      base-language fallback (`en`/`en-US`) for both TM and TB lookup. Add
      reordered-long-text, repeated-token, Unicode, RTL, locale-variant, and
      performance regressions.
- [ ] AUD-011 **REOPENED:** Warn before translated-document export when target
      segments are empty or unconfirmed, while retaining an explicit user
      override. Confirmation must use workflow state and must never be inferred
      from the independent segment-lock state.

## Import, detection, export, and project validation

- [x] AUD-012 Require a non-empty project name, reject identical source/target
      languages, and expose clear validation messages.
- [x] AUD-013 Make upload drop zones keyboard-operable.
- [ ] AUD-014 **REOPENED:** Remove extension/MIME-only or shallow-signature
      supported detection. PDF and ZIP-package families must pass their adapter
      content/structure validator before the UI reports them as supported or
      high confidence. Add truncated, forged-signature, renamed, adversarial,
      and cancellation regressions.
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

- [ ] Every reopened and follow-up item below is complete with recorded evidence.
- [ ] `npm run verify` passes after the final fix on a clean worktree.
- [ ] `npm audit --omit=dev` has no unaccepted high/critical production finding,
      and the full development/build audit has no unreviewed critical or high
      finding.
- [ ] Browser tests complete without unhandled exceptions, stale-reactivity
      warnings, hanging processes, or false-positive tests.
- [ ] Production build completes without an unreviewed oversized entry chunk or
      unexpectedly eager heavy runtime asset.
- [ ] Roadmap Definition of Done accurately distinguishes automated, optional
      native-tool, and manual interoperability validation.
- [ ] Every item is backed by implementation evidence and a regression that
      fails against the pre-fix behavior.

## Follow-up audit — explicit unresolved work

### CAT state model and delivery correctness

- [x] AUD-024 Separate segment locking from translation workflow state.

  - Add an independently persisted `locked[]` state (or equivalent per-unit
    field) while retaining `initial`, `translated`, `reviewed`, and `final`
    workflow states in the neutral document.
  - Migrate existing projects deterministically without converting historical
    locks into false review confirmations.
  - “Lock all” must not change progress, finished-project statistics, QA
    confirmation counts, XLIFF state, or converted-export status.
  - Confirming/reviewing a unit must not implicitly lock it unless the user
    explicitly chooses a combined action.
  - Add migration, statistics, QA, XLIFF, converted-export, and real-browser
    regressions proving the states remain independent after reload.

  Completed 2026-08-20. Project schema v2 persists `locked[]` independently
  from workflow `checked[]`. The v1 migration preserves legacy edit protection
  as locks while conservatively resetting review confirmation and reviewed/final
  neutral-unit states. Native non-translatable/vendor-locked units initialize
  as locked, Open TLC XLIFF metadata round-trips both arrays, segment editing
  exposes separate lock and confirm actions, and split/join retains both states.
  Evidence: `persistenceMigrations.spec.ts`, `segmentationLogic.spec.ts`,
  `workflowState.spec.ts`, and the real-browser CAT route lock regression.

- [x] AUD-025 Make translated-source export failure retryable.

  - Export functions must return success or throw; they may not swallow a failure
    that callers interpret as success.
  - Keep the export modal open after failure, show one actionable error, and only
    close it after a download is successfully created.
  - Cover original-format, converted PDF/DOCX/RTF/HTML/TXT/CSV, vendor XLIFF, and
    cancellation failures in browser tests.

  Completed 2026-08-20. All export-modal actions now share a single success-or-
  failure contract: failures and cancellations leave the modal open with one
  actionable inline alert, while the modal closes only after the download
  trigger succeeds. JSON and XLIFF download helpers no longer swallow errors,
  download URLs/anchors are cleaned in `finally`, and original-format and
  converted writers propagate failures. Browser regressions exercise the
  original writer, PDF/DOCX/RTF/HTML/TXT/CSV conversions, XLIFF 1.2/2.0/2.1,
  same-profile vendor XLIFF, cancellation, and a successful retry.

### Persistence and lifecycle reliability

- [x] AUD-026 Establish one persistence error contract across projects, segments,
      TM, and TB.

  - Do not mutate shared stores permanently before a write succeeds unless a
    tested rollback restores the exact prior snapshot.
  - Do not emit success/info notifications after a failed transaction.
  - Name/language changes, lock/review changes, resource selection/activation,
    split/join, fill, and TM/TB edits must all follow the same contract.
  - Inject transaction aborts and quota failures into route-level tests and
    verify UI state, modal state, notifications, and reload behavior.

  Completed 2026-08-20; reviewer confirmation: Codex re-inspected every project,
  segment, TM, and TB IndexedDB mutation caller before closure. Implementation
  commit: `fix: make persisted mutations failure-atomic` (this task's commit).
  Affected code includes `persistenceContract.ts`, `indexedDb.ts`, project and
  segment mutation components, TM/TB libraries and editors, import/merge flows,
  and new-project persistence. Candidate snapshots are now cloned, committed,
  and only then published; failed transactions retain the previous store and
  database value, keep retryable UI open, clear loading state, show one helpful
  error, and never emit the corresponding success/info notification. Multi-
  project writes now use one IndexedDB transaction instead of independently
  committed batches.

  Regression evidence: `persistenceContract.spec.ts` proves isolation and exact
  rollback for quota and abort failures; `saveFileModsIndexedDb.spec.ts` proves a
  failed project creation cannot mutate or publish the caller's collection; the
  CAT route cases “keeps the project rename modal and snapshots unchanged after
  a quota failure”, “does not publish a segment fill when its transaction
  aborts”, and the failed TM/TB edit cases inject real object-store failures and
  verify modal/editor state, stores, notifications, and an IndexedDB reload.
  These tests fail against the pre-fix code because it published/mutated data
  before transaction completion, closed retry UI, or emitted success after
  failure.

  Commands: `npm run test:unit -- --run` — 85 files passed, 1,098 tests passed,
  11 conditional tests skipped; `npm run test:browser:smoke` — 1 file and 10
  tests passed; `npm run lint` — formatting and ESLint passed; `npm run check` —
  0 errors and 0 warnings; `npm run build` — production build completed. The
  known Svelte `derived_inert` browser warning is outside this persistence item
  and remains explicitly tracked by AUD-034. Lifecycle-safe flushing of the
  final debounced textarea edit remains explicitly tracked by AUD-027; no other
  limitation is known for the mutation classes closed here.

- [x] AUD-027 Guarantee the final debounced edit survives navigation and tab exit.

  - Use a lifecycle-safe queued-write strategy rather than relying on an
    unawaited promise from `onDestroy`.
  - Test blur, Svelte route destruction, immediate project switching,
    `visibilitychange`/`pagehide`, transaction overlap, and a write already in
    flight.

  Completed 2026-08-20; reviewer confirmation: Codex traced the target-editor
  lifecycle from input through IndexedDB completion and route teardown.
  Implementation commit: `fix: persist final edits across route teardown` (this
  task's commit). `persistedEditQueue.ts` replaces child-component timers with a
  parent-owned queue that starts the first transaction immediately, coalesces
  overlapping keystrokes to the newest full snapshot, retains its work beyond
  component destruction, and rolls back to the last confirmed snapshot on
  failure. Blur, hidden-document, pagehide, and destroy paths flush/observe that
  already-running queue; other project mutations first drain it and then adopt
  their successful snapshot as the next rollback baseline.

  Regression evidence: four `persistedEditQueue.spec.ts` tests cover immediate
  start, an in-flight write, coalescing, exact rollback, recovery baselines, and
  awaited flush. The real-browser case “persists the final queued edit through
  blur, page exit, route destruction, and project switching” sends rapid edits
  including Unicode/RTL text, fires blur, `visibilitychange`, and `pagehide`,
  switches projects, destroys the Svelte route, and verifies the final target and
  cleared confirmation after an IndexedDB reload. These tests fail on the old
  per-segment 300 ms timer because destruction only launched an unawaited late
  save and overlapping segment timers could commit stale snapshots.

  Commands: `npx vitest --run
src/lib/functions/saveData/persistedEditQueue.spec.ts` — 1 file and 4 tests
  passed; `npm run test:browser:smoke` — 1 file and 11 tests passed; `npm run
lint` — formatting and ESLint passed; `npm run check` — 0 errors and 0
  warnings; `npm run build` — production build completed. The browser cannot
  override an operating-system process kill that prevents all IndexedDB work;
  within supported browser lifecycle events, the final edit is queued before
  teardown rather than depending on teardown to initiate it.

- [x] AUD-028 Make every global loading transition exception-safe.

  - Wrap initial project loading, project opening, and TM/TB loading in
    `try/catch/finally` or a shared reference-counted loading helper.
  - A failed nested load must clear the overlay, preserve navigation, and show an
    actionable message.
  - Add IndexedDB-open, read, migration, and missing-resource browser failures.

  Completed 2026-08-20; reviewer confirmation: Codex audited every reachable
  `showLoading` activation and the initial project, project-open, project-
  resource, TM-library, and TB-library paths. Implementation commit: `fix: make
loading failures recoverable` (this task's commit). `withLoading` now owns a
  reference-counted begin/finally/end lifecycle, so a failed or nested operation
  cannot leave the overlay active or hide it while another operation remains.
  Initial libraries and project/resource opening use that contract, retain the
  current route on failure, and report an actionable error. IndexedDB open
  failures reset the cached connection promise so a retry can succeed. Active
  projects now reject missing TM/TB references before leaving the library.

  Regression evidence: `uiHelpers.spec.ts` proves exception cleanup and nested
  reference counting. Real-browser route tests inject a synchronous IndexedDB
  open failure, a read-transaction failure, a raw future-schema record that
  fails migration, missing active TM metadata, and TM/TB library read failures;
  every case verifies `showLoading === false`, error notification text, retained
  navigation, and recovery/retry where applicable. These regressions fail on the
  old code because several awaits had no `finally`, the rejected open promise was
  cached, and nested project resource loading could strand the global overlay.

  Commands: `npx vitest --run src/lib/functions/uiHelpers.spec.ts
src/lib/functions/saveData/indexedDb.spec.ts` — 2 files and 6 tests passed;
  `npm run test:browser:smoke` — 1 file and 15 tests passed; `npm run lint` —
  formatting and ESLint passed; `npm run check` — 0 errors and 0 warnings; `npm
run build` — production build completed. No remaining loading-state limitation
  is known; stale-reactivity and production logging diagnostics remain separately
  tracked by AUD-034 and AUD-031.

### Detection, matching, and security

- [ ] AUD-029 Strengthen PDF and package detection before advertising support.

  - `%PDF-`, ZIP magic, a filename, MIME type, or one internal marker is not
    sufficient by itself for a supported/high-confidence result.
  - Reuse bounded adapter validation during detection and support cancellation
    when a selected file is replaced or the modal closes.
  - Verify that malformed files never briefly appear importable.

- [ ] AUD-030 Replace long-segment set-Dice matching and normalize language tags.

  - Preserve token order and multiplicity, cap time/memory predictably, and never
    report 100% for a reordered non-identical long segment.
  - Canonicalize valid BCP 47 tags and document exact versus base-language
    fallback behavior for TM and TB.
  - Add adversarial repeated-token, reordered-token, CJK, combining-mark, RTL,
    punctuation, and 10,000-entry performance tests.

- [ ] AUD-031 Remove sensitive and obsolete debug logging from production paths.

  - Remove or gate logs containing project objects, source/target segments,
    TM/TB content, language selections, API responses, and imported text.
  - Remove unused legacy upload/API helpers after proving they are unreachable,
    or bring them under the same validation and logging policy.
  - Add an ESLint rule that rejects `console.log` in shipped source while allowing
    intentional `console.error`/test diagnostics under a documented policy.

- [ ] AUD-032 Resolve the full dependency-audit backlog.
  - Review all production, development, browser-test, image/OCR, and transcription
    dependency advisories; upgrade, replace, isolate, or record a time-bounded
    risk acceptance for each one.
  - Do not use `npm audit fix --force` without reviewing breaking migrations.
  - Record separate `npm audit --omit=dev` and full `npm audit` results.

### Test integrity, runtime warnings, and delivery size

- [ ] AUD-033 Add enforceable coverage and mutation-sensitive regressions.

  - Add line, branch, function, and statement thresholds with justified scoped
    exclusions.
  - Cover every registry adapter through the conformance harness and every CAT
    state transition through unit or browser tests.
  - Explicitly prove that the lock/confirmation, failed-save, failed-export,
    long-TM-match, loading-overlay, and forged-PDF tests fail on commit `14830b5`.

- [ ] AUD-034 Eliminate browser runtime/test warnings.

  - Resolve Svelte's `derived_inert` warning in filtered TM/TB editing rather than
    suppressing it.
  - Resolve or explicitly isolate the PDF.js dynamic-import warning, invalid
    local-storage-file warning, test-server shutdown hangs, and all unhandled
    test errors.
  - Treat unexpected stderr and unhandled rejections as test failures.

- [ ] AUD-035 Set and enforce a production bundle budget.

  - Record route-level compressed and uncompressed budgets.
  - Keep OCR/transcription engines and models out of ordinary application route
    downloads and load them only after the relevant local feature is requested.
  - Review the emitted 23+ MiB ONNX WASM asset, PDF worker, 500+ KiB chunks, and
    1+ MiB app chunks; split or explicitly justify each retained artifact.
  - Add a CI budget check that fails on unapproved regressions.

- [ ] AUD-036 Close the external-validator release gates.
  - Run or obtain CI artifacts for LibreOffice ODF/PDF reopening, EPUBCheck,
    DITA-OT, a TeX engine, `windres`, `ffprobe`, and every other conditional
    native check currently skipped.
  - Record tool name/version, operating system, command, result, and fixture for
    every gate. A skipped gate may be documented, but the implementation plan
    must not be described as fully release-validated while it remains skipped.

## Checkbox closure protocol

Before changing any reopened item to `[x]`, record directly beneath it:

1. implementation commit and affected files;
2. regression test names and why they fail on the old code;
3. commands run and their exact pass/skip counts;
4. remaining limitations or an explicit statement that none are known;
5. completion date and reviewer confirmation.

Do not bulk-check tasks from a green `npm run verify`. Each task requires its own
evidence review, and the final verification boxes remain unchecked until every
applicable AUD item is closed.

## Historical completion evidence — superseded by follow-up audit

- The first pass was marked completed on 2026-08-20. That completion claim is
  superseded by the reopened status and unchecked work above.
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

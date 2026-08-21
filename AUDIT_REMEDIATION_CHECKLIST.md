# Open TLC audit remediation checklist

This checklist tracks the repository-wide functional audit performed on
2026-08-20 and reopened after the independent follow-up audit on 2026-08-20.

> **Current status: FIFTH FOLLOW-UP IN PROGRESS — 2026-08-21.** A new audit
> reopened PDF semantics, editor scaling, media validation/cancellation,
> cross-tab concurrency, bidirectional-language semantics, roadmap accuracy,
> and final release evidence. AUD-052 through AUD-058 supersede the earlier
> blanket completion statement.

The final gate is `npm run verify` on a clean worktree, the absence of unexpected
runtime/build warnings, and a manual review of the evidence recorded beneath
every reopened task.

## Data integrity and persistence

- [x] AUD-001 Preserve stable TM unit identities while filtering so edit, add,
      and delete operations always modify the displayed unit.
- [x] AUD-002 Preserve stable TB concept identities while filtering so edit,
      add, and delete operations always modify the displayed concept.
- [x] AUD-003 Make project, TM, and TB IndexedDB writes
      transaction-complete, awaited, serialized where necessary, and visible to
      the UI on failure. Editor persistence wrappers must reject on failure;
      callers must not announce success, close a modal, or retain an
      unpersisted optimistic mutation unless they explicitly roll it back.

  Closed 2026-08-20 after a second caller-by-caller review. The implementation
  is in follow-up AUD-026 (`c8d9e0c`): all project, TM, and TB write/delete
  helpers enter one serialized queue, await the IndexedDB transaction's
  `complete` event, translate quota/abort failures into actionable errors, and
  publish refreshed stores only after commit. Cross-store TM/TB deletion and
  project-reference repair share a single transaction. Project creation,
  rename/language changes, segment operations, resource selection, imports,
  merges, and TM/TB editors await those helpers; successful UI state and modal
  closure occur only afterward. Editors that expose an optimistic local draft
  restore their exact last-persisted snapshot on rejection.

  Regression evidence: `persistenceContract.spec.ts` covers publish-after-
  commit and exact quota/abort rollback; `saveFileModsIndexedDb.spec.ts` proves
  failed project creation cannot publish an unpersisted collection;
  `persistedEditQueue.spec.ts` covers serialized in-flight writes and rollback;
  `indexedDb.browser.spec.ts` verifies awaited writes are immediately readable
  and cross-store reference repair is transaction-complete. The route browser
  cases inject real object-store quota/abort failures and verify that project,
  segment, TM, and TB data, notifications, and retryable UI remain correct after
  an IndexedDB reload. These tests fail against the pre-fix implementation,
  which published or mutated state before transaction completion.

  Closure commands: `npm run test:unit -- --run
src/lib/functions/saveData/persistenceContract.spec.ts
src/lib/functions/saveFileModsIndexedDb.spec.ts
src/lib/functions/saveData/persistedEditQueue.spec.ts` — 3 files and 11 tests
  passed; `npm run test:browser:smoke` — 1 file and 18 tests passed. Final-edit
  lifecycle durability is independently closed and evidenced by AUD-004/027.

- [x] AUD-004 Debounce segment autosaves and remove full-library
      reloads from the per-keystroke persistence path. Additionally flush or
      durably queue the last edit during blur, route navigation, `pagehide`, and
      component destruction, with a browser regression for an immediate exit
      inside the debounce window.

  Completed 2026-08-20. Follow-up AUD-027 (`7f036a3`) moved target edits into a
  route-owned persisted queue whose work survives child and route teardown. The
  closure review found that its first version only coalesced edits while an
  IndexedDB transaction happened to remain in flight; a fast transaction could
  therefore still produce a write per keystroke. This task now starts the first
  write immediately, holds a 250 ms quiet window, and collapses the remainder of
  each input burst into one trailing snapshot. `flush()` cancels that delay and
  drains the newest snapshot immediately. The input path writes the selected
  project record directly and never reloads the full project library.

  Blur, hidden-document `visibilitychange`, `pagehide`, parent mutations, and
  component destruction all flush or await the same queue. An in-flight write
  remains owned by the queue rather than the component; overlapping edits are
  serialized, and a failed write drops dependent drafts and restores the exact
  last committed snapshot. The route browser regression enters rapid
  Unicode/RTL text, exits inside the quiet window through all lifecycle signals,
  switches projects, destroys the route, and verifies the final value after an
  IndexedDB reload.

  Regression evidence: the five `persistedEditQueue.spec.ts` cases prove
  immediate first-write durability, debounce of a fast-write burst, trailing-
  value coalescing, flush of an in-flight/final write, exact failure rollback,
  and baseline adoption. The fast-write regression fails against the prior
  queue because its second and third inputs start new writes without a quiet
  window. Closure commands: focused unit run — 1 file and 5 tests passed; `npm
run test:browser:smoke` — 1 file and 18 tests passed; `npm run check` — 0
  errors and 0 warnings; `npm run lint:logic` passed.

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
- [x] AUD-010 Replace unbounded per-candidate TM matching with
      normalized, bounded matching that preserves order and token frequency for
      long segments. Canonicalize BCP 47 language tags and define intentional
      base-language fallback (`en`/`en-US`) for both TM and TB lookup. Add
      reordered-long-text, repeated-token, Unicode, RTL, locale-variant, and
      performance regressions.

  Closed 2026-08-20 after re-auditing follow-up AUD-030 (`4d392e9`). TM queries
  and candidates are NFKC-normalized once per comparison, case/whitespace
  normalized, length-pruned before scoring, sorted, and capped at 50 results.
  Short segments use a two-row Unicode-code-point Levenshtein implementation;
  long segments use fixed 2,048-bucket unigram-multiset and ordered-bigram
  sketches. Working memory per comparison is bounded, token repetition and
  order affect the result, and only normalized-identical strings can score
  100%. A generated 10,000-entry test avoids committed large fixtures and
  enforces the five-second regression budget.

  `languageMatching.ts` accepts UI labels and underscore variants, canonicalizes
  valid tags through `Intl.getCanonicalLocales`, ranks exact locale matches
  before same-base matches, and limits invalid legacy labels to case-insensitive
  exact matching. TM applies that policy across source entries and then target
  variants; TB applies it within each terminology concept. README documentation
  states these scopes explicitly.

  Regression evidence covers reordered 320-token input, changed token
  multiplicity, punctuation, CJK, combining marks, RTL Arabic, exact 100%
  Unicode normalization, canonical/underscored/invalid locale tags, exact-first
  TM/TB lookup, and base fallback. These cases fail against the former unordered
  set-Dice and raw-string language filtering. Closure command: `npm run
test:unit -- --run src/lib/components/resources/catMatching.spec.ts
src/lib/functions/utilities.spec.ts` — 2 files and 16 tests passed, including
  the generated 10,000-entry performance case.

- [x] AUD-011 Warn before translated-document export when target
      segments are empty or unconfirmed, while retaining an explicit user
      override. Confirmation must use workflow state and must never be inferred
      from the independent segment-lock state.

  Completed 2026-08-20. `getProjectCompletionSummary` reports empty targets and
  unconfirmed workflow units independently from `locked[]`. Every translated
  delivery action—original-format and converted PDF/DOCX/RTF/HTML/TXT/CSV—passes
  through the same completion gate. An incomplete project opens a dedicated QA
  warning with both counts and offers “Review project” or the explicit “Export
  anyway” override; bilingual project/backup formats remain available without a
  delivery warning because they preserve editable workflow state. Export
  execution retains AUD-025's retryable success-or-throw contract.

  Regression evidence: `qualityAssurance.spec.ts` verifies empty and
  unconfirmed indexes separately. `workflowState.spec.ts` proves a locked draft
  remains unconfirmed in statistics, QA, XLIFF approval, and converted CSV. The
  real-browser CAT regression opens a 151-unit project whose first draft is
  locked, observes 0% completion and both 151-unit warning counts, verifies the
  lock did not alter confirmation, explicitly chooses “Export anyway”, observes
  exactly one download, and confirms modal completion. It fails against the
  pre-fix behavior that treated `checked[]` as both lock and review state or
  exported delivery files without warning.

  Closure commands: `npm run test:unit -- --run
src/lib/formats/qualityAssurance.spec.ts
src/lib/formats/workflowState.spec.ts` — 2 files and 15 tests passed; `npm run
test:browser:smoke` — 1 file and 18 tests passed.

## Import, detection, export, and project validation

- [x] AUD-012 Require a non-empty project name, reject identical source/target
      languages, and expose clear validation messages.
- [x] AUD-013 Make upload drop zones keyboard-operable.
- [x] AUD-014 Remove extension/MIME-only or shallow-signature
      supported detection. PDF and ZIP-package families must pass their adapter
      content/structure validator before the UI reports them as supported or
      high confidence. Add truncated, forged-signature, renamed, adversarial,
      and cancellation regressions.

  Closed 2026-08-20 after re-auditing follow-up AUD-029 (`af83ee5`). PDF
  candidates require a versioned `%PDF-` header, terminal `startxref`/`%%EOF`
  envelope, and successful bounded PDF.js structural parse. ZIP-family
  candidates first pass central-directory/path/size safety inspection, then
  their registered adapter validator. OOXML additionally requires matching
  `[Content_Types].xml` and a non-external root office-document relationship;
  EPUB, CAT packages, and manifest batches must satisfy their own container and
  declared-member structures. Extension and MIME metadata can contribute
  evidence but cannot produce supported/high-confidence status by themselves.

  The upload UI clears prior support state synchronously and gives every
  detection an `AbortController`. Replacement, removal, modal close, component
  destruction, and import takeover cancel the current read; stale completions
  cannot publish a format, enable project fields, or raise a cancellation toast.
  Safe streaming attaches cancellation during stream construction and all
  package validation uses the repository's bounded archive/XML limits.

  Regression evidence rejects truncated/forged PDF data, ZIP magic or a single
  document marker, mismatched/renamed OOXML, malformed OPC declarations,
  incomplete EPUB/CAT packages, unsafe archives, and a valid-looking manifest
  with an invalid declared member. Unit and browser cases cancel an in-progress
  stream, replace the selected file, close the modal, and hold malformed PDF
  detection long enough to prove it never appears importable. These cases fail
  against the former signature/marker-only detection. Closure commands: focused
  format run — 9 files, 146 tests passed and 1 conditional test skipped; the
  post-change `npm run test:browser:smoke` run — 1 file and 18 tests passed.

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

- [x] Every reopened and follow-up item below is complete with recorded evidence.
- [x] `npm run verify` passes after the final fix on a clean worktree.
- [x] `npm audit --omit=dev` has no unaccepted high/critical production finding,
      and the full development/build audit has no unreviewed critical or high
      finding.
- [x] Browser tests complete without unhandled exceptions, stale-reactivity
      warnings, hanging processes, or false-positive tests.
- [x] Production build completes without an unreviewed oversized entry chunk or
      unexpectedly eager heavy runtime asset.
- [x] Roadmap Definition of Done accurately distinguishes automated, optional
      native-tool, and manual interoperability validation.
- [x] Every item is backed by implementation evidence and a regression that
      fails against the pre-fix behavior.

Final gate evidence, 2026-08-20:

- The final `npm run verify` began with `git status --porcelain` empty and
  passed formatting, ESLint, Svelte check with 0 errors/0 warnings, 90 unit
  files with 1,120 tests passed and 11 explicit conditional skips, 18 real-
  browser files with 95 tests passed, coverage thresholds, production build,
  and bundle budgets. Browser diagnostic enforcement reported no unhandled
  exception, stale-reactivity warning, hang, or false-positive suite result.
- Coverage finished at 85.75% statements, 75.16% branches, 92.49% functions,
  and 87.12% lines, above every enforced floor. The bundle gate measured the
  landing/about/app/TB/TM route closures at 45,102/48,615/360,040/138,857/
  139,103 gzip bytes and confirmed PDF.js, OCR, transcription, and ONNX assets
  remain behind reviewed dynamic boundaries.
- `npm audit --omit=dev --audit-level=high` and the full `npm audit
--audit-level=high` both reported 0 vulnerabilities.
- Strict `npm run test:external` passed 13 files and all 125 tests with no skip.
  Its report is `strict-release-gate: passed` and records LibreOffice 25.8.2.2,
  EPUBCheck 5.3.0, DITA-OT 4.4.0, TeX Live 2026, GNU windres 2.46, FFmpeg n8.0,
  Poppler 25.10.0, qmllint 1.0, libxml2 2.15.1, and gettext 0.26 on CachyOS
  Linux x86-64. `EXTERNAL_VALIDATION.md` and the roadmap now distinguish the
  mandatory repository gate, strict/optional native-tool automation, and
  supplemental manual proprietary-application observations.

Original-item regression index (the detailed reopened/follow-up evidence is
recorded beneath AUD-003/004/010/011/014 and AUD-024 through AUD-036):

- AUD-001/002: `resourceFiltering.spec.ts` and the filtered TM/TB real-browser
  edit cases prove displayed stable identities are mutated rather than array
  positions.
- AUD-005/006: TMX/TBX format tests, `indexedDb.browser.spec.ts`, and the empty-
  resource/export browser cases cover empty safety, completed downloads, and
  atomic repair of deleted project references.
- AUD-007/008/009: `segmentationLogic.spec.ts`, `workflowState.spec.ts`, and the
  CAT browser route cover every locked mutation path, native editing shortcuts,
  and virtual-window keyboard expansion.
- AUD-012/013: `projectValidation.spec.ts` and modal route tests cover blank/
  identical-language validation plus keyboard activation and focus behavior for
  every upload drop zone.
- AUD-015/016: `pdf.spec.ts`, converted-export tests, `supportCatalog.spec.ts`,
  and `repositoryConsistency.spec.ts` cover PDF page/overlay constraints and one
  registry-derived picker/landing/About support catalog.
- AUD-017/018: modal and CAT route browser cases cover focus trap/restoration,
  background isolation, scroll lock, keyboard result rows, and the static CSS/
  interaction consistency rules.
- AUD-019/020: explicit conditional-validator assertions and all 95 route/
  conformance browser tests prevent silent native passes and exercise the named
  user workflows.
- AUD-021/022/023: ESLint/repository policy tests, both dependency audits,
  `buildPolicy.spec.ts`, the enforced bundle manifest, `safeInput.spec.ts`, and
  IndexedDB quota/cancellation browser cases cover static analysis, advisory/
  eager-load containment, bounded inputs, storage preflight, and actionable
  cancellation/quota failure.

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

- [x] AUD-029 Strengthen PDF and package detection before advertising support.

  - `%PDF-`, ZIP magic, a filename, MIME type, or one internal marker is not
    sufficient by itself for a supported/high-confidence result.
  - Reuse bounded adapter validation during detection and support cancellation
    when a selected file is replaced or the modal closes.
  - Verify that malformed files never briefly appear importable.

  Completed 2026-08-20; reviewer confirmation: Codex traced source detection
  through the registry, safe-input limits, every package adapter, and the real
  new-project modal. Implementation commit: `fix: validate advertised PDF and
package formats` (this task's commit). PDF detection now requires a versioned
  header and final `startxref`/`%%EOF` envelope before bounded PDF.js parsing.
  OOXML detection requires matching content-type and root office-document
  declarations, then invokes the DOCX/XLSX/PPTX or XLSB adapter validator.
  EPUB, CAT, and manifest ZIP candidates likewise pass their full bounded
  adapter validation—including declared manifest members—before the UI receives
  a supported result. This follows the package/relationship model in
  [ECMA-376](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/),
  the OCF container/package requirements in
  [EPUB 3.3](https://www.w3.org/TR/epub-33/), and the PDF header/trailer model
  summarized by the
  [PDF Association specification errata](https://pdf-issues.pdfa.org/32000-2-2020/clause07.html).

  The upload component now owns a detection `AbortController`, resets all prior
  detection state synchronously, and cancels on direct replacement, removal,
  close, destruction, or import takeover. The selected-file card exposes a
  keyboard-accessible Replace action. Safe streaming also closes the race where
  cancellation occurred during stream construction, before its abort listener
  was attached. Stale or cancelled detections cannot publish a format, form
  fields, or an error toast.

  Regression evidence: registry tests reject forged `%PDF-` data, marker-only
  DOCX/XLSX/PPTX/EPUB archives, and a valid-looking manifest with a malformed
  declared member; they also prove bounded detection cancellation. Safe-input
  tests reproduce the stream-construction abort race. The real-browser tests
  hold detection in flight, replace the file, close a second in-flight modal,
  and verify reader cancellation, latest-file ownership, no cancellation toast,
  and no briefly importable project form for a malformed PDF. Existing minimal
  office fixtures were upgraded to valid OPC declarations rather than weakening
  the gate.

  Commands: focused format/safety run — 6 files, 102 tests passed and 1 skipped;
  `npm run test:browser:smoke` — 1 file and 17 tests passed; `npm run verify` —
  lint passed, Svelte check reported 0 errors and 0 warnings, 87 unit files with
  1,107 tests passed and 11 skipped, 18 browser files with 94 tests passed, and
  the static production build completed. The already-tracked PDF.js dynamic-
  import diagnostic and bundle-size budget remain under AUD-034 and AUD-035;
  they do not weaken detection validation.

- [x] AUD-030 Replace long-segment set-Dice matching and normalize language tags.

  - Preserve token order and multiplicity, cap time/memory predictably, and never
    report 100% for a reordered non-identical long segment.
  - Canonicalize valid BCP 47 tags and document exact versus base-language
    fallback behavior for TM and TB.
  - Add adversarial repeated-token, reordered-token, CJK, combining-mark, RTL,
    punctuation, and 10,000-entry performance tests.

  Completed 2026-08-20; reviewer confirmation: Codex traced TM and TB language
  filtering, fuzzy scoring, persistence consumers, and the resource UI before
  changing the shared matchers. Implementation commit: `fix: preserve order in
  CAT resource matching` (this task's commit). Valid language identifiers are
  normalized with `Intl.getCanonicalLocales` after accepting the underscore and
  display-label forms already stored by the application. Matching now prefers
  an exact canonical locale and uses the same base language only when that
  resource has no exact candidate. Invalid legacy labels remain available only
  through case-insensitive exact matching. This behavior follows the language-
  tag syntax in [RFC 5646](https://www.rfc-editor.org/info/rfc5646/) and the
  exact-before-broader lookup principle in
  [RFC 4647](https://www.rfc-editor.org/info/rfc4647/).

  Long non-identical segments no longer use unordered token sets. They use
  Unicode-aware token multisets plus directional token bigrams in fixed 2,048-
  bucket sketches, preserving repetition and order evidence with linear scan
  time and bounded working memory per candidate. Exact strings are the only
  100% result; every approximate long result is capped below 100%. Short
  segments retain Unicode-code-point Levenshtein matching, and each TM query is
  prepared once rather than rebuilt for every entry. The README documents the
  exact/base fallback and invalid-label behavior.

  Regression evidence covers reordered unique tokens, repeated-token count
  changes, CJK, combining marks, RTL, punctuation, Unicode normalization,
  invalid/canonical/underscored BCP 47 tags, TM/TB exact-first behavior, base
  fallback, and a generated 10,000-entry memory performance boundary without a
  committed large fixture. Commands: `npx vitest --run
src/lib/components/resources/catMatching.spec.ts
src/lib/functions/utilities.spec.ts` — 2 files and 16 tests passed; `npm run
verify` — lint passed, Svelte check reported 0 errors and 0 warnings, 87 unit
  files with 1,112 tests passed and 11 skipped, 18 browser files with 94 tests
  passed, and the static production build completed. Approximate long matching is
  deliberately bounded and collision-tolerant below 100%; it is a ranking signal,
  not an identity claim.

- [x] AUD-031 Remove sensitive and obsolete debug logging from production paths.

  - Remove or gate logs containing project objects, source/target segments,
    TM/TB content, language selections, API responses, and imported text.
  - Remove unused legacy upload/API helpers after proving they are unreachable,
    or bring them under the same validation and logging policy.
  - Add an ESLint rule that rejects `console.log` in shipped source while allowing
    intentional `console.error`/test diagnostics under a documented policy.

  Completed 2026-08-20; reviewer confirmation: Codex searched every shipped
  TypeScript, JavaScript, and Svelte source plus the import graph before making
  changes. Implementation commit: `fix: remove production content logging`
  (this task's commit). Project rename/open/delete flows, segment loading and TM
  insertion, language selection, TM/TB library/editor actions, and TBX creation
  no longer log records, source/target segments, resource contents, identifiers,
  or language values. Import failures still show the existing sanitized UI
  message without forwarding parser objects to the console.

  Seventeen unreachable prototype files were removed after repository-wide
  fixed-string and import searches found no callers: the obsolete direct
  DeepL/LibreTranslate request module, standalone media IndexedDB helper, six
  pre-registry document uploaders, and nine OCR/MessagePack upload blueprints.
  The active universal, portable-project, TMX, and TBX upload paths remain. The
  stale TypeScript exclusion and repository-test exemption for the former
  `uploads/unused` tree were removed, so all shipped source is checked equally.

  ESLint now rejects `console.log`, `console.info`, and `console.debug` throughout
  production source while permitting warnings/errors and test diagnostics.
  Intentional failures route through a shared diagnostic helper that emits only
  a fixed operation label and error category, never the error message, thrown
  object, imported content, or application state. README documents this policy.
  Repository consistency tests independently reject content-bearing production
  logging and resurrection of the deleted prototype trees; diagnostic tests use
  adversarial secret-bearing errors and arbitrary objects to prove redaction.

  Commands: repository-wide `rg` import/log/fetch audits found no remaining
  production `log`/`info`/`debug`, prototype reference, or direct network helper;
  focused verification — 4 files and 17 tests passed; `npm run
test:browser:smoke` — 1 file and 17 tests passed without the former project-
  object stdout; `npm run verify` — lint passed, Svelte check reported 0 errors
  and 0 warnings, 88 unit files with 1,116 tests passed and 11 skipped, 18 browser
  files with 94 tests passed, and the static production build completed. The
  remaining Svelte, PDF.js, local-storage, and bundle-size diagnostics are
  separately tracked by AUD-034 and AUD-035.

- [x] AUD-032 Resolve the full dependency-audit backlog.

  - Review all production, development, browser-test, image/OCR, and transcription
    dependency advisories; upgrade, replace, isolate, or record a time-bounded
    risk acceptance for each one.
  - Do not use `npm audit fix --force` without reviewing breaking migrations.
  - Record separate `npm audit --omit=dev` and full `npm audit` results.

  Completed 2026-08-20; reviewer confirmation: Codex audited the lockfile with
  the official npm advisory endpoint before and after remediation, inspected
  package peer/engine metadata, traced runtime imports, and reviewed the Vite 8
  and Vitest 4 migrations. Implementation commit: `chore: remediate dependency
audit findings` (this task's commit). The initial production-only audit was
  clean. The initial full audit reported 16 development-graph findings: 4 low,
  5 moderate, 5 high, and 2 critical. These covered the Vitest browser command
  and UI-server advisories, Vite/esbuild development-server paths, SvelteKit's
  legacy cookie dependency, and optional Node `sharp`/`onnxruntime-node`
  dependencies pulled by the browser transcription package.

  Vite moved from 5.4 to 8.2, Vitest and its browser runner from 2.1 to 4.1, and
  the Svelte Vite plugin from 4 to 7. The browser suite now uses the dedicated
  `@vitest/browser-playwright` provider and `instances` configuration described
  by the official
  [Vitest Playwright configuration](https://vitest.dev/config/browser/playwright.html)
  and [Vitest 4 migration guide](https://vitest.dev/guide/migration). SvelteKit,
  Svelte, and the static adapter were updated within their supported lines; the
  unused auto-adapter was removed. This satisfies Vite 8's documented Node
  floor, already covered by this repository's Node 22.20 engine requirement;
  see the [Vite 8 release notes](https://vite.dev/blog/announcing-vite8).

  Reviewed overrides pin `cookie` to 0.7.2, `sharp` to the patched 0.35 line,
  and the Node-only `adm-zip` transitive to 0.6. The latter two are optional
  server-side branches of Transformers and are not executed by the browser
  transcription adapter, but remain patched in complete installs. Prettier,
  its Svelte plugin, and TypeScript are pinned to the repository's previously
  verified versions to avoid unrelated formatting and 86-file DOM declaration
  migrations. No `--force`, `--legacy-peer-deps`, or advisory acceptance was
  used.

  Final `npm audit --omit=dev --json`: 0 vulnerabilities across the production
  graph. Final `npm audit --json`: 0 vulnerabilities across the complete graph
  (73 production, 316 development, 67 optional, and 16 peer dependencies as
  reported by npm). `npm ls` confirmed the intended Vite/Svelte/Vitest versions
  and patched overrides. `npm run verify` passed: formatting and ESLint, Svelte
  check with 0 errors and 0 warnings, 88 unit files with 1,116 tests passed and
  11 skipped, 18 browser files with 94 tests passed, and the Vite 8 static
  production build. Runtime/build diagnostics exposed by the newer toolchain
  remain explicitly tracked by AUD-034 and bundle sizing by AUD-035.

### Test integrity, runtime warnings, and delivery size

- [x] AUD-033 Add enforceable coverage and mutation-sensitive regressions.

  - Add line, branch, function, and statement thresholds with justified scoped
    exclusions.
  - Cover every registry adapter through the conformance harness and every CAT
    state transition through unit or browser tests.
  - Explicitly prove that the lock/confirmation, failed-save, failed-export,
    long-TM-match, loading-overlay, and forged-PDF tests fail on commit `14830b5`.

  Completed 2026-08-20; reviewer confirmation: Codex inspected the registry,
  conformance harness, segment editor, persistence queue, export controller,
  loading controller, PDF detection, and their unit/browser suites. Implementation
  commit: `test: enforce CAT regression coverage` (this task's commit). Vitest V8
  coverage is now part of `npm run verify`, with enforced aggregate floors of 84%
  statements, 74% branches, 91% functions, and 86% lines. The measured completion
  baseline is 85.76% statements, 75.16% branches, 92.47% functions, and 87.12%
  lines. Svelte views and routes are intentionally measured by the separate real-
  Chromium suite; declarations, generated fixtures, and test modules are excluded
  because they contain no shipped executable behavior.

  Adapter and state evidence: `conformance.spec.ts` requires exactly one fixture
  for every registered adapter and exercises validation, malformed input,
  identity/derived output, translated reimport, Unicode/RTL, generated large input,
  and declared ZIP-part changes. `segmentationLogic.spec.ts`,
  `workflowState.spec.ts`, persistence tests, and the real CAT route suite cover
  selection, split, join, edit, confirm, unconfirm, lock, unlock, bulk operations,
  save rollback, lifecycle flushing, and export recovery. A new browser regression
  explicitly proves that an empty segment cannot be confirmed, confirmation and
  locking remain independent, unconfirmation persists, and a later edit clears
  confirmation in both the live store and IndexedDB.

  Mutation/baseline proof: the current focused regressions were run against a
  temporary detached worktree at `14830b5` using the current Vitest runner (the
  obsolete `closeIndexedDbConnection` import/call was removed only from the
  temporary compatibility harness). All six failed for the intended historical
  defects: no independent Confirm control; an aborted fill lacked rollback-safe
  behavior; failed delivery closed the export UI; project-read failure produced an
  unhandled rejection/loading recovery failure; malformed `%PDF-` input appeared
  as high-confidence importable PDF; and a reversed 320-token segment scored 100%
  instead of below 70%. Verification: `npm run verify` passed formatting, ESLint,
  Svelte diagnostics (0 errors/warnings), 88 covered unit files with 1,116 tests
  passed and 11 skipped, 18 browser files with 95 tests passed, all four coverage
  gates, and the production build. Runtime warnings emitted during that successful
  run remain explicitly tracked by AUD-034; delivery-size findings remain tracked
  by AUD-035.

- [x] AUD-034 Eliminate browser runtime/test warnings.

  - Resolve Svelte's `derived_inert` warning in filtered TM/TB editing rather than
    suppressing it.
  - Resolve or explicitly isolate the PDF.js dynamic-import warning, invalid
    local-storage-file warning, test-server shutdown hangs, and all unhandled
    test errors.
  - Treat unexpected stderr and unhandled rejections as test failures.

  Completed 2026-08-20; reviewer confirmation: Codex reproduced the Svelte
  `derived_inert` warning in the filtered TM editor, converted the warning into
  an intentional failing trace, and followed it to two-way input bindings on
  derived each-block row contexts. Implementation commit: `test: fail on browser
runtime diagnostics` (this task's commit). Filtered TM/TB library and editor
  views now use ordinary filter functions, and editable row fields use explicit
  synchronous input/change handlers, so teardown never reads an inert derived
  binding. Focused TM and TB browser regressions and the full suite now complete
  without the Svelte warning.

  PDF.js remains an independently exercised browser dependency, but its
  runtime-configurable local worker URL cannot be statically resolved by Vite.
  Browser tests therefore exclude only `pdfjs-dist/legacy/build/pdf.mjs` from
  prebundling and a tested pre-transform adds `@vite-ignore` only to PDF.js's
  `import(this.workerSrc)` expression. Other variable imports are not hidden.
  Node 25's warning-producing built-in `localStorage` getter is replaced in the
  Node test environment with deterministic in-memory Storage. Test setup now
  records unmocked `console.warn`/`console.error` and fails after the responsible
  test; an injected temporary `console.error` was verified to fail. Ignoring
  unhandled errors is explicitly disabled, and the browser runner has a bounded
  teardown timeout. Multiple focused and complete browser runs exited normally
  without shutdown hangs or unhandled rejections.

  Verification: `npm run verify` passed formatting, ESLint, Svelte diagnostics
  (0 errors/warnings), 89 covered unit files with 1,118 tests passed and 11
  skipped, 18 browser files with 95 tests passed and no runtime/test diagnostics,
  all coverage gates, and the production build. The build's dependency and chunk-
  size notices are not browser runtime/test failures; they remain explicitly
  assigned to the immediately following bundle remediation task, AUD-035.

- [x] AUD-035 Set and enforce a production bundle budget.

  - Record route-level compressed and uncompressed budgets.
  - Keep OCR/transcription engines and models out of ordinary application route
    downloads and load them only after the relevant local feature is requested.
  - Review the emitted 23+ MiB ONNX WASM asset, PDF worker, 500+ KiB chunks, and
    1+ MiB app chunks; split or explicitly justify each retained artifact.
  - Add a CI budget check that fails on unapproved regressions.

  Completed 2026-08-20; reviewer confirmation: Codex inspected the production
  client manifest and recorded raw and gzip budgets for `/`, `/about`, `/app`,
  `/tm`, and `/tb` in `bundle-budget.json` and `BUNDLE_BUDGET.md`. The
  `checkBundleBudget.mjs` CI gate follows every production build, measures each
  route's complete static JavaScript/CSS closure, enforces static/dynamic chunk
  and emitted-asset limits, and fails if Tesseract, Hugging Face Transformers,
  or ONNX WASM enters an ordinary route download. The 23.6 MB ONNX WASM asset,
  2.38 MB PDF worker, 1.23 MB PDF.js worker entry, 1.15 MB Reamkit parser, large
  format engines, and 724 KB app node were each traced and documented. OCR,
  transcription, PDF, legacy Office, spreadsheet, and document generators remain
  feature-requested dynamic entries; model payloads are not bundled into a route.

  Implementation commit: `build: enforce production bundle budgets` (this
  task's commit). Affected files: `bundle-budget.json`, `BUNDLE_BUDGET.md`,
  `scripts/checkBundleBudget.mjs`, `package.json`, `package-lock.json`,
  `vite.config.ts`, `src/buildPolicy.js`, and
  `src/test/buildPolicy.spec.ts`. The regression test that isolates only DOCX's
  unused Node stream buffer branch fails before this work because no narrow
  warning policy exists; it also prevents suppressing a first-party browser
  `buffer` warning. The manifest budget gate itself fails on any route, chunk,
  asset, or deferred-engine regression and did not exist in the old code.

  Verification: focused build-policy test passed 1/1; `npm run verify` passed
  formatting, ESLint, Svelte diagnostics (0 errors/warnings), 90 covered unit
  files with 1,119 tests passed and 11 skipped, 18 browser files with 95 tests
  passed, all four coverage gates, the production build, and the new bundle
  budget/deferred-engine gate. Remaining limitation: transcription model weights,
  Tesseract workers/core/language data, and other third-party runtime payloads are
  fetched only when requested and are therefore not byte-budgeted by the local
  build artifact; their route isolation is enforced. No other known AUD-035
  limitation remains.

- [x] AUD-036 Close the external-validator release gates.

  - Run or obtain CI artifacts for LibreOffice ODF/PDF reopening, EPUBCheck,
    DITA-OT, a TeX engine, `windres`, `ffprobe`, and every other conditional
    native check currently skipped.
  - Record tool name/version, operating system, command, result, and fixture for
    every gate. A skipped gate may be documented, but the implementation plan
    must not be described as fully release-validated while it remains skipped.

  Completed 2026-08-20; reviewer confirmation: Codex replaced silent
  tool-unavailable returns with explicit development-suite skips and a strict
  `npm run test:external` release command. The strict runner requires all ten
  tools, enables every opt-in test, fails before a missing validator can be
  mistaken for a pass, and records OS, version command/output, fixture, test
  command and result in JSON plus a complete log. A dedicated Ubuntu CI workflow
  installs the native packages, verifies the published SHA-256 digests of pinned
  EPUBCheck 5.3.0 and DITA-OT 4.4 downloads, runs the strict command, and uploads
  both artifacts even on failure. `EXTERNAL_VALIDATION.md` records the local
  CachyOS result and explains the release/development distinction.

  Implementation commit: `ci: enforce external format validators` (this task's
  commit). Affected files: `.github/workflows/external-format-validation.yml`,
  `.gitignore`, `EXTERNAL_VALIDATION.md`,
  `README_FILE_FORMAT_IMPLEMENTATION_PLAN.md`, `package.json`,
  `scripts/runExternalValidators.mjs`, and the ODF, EPUB, DITA, Windows RC,
  subtitle, ICML, SVG, TTML, DocBook and PO validator specs. The runner also
  activates the existing LaTeX, PDF and QML native checks.
  Regression tests failed on the old gate for concrete reasons: the ODT reopen
  test exceeded Vitest's five-second default; the EPUB fixture failed EPUBCheck
  on metadata/navigation/media requirements; the DITA fixture was filtered out
  by DITA-OT because it had no DITA declaration; and the windres fixture named a
  missing icon. The strict runner and CI artifact did not exist, and missing
  EPUBCheck, LibreOffice, or ffprobe could disable a requested gate silently.

  Verification: the strict release command passed 13/13 files and 125/125 tests
  with zero skips using LibreOffice 25.8.2.2, EPUBCheck 5.3.0, DITA-OT 4.4.0,
  pdfTeX/TeX Live 2026, GNU windres 2.46, FFmpeg ffprobe n8.0, Poppler pdfinfo
  25.10.0, Qt qmllint 1.0, libxml2 xmllint 2.15.1 and GNU msgfmt 0.26. `npm run
verify` also passed formatting, ESLint, Svelte diagnostics (0 errors/warnings),
  90 covered unit files with 1,119 tests passed and 11 intentional external-tool
  skips, 18 browser files with 95 tests passed, all coverage gates, production
  build, and bundle budgets. The strict suite runs those conditional native tests
  separately with zero skips. Remaining limitation: proprietary applications
  such as Adobe FrameMaker are not automatable in this open CI environment and
  are not claimed as validated; no known conditional native-validator gate in
  the repository remains unexecuted.

## Second independent follow-up audit

- [x] AUD-037 Serialize every editor project mutation through the route-owned
      persisted edit queue. A rapid trailing target edit followed immediately
      by confirmation, lock, Fill, TM, or TB must persist the newest combined
      state; no older debounced snapshot may overwrite it.

  Completed 2026-08-21 in the remediation commit containing this entry.
  `segments.svelte` is now the sole project-persistence owner for the open CAT
  editor. Segment, TM, and TB actions submit mutations to the same route-owned
  queue as textarea input; optimistic snapshots are published in queue order,
  failures restore both segment arrays and word counts, and no child performs a
  competing direct IndexedDB project write. The browser state-transition test
  enters three rapid target drafts and immediately confirms, then reloads the
  project from IndexedDB and requires the final target plus confirmation. It
  fails against the old trailing-snapshot behavior.

- [x] AUD-038 Invalidate segment confirmation whenever TM, TB, direct Fill, or
      bulk Fill changes target text. Persist and reload the unconfirmed state
      before progress, QA, or export can treat the changed target as reviewed.

  Completed 2026-08-21. TM replacement, TB insertion, row Fill, keyboard Fill,
  and bulk Fill explicitly clear `checked[index]` for every changed target.
  `catApplication.browser.spec.ts` applies a TM match to a confirmed segment,
  reconfirms it, inserts a TB term, and verifies after each operation by reading
  IndexedDB that the changed target is unconfirmed. No known target-changing
  editor shortcut bypasses this invariant.

- [x] AUD-039 Determine finished-project counts from exact segment state rather
      than a rounded display percentage. A 199/200 project must neither display
      100% nor be classified as finished.

  Completed 2026-08-21. Dashboard completion now requires a non-empty segment
  array whose entries are all confirmed. The regression proves 199/200 displays
  99% and remains unfinished, then becomes 100% and finished only when the final
  segment is confirmed.

- [x] AUD-040 Count multilingual words with Unicode word boundaries, including
      CJK and Thai text without ASCII whitespace, with a safe fallback for older
      browser engines.

  Completed 2026-08-21. Both full-text and project totals share
  `Intl.Segmenter` word boundaries, with a Unicode-aware CJK fallback for older
  engines. Regressions cover Chinese, Japanese, Thai, whitespace-only, and mixed
  whitespace inputs. Word totals are token counts rather than language-specific
  morphological analysis, which is the intended cross-language CAT statistic.

- [x] AUD-041 Contain unavailable, denied, and quota-limited `localStorage`
      access for parsing and dashboard view preferences. These optional settings
      must fall back to defaults and must never prevent the workspace loading.

  Completed 2026-08-21. Parsing-preference reads/writes and project-view
  reads/writes contain storage getter, `getItem`, `setItem`, security, and quota
  failures. Unit regressions inject throwing storage implementations and prove
  default parsing and card views remain usable. When storage is denied these
  optional preferences cannot persist, but project data and workspace loading
  are unaffected.

- [x] AUD-042 Keep the public workflow count synchronized with the 44-adapter
      registry, run the complete unit/browser/build/dependency/external-validator
      gates, and review the final diff before declaring this follow-up complete.

  Completed 2026-08-21. README now reports 44 registered workflows. `npm run
verify` passed formatting, ESLint, Svelte diagnostics with 0 errors/warnings,
  90 unit files with 1,124 tests passed and 11 intentional conditional skips,
  18 browser files with 96 tests passed, coverage gates, production build, and
  bundle budgets. Production-only and full `npm audit --audit-level=high` each
  reported 0 vulnerabilities. The strict external suite separately passed all
  13 files and 125 tests with zero skips using LibreOffice 25.8.2.2, EPUBCheck
  5.3.0, DITA-OT 4.4.0, pdfTeX/TeX Live 2026, GNU windres 2.46, FFmpeg n8.0,
  Poppler 25.10.0, Qt qmllint 1.0, libxml2 2.15.1, and gettext 0.26.

## Third independent follow-up audit

- [x] AUD-043 Run export QA against the editor's current source and target text,
      even when the neutral document model retains immutable rich fragments for
      protected inline-code reconstruction.

  Completed 2026-08-21 in the remediation commit containing this entry.
  `runProjectExportQuality` now scans placeholders and visible tags from the live
  segment arrays while continuing to compare protected inline-code structure
  from the neutral model. The rich-fragment regression changes only the current
  target and fails against the old stale-text scan. No known limitation remains.

- [x] AUD-044 Keep TM and TB collection stores coherent after every successful
      resource update, and convert reactive upload state to plain snapshots
      before cloning, replacing, or merging imported TMX/TBX data.

  Completed 2026-08-21. TM/TB updates reload their collection stores after the
  IndexedDB transaction completes. A real-browser regression updates both
  resources and requires the collection stores to expose the committed values.
  The import failure-path test also exposed that Svelte reactive proxies could
  not be `structuredClone`d; import, same-ID replacement, and merge paths now use
  plain state snapshots. The focused Chromium suite passes 25/25 tests. No known
  collection or reactive-cloning limitation remains.

- [x] AUD-045 Publish import success only after persistence and reopening have
      succeeded; create genuinely empty TM/TB resources; and reject incomplete
      TM units at both the UI and function boundary.

  Completed 2026-08-21. TMX, TBX, and portable-project import notifications now
  follow the awaited database commit. Browser tests inject quota failures and
  require an error with no success toast. Empty memories and term bases contain
  no synthetic blank records, while TM+ remains disabled until both languages
  and both segment texts are present and its function guard returns a helpful
  validation error. That closure statement covered project-editor TM+ and empty
  resource creation, but the later audit found that the standalone TM/TB
  resource editors could still persist their own newly inserted blank rows.
  That narrower gap is tracked and closed independently by AUD-049/AUD-050.

- [x] AUD-046 Reserve 100% progress for exact completion in both per-project and
      aggregate statistics, including empty and near-complete projects.

  Completed 2026-08-21. Incomplete percentages round normally but are capped at
  99; empty projects remain 0; aggregate progress reaches 100 only when every
  project has a non-empty, fully confirmed segment set. Unit regressions cover
  empty, partial, 199/200, and exact-completion states. No known limitation
  remains.

- [x] AUD-047 Let browser downloads begin before object URLs are revoked and run
      browser regressions under configurable Chromium, Firefox, and WebKit
      targets.

  Completed 2026-08-21. Every production download path now defers object-URL
  revocation for one second; a repository regression rejects immediate cleanup.
  `OPEN_TLC_BROWSERS` configures the Vitest Playwright instances, the default
  remains Chromium, `npm run test:browser:matrix` targets all three engines, and
  the dedicated CI workflow installs their runtime dependencies. The complete
  Chromium suite passes 100/100 tests and the CAT Firefox smoke suite passes
  22/22. Local WebKit execution is blocked on this CachyOS host by absent ICU,
  XML, and Flite runtime libraries; Ubuntu CI installs them with Playwright's
  dependency installer, so this host limitation is not hidden as a local pass.

- [x] AUD-048 Run the complete repository, native-format, dependency, and diff
      gates before closing the third follow-up.

  Completed 2026-08-21 after reviewing the final diff. `npm run verify` passes
  formatting, ESLint, Svelte diagnostics with 0 errors/warnings, 90 covered unit
  files with 1,127 tests passed and 11 intentional conditional skips, all four
  coverage thresholds, 18 Chromium browser files with 100 tests passed, the
  production build, and bundle budgets. The strict native-format suite passes
  all 13 files and 125/125 tests with zero skips using LibreOffice 25.8.2.2,
  EPUBCheck 5.3.0, DITA-OT 4.4.0, pdfTeX/TeX Live 2026, GNU windres 2.46,
  FFmpeg n8.0, Poppler 25.10.0, Qt qmllint 1.0, libxml2 2.15.1, and gettext 0.26.
  Production and full high-severity dependency audits report zero
  vulnerabilities. The only remaining environment limitation is the explicitly
  recorded local WebKit host-library gap in AUD-047; no known application defect
  from this follow-up remains.

## Fourth independent follow-up audit

- [x] AUD-049 Treat newly added translation units, target variants, terminology
      concepts, terms, and notes as editor-local drafts. Persist only after the
      complete resource is valid, keep validation failures editable, and prevent
      deletion of the final target variant in a translation unit.

  Completed 2026-08-21 in the remediation commit containing this entry. The TM
  and TB editors now open every newly inserted record in edit mode without
  writing it, retain invalid drafts for correction, and publish success only
  after a complete snapshot commits. The final TM target delete control is
  disabled with an explanatory tooltip and the mutation guard independently
  rejects the operation. `catApplication.browser.spec.ts` proves that new TM
  units, extra targets, TB terms, and notes remain absent from IndexedDB until
  complete; it also covers Unicode/RTL text, validation recovery, and final-
  target protection. The focused Chromium CAT suite passed 26/26. No known
  editor-local invalid-record path remains.

- [x] AUD-050 Enforce the same complete-record invariant at the IndexedDB and
      TMX/TBX serialization boundaries. Empty resource libraries remain valid,
      but a stored or exported record must contain its required language and
      non-whitespace text; an empty terminology note must be completed or
      removed.

  Completed 2026-08-21 in the same remediation commit. Shared TM/TB resource
  validation is called before every create/update transaction and before TMX or
  TBX serialization. Unit cases reject missing variants, blank languages,
  whitespace-only source/target/term values, empty concepts, and empty notes;
  the browser persistence regression proves rejected data never reaches the
  object stores. Existing empty-library creation remains supported, while TMX
  correctly continues to require at least one unit for file export. Existing
  identity/translated round trips, malformed/adversarial imports, large-file
  generation, and independent-parser reopen tests remained green in the full
  suites. No known boundary bypass remains.

- [x] AUD-051 Run focused mutation-sensitive editor, persistence, Unicode/RTL,
      malformed-resource, and round-trip regressions, then rerun the full
      repository, native-format, dependency, Chromium, and Firefox gates before
      closing this follow-up. Keep the already documented local WebKit runtime
      limitation distinct from application correctness; the browser-matrix CI
      workflow remains the WebKit release gate.

  Completed and reviewer-confirmed 2026-08-21. `npm run verify` passed Prettier,
  ESLint, Svelte diagnostics with 0 errors/warnings, 90 covered unit files with
  1,135 tests passed and 11 intentional conditional skips, all four coverage
  thresholds, 18 Chromium browser files with 105/105 tests, production build,
  and bundle budgets. The complete Firefox run passed the same 18 files and
  105/105 tests. The strict native suite passed 13 files and 125/125 tests with
  zero skips using LibreOffice 25.8.2.2, EPUBCheck 5.3.0, DITA-OT 4.4.0,
  pdfTeX/TeX Live 2026, GNU windres 2.46, FFmpeg n8.0, Poppler 25.10.0, Qt
  qmllint 1.0, libxml2 2.15.1, and gettext 0.26. Production and complete npm
  audits both reported 0 vulnerabilities. Local WebKit remains unavailable only
  because this CachyOS host lacks its ICU/XML/Flite runtime libraries; the
  checked-in Ubuntu browser-matrix workflow installs those dependencies and is
  the WebKit gate.

## Fifth independent follow-up audit

- [x] AUD-052 Rebuild translated PDFs as flattened delivery documents, remove
      extractable source objects, and add a searchable translated text layer.

  Completed 2026-08-21 in `5039be8`. Both source-PDF and converted-document
  delivery paths now create fresh PDFs from rendered pages and add invisible
  Unicode target text. Browser regressions reopen output with PDF.js, verify
  page geometry, require translated extraction, and prove replaced source text
  is absent. No scripts, forms, links, attachments, or original PDF objects are
  copied into delivery output. PDF extraction and visual replacement remain
  inherently lossy and are still labelled accordingly.

- [x] AUD-053 Remove whole-project clones and full target-word recounts from
      every editor keystroke while retaining exact rollback and final-save
      behavior.

  Completed 2026-08-21 in `ee72501`. The live editor mutates the addressed
  target/confirmation fields, adjusts the word count by old/new segment delta,
  and takes immutable snapshots only when the immediate or trailing coalesced
  write starts. Queue tests prove three rapid edits produce two snapshots/writes
  and that persistence failure still restores the exact committed project.

- [x] AUD-054 Validate media container structure beyond magic bytes, bound local
      decoded-audio allocation, and pass cancellation through image decoding,
      OCR, audio decoding, model loading, and transcription.

  Completed 2026-08-21 in `592b4ff`. WAV chunk structure, MP3 frames, Ogg page
  headers, FLAC STREAMINFO, WebM Segment markers, and ISO-BMFF boxes are checked
  from a bounded header read. Header-only WAV is rejected, decoded audio is
  capped at one hour, and OCR/transcription extension points receive the active
  AbortSignal; built-in workers/models check it during progress and terminate
  on cancellation. Focused OCR/transcription tests pass 22/22.

- [x] AUD-055 Prevent stale browser tabs from silently overwriting newer
      projects and make the documented 100-record bulk-write batching real.

  Completed 2026-08-21 in `050a3f4`. Project schema version 3 adds a monotonic
  persistence revision. Every project write compares the caller revision inside
  its read/write transaction and rejects a mismatch with a reload instruction.
  A real-browser regression saves two copies of one revision and proves the
  second stale write fails while the first tab's text remains. Bulk writes now
  commit ordered slices of at most 100 records.

- [x] AUD-056 Give source and target content independent language and direction
      semantics, including locked target text and additional RTL languages.

  Completed 2026-08-21 in `6ecac50`. The segment container no longer mislabels
  source UI as target-language content. Source text, editable targets, and
  locked targets expose their own `lang` and `dir`; the RTL set covers Arabic,
  Hebrew, Persian, Kurdish-family, Pashto, Sindhi, Syriac, Uyghur, Urdu, Yiddish,
  Divehi, and N'Ko codes. The focused Chromium accessibility regression passes.

- [x] AUD-057 Reconcile implementation-plan claims and CAT package evidence
      labels with the code and focused round-trip tests.

  Completed 2026-08-21 in the roadmap/evidence commit containing this entry.
  FF-005 now describes actual coalesced snapshots, batching, and revision
  conflicts; FF-006 no longer preserves its superseded legacy-format exclusion;
  FF-401 describes flattened searchable delivery PDFs; FF-402 records bounded
  structural media checks and cancellation; and FF-403 calls repository-reopen
  evidence `automated-round-trip` instead of `assumed-compatible`. The CAT,
  migration, and persistence-queue focused run passed 3 files and 41 tests, and
  Svelte diagnostics reported 0 errors and 0 warnings.

- [ ] AUD-058 Run formatting, lint, type checking, full coverage/unit and
      Chromium browser suites, production build/bundle checks, available native
      validators, dependency audit, and final diff review. Record exact evidence
      here before declaring the fifth follow-up complete.

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
- PDF output is reopened with PDF.js in browser tests. This historical statement
  that delivery retained original PDF objects is superseded by AUD-052: output is
  now flattened, visually mapped, searchable in the target language, and does
  not retain replaced extractable source text.

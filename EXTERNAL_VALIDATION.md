# External format validation

`npm run test:external` is the strict release gate for generated files that need
an independent native application, compiler, or parser. It fails when any tool
is missing, runs the format fixtures with every opt-in validator enabled, and
writes the operating system, exact version commands, tool versions, fixture
descriptions, test command, and result to `artifacts/`.

The `External format validation` GitHub Actions workflow installs pinned
EPUBCheck 5.3.0 and DITA-OT 4.4 distributions after checking their published
SHA-256 digests. Its Ubuntu runner also supplies LibreOffice, TeX Live,
GNU windres, FFmpeg, Poppler, Qt qmllint, libxml2 xmllint, and GNU msgfmt. The
report and complete log are uploaded even when a gate fails.

For workstation diagnosis, `npm run test:external:available` executes every
installed validator and records missing tools as `incomplete`. That command is
not a release pass. A release is externally validated only when the strict
command exits successfully and its report says `"status": "passed"` with no
missing validators.

## Covered generated fixtures

| Validator                 | Generated output inspected                                     |
| ------------------------- | -------------------------------------------------------------- |
| LibreOffice               | ODT, OTT, ODM, OTS, OTP, and ODF reopened and converted to PDF |
| EPUBCheck                 | EPUB 3 package                                                 |
| DITA-OT                   | DITA topic published to HTML5                                  |
| `pdflatex`                | LaTeX article compiled to PDF                                  |
| GNU `windres`             | Windows RC compiled to RES                                     |
| FFmpeg `ffprobe`          | ASS and Spruce STL subtitle streams                            |
| Poppler `pdfinfo`         | One-page PDF fixture                                           |
| Qt `qmllint`              | QML document                                                   |
| libxml2 `xmllint --nonet` | DITA, DocBook, ICML, SVG, and TTML XML                         |
| GNU `msgfmt`              | Gettext PO compiled to MO with format checks                   |

Conditional tests use explicit Vitest skips in ordinary development runs. When
the strict release command sets an opt-in environment variable, a missing tool
is a hard failure rather than a silent skip.

## Recorded strict result — 2026-08-20

The strict gate passed on CachyOS Linux, kernel `6.12.56-3-cachyos-lts`, x86-64.
It ran 13 focused files and all 125 tests passed with no skips. The command was
`npm run test:external`; `scripts/runExternalValidators.mjs` expanded it to the
13 format specifications recorded in the JSON report.

| Tool                   | Recorded version               | Result |
| ---------------------- | ------------------------------ | ------ |
| LibreOffice            | 25.8.2.2                       | Passed |
| EPUBCheck              | 5.3.0                          | Passed |
| DITA-OT                | 4.4.0                          | Passed |
| pdfTeX / TeX Live      | 3.141592653-2.6-1.40.29 / 2026 | Passed |
| GNU windres / Binutils | 2.46.0.20260210                | Passed |
| FFmpeg ffprobe         | n8.0                           | Passed |
| Poppler pdfinfo        | 25.10.0                        | Passed |
| Qt qmllint             | 1.0                            | Passed |
| libxml2 xmllint        | 2.15.1                         | Passed |
| GNU msgfmt             | 0.26                           | Passed |

The complete machine-readable report and test log are regenerated under
`artifacts/` and uploaded by CI. This recorded result covers the automated
offline gates above; it does not claim testing in proprietary authoring tools
such as Adobe FrameMaker.

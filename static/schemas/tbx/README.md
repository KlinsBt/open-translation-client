# Local TBX validation assets

Open TLC validates TBX in two layers: the local Relax NG grammar checks the
ISO 30042:2019 core hierarchy, while the selected JSON profile drives the
dialect/style, data-category, pick-list, placement, ID, and reference checks in
`src/lib/formats/tbx.ts`. This split mirrors the current LTAC dialect packages,
which use a core grammar plus dialect-specific Schematron (and NVDL for DCT).

The profiles are derived from the public LTAC-Global TBX-Core 1.0, TBX-Min
1.0.1, and TBX-Basic 1.2.1 definition packages. They are intentionally local so
opening or exporting a termbase never resolves a remote schema or DTD.

Sources:

- https://ltac-global.github.io/TBX-Core_dialect/
- https://ltac-global.github.io/TBX-Min_dialect/
- https://ltac-global.github.io/TBX-Basic_dialect/
- https://www.tbxinfo.net/tbx-dialects/

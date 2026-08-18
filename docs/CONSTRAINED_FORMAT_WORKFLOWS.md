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

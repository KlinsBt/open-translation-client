<h1 align="center">Open TLC</h1>

<div align="center">
    <img alt="Logo Banner" src="./static/md-pictures/banner.png"/>
    <br/>
    <br/>
    <a href="https://github.com/KlinsBt/open-translation-client?tab=MPL-2.0-1-ov-file">
        <img alt="MPL 2.0 License" src="./static/md-pictures/license.svg"/>
    </a>
    <!-- <a href="https://github.com/KlinsBt/open-translation-client/releases">
        <img alt="Current Release" src="./static/md-pictures/version.svg"/>
    </a> -->
</div>

---

<p>
Open Translation Client (Open TLC) is a free and open source web-based CAT-Tool designed for professional translators, teachers, and students. Initially developed as a master thesis project at Anhalt University of Applied Sciences, Germany, Open TLC focuses on user-friendliness and accessibility. It supports multiple save file formats, including industry standards such as XLIFF 1.2 and 2.0 as well as a our own self defined JSON-based save file format. Being a web-based application, it works seamlessly on any device with a browser, whether it's a desktop, tablet, or smartphone.
</p>

<p> 
Open TLC stores all translation projects locally using your browser's own IndexedDB database, ensuring full control over your data without relying on external servers. Users can export projects in JSON or standard XLIFF formats for backup or sharing. Imported SDLXLIFF, MQXLIFF/MQXLF, Phrase MXLIFF, WorldServer WsXLIFF, WPML, XLIFF:doc, and recognized CMS/e-learning XLIFF variants have a separate same-profile export that preserves their vendor structure. TTX, ITD, Wordfast/GlobalLink TXML, and structurally recognized Trados Workbench bilingual files use protected target-only writers. To prevent data loss from unforeseen issues like cache clearing or device failures, regular backups are recommended.
</p>

<p>
Open TLC supports 42 registered office, web, localization, diagram, publishing, subtitle and media workflows. This includes XLIFF 1.2–2.1, TMX, TBX, TTX, ITD, TXML, XLIFF:doc, Workbench bilingual files, SRT/WebVTT/SBV and styled ASS/SSA/Spruce STL subtitles, modern and legacy Office files, Visio OPC/XML drawings, Adobe IDML/ICML/INX, FrameMaker MIF/MIF2, QuarkXPress Tags, protected Photoshop PSD text-layer conversion, DITA BOOKMAP, specialist ITS, MULIX, Author-it, MadCap, TYPO3, SpreadsheetML 2003 and constrained SGML profiles, local PNG/JPEG/TIFF/BMP/DIB/GIF image OCR (including common JPEG filename aliases), local audio/video transcription, and Trados, WorldServer and memoQ return packages. Source files and projects stay in the browser; PSD resources stay in the retained original, while OCR and transcription may download model assets but do not upload the user's media.
</p>

<p> 
As an open source project, Open TLC welcomes contributions. Developers can access the source code on GitHub, report issues, suggest features, or assist with translations. 
</p>

---

#### Want to get started?

Head over to our plattform <a href="https://opentlc.org">opentlc.org</a> and start using Open TLC for your translation project, terminology database or translation memory management system.<br/>

<br/>

#### Something not working right?

Open an <a href="https://github.com/KlinsBt/open-translation-client/issues">Issue</a> on GitHub.<br/>

<br/>

#### Want to contribute?

No formal guidelines are implemented yet, but ontributions are always welcomed. If you open a pull request we will review and discuss it until formal guidelines are in place.

See the [file-format implementation plan](./README_FILE_FORMAT_IMPLEMENTATION_PLAN.md)
for the prioritized import/export roadmap and its completion criteria.

#### TM and term-base language matching

Open TLC canonicalizes valid BCP 47 language tags before matching (for example,
`EN_us` becomes `en-US`). Translation memories prefer an exact source or target
locale. Only when no exact locale exists do they fall back to entries with the
same base language; term bases apply the same exact-first rule within each
concept. Invalid legacy language labels can match the same label
case-insensitively, but never receive base-language fallback. Long fuzzy matches
use ordered token evidence with multiplicity, so reordered non-identical text is
never reported as a 100% match.

---

#### Prerequisites

Before the project can be built, you must first install the latest [Node.js](https://nodejs.org/en) version on your system.

If not already installed, you need to install the Node Package Manager aswell with:

`npm install`

<br/>

#### Cloning the Repository

After dependencies have been installed you will need to clone a local copy of this repository. The following example shows how you can clone the repository directly over HTTPS.

```bash
git clone https://github.com/KlinsBt/open-translation-client.git
```

<br/>

#### Running the Test Environment

When you have a local copy of the cloned repo folder `cd` into that folder directory and install all npm dependencies first with:

`npm install`

Then run the application using:

`npm run dev`

#### Running Automated Verification

Run the complete formatting, type/accessibility, unit, integration, output, and
production-build checks with:

`npm run verify`

Run only the automated test suite with:

`npm test`

<br/>

#### Running the Production Environment

Once you made some changes to the repo and are confident that it can run on a production environment, build the application using

`npm run build`

Then run the production built to check it using:

`npm run preview`

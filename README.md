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
Open TLC stores all translation projects locally using your browser's own IndexedDB database, ensuring full control over your data without relying on external servers. Users can export projects in JSON or XLIFF formats for backup or sharing purposes. To prevent data loss from unforeseen issues like cache clearing or device failures, regular backups are recommended.
</p>

<p>
Open TLC supports JSON, XLIFF 1.2, and XLIFF 2.0 formats, making it compatible with other CAT-Tools and industry standards. It provides a clear and intuitive structure for translation projects, including details like source and target languages, creation date, and translation segments. It also supports Translation Memories and TMX files aswell as Terminology databases and TBX files.
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

<br/>

#### Running the Production Environment

Once you made some changes to the repo and are confident that it can run on a production environment, build the application using

`npm run build`

Then run the production built to check it using:

`npm run preview`

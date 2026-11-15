# Editing eMelbourne: a guide for collaborators

This guide is for anyone who adds to or corrects eMelbourne entries. You don't need any technical
knowledge. You need:

- a computer with Chrome, Edge, Firefox or Safari
- a free GitHub account, which the eMelbourne team has added to the project (ask them if you haven't
  been added yet)

There are three stages: **edit** the entry in the eMelbourne editor, **save** it, then **upload**
it to GitHub. Nothing on the website changes until you upload.

---

## 1. Open the editor

Use whichever of these the team has told you to use:

- **On the website:** go to
  [notamitchell.github.io/melbourne/editor.html](https://notamitchell.github.io/melbourne/editor.html)
  (the site's address with `editor.html` on the end).
- **From a copy on your computer:** open the `site` folder and double-click `editor.html`. It opens
  in your web browser. (To get a copy, the team can send you one, or on the GitHub page for the
  project press the green **Code** button, then **Download ZIP**, and unzip it.)

If you use a copy on your computer, get a fresh one before each editing session, so you start from
the latest version of every entry.

## 2. Find the entry, or start a new one

The editor opens with three choices.

- **Edit an entry:** type part of the entry's name, or its ID (such as `EM00187`), and click it in
  the list. An entry's ID is at the end of its address on the website (`entry.html?id=EM00187`).
- **Start a new entry:** type the title, choose the type (Entry, Person, Place, and so on) and press
  **Create**. For a person, write the title as *Surname, First names*, for example *Batman, John*.
  The editor gives the new entry the next free ID.
- **Open a saved file:** if you saved an entry earlier but haven't uploaded it yet, choose its
  `.xml` file to carry on.

## 3. Make your changes

The **Edit** tab has a box for each part of the entry. Change only what you need to; anything you
leave alone stays exactly as it was.

- **About this entry:** the title, the type and the authors (one name per line).
- **Facts / Dates:** for a person, their name, birth, death and occupations. For anything else, its
  start and end dates. Write dates as you would in a sentence, such as *3 March 1850*, *1850* or
  *c. 1850*.
- **Quick facts:** an optional short list at the top of the article, used on the cultural artefact
  pages (*Artist:*, *Media:*, *Created:*, *Location:*).
- **Article:** the main text. It works like a word processor: bold, italic, headings, lists and
  quotations are on the toolbar.
  - **Link to another eMelbourne entry:** select some words, press **Link to entry**, type the
    entry's name and click it.
  - **Link to another website:** select some words and press the chain button.
  - **Add a picture from a collection:** copy the link to the item's page at Trove (National
    Library of Australia), State Library Victoria, Public Record Office Victoria or University of
    Melbourne Digitised Collections, or a link to an image file, and paste it on a line of its own.
    After a moment it turns into the picture, with a caption linking back to the collection.
- **Gallery:** the pictures shown under the article. Paste a collection link in the box and press
  **Add picture**, then write a caption and, if you know them, the creator and date. Every picture
  needs a caption. Use the arrows to change the order, and **Remove** to take one out.
- **Related entries:** press **Add a related entry** and choose the entry. The × removes one.
- **References:** press **Add a reference** and fill in what you know: author, title, the book or
  journal it was published in, place, publisher, year, pages, and a link if it's online. Click a
  reference to open it and correct it.
- **About your change:** your name, and a few words on what you changed. These go in the entry's
  history.

Your work is kept in the browser as you go. If you close the tab by mistake, open the editor again
and press **Carry on with it**. (This only works on the same computer and browser.)

## 4. Check it

- The **Preview** tab shows the page as it will look on the website.
- The **Compare** tab lists everything you've changed, with the old version on the left and the new
  one on the right. Deleted words are crossed out in red and new words are highlighted in green.
  Check it before you save, especially that nothing has gone missing by accident.

## 5. Save

Press **Save files** (top right, or at the bottom of the form). Two files go into your **Downloads**
folder, named after the entry's ID:

| File | What it is |
| --- | --- |
| `EM00187.xml` | The entry itself. |
| `EM00187.js` | A copy of the same entry that the website loads. |

If the browser asks whether to allow the site to download several files, choose **Allow**. If only
one file arrived, use the links in the *Saved* box to download the other again.

**Check the file names.** If you have saved the same entry before, your computer may have named
the new files `EM00187 (1).xml` and `EM00187 (1).js`. Either delete the older files from your
Downloads folder and rename the new ones, removing ` (1)`, or rename them before you upload. The
names must be exactly the ID followed by `.xml` and `.js`, or the website won't find them.

## 6. Upload to GitHub

You upload each of the two files to its own folder. Each upload is called a *commit*.

**Shortcut:** after you save, the editor's *Saved* box has a link to each upload page. Use them
and you can skip straight to step 5 below for each file.

### Upload the .xml file

1. Go to [github.com](https://github.com) and sign in.
2. Open the eMelbourne project at
   [github.com/notamitchell/melbourne](https://github.com/notamitchell/melbourne).
3. Click the **site** folder, then the **tei** folder. You'll see a long list of files whose names
   start with `EM`. GitHub only lists the first 1,000 and says the list has been truncated; that's
   expected, and you don't need to find your file in the list.
4. Near the top right, press **Add file**, then **Upload files**.
5. Drag the `.xml` file from your Downloads folder onto the page (or click **choose your files** and
   pick it). Wait until the file name appears under the drop area.
6. Scroll down to **Commit changes**. In the first box, write a short description, for example
   *Corrected birth date of John Batman* or *New entry: Fitzroy Gardens*.
7. Leave **Commit directly to the main branch** selected, and press the green **Commit changes**
   button.

### Upload the .js file

1. At the top of the page, click **site** in the folder path (it looks like
   `melbourne / site / tei`) to go back up one folder.
2. Click the **tei-js** folder.
3. Do steps 4 to 7 again with the `.js` file.

Upload both files, and make sure each goes into the right folder: the `.xml` file into `tei`, and
the `.js` file into `tei-js`.

If the entry already existed, uploading replaces it with your version; that's expected. GitHub keeps
every earlier version, so nothing is ever lost and a mistake can always be undone by the team.

## 7. See it on the website

The website updates a few minutes after you upload. The search and A to Z pages update themselves
too. Open the entry's page (`entry.html?id=EM00187`) and check it. If you see the old version,
wait a minute and reload the page.

---

## If something goes wrong

- **The editor says it can't open an entry.** Check the ID. If you're using a copy on your computer,
  it may be out of date: download a fresh one.
- **No picture appears after pasting a collection link.** The link has to be to a single item that
  has a digitised image, and the editor only recognises the collections listed above, IIIF image
  links and links ending in `.jpg`, `.png`, `.gif` or `.webp`. If it can't find a picture, the link
  stays as an ordinary link.
- **You uploaded a file to the wrong folder, or with the wrong name.** Tell the team; they can move or
  remove it. Don't worry, nothing is lost.
- **Two people edit the same entry at once.** Whoever uploads second replaces the first person's
  changes. If you're planning a big change to an entry, let the team know first.
- **Two people start new entries at the same time.** The editor may give both the same ID, and the
  second upload would replace the first. If you're writing a new entry, tell the team, and check on
  the website that the ID you were given is still free before you upload.
- **You get an email from GitHub saying "Run failed: Rebuild search index".** The file you uploaded
  has a mistake in it, usually because it was edited outside the editor. The website keeps its
  previous search index until it's fixed. Tell the team and forward them the email; the link in it
  shows which file and line is wrong.
- **GitHub says "Uploads are disabled. File uploads require push access to this repository", or
  there is no *Upload files* choice under *Add file*.** Either you aren't signed in, or your account
  hasn't been added to the project yet. Ask the team to add you, accept the invitation email from
  GitHub, then try again.

---

## For the team

- `site/editor.html` is the editor. It needs no server: it works double-clicked and on any static
  host. It isn't linked from the site's pages and asks search engines not to index it, but it is
  public if the site is; it can only download files, never change the site.
- To let someone upload, add their GitHub account: on the repository page, **Settings** →
  **Collaborators** → **Add people**. They get an email invitation and must accept it first.
- `githubRepo` near the top of `site/js/editor.js` is set to `"notamitchell/melbourne"`, so the
  *Saved* box links straight to the two upload pages. Change it if the repository moves.
- `.github/workflows/rebuild-index.yml` runs `tools/build_index.py` and `tools/build-facets.py`
  whenever a file in `site/tei/` changes. It rebuilds `site/tei-js/`, `site/data/index.js` (search
  and A to Z), `site/data/names.js` and `site/data/facets.js` (advanced search) from the TEI files,
  commits them, and checks every TEI file against the
  schema. It can also be run by hand from the **Actions** tab (*Rebuild search index* → *Run
  workflow*). So strictly a collaborator only needs to upload the `.xml` file; the `.js` file is
  regenerated anyway. Uploading both keeps the site correct even before the workflow has run.
- `.github/workflows/deploy-pages.yml` publishes `site/` to GitHub Pages. A TEI upload is published
  only after the rebuild workflow succeeds, so a file that fails validation never goes live; any
  other change to `main` is published straight away.
- On a host without GitHub Actions, run `python3 tools/build_index.py` after adding files (Python 3,
  no other packages), or use **Download updated index files** in the editor's *Saved* box. That
  merges the one entry into the index files of the copy the editor was opened from, so only use it
  when nobody else is editing at the same time.

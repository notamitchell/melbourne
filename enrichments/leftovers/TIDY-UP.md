# Content tidy-up: findings and recommendations (15 Nov 2026)

The source lists are in this folder: `unmapped-tags.csv`, `unlinked-bibliography.csv`,
`unlinked-digital-objects.csv` and `unlinked-archival-records.csv`, written from the database by the conversion thread.

## 1. Stray HTML tags: fixed

Only one tag was left unmapped. The "~10" count came from an earlier converter version.

- **EM00360 (Climate):** `<h3>Climate by Months</h3>` had become a plain paragraph. It is now a TEI subdivision,
  `<div rend="h3"><head>Climate by Months</head>…</div>`, wrapping the month-by-month section, and renders as a heading.
  The file validates.

## 2. Unlinked leftovers: recommendations

**Overall: keep almost everything (99 of 100) and drop one item.** Most of these are only "unlinked" because the
links run through objects or collections, not straight to an entry.

### Bibliography (31)

| Items | What they are | Recommendation |
|---|---|---|
| PEM000044 Wright, *A people's counsel* (1992); PEM000266 de Serville, *Pounds and pedigrees* (1991); PEM000284 Onians, *Read all about it* (1953) | Standard Melbourne histories | **Keep.** Cite from Parliament of Victoria (EM01118), Melbourne Club (EM00931) and the newspapers/media entry respectively, or add them to a general Further reading list |
| PEM001997 to PEM002100 (19 books, 1888 to 1986) | A 2009 batch "prepared by Helen Morgan and Ailie Smith" with library catalogue ids: school, church, university and education histories | **Keep** as a single "Melbourne bibliography" page. None has a matching entry to attach it to |
| PEM000681 City of Melbourne, "welcomes 'new look' Driver Lane" (2004 web page) | Council media release; the URL is dead | **Drop**, or cite from Driver Lane (EM01782) with a web-archive link if one exists |
| PEM000631 ADB online; PEM000633 AWM *Fifty Australians*; PEM000638 Victorian Heritage Register; PEM000645 Laneway Commissions 2004 | Parent records that cited sections belong to (isPartOf) | **Keep.** They complete the citations of the sections that are cited. Update the old URLs (e.g. adb.online.anu.edu.au becomes adb.anu.edu.au) |
| PEM000675 Degraves, PEM000677 Anderson, PEM000686 Finn, PEM000691 Goldsbrough (ADB articles) | ADB biographies cited by nothing | **Keep and attach**: Finn to EM02152 and Anderson to EM02485. William Degraves and Richard Goldsbrough have no person entry, so cite them from Degraves Street (EM01774) and Goldsbrough Mort (EM00653) |

### Digital objects (8)

- **D00000639, D00000664, D00000667, D00000689, D00000708, D00000789, D00000846:** **Keep.** These are PROV letters
  (VPRS 3621 and 3622) that the **Civic Treasures** page links to, so they are already on the site. They just aren't tied
  to an entry. Their images were in the old paged viewer (`image_viewer_paged.htm?VPRS3621,455,…`), and PROV has
  not digitised VPRS 3621 or 3622 online.
- **D00000007** "Little Flinders Street East, now Flinders Lane" (SLV, 1875): **Keep and link** to Flinders Lane
  (EM00586), which already has its five sibling photographs (D00000001 to D00000005). The image file nc000637.jpg is
  not in the archive.

### Archival records (61)

| Items | What they are | Recommendation |
|---|---|---|
| A00000012 VPRS 3181 Town Clerk's Files Series 1, and 44 unit/item records (Units 467 to 474, 1856 to 1878, e.g. A00000143 "Unit 467, dated 29 September 1856") | The PROV citations for the laneway correspondence objects (e.g. D00000053 Highlander Lane, 29 September 1856) | **Keep** and attach each to its object as a PROV reference, as the Everyday War letters now have. VPRS 3181 is not digitised at PROV, so there are no images |
| A00000176 VPRS 3182, A00000177 VPRS 8863 | PROV series records | **Keep** as series-level sources |
| A00000001 to A00000010, A00000013, A00000023 (11 SLV) | SLV collections the pictures come from (Pictures Collection, J.T. Collins, Caldwell, Harvey, Sievers, MMBW plans) | **Keep** as image provenance. They will also help match SLV images later |
| A00000011 Luly Collection, A00000173 Andrew May Private Collection, A00000174 Museum Victoria album | Lenders and collections | **Keep** as provenance. "Courtesy Andrew May Private Collection" already appears in object rights |

Suggested next step: map objects to archival records with `dobject.arcid` from the database, then show
"Collection" and "Archival reference" on object pages. I can do this once the mapping is exported.

## 3. Broken internal links

I checked every `ref`/`ptr`/`graphic` in all 3,412 TEI files, the object list (`objects.js`), the menu (`nav.js`)
and the local `href`/`src` links in the HTML and JS.

- **Links between entries, pages, objects and anchors: none broken.** Every `EM…xml`, `ohrm:D…`, `pages/…` and `#id` target exists.
- **Objects linked to entries: none broken.**
- **Missing images: 752**, all already hidden by the renderer:
  - Civic Treasures: 452
  - Letterheads: 256
  - Everyday War front page: 14
  - Everyday War year pages: 6
  - About (partner logos): 9
  - Home: 8
  - Help: 5
  - The image files for D00000007
  
  These are the image-recovery item that is on hold.

## 4. Done (approved 15 Nov 2026, `tools/apply_leftovers.py`)

- **Cited in entries:** Wright, *A people's counsel*, in Parliament of Victoria (EM01118); de Serville, *Pounds and pedigrees*,
  in Melbourne Club (EM00931); ADB "Degraves, William" in Degraves Street (EM01774); ADB "Goldsbrough, Richard" in
  Goldsbrough Mort (EM00653).
- **Not added, as duplicates:** the ADB records for Finn (PEM000686) and Anderson (PEM000677). EM02152 and EM02485 already
  cite the same articles under other ids.
- **New page "Further Reading"** (`tei/pages/further-reading.xml`, linked from About): 20 books (the 19 from 2009 plus Onians,
  *Read all about it*), the 4 parent web resources (ADB online, AWM *Fifty Australians*, Victorian Heritage Register,
  Laneway Commissions 2004), and the 4 archival collections that no object uses (Harold Paynting Collection, the two MMBW
  plan records, Unit 467 item 1864/90).
- **Objects:** D00000007 is linked to Flinders Lane. All 1,477 objects with an archival record now show it on their
  object page as "Archival source", which covers the 57 leftover archival records that objects use (e.g. D00000053:
  "Unit 467, dated 29 September 1856, part of VPRS 3181 …, Public Record Office Victoria").
- **Dropped:** PEM000681, the dead 2004 City of Melbourne Driver Lane link.

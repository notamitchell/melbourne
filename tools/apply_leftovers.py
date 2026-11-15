"""Attach the OHRM leftovers kept in the content tidy-up (enrichments/leftovers/TIDY-UP.md).

  1. Cites four unlinked publications in the entries they belong to (tei/EM*.xml).
  2. Writes tei/pages/further-reading.xml: the unlinked books, the parent web resources, and the
     archival collections no object uses; adds it to data/nav.js and links it from the About page.
  3. Links D00000007 to Flinders Lane (EM00586) in data/objects.js.
  4. Gives every object with an archival record its source in data/objects.js ("archive"), shown on
     object pages: e.g. "Unit 467, dated 29 September 1856", part of "VPRS 3181 ...", PROV.
The dead 2004 Driver Lane link (PEM000681) is left out on purpose. Safe to re-run.
Then run tools/build_index.py and tools/build-facets.py, and tools/validate.sh.
Usage: python3 tools/apply_leftovers.py [site]"""
import csv, json, os, re, sys
from xml.sax.saxutils import escape, quoteattr

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(root, "tools"))
from convert import bibl  # the converter's own <bibl> writer, so new references match the old ones

site = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "site")
left = os.path.join(root, "enrichments", "leftovers")
rows = lambda f: list(csv.DictReader(open(os.path.join(left, f), encoding="utf-8")))
pubs = {r["pubid"]: r for r in rows("unlinked-bibliography.csv")}
arcs = {r["arcid"]: r for r in rows("archival-records.csv")}
read = lambda p: open(p, encoding="utf-8").read()
def write(p, s):
    with open(p, "w", encoding="utf-8") as f: f.write(s)

# 1. references in entries. Finn (PEM000686) and Anderson (PEM000677) are not added: EM02152 and
#    EM02485 already cite the same ADB articles under other ids (PEM000761, PEM001093).
CITE = {"EM01118": "PEM000044", "EM00931": "PEM000266", "EM01774": "PEM000675", "EM00653": "PEM000691"}
for eid, pid in CITE.items():
    p = os.path.join(site, "tei", eid + ".xml"); s = read(p)
    if 'xml:id="%s"' % pid in s: continue
    b = bibl(pubs[pid])
    if "</listBibl>" in s:
        s = s.replace("</listBibl>", b + "</listBibl>", 1)
    else:
        s = s.replace("</body>\n", '</body>\n<back><div type="bibliography" xml:id="references"><head>References</head>'
                      "<listBibl>%s</listBibl></div></back>\n" % b, 1)
    write(p, s); print("cited", pid, "in", eid)

# 2. Further reading page
books = [p for k, p in pubs.items() if p["type"] in ("Book", "Edited Book") and k != "PEM000044" and k != "PEM000266"]
books.sort(key=lambda p: (p["author"] or p["title"]).lower())
web = [pubs[k] for k in ("PEM000631", "PEM000633", "PEM000638", "PEM000645")]
spare = [arcs[a] for a in ("A00000005", "A00000013", "A00000014", "A00000023")]
def arc_item(a):
    parent = arcs.get(a["ispartof"].split()[0]) if a["ispartof"] else None
    bits = [escape(a["artitle"])]
    if parent: bits.append("part of " + escape(parent["artitle"]))
    if a["repository_name"]: bits.append(escape(a["repository_name"]))
    return "<item>%s</item>" % ", ".join(bits)
page = """<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="../../schema/emelbourne.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" type="topic" subtype="page" xml:lang="en"><teiHeader><fileDesc><titleStmt><title>Further Reading</title></titleStmt><publicationStmt><publisher>eMelbourne: The Encyclopedia of Melbourne Online</publisher><idno type="page">further-reading</idno><availability><licence target="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</licence></availability></publicationStmt><sourceDesc><p>Publications and archival records in the eMelbourne OHRM database that no entry cites, <ref target="https://doi.org/10.26188/23983911.v1">doi:10.26188/23983911.v1</ref>. Gathered in the content tidy-up (enrichments/leftovers/TIDY-UP.md).</p></sourceDesc></fileDesc><revisionDesc status="published"><change type="created">Gathered from unlinked OHRM records, 2026.</change></revisionDesc></teiHeader><text><body>
<div><p>Works on Melbourne recorded in the eMelbourne database that are not cited by any one entry. Most of the books were compiled by Helen Morgan and Ailie Smith in 2009.</p></div>
<div rend="h3"><head>Books</head><listBibl>%s</listBibl></div>
<div rend="h3"><head>Online resources</head><p>Web resources whose pages are cited in entries. Their addresses are as recorded in 2004 to 2008 and may have moved.</p><listBibl>%s</listBibl></div>
<div rend="h3"><head>Archival sources</head><p>Collections recorded in the database that no digital object comes from.</p><list rend="bulleted">%s</list></div>
</body></text></TEI>
""" % ("".join(bibl(p) for p in books), "".join(bibl(p) for p in web), "".join(arc_item(a) for a in spare))
write(os.path.join(site, "tei", "pages", "further-reading.xml"), page)
print("further-reading.xml: %d books, %d web resources, %d archival sources" % (len(books), len(web), len(spare)))

p = os.path.join(site, "data", "nav.js"); s = read(p)
a, b = s.index("{"), s.rindex("}") + 1
nav = json.loads(s[a:b])
if not any(x["id"] == "further-reading" for x in nav["pages"]):
    nav["pages"].append({"id": "further-reading", "title": "Further Reading", "group": ""})
    write(p, s[:a] + json.dumps(nav, ensure_ascii=False, separators=(",", ":")) + s[b:])
p = os.path.join(site, "tei", "pages", "about.xml"); s = read(p)
if "further-reading.xml" not in s:
    s = s.replace("</body>", '<div rend="h3"><head>Further Reading</head><p>Books, web resources and archival '
                  'collections recorded in eMelbourne but not cited in any one entry are listed in '
                  '<ref target="further-reading.xml">Further Reading</ref>.</p></div></body>', 1)
    write(p, s)

# 3 and 4. objects.js
p = os.path.join(site, "data", "objects.js"); s = read(p)
a, b = s.index("{"), s.rindex("}") + 1
objs = json.loads(s[a:b])
o = objs["D00000007"]
if "EM00586" not in o.get("entries", []):
    o["entries"] = o.get("entries", []) + ["EM00586"]
n = 0
for r in rows("object-archives.csv"):
    o, arc = objs.get(r["doid"]), arcs.get(r["arcid"])
    if not o or not arc: continue
    v = {"id": arc["arcid"], "title": arc["artitle"]}
    if arc["repository_name"]: v["repository"] = arc["repository_name"]
    if arc["arrepref"] and arc["arrepref"] not in arc["artitle"]: v["ref"] = arc["arrepref"]
    if arc["arrepreflink"]: v["url"] = arc["arrepreflink"]
    par = arcs.get(arc["ispartof"].split()[0]) if arc["ispartof"] else None
    if par: v["partOf"] = par["artitle"]
    o["archive"] = v; n += 1
write(p, s[:a] + json.dumps(objs, ensure_ascii=False, separators=(",", ":")) + s[b:])
print("objects.js: %d objects given their archival source; D00000007 linked to EM00586" % n)

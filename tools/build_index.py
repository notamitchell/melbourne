#!/usr/bin/env python3
"""Rebuild the site's generated files from the TEI files (the master copy).

    python3 tools/build_index.py            # uses ./site
    python3 tools/build_index.py --site path/to/site

Reads   site/tei/*.xml and site/tei/pages/*.xml
Writes  site/tei-js/<id>.js and site/tei-js/pages/<page>.js  (the same TEI wrapped
                                                              for file:// use)
        site/data/index.js   search and A to Z index
        site/data/names.js   id -> name of every entry

Run it after adding or changing entries, e.g. ones saved from editor.html. The
GitHub workflow .github/workflows/rebuild-index.yml runs it automatically when
TEI files change. Only files whose content changes are rewritten. Python
standard library only.

The index rows match the ones tools/convert.py writes from the database, but
are read from the TEI, so edits made in the editor reach the search.
"""
import argparse
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.tei-c.org/ns/1.0}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
# TEI/@subtype -> the OHRM type names the site uses in the index
TYPE = {"entry": "Entry", "theme": "Theme", "person": "Person", "place": "Place",
        "cultural-artefact": "Cultural Artefact", "concept": "Concept", "event": "Event"}


def text(el):
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def own_text(el):
    """Text of a birth/death without its <placeName> ("13 January 1819")."""
    if el is None:
        return ""
    parts = [el.text or ""]
    for c in el:
        if c.tag != NS + "placeName":
            parts.append("".join(c.itertext()))
        parts.append(c.tail or "")
    return re.sub(r"\s+", " ", "".join(parts)).strip().rstrip(",").strip()


def index_row(root, eid):
    title = text(root.find(f"{NS}teiHeader/{NS}fileDesc/{NS}titleStmt/{NS}title"))
    authors = [text(a) for a in root.findall(f"{NS}teiHeader/{NS}fileDesc/{NS}titleStmt/{NS}author")]
    subtype = root.get("subtype") or ""
    subject = next((e for e in root.iter() if e.get(XML_ID) == "subject"), None)
    dates = []
    if subject is not None and subject.tag == NS + "person":
        dates = [own_text(subject.find(NS + "birth")), own_text(subject.find(NS + "death"))]
    else:
        for ev in root.iter(NS + "listEvent"):
            if ev.get("type") == "chronology":
                for e in ev.findall(NS + "event"):
                    label = text(e.find(NS + "label"))
                    dates.append(label.split(":", 1)[1].strip() if ":" in label else label)
    themes = []
    for r in root.iter(NS + "relation"):
        m = re.search(r"(EM\d{5})\.xml$", r.get("passive") or "")
        if m and r.get("type") == "theme":
            themes.append(m.group(1))
    img = None
    for fig in root.iter(NS + "figure"):
        g = fig.find(NS + "graphic[@type='thumbnail']")
        if g is None:
            g = fig.find(NS + "graphic")
        if g is not None and g.get("url"):
            img = re.sub(r"^(\.\./)+", "", g.get("url"))
            break
    detail = next((d for d in root.iter(NS + "div") if d.get("type") == "detail"), None)
    return {
        "id": eid, "name": title, "type": TYPE.get(subtype, subtype.replace("-", " ").title()),
        "author": " and ".join(a for a in authors if a),
        "dates": " – ".join(d for d in dates if d),
        "themes": themes, "img": img, "text": text(detail),
    }


def js(key, value):
    return "EMEL.loaded(%s,%s);\n" % (json.dumps(key), json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def write_if_changed(path, content, counter):
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == content:
                return
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    counter[0] += 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--site", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"))
    a = ap.parse_args()
    site = os.path.normpath(a.site)
    changed, index, names, problems = [0], [], {}, []

    for path in sorted(glob.glob(os.path.join(site, "tei", "EM*.xml"))):
        eid = os.path.basename(path)[:-4]
        with open(path, encoding="utf-8") as f:
            src = f.read()
        try:
            root = ET.fromstring(src.encode("utf-8"))
        except ET.ParseError as e:
            problems.append("%s: not well-formed XML (%s)" % (os.path.basename(path), e))
            continue
        idno = text(root.find(f"{NS}teiHeader/{NS}fileDesc/{NS}publicationStmt/{NS}idno[@type='entry']"))
        if idno and idno != eid:
            problems.append("%s: its idno says %s; the file name and idno must match" % (os.path.basename(path), idno))
        row = index_row(root, eid)
        index.append(row)
        names[eid] = row["name"]
        write_if_changed(os.path.join(site, "tei-js", eid + ".js"), js("tei:" + eid, src), changed)

    for path in sorted(glob.glob(os.path.join(site, "tei", "pages", "*.xml"))):
        pid = os.path.basename(path)[:-4]
        with open(path, encoding="utf-8") as f:
            src = f.read()
        write_if_changed(os.path.join(site, "tei-js", "pages", pid + ".js"), js("page:" + pid, src), changed)

    write_if_changed(os.path.join(site, "data", "index.js"), js("index", index), changed)
    write_if_changed(os.path.join(site, "data", "names.js"), js("names", names), changed)
    print("%d entries indexed, %d files updated" % (len(index), changed[0]), file=sys.stderr)
    for p in problems:
        print("problem: " + p, file=sys.stderr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

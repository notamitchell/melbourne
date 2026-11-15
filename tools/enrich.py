#!/usr/bin/env python3
"""Find links the TEI doesn't record yet, list them for checking, and write the checked ones in.

  python3 tools/enrich.py review [site_dir]   writes enrichments/review.csv
  python3 tools/enrich.py apply  [site_dir]   writes the rows marked y into site/tei/*.xml

Two kinds of link are found:

  mention      an entry, place or artefact whose text names a person (first forename and
               surname, exactly; names shared by two people are left out). Written into the
               entry as <relation name="mentions" type="person" active="#subject"
               passive="EM....xml"><desc>Name</desc></relation> in its listRelation.
  birthplace / deathplace
               a person's birth or death place whose first part ("Carlton" in "Carlton,
               Melbourne") is the title of a place record. Written as
               <placeName ref="EM....xml"> inside <birth> or <death>.

Checking: open enrichments/review.csv in a spreadsheet and put y (write it in) or n (wrong;
never suggest it again) in the "decision" column; leave it empty to decide later. Running
review again keeps every decision already made. apply also adds a <change> to each file it
edits. Afterwards rebuild the tei-js wrappers (tools/build_index.py) and the search index
(tools/build-facets.py). Python 3 standard library only.
"""
import csv, datetime, os, re, sys
import xml.etree.ElementTree as ET

NS = "{http://www.tei-c.org/ns/1.0}"
FIELDS = ["decision", "kind", "record_id", "record", "target_id", "target", "detail", "context"]


def text(e):
    return " ".join("".join(e.itertext()).split()) if e is not None else ""


def load(site):
    tei = os.path.join(site, "tei")
    out = {}
    for f in sorted(os.listdir(tei)):
        if re.match(r"EM\d+\.xml$", f):
            out[f[:-4]] = ET.parse(os.path.join(tei, f)).getroot()
    return out


def life(p):
    ys = []
    for tag in ("birth", "death"):
        e = p.find(NS + tag)
        m = re.match(r"-?\d{4}", (e.get("when") or "") if e is not None else "")
        ys.append(m.group(0) if m else "?")
    return "–".join(ys)


def find(site):
    roots = load(site)
    title = {i: text(r.find(".//" + NS + "titleStmt/" + NS + "title")) for i, r in roots.items()}
    places = {}
    for i, r in roots.items():
        if r.get("type") == "place":
            places.setdefault(title[i].lower(), i)
    people, lives, rows = {}, {}, []
    for i, r in roots.items():
        p = r.find(".//" + NS + "listPerson/" + NS + "person")
        if p is None:
            continue
        lives[i] = life(p)
        pn = p.find(NS + "persName[@type='main']")
        fn = (pn.findtext(NS + "forename") or "").split("[")[0].split() if pn is not None else []
        sn = " ".join((pn.findtext(NS + "surname") or "").split()) if pn is not None else ""
        if fn and sn:
            people.setdefault(fn[0] + " " + sn, []).append(i)
        for kind, tag in (("birthplace", "birth"), ("deathplace", "death")):
            pl = p.find(NS + tag + "/" + NS + "placeName")
            if pl is None or pl.get("ref"):
                continue
            pid = places.get(text(pl).split(",")[0].strip().lower())
            if pid and pid != i:
                rows.append({"kind": kind, "record_id": i, "record": title[i], "target_id": pid, "target": title[pid],
                             "detail": lives[i], "context": text(pl)})
    names = [(re.compile(r"\b" + re.escape(n) + r"\b"), ids[0]) for n, ids in people.items() if len(ids) == 1]
    for i, r in roots.items():
        if r.get("type") == "person":
            continue
        have = {(x.get("passive") or "").replace(".xml", "") for x in r.iter(NS + "relation") if x.get("name") == "mentions"}
        body = text(r.find(".//" + NS + "body"))
        for rx, pid in names:
            if pid in have:
                continue
            m = rx.search(body)
            if m:
                a, z = max(0, m.start() - 90), min(len(body), m.end() + 90)
                rows.append({"kind": "mention", "record_id": i, "record": title[i], "target_id": pid, "target": title[pid],
                             "detail": lives[pid], "context": ("…" if a else "") + body[a:z] + ("…" if z < len(body) else "")})
    rows.sort(key=lambda x: (x["kind"], x["target"], x["record"]))
    return rows


def key(row):
    return (row["kind"], row["record_id"], row["target_id"])


def read_review(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def review(site):
    path = os.path.join(site, "..", "enrichments", "review.csv")
    old = {key(r): r for r in read_review(path)}
    rows = find(site)
    for r in rows:
        r["decision"] = (old.get(key(r)) or {}).get("decision", "")
    # keep decided rows that are no longer found (already applied, or the text changed)
    found = {key(r) for r in rows}
    rows += [r for k, r in old.items() if k not in found and r.get("decision")]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    n = {}
    for r in rows:
        n[r["kind"]] = n.get(r["kind"], 0) + 1
    print(f"{len(rows)} rows -> {os.path.normpath(path)}", n)


def xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def apply(site):
    path = os.path.join(site, "..", "enrichments", "review.csv")
    todo = [r for r in read_review(path) if r.get("decision", "").strip().lower() in ("y", "yes")]
    by_file = {}
    for r in todo:
        by_file.setdefault(r["record_id"], []).append(r)
    today = datetime.date.today().isoformat()
    changed = 0
    for rid, items in sorted(by_file.items()):
        fp = os.path.join(site, "tei", rid + ".xml")
        with open(fp, encoding="utf-8") as fh:
            s = fh.read()
        before, notes = s, []
        for r in items:
            tid = r["target_id"]
            if r["kind"] == "mention":
                if re.search(r'<relation name="mentions"[^>]*passive="' + tid + r'\.xml"', s):
                    continue
                rel = (f'<relation name="mentions" type="person" active="#subject" passive="{tid}.xml">'
                       f'<desc>{xml_escape(r["target"])}</desc></relation>')
                if "</listRelation>" in s:
                    s = s.replace("</listRelation>", rel + "</listRelation>", 1)
                elif "</standOff>" in s:
                    s = s.replace("</standOff>", "<listRelation>" + rel + "</listRelation></standOff>", 1)
                else:
                    s = s.replace("<text>", "<standOff><listRelation>" + rel + "</listRelation></standOff>\n<text>", 1)
                notes.append("mention of " + r["target"])
            else:
                tag = "birth" if r["kind"] == "birthplace" else "death"
                s2 = re.sub(r"(<" + tag + r"\b[^>]*>[^<]*)<placeName>", r'\1<placeName ref="' + tid + '.xml">', s, count=1)
                if s2 != s:
                    s = s2
                    notes.append(tag + " place " + r["target"])
        if s != before:
            change = f'<change when="{today}" type="edited">Linked {xml_escape("; ".join(notes))} (checked list, tools/enrich.py).</change>\n'
            s = s.replace("</revisionDesc>", change + "</revisionDesc>", 1)
            ET.fromstring(s.encode("utf-8"))      # still well-formed, or stop before writing
            with open(fp, "w", encoding="utf-8") as fh:
                fh.write(s)
            changed += 1
    print(f"{len(todo)} checked rows, {changed} TEI files changed. Now run tools/build_index.py and tools/build-facets.py.")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("review", "apply"):
        sys.exit(__doc__)
    site = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
    (review if sys.argv[1] == "review" else apply)(site)

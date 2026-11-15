#!/usr/bin/env python3
"""Build site/data/facets.js, the index behind the advanced search (advanced.html).

Reads every TEI file in site/tei/ and writes one compact row per record:

  id    EM id                      t    TEI/@subtype (entry, person, place, ...)
  n     title                      alt  [[alternative name, kind], ...]
  au    [author, ...]              th   [theme id, ...]
  rel   [id, ...]  records linked to it in either direction (listRelation)
  b, d  birth / death: {"y":1819,"m":1,"d":13,"p":"day|month|year","c":1 (circa),"pl":"Tipperary","pid":"EM..."}
  occ   [occupation, ...]          sex  "m" | "f"
  bib   [[kind, author, title, year], ...]
  img   1 if it has a gallery       adb  1 if it cites the ADB
  mn    computed, not in the TEI: for a person, the entries whose text names them;
        for an entry, the people it names (first forename + surname, unambiguous names only)

Date precision is read from the display text of <birth>/<death>, because @when is
always a full date (a birth known only as "1813" is stored as 1813-01-01).
Birthplaces are linked to a place entry ("pid") when the first part of the place
name is the title of a place record. Both are computed; they are written into the
TEI only after checking (see tools/enrich.py); links already written in are read
from the TEI (relation name="mentions", placeName/@ref).

Usage: python3 tools/build-facets.py [site_dir]      (Python 3 standard library only)
"""
import json, os, re, sys
import xml.etree.ElementTree as ET

NS = "{http://www.tei-c.org/ns/1.0}"
MONTHS = "january february march april may june july august september october november december".split()

# spelling variants of persName/@subtype, as found in the data
NAME_KINDS = {"alternate-spelling": "alternative-spelling", "pseud": "pseudonym",
              "baptism-name": "baptismal-name", "name-at-birth": "birth-name",
              "publicly-known-as": "known-as"}


def text(e):
    return " ".join("".join(e.itertext()).split()) if e is not None else ""


def life_event(e, places):
    if e is None:
        return None
    when = e.get("when") or ""
    m = re.match(r"(-?\d{4})(?:-(\d\d))?(?:-(\d\d))?", when)
    pl = e.find(NS + "placeName")
    place = text(pl)
    shown = (e.text or "").strip().rstrip(",").strip().lower()
    if not m and not place:
        return None
    out = {}
    if m:
        out["y"] = int(m.group(1))
        # precision from what the record shows: "13 January 1819", "May 1818", "1813"
        if re.search(r"\b\d{1,2}\s+(" + "|".join(MONTHS) + r")\b", shown):
            out["p"] = "day"
        elif re.search(r"\b(" + "|".join(MONTHS) + r")\b", shown):
            out["p"] = "month"
        else:
            out["p"] = "year"
        # @when now follows the precision ("1813", "1813-10"); older files have full dates
        if len(when.lstrip("-")) == 4: out["p"] = "year"
        elif len(when.lstrip("-")) == 7: out["p"] = "month"
        if out["p"] in ("month", "day") and m.group(2):
            out["m"] = int(m.group(2))
        if out["p"] == "day" and m.group(3):
            out["d"] = int(m.group(3))
        if re.search(r"\b(c\.|circa|about|ca\.)", shown):
            out["c"] = 1
    if place:
        out["pl"] = place
        ref = (pl.get("ref") or "").replace(".xml", "") if pl is not None else ""
        pid = ref or places.get(place.split(",")[0].strip().lower())
        if pid:
            out["pid"] = pid
    return out


def main():
    site = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
    tei_dir = os.path.join(site, "tei")
    files = sorted(f for f in os.listdir(tei_dir) if re.match(r"EM\d+\.xml$", f))
    roots = {}
    for f in files:
        try:
            roots[f[:-4]] = ET.parse(os.path.join(tei_dir, f)).getroot()
        except ET.ParseError as err:
            print("skipped", f, err, file=sys.stderr)

    # place titles, for linking birthplaces
    places = {}
    for i, r in roots.items():
        if r.get("type") == "place":
            places.setdefault(text(r.find(".//" + NS + "titleStmt/" + NS + "title")).lower(), i)

    rows, links, bodies, people, confirmed = {}, {}, {}, {}, []
    # mentions marked n (wrong) in the checking list are not suggested again
    rejected = set()
    review = os.path.join(site, "..", "enrichments", "review.csv")
    if os.path.exists(review):
        import csv
        with open(review, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                if r.get("kind") == "mention" and r.get("decision", "").strip().lower() in ("n", "no"):
                    rejected.add((r["record_id"], r["target_id"]))
    for i, r in roots.items():
        row = {"id": i, "t": r.get("subtype") or r.get("type"),
               "n": text(r.find(".//" + NS + "titleStmt/" + NS + "title"))}
        au = [text(a) for a in r.findall(".//" + NS + "titleStmt/" + NS + "author") if text(a)]
        if au: row["au"] = au
        th, rel = [], set()
        for rl in r.iter(NS + "relation"):
            other = (rl.get("passive") or "").replace(".xml", "")
            if not re.match(r"EM\d+$", other): continue
            if rl.get("name") == "mentions":             # checked with tools/enrich.py
                confirmed.append((i, other))
            elif rl.get("type") == "theme":
                th.append(other)                         # a theme's members are found through "th"
            else:
                rel.add(other)
                links.setdefault(other, set()).add(i)    # the other direction
        if th: row["th"] = th
        row["rel"] = rel
        p = r.find(".//" + NS + "listPerson/" + NS + "person")
        if p is not None:
            alt = []
            for pn in p.findall(NS + "persName"):
                if pn.get("type") == "alternative":
                    k = pn.get("subtype") or "alternative"
                    alt.append([text(pn), NAME_KINDS.get(k, k)])
                elif pn.get("type") == "main":
                    fn = (pn.findtext(NS + "forename") or "").split("[")[0].split()
                    sn = " ".join((pn.findtext(NS + "surname") or "").split())
                    if fn and sn: people.setdefault(fn[0] + " " + sn, []).append(i)
            if alt: row["alt"] = alt
            for k, tag in (("b", "birth"), ("d", "death")):
                ev = life_event(p.find(NS + tag), places)
                if ev: row[k] = ev
            occ = [text(o) for o in p.findall(NS + "occupation") if text(o)]
            if occ: row["occ"] = occ
            sx = p.find(NS + "sex")
            if sx is not None and sx.get("value") in ("1", "2"):
                row["sex"] = "m" if sx.get("value") == "1" else "f"
        bib = []
        for b in r.iter(NS + "bibl"):
            title = [text(t) for t in b.findall(NS + "title")]
            y = re.search(r"\d{4}", b.findtext(NS + "date") or "")
            if any("Australian Dictionary of Biography" in t for t in title):
                row["adb"] = 1                           # the ADB link: a flag, not a row
                continue
            bib.append([b.get("type") or "", "; ".join(text(a) for a in b.findall(NS + "author")),
                        " · ".join(title), int(y.group(0)) if y else None])
        if bib: row["bib"] = bib
        if r.find(".//" + NS + "div[@type='gallery']") is not None: row["img"] = 1
        if r.get("type") != "person":
            body = r.find(".//" + NS + "body")
            bodies[i] = text(body)
        rows[i] = row

    for i, s in links.items():
        if i in rows: rows[i]["rel"] |= s

    # people named in entries: those checked into the TEI, then names that belong to one person
    mentions = 0
    for e, p in confirmed:
        if e in rows and p in rows:
            rows[p].setdefault("mn", []).append(e); rows[e].setdefault("mn", []).append(p)
    for name, ids in people.items():
        if len(ids) != 1: continue
        rx = re.compile(r"\b" + re.escape(name) + r"\b")
        hits = [e for e, t in bodies.items() if (e, ids[0]) not in rejected and e not in rows[ids[0]].get("mn", []) and rx.search(t)]
        if hits:
            rows[ids[0]]["mn"] = hits
            for e in hits: rows[e].setdefault("mn", []).append(ids[0])
            mentions += len(hits)

    out = []
    for i in sorted(rows):
        row = rows[i]
        row["rel"] = sorted(x for x in row["rel"] if x in rows and x != i)
        if not row["rel"]: del row["rel"]
        out.append(row)
    js = 'EMEL.loaded("facets",' + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ");\n"
    path = os.path.join(site, "data", "facets.js")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"{len(out)} records, {mentions} name mentions, {len(js) // 1024} KB -> {path}")


if __name__ == "__main__":
    main()

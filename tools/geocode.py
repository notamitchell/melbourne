#!/usr/bin/env python3
"""Coordinates for places, streets and birth/death places, listed for checking, then written in.

  python3 tools/geocode.py fetch   [site_dir]   downloads the gazetteers into tmp/geo-cache/
  python3 tools/geocode.py review  [site_dir]   writes enrichments/geo-review.csv and geo-skipped.csv
  python3 tools/geocode.py apply   [site_dir]   writes the rows marked y into site/tei/*.xml
  python3 tools/geocode.py basemap [site_dir]   writes site/data/basemap.js, the outlines the map experiments draw

Only Melbourne and Victorian places are geocoded, and only when the match is certain:

  place        a Suburbs & Localities record (TEI type place). Its title must be a gazetted Vicmap
               locality (or, for an old or unofficial name, a single VICNAMES neighbourhood within
               100 km), and the point must agree with the distance and direction from the GPO that
               the entry itself gives, e.g. "(3067, 4 km E, Yarra City)".
  street       a Streets & Lanes entry. The road must be in Vicmap Transport under exactly that name,
               in the suburb the entry names or, for the city, inside the Hoddle grid and within
               250 m of every grid street the entry's first two sentences name. A lane the entry
               says has gone or been renamed is skipped, since a road of that name today may be
               another one. Two separate roads of the same name in the same area are skipped.
  birthplace / deathplace
               a person's <birth>/<death> <placeName>. Dates are the first test: nothing born or
               dying before 1836 is placed in Melbourne. "X, Melbourne" needs X to be a Melbourne
               locality, neighbourhood or park; "Melbourne" alone is placed at the city centre; a
               bare name only when it is a Victorian place with no well-known namesake elsewhere
               (the DISTINCT list below, checked by hand). Places elsewhere are never geocoded.

Sources (all CC BY 4.0, © State of Victoria / City of Melbourne): Vicmap Admin locality polygons,
VICNAMES (the Register of Geographic Place Names) and Vicmap Transport road centrelines from
opendata.maps.vic.gov.au; City of Melbourne road corridors (data.melbourne.vic.gov.au) as a
cross-check. Coordinates are GDA2020 latitude and longitude, which for mapping is the same as WGS84.

Checking: open enrichments/geo-review.csv in a spreadsheet and put y (write it in) or n (wrong)
in the "decision" column; leave it empty to decide later. Re-running review keeps every decision.
geo-skipped.csv lists what was left out and why. apply writes, for each y row:

  place        <location type="point"><geo>lat long</geo><note type="source">…</note></location>
               inside the record's <place xml:id="subject">
  street       <listPlace type="location"><place><placeName>Bourke Street</placeName><location …/>
               </place></listPlace> in the entry's standOff
  birth/death  <listPlace type="life"><place type="birth"><placeName>…</placeName><location …/>
               </place></listPlace> in the person's standOff

and a <change> in revisionDesc. Re-running apply replaces what an earlier apply wrote, so a
corrected row can be applied again. Afterwards run tools/build_index.py and tools/build-facets.py.
fetch and review need shapely (pip install shapely); apply needs only the standard library.
"""
import collections, csv, datetime, glob, json, math, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

NS = "{http://www.tei-c.org/ns/1.0}"
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CACHE = os.path.join(ROOT, "tmp", "geo-cache")
REVIEW = os.path.join(ROOT, "enrichments", "geo-review.csv")
SKIPPED = os.path.join(ROOT, "enrichments", "geo-skipped.csv")
FIELDS = ["decision", "kind", "record_id", "record", "field", "place_text", "year", "matched", "source", "lat", "long", "reason"]
WFS = "https://opendata.maps.vic.gov.au/geoserver/wfs"
COM = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/road-corridors/exports/geojson"
METRO_BBOX = (143.8, -38.7, 146.3, -37.1)
GPO = (-37.81375, 144.96305)
CREDIT = {
    "Vicmap Admin locality polygon": "Vicmap Admin locality polygon, © State of Victoria (DEECA), CC BY 4.0",
    "VICNAMES": "VICNAMES Register of Geographic Place Names, © State of Victoria (DEECA), CC BY 4.0",
    "Vicmap Transport road centreline": "Vicmap Transport road centreline, © State of Victoria (DEECA), CC BY 4.0",
}

# Victorian places whose names have no well-known namesake outside Victoria (checked by hand). A bare
# birth/death place ("Ballarat") is geocoded only if it is here; "Richmond", "Brighton", "Kensington",
# "Eltham", "Portsea", "Sale", "Hamilton", "Maryborough" and the like are not.
DISTINCT = """East Melbourne;South Melbourne;North Melbourne;West Melbourne;Port Melbourne;South Yarra;Frankston;
Murrumbeena;Warrandyte;Dromana;Healesville;Dandenong;Kallista;Langwarrin;Mount Evelyn;Wheelers Hill;Gembrook;
Mount Eliza;Mount Martha;Greensborough;Harkaway;Silvan;Christmas Hills;Mont Albert;Geelong;Castlemaine;Bendigo;
Ballarat;Ballarat East;Kyneton;Warrnambool;Wangaratta;Creswick;Beechworth;Benalla;Stawell;Rushworth;Buninyong;
Bullengarook;Goornong;Casterton;Daylesford;Corindhap;Nathalia;Boorhaman;Natimuk;Trawalla;Jeparit;Boorcan;Swan Hill;
Coghills Creek;Glenpatrick;Eaglehawk;Leitchville;Nerrin Nerrin;Glenthompson;Birchip;Kewell;Barfold;Poowong North;
Dunolly;Mildura;Barkers Creek;Kangaroo Flat;Kinglake;Inverloch;Cobram;Terang;Port Fairy;Wodonga;Leongatha;
Sutton Grange;Tarnagulla;Lal Lal;Nyora;Wendouree;Mooroopna;Malmsbury;Kerang;Nayook;Walhalla;St Arnaud;Bacchus Marsh;
Queenscliff;Bairnsdale;Tallarook;Colac;Morwell;Lovely Banks;Barrys Reef;Durham Lead"""
ALIAS = {"SANDHURST BENDIGO": ("BENDIGO", "Sandhurst was the old name of Bendigo"),
         "HOTHAM": ("NORTH MELBOURNE", "Hotham was the old borough name of North Melbourne")}

# Streets & Lanes theme members and street-like titles that are not a single road
NOT_STREETS = set("""ANZ Bank Collins Street;Arbitration Court;Baptist Church Collins Street;Cole's Book Arcade;
Federation Square;Glass Terrace;Launching Place;Princes Court;My Melbourne: Collins Street;Supreme Court;Resting Place;
City Square;Banana Alley;Arcades;City Growth;City Planning;Grid Plan;Lanes and Alleys;Little Lon;Little Streets;
Nature Strips;Roads;Street Lighting;Street Names;Street Numbering;Surveying;Bilking Square;Temple Court""".replace("\n", "").split(";"))
STREET_SUFFIX = r" (Street|Lane|Place|Alley|Arcade|Road|Parade|Way|Avenue|Mall|Square|Walk|Court|Terrace|Row|Boulevard|Highway)$"
GRID = ["Little Flinders Street", "Flinders Street", "Flinders Lane", "Little Collins Street", "Collins Street",
        "Little Bourke Street", "Bourke Street", "Little Lonsdale Street", "Lonsdale Street", "Little La Trobe Street",
        "La Trobe Street", "Spencer Street", "King Street", "William Street", "Little Queen Street", "Queen Street",
        "Elizabeth Street", "Swanston Street", "Russell Street", "Exhibition Street", "Spring Street", "Market Street"]
VANISHED = re.compile(r"no longer exist|was located|were located|existed (between|from|until|in)|subsumed|disappeared|"
                      r"was demolished|demolished in|once ran|once connected|once led|was once a|"
                      r"was a (short )?(dead-end|lane|laneway|street|portion)|(ran|led) (north|south|east|west|between|off)|"
                      r"has been built over|was closed|was renamed|now part of|was absorbed", re.I)
ROADWORD = (r"(Street|Lane|Place|Alley|Road|Way|Court|Parade|Arcade|Hotel|Avenue|Square|Walk|Terrace|Highway|Football|"
            r"Club|Town|City|Council|Junction|Inn|Bridge|River|Creek)")
DIRS = {d: i * 22.5 for i, d in enumerate("N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split())}


# ---------------------------------------------------------------- helpers

def text(e):
    return " ".join("".join(e.itertext()).split()) if e is not None else ""


def norm(s):
    return re.sub(r"[^A-Z ]", "", s.upper().replace("'", "").replace(".", "")).strip()


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    return 6371 * math.acos(min(1, math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(lo2 - lo1)))


def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def load_tei(site):
    out = {}
    for f in sorted(glob.glob(os.path.join(site, "tei", "EM*.xml"))):
        out[os.path.basename(f)[:-4]] = ET.parse(f).getroot()
    return out


def title_of(r):
    return text(r.find(".//" + NS + "titleStmt/" + NS + "title"))


def get(url, params=None, tries=4):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for t in range(tries):
        try:
            return urllib.request.urlopen(url, timeout=300).read()
        except Exception as e:  # the open-data servers drop connections now and then
            if t == tries - 1:
                raise
            print("  retrying:", e)
            time.sleep(3 * (t + 1))


def wfs(layer, props=None, cql=None, bbox=None, page=5000):
    """All features of a Vicmap open-data WFS layer, paged."""
    feats, start = [], 0
    while True:
        p = dict(service="WFS", version="1.1.0", request="GetFeature", typeName="open-data-platform:" + layer,
                 outputFormat="application/json", srsName="EPSG:4326", maxFeatures=str(page), startIndex=str(start), sortBy="ufi")
        if props:
            p["propertyName"] = ",".join(props)
        if cql:
            p["CQL_FILTER"] = cql
        elif bbox:
            p["bbox"] = ",".join(map(str, bbox)) + ",EPSG:4326"
        got = json.loads(get(WFS, p))["features"]
        feats += got
        if len(got) < page:
            return feats
        start += page


def cache(name):
    return os.path.join(CACHE, name)


def street_titles(roots):
    """(id, title) of every Streets & Lanes entry and every entry whose title looks like a street."""
    theme = {(x.get("passive") or "")[:-4] for x in roots["EM00021"].iter(NS + "relation")} if "EM00021" in roots else set()
    out = []
    for i, r in roots.items():
        t = title_of(r)
        if r.get("type") in ("person", "place") or t in NOT_STREETS:
            continue
        if i in theme or re.search(STREET_SUFFIX, t):
            out.append((i, t))
    return out


# ---------------------------------------------------------------- fetch

def fetch(site):
    os.makedirs(os.path.join(CACHE, "roads"), exist_ok=True)
    roots = load_tei(site)
    print("VICNAMES …")
    g = wfs("gnr", props=["ufi", "place_id", "place_name", "feature_code", "feature", "name_status", "longitude", "latitude"])
    json.dump([f["properties"] for f in g], open(cache("vicnames.json"), "w"))
    print("Vicmap Admin localities (Melbourne region) …")
    loc = wfs("locality_polygon", bbox=METRO_BBOX, page=500)
    names = sorted({norm(x) for x in DISTINCT.replace("\n", "").split(";")})
    for i in range(0, len(names), 20):   # towns further out, by name
        loc += wfs("locality_polygon", cql="locality_name IN (" + ",".join("'" + n + "'" for n in names[i:i + 20]) + ")")
    json.dump(loc, open(cache("localities.json"), "w"))
    print("Vicmap Lite local government areas …")
    open(cache("lga-lite.json"), "wb").write(get(WFS, dict(service="WFS", version="1.1.0", request="GetFeature",
         typeName="open-data-platform:vmlite_lga", outputFormat="application/json", srsName="EPSG:4326")))
    print("City of Melbourne road corridors …")
    open(cache("com-road-corridors.geojson"), "wb").write(get(COM))
    todo = sorted({t for _, t in street_titles(roots)} | set(GRID))
    print(f"Vicmap Transport roads ({len(todo)} names) …")
    for n in todo:
        fn = cache("roads/" + re.sub(r"\W", "_", n.upper()) + ".json")
        if not os.path.exists(fn):
            q = n.upper().replace("'", "''")
            feats = wfs("tr_road", props=["ezi_road_name", "left_locality", "right_locality", "geom"],
                        cql=f"ezi_road_name='{q}' AND BBOX(geom,144.3,-38.6,146.0,-37.3,'EPSG:4326')")
            json.dump(feats, open(fn, "w"))
    print("done ->", os.path.relpath(CACHE, ROOT))


# ---------------------------------------------------------------- review

class Gaz:
    def __init__(self):
        from shapely.geometry import shape
        self.shape = shape
        self.vn = collections.defaultdict(list)
        for g in json.load(open(cache("vicnames.json"))):
            self.vn[norm(g["place_name"])].append(g)
        self.loc, seen = collections.defaultdict(list), set()
        for f in json.load(open(cache("localities.json"))):
            if f["properties"]["ufi"] not in seen:
                seen.add(f["properties"]["ufi"])
                self.loc[norm(f["properties"]["locality_name"])].append(f)

    def locality(self, n, metro=True):
        """(lat, long, source, name, how) for a uniquely named gazetted locality."""
        lc = self.loc.get(n, [])
        if metro:
            lc = [f for f in lc if km(GPO, self._rep(f)) < 70]
        if len(lc) != 1:
            return None
        g = self.shape(lc[0]["geometry"])
        c = g.centroid
        inside = g.contains(c)
        p = c if inside else g.representative_point()
        return (p.y, p.x, "Vicmap Admin locality polygon", lc[0]["properties"]["locality_name"].title(),
                "centroid of the gazetted locality" if inside else "point inside the gazetted locality (its centroid falls outside it)")

    def _rep(self, f):
        p = self.shape(f["geometry"]).representative_point()
        return p.y, p.x

    def vicnames(self, n, codes, maxkm):
        gs = [g for g in self.vn.get(n, []) if g["feature_code"] in codes and km(GPO, (g["latitude"], g["longitude"])) < maxkm]
        if not gs:
            return None
        g = gs[0]
        what = f"VICNAMES {g['feature'].lower()} point"
        status = f" ({g['name_status'].lower()} name)"
        if len({x["place_id"] for x in gs}) == 1:
            return g["latitude"], g["longitude"], "VICNAMES", g["place_name"].title(), what + status
        if max(km((a["latitude"], a["longitude"]), (b["latitude"], b["longitude"])) for a in gs for b in gs) > 3:
            return None
        return (sum(x["latitude"] for x in gs) / len(gs), sum(x["longitude"] for x in gs) / len(gs), "VICNAMES",
                g["place_name"].title(), f"mean of {len(gs)} {what}s for the same place, all within 3 km" + status)


def find_places(roots, gz):
    rows, skipped = [], []
    for rid, r in roots.items():
        if r.get("type") != "place":
            continue
        title = title_of(r)
        p = r.find(".//" + NS + "body//" + NS + "p")
        par = text(p) if p is not None and text(p).startswith("(") else ""
        par = par[:par.index(")") + 1] if ")" in par else par
        base = dict(kind="place", record_id=rid, record=title, field="place", place_text=par, year="")
        m = re.search(r"(\d+(?:\.\d+)?)\s*km\s+([NSEW]+)", par)
        dist, d = (float(m.group(1)), m.group(2)) if m else (None, None)
        key = norm(title)
        hit = None
        if len(gz.loc.get(key, [])) > 1:
            skipped.append(dict(base, reason=f"{len(gz.loc[key])} Vicmap localities share this name"))
            continue
        hit = gz.locality(key, metro=False)
        if not hit:
            hit = gz.vicnames(key, ("NBHD", "LOCB"), 100)
            if hit:
                hit = hit[:4] + (hit[4] + "; not a gazetted locality today",)
        if not hit:
            n = len([g for g in gz.vn.get(key, []) if g["feature_code"] in ("NBHD", "LOCB")])
            skipped.append(dict(base, reason="no gazetted locality of this name" if not n else f"{n} VICNAMES places of this name, too far apart"))
            continue
        lat, lon, src, matched, how = hit
        dd, br = km(GPO, (lat, lon)), bearing(GPO, (lat, lon))
        if dist is not None:
            off = abs(((br - DIRS[d]) + 180) % 360 - 180)
            check = f"entry says {dist:g} km {d}; point is {dd:.1f} km at {br:.0f}°"
            if not (abs(dd - dist) <= max(3, 0.3 * dist) and (off <= 50 or dd < 3)):
                skipped.append(dict(base, reason="distance/direction disagrees with the entry: " + check))
                continue
        else:
            if dd > 80:
                skipped.append(dict(base, reason=f"no distance in entry and point is {dd:.0f} km out"))
                continue
            check = f"entry gives no distance; point is {dd:.1f} km from the GPO"
        rows.append(dict(base, matched=matched.title(), source=src, lat=f"{lat:.5f}", long=f"{lon:.5f}", reason=f"{how}; {check}"))
    return rows, skipped


def find_lives(roots, gz, places):
    distinct = {norm(x) for x in DISTINCT.replace("\n", "").split(";")}
    by_title = {norm(v["record"]): k for k, v in places.items()}
    rows, skipped = [], []

    def from_record(n):
        pid = by_title.get(n)
        if pid:
            p = places[pid]
            return float(p["lat"]), float(p["long"]), p["source"], p["matched"], f"same point as place record {pid}"

    for rid, r in roots.items():
        if r.get("type") != "person":
            continue
        name = title_of(r)
        for tag in ("birth", "death"):
            e = r.find(".//" + NS + "person/" + NS + tag)
            pl = e.find(NS + "placeName") if e is not None else None
            if pl is None:
                continue
            txt = text(pl)
            ref = (pl.get("ref") or "").replace(".xml", "")
            ym = re.match(r"-?\d{4}", e.get("when") or e.get("notBefore") or e.get("from") or "")
            year = int(ym.group()) if ym else None
            base = dict(kind=tag + "place", record_id=rid, record=name, field=tag, place_text=txt, year=year or "")
            parts = [p.strip().rstrip(".") for p in re.sub(r"\. (?=Melbourne$)", ", ", txt).split(",")]
            last = norm(parts[-1]) if len(parts) > 1 else ""
            vic_name = norm(txt) in distinct or gz.loc.get(norm(txt)) or any(g["feature_code"] == "LOCB" for g in gz.vn.get(norm(txt), []))
            if year is not None and year < 1836:
                if "MELBOURNE" in norm(txt) or ref:
                    skipped.append(dict(base, reason=f"{tag} in {year}, before Melbourne was settled (1835): the place is not the Melbourne one"
                                        + (f"; it is linked to {ref}, which looks wrong" if ref else "")))
                continue
            if year is None and tag == "birth" and (last == "MELBOURNE" or vic_name):
                skipped.append(dict(base, reason="no birth year, so the date cannot rule out a namesake elsewhere"))
                continue
            hit, why = None, ""
            if len(parts) == 1 or (len(parts) == 2 and last == "MELBOURNE" and norm(parts[0]) == "MELBOURNE"):
                n = norm(txt)
                n, note = ALIAS.get(n, (n, ""))
                if n == "MELBOURNE":
                    g = min((x for x in gz.vn["MELBOURNE"] if x["feature_code"] == "LOCB"), key=lambda x: km(GPO, (x["latitude"], x["longitude"])))
                    hit = (g["latitude"], g["longitude"], "VICNAMES", "Melbourne",
                           "VICNAMES locality point for Melbourne (the city centre); stands for Melbourne generally")
                    why = f'"Melbourne" in {year}: Melbourne, Victoria'
                elif n in distinct:
                    hit = from_record(n) or gz.locality(n, metro=False) or gz.vicnames(n, ("LOCB",), 1000) or gz.vicnames(n, ("NBHD",), 1000)
                    why = f"bare name, {year}: a Victorian place with no well-known namesake elsewhere" + (f" ({note})" if note else "")
                elif vic_name or ref:
                    skipped.append(dict(base, reason="bare name that is also a place outside Victoria" + (f"; already linked to {ref}" if ref else "")))
                    continue
                else:
                    continue  # not a Victorian name: never geocoded
            elif last == "MELBOURNE":
                first = norm(re.sub(r"\(.*?\)", "", parts[0]))
                first, note = ALIAS.get(first, (first, ""))
                m = re.match(r"(NORTH|SOUTH|EAST|WEST|UPPER|LOWER) (.+)$", first)
                for n in (first, m and f"{m.group(2)} {m.group(1)}"):   # "East Malvern" is gazetted as "Malvern East"
                    if n:
                        hit = from_record(n) or gz.locality(n) or gz.vicnames(n, ("NBHD", "LOCB", "PARK"), 40)
                        if hit:
                            break
                why = f'"{txt}": a named part of Melbourne' + (f" ({note})" if note else "")
                if not hit:
                    skipped.append(dict(base, reason="the first part is not a Melbourne locality, neighbourhood or park in Vicmap/VICNAMES (spelling or old name)"))
                    continue
            elif ref:
                skipped.append(dict(base, reason=f"text names a place outside Victoria but it is linked to {ref}: that link looks wrong"))
                continue
            else:
                continue  # elsewhere (London, Sydney, …): never geocoded
            if not hit:
                skipped.append(dict(base, reason="no unique Vicmap/VICNAMES match"))
                continue
            lat, lon, src, matched, how = hit
            rows.append(dict(base, matched=matched, source=src, lat=f"{lat:.5f}", long=f"{lon:.5f}",
                             reason=f"{why}; {how}" + (f"; already linked to {ref}" if ref else "")))
    return rows, skipped


def find_streets(roots, gz, place_titles):
    from shapely.geometry import shape, LineString, MultiLineString, Point
    from shapely.ops import linemerge, unary_union
    DEG = 1 / 111000  # metres -> degrees, for tolerances only

    def roads(n):
        fn = cache("roads/" + re.sub(r"\W", "_", n.upper()) + ".json")
        return json.load(open(fn)) if os.path.exists(fn) else []

    def in_city(f):
        return "MELBOURNE" in (f["properties"]["left_locality"], f["properties"]["right_locality"])

    def components(feats, join):
        u = unary_union([shape(f["geometry"]) for f in feats])
        m = linemerge(u) if hasattr(u, "geoms") else u
        groups = [[p] for p in (m.geoms if hasattr(m, "geoms") else [m])]
        merged = True
        while merged:
            merged = False
            for i in range(len(groups)):
                for j in range(i + 1, len(groups)):
                    if MultiLineString(groups[i]).distance(MultiLineString(groups[j])) < join * DEG:
                        groups[i] += groups.pop(j)
                        merged = True
                        break
                if merged:
                    break
        return [MultiLineString(g) for g in groups]

    def midpoint(ml):
        m = linemerge(ml) if len(ml.geoms) > 1 else ml.geoms[0]
        if isinstance(m, LineString):
            return m.interpolate(0.5, normalized=True), "midpoint along the road centreline"
        c = ml.centroid
        return min((Point(xy) for l in ml.geoms for xy in l.coords), key=lambda q: q.distance(c)), "centreline vertex nearest the middle of the road"

    def grid_mentions(s, title):
        t = re.sub(r"\b(Post Office Place|Chancery Lane)\s*\(now ([^)]*)\)", r"\2", s.replace(title, " "))
        found, name = [], r"(?:Little )?(?:La Trobe|[A-Z][a-z]+)"
        for m in re.finditer(r"(" + name + r"(?:(?:, | and | or )" + name + r")*) [Ss]treets?\b", t):
            for x in re.split(r", | and | or ", m.group(1)):
                if x + " Street" in GRID and x + " Street" not in found:
                    found.append(x + " Street")
        if re.search(r"\bFlinders Lane\b", t):
            found.append("Flinders Lane")
        return found

    def suburbs_in(t):
        out = []
        for l in place_titles:
            if l == "Melbourne" or norm(l) not in gz.loc:
                continue
            for m in re.finditer(r"\b" + re.escape(l) + r"\b", t):
                before = t[:m.start()].rstrip()
                prev = before.split(" ")[-1] if before else ""
                if prev[:1].isupper() and not before.endswith((".", ",")) and prev not in ("In", "The", "This", "At"):
                    continue  # part of a name: "Benjamin Baxter"
                if re.match(r"\s+" + ROADWORD + r"\b|'s\b", t[m.end():]):
                    continue  # "Flinders Street", "Fitzroy's"
                out.append(l)
                break
        return out

    com = []
    if os.path.exists(cache("com-road-corridors.geojson")):
        com = json.load(open(cache("com-road-corridors.geojson")))["features"]
    rows, skipped = [], []
    for rid, title in sorted(street_titles(roots), key=lambda x: x[1]):
        s = text(roots[rid].find(".//" + NS + "body"))
        head = " ".join(re.split(r"(?<=[.!?])\s+", s)[:2])
        base = dict(kind="street", record_id=rid, record=title, field="street", place_text=head[:160], year="")
        feats = roads(title)
        if not feats:
            skipped.append(dict(base, reason="no road of this name in Vicmap Transport today"))
            continue
        v = VANISHED.search(head)
        if v:
            skipped.append(dict(base, reason=f"entry says the lane has gone or changed ({v.group(0)}); a road of this name today may not be the same one"))
            continue
        grid = grid_mentions(head, title)
        suburbs = suburbs_in(head.replace(title, " "))
        if grid and (not suburbs or len(grid) >= 2) or (not suburbs and title in GRID):
            target, where = {"MELBOURNE"}, "Melbourne (the Hoddle grid)"
        elif suburbs:
            target, where = {norm(x) for x in suburbs}, ", ".join(suburbs)
        else:
            skipped.append(dict(base, reason="the entry names no cross streets or suburb to pin the road down"))
            continue
        everywhere = components(feats, 30)
        if not grid and len(everywhere) == 1:
            inloc, where = feats, "Melbourne"   # the only road of this name: use all of it
        else:
            inloc = [f for f in feats if f["properties"]["left_locality"] in target or f["properties"]["right_locality"] in target]
        if not inloc:
            skipped.append(dict(base, reason=f"no {title} in {where} in Vicmap Transport"))
            continue
        comps = components(inloc, 300 if title in GRID else 30)   # the grid's main streets are broken by malls and squares
        if len(comps) != 1:
            skipped.append(dict(base, reason=f"{len(comps)} separate roads called {title} in {where}"))
            continue
        ml, bad = comps[0], []
        for g in grid:
            gf = [f for f in roads(g) if in_city(f)]
            d = ml.distance(unary_union([shape(f["geometry"]) for f in gf])) / DEG * 0.9 if gf else None
            if d is None or d > 250:
                bad.append(f"{g} is {d:.0f} m away" if d is not None else f"{g} not found")
        if bad:
            skipped.append(dict(base, reason="cross streets named in the entry do not fit: " + "; ".join(bad)))
            continue
        p, how = midpoint(ml)
        why = f"only {title} in {where}" + (f" (Vicmap has {len(everywhere) - 1} other road(s) of this name elsewhere in Melbourne)" if len(everywhere) > 1 else "")
        if grid:
            why += "; within 250 m of " + ", ".join(grid) + ", as the entry says"
        cs = [c for c in com if re.split(r" between | from ", (c["properties"].get("seg_descr") or "").lower())[0].strip() == title.lower()]
        if cs and target == {"MELBOURNE"} and min(shape(c["geometry"]).distance(p) for c in cs) / DEG * 0.85 < 60:
            why += "; City of Melbourne road corridors agree"
        rows.append(dict(base, matched=title, source="Vicmap Transport road centreline", lat=f"{p.y:.5f}", long=f"{p.x:.5f}", reason=f"{why}; {how}"))
    return rows, skipped


def key(r):
    return (r["kind"], r["record_id"])


def read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def review(site):
    roots = load_tei(site)
    gz = Gaz()
    p_rows, p_skip = find_places(roots, gz)
    places = {r["record_id"]: r for r in p_rows}
    place_titles = [title_of(r) for r in roots.values() if r.get("type") == "place"]
    s_rows, s_skip = find_streets(roots, gz, place_titles)
    l_rows, l_skip = find_lives(roots, gz, places)
    rows = (sorted(p_rows, key=lambda r: r["record"]) + s_rows + sorted(l_rows, key=lambda r: (r["place_text"], r["record"])))
    old = {key(r): r for r in read_csv(REVIEW)}
    for r in rows:
        o = old.get(key(r))
        r["decision"] = o["decision"] if o and (o["lat"], o["long"]) == (r["lat"], r["long"]) else ""   # a moved point is asked again
    found = {key(r) for r in rows}
    rows += [r for k, r in old.items() if k not in found and r.get("decision")]   # decided rows no longer found
    with open(REVIEW, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    skipped = sorted(p_skip, key=lambda r: r["record"]) + s_skip + sorted(l_skip, key=lambda r: (r["place_text"], r["record"]))
    with open(SKIPPED, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, ["kind", "record_id", "record", "field", "place_text", "year", "reason"], extrasaction="ignore")
        w.writeheader()
        w.writerows(skipped)
    print(f"{len(rows)} rows -> {os.path.relpath(REVIEW, ROOT)}", dict(collections.Counter(r["kind"] for r in rows)))
    print(f"{len(skipped)} skipped -> {os.path.relpath(SKIPPED, ROOT)}", dict(collections.Counter(r["kind"] for r in skipped)))


# ---------------------------------------------------------------- apply

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def location(r):
    credit = CREDIT.get(r["source"], r["source"])
    return (f'<location type="point"><geo>{float(r["lat"]):.5f} {float(r["long"]):.5f}</geo>'
            f'<note type="source">{esc(r["matched"])}: {esc(credit)}. {esc(r["reason"].split(";")[0][:1].upper() + r["reason"].split(";")[0][1:])}.</note></location>')


GEO_DONE = re.compile(r'<location type="point"><geo>[^<]*</geo><note type="source">.*?</note></location>')
LIST_DONE = re.compile(r'\n?<listPlace type="(location|life)">.*?</listPlace>', re.S)


def apply(site):
    todo = [r for r in read_csv(REVIEW) if r.get("decision", "").strip().lower() in ("y", "yes")]
    by_file = collections.defaultdict(list)
    for r in todo:
        by_file[r["record_id"]].append(r)
    today = datetime.date.today().isoformat()
    changed = 0
    for rid, items in sorted(by_file.items()):
        path = os.path.join(site, "tei", rid + ".xml")
        s = open(path, encoding="utf-8").read()
        orig = s
        s = LIST_DONE.sub("", GEO_DONE.sub("", s))   # undo an earlier apply, so this one replaces it
        place = [r for r in items if r["kind"] == "place"]
        street = [r for r in items if r["kind"] == "street"]
        life = sorted((r for r in items if r["kind"] in ("birthplace", "deathplace")), key=lambda r: r["kind"])
        if place:
            s = re.sub(r'(<place xml:id="subject">.*?)(</place>)', lambda m: m.group(1) + location(place[0]) + m.group(2), s, count=1, flags=re.S)
        lp = ""
        if street:
            lp += f'<listPlace type="location"><place><placeName>{esc(street[0]["record"])}</placeName>{location(street[0])}</place></listPlace>\n'
        if life:
            lp += ('<listPlace type="life">' + "".join(
                f'<place type="{r["field"]}"><placeName>{esc(r["place_text"])}</placeName>{location(r)}</place>' for r in life) + "</listPlace>\n")
        if lp:
            lp = "\n" + lp.rstrip("\n").replace("</listPlace>\n", "</listPlace>\n")
            if "</listPerson>" in s:
                s = s.replace("</listPerson>", "</listPerson>" + lp, 1)
            elif "<standOff>" in s:
                s = s.replace("<standOff>", "<standOff>" + lp, 1)
            else:
                s = s.replace("<text>", "<standOff>" + lp + "</standOff>\n<text>", 1)
        if s == orig:
            continue
        what = ", ".join(sorted({r["kind"].replace("place", " place").strip() for r in items}))
        if 'type="geocoded"' not in s:
            change = (f'<change when="{today}" type="geocoded">Coordinates added ({what}) from Vicmap and VICNAMES '
                      f'(CC BY 4.0), checked in enrichments/geo-review.csv.</change>\n')
            s = s.replace("</revisionDesc>", change + "</revisionDesc>", 1)
        open(path, "w", encoding="utf-8").write(s)
        changed += 1
    print(f"{len(todo)} rows marked y; {changed} files changed. Now run tools/build_index.py and tools/build-facets.py.")


# ---------------------------------------------------------------- basemap

def basemap(site):
    """Simplified outlines for the map experiments: Victoria, Melbourne's localities, the Hoddle grid."""
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union, linemerge

    def rings(g, nd=4):
        polys = g.geoms if hasattr(g, "geoms") else [g]
        out = []
        for p in polys:
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            out.append([[round(x, nd), round(y, nd)] for x, y in p.exterior.coords])
        return out

    lga = [f for f in json.load(open(cache("lga-lite.json")))["features"] if f["properties"]["state"] == "VIC"]
    vic = unary_union([shape(f["geometry"]).buffer(0) for f in lga]).simplify(0.01)
    vic = [r for r in rings(vic, 3) if len(r) > 8]
    loc = []
    for f in json.load(open(cache("localities.json"))):
        g = shape(f["geometry"]).buffer(0)
        c = g.representative_point()
        if km(GPO, (c.y, c.x)) > 75:
            continue
        g = g.simplify(0.0007)
        loc.append({"n": f["properties"]["locality_name"].title(), "c": [round(c.x, 4), round(c.y, 4)], "r": rings(g)})
    grid = []
    for n in GRID:
        fn = cache("roads/" + re.sub(r"\W", "_", n.upper()) + ".json")
        if not os.path.exists(fn):
            continue
        u = unary_union([shape(f["geometry"]) for f in json.load(open(fn))
                         if "MELBOURNE" in (f["properties"]["left_locality"], f["properties"]["right_locality"])])
        u = (linemerge(u) if hasattr(u, "geoms") else u).simplify(0.00005)
        for l in (u.geoms if hasattr(u, "geoms") else [u]):
            grid.append({"n": n, "l": [[round(x, 5), round(y, 5)] for x, y in l.coords]})
    data = {"credit": "Outlines: Vicmap Lite, Vicmap Admin and Vicmap Transport, © State of Victoria (DEECA), CC BY 4.0",
            "vic": vic, "loc": loc, "grid": grid}
    path = os.path.join(site, "data", "basemap.js")
    js = 'EMEL.loaded("basemap",' + json.dumps(data, separators=(",", ":")) + ");\n"
    open(path, "w", encoding="utf-8").write(js)
    print(f"{len(loc)} localities, {len(grid)} grid street pieces, {len(js) // 1024} KB -> {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    site = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "site")
    {"fetch": fetch, "review": review, "apply": apply, "basemap": basemap}.get(cmd, lambda s: sys.exit(__doc__))(site)

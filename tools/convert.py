#!/usr/bin/env python3
"""Convert the eMelbourne OHRM database (PostgreSQL dump from figshare) to TEI.

Stdlib only. Reads the database through the `psql` command line client.

    python3 convert.py --db emel --out ../site [--ids EM00187,EM00018 | --all]
                       [--objects /path/to/unzipped/crate]

Writes:
    <out>/tei/<EID>.xml      one TEI document per entity
    <out>/data/index.json    browse/search index (all converted entities)
    <out>/objects/...        images referenced by converted entities (if --objects)
"""
import argparse, csv, html, io, json, os, posixpath, re, shutil, subprocess, sys
import urllib.parse
csv.field_size_limit(sys.maxsize)
from html.parser import HTMLParser
from xml.sax.saxutils import escape, quoteattr

TEI_NS = "http://www.tei-c.org/ns/1.0"
LICENCE = "https://creativecommons.org/licenses/by-nc-sa/4.0/"
SOURCE_DOI = "https://doi.org/10.26188/23983911.v1"

# --------------------------------------------------------------------------- db

def query(db, sql):
    out = subprocess.run(["psql", "-X", "-q", "--csv", "-d", db, "-c", sql],
                         check=True, capture_output=True, text=True).stdout
    return list(csv.DictReader(io.StringIO(out)))

def by_key(rows, key):
    d = {}
    for r in rows:
        d.setdefault(r[key], []).append(r)
    return d

def clean(s):
    """Field value -> plain text (fields are stored with HTML entities)."""
    if s is None:
        return ""
    return html.unescape(s).strip()

# ------------------------------------------------------- HTML-ish note -> TEI

INLINE = {"em": ("hi", {"rend": "italic"}), "i": ("hi", {"rend": "italic"}),
          "b": ("hi", {"rend": "bold"}), "strong": ("hi", {"rend": "bold"}),
          "u": ("hi", {"rend": "underline"}), "sup": ("hi", {"rend": "sup"}),
          "sub": ("hi", {"rend": "sub"})}
BLOCK = {"table", "blockquote", "ul", "ol", "dl"}
EMID = re.compile(r"(EM\d{5})[a-z]?\.htm", re.I)


LINK_BASE = [""]   # path from the TEI file being written to the tei/ folder


PAGE_DIR = [""]    # folder of the old page being converted (e.g. "everydaywar")
DOID = re.compile(r"(D\d{8})\.htm", re.I)


def page_id(filename):
    """Old page path -> page id: everydaywar/aftermath.html -> everydaywar-aftermath."""
    f = re.sub(r"(^|/)index\.html?$", "", filename.strip("/"))
    f = re.sub(r"\.html?$", "", f)
    if f in ("", "home"):
        return "home"
    parts = f.split("/")
    if len(parts) == 2 and parts[0] == parts[1]:   # civictreasures/civictreasures.html
        parts = parts[:1]
    return "-".join(p for p in parts if p).lower()


def link_target(href):
    href = (href or "").strip()
    m = EMID.search(href)
    if m:
        return LINK_BASE[0] + m.group(1).upper() + ".xml", "entity"
    m = DOID.search(href)
    if m:
        # digital objects have no TEI file; "ohrm:" names the OHRM record
        # (declared in schema/emelbourne.odd), shown by object.html
        return "ohrm:" + m.group(1).upper(), "object"
    if href.startswith("#entryreferences"):
        return "#references", "internal"
    if href and not re.match(r"^[a-z]+:|^#", href, re.I):
        path = posixpath.normpath(posixpath.join(PAGE_DIR[0], href))
        if href.endswith("/"):
            path += "/index.html"
        if re.search(r"\.html?$", path) and page_id(path) in KNOWN_PAGES:
            pid = page_id(path)
            return (pid + ".xml" if LINK_BASE[0] == "../" else "pages/" + pid + ".xml"), "page"
    return href, "external"


class NoteToTEI(HTMLParser):
    """Turns the loose HTML used in ESUMNOTE into TEI body content.

    Paragraphs are separated by blank lines; tables, quotes and lists are
    lifted out of paragraphs to block level. Unknown tags are dropped but
    their text is kept, so nothing is lost silently (warnings are counted).
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # finished block-level chunks
        self.cur = []          # current paragraph fragments
        self.stack = []        # open TEI element names (inside blocks/inline)
        self.block_depth = 0
        self.blk = []          # fragments of the current block element
        self.warnings = []

    # helpers
    def _emit(self, s):
        if self.block_depth:
            self.blk.append(s)
        else:
            self.cur.append(s)

    def _close_p(self):
        text = "".join(self.cur).strip()
        if text:
            self.out.append("<p>%s</p>" % text)
        self.cur = []

    def _open(self, name, attrs=None):
        a = "".join(" %s=%s" % (k, quoteattr(v)) for k, v in (attrs or {}).items())
        self._emit("<%s%s>" % (name, a))
        self.stack.append(name)

    def _close(self, name):
        if name in self.stack:
            while self.stack:
                top = self.stack.pop()
                self._emit("</%s>" % top)
                if top == name:
                    break

    # parser callbacks
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in INLINE:
            n, a = INLINE[tag]
            self._open(n, a)
        elif tag == "a":
            tgt, kind = link_target(attrs.get("href"))
            if attrs.get("name") and not attrs.get("href"):
                self._open("anchor", {"xml:id": "a-" + attrs["name"]}); self._close("anchor")
                return
            self._open("ref", {"target": tgt})
        elif tag == "br":
            self._emit("<lb/>")
        elif tag == "p":
            if not self.block_depth:
                self._close_p()
        elif tag in BLOCK:
            if not self.block_depth:
                self._close_p()
            self.block_depth += 1
            if tag == "table":
                self._open("table")
            elif tag == "blockquote":
                self._open("quote", {"rend": "block"})
            elif tag == "dl":
                self._open("list", {"type": "gloss"})
            else:
                self._open("list", {"rend": "numbered" if tag == "ol" else "bulleted"})
        elif tag == "li":
            self._open("item")
        elif tag == "dt":
            self._open("label")
        elif tag == "dd":
            # TEI gloss lists alternate label/item; a <dd> with no <dt> (the old "Details" link) gets the label "Record"
            last = (self.blk or self.cur or [""])[-1]
            if last.endswith("</item>"):
                self._emit("<label>Record</label>")
            self._open("item")
        elif tag == "img":
            g = "<graphic url=%s/>" % quoteattr(image_url(attrs.get("src", "")))
            alt = attrs.get("alt")
            fig = "<figure>%s%s</figure>" % (g, "<figDesc>%s</figDesc>" % escape(alt) if alt else "")
            if self.block_depth:
                self.blk.append(fig)
            elif self.stack:     # inside a link: keep the figure in place (TEI allows ref/figure)
                self.cur.append(fig)
            else:
                self._close_p(); self.out.append(fig)
        elif tag == "tr":
            self._open("row")
        elif tag in ("td", "th"):
            a = {"role": "label"} if tag == "th" else {}
            for k in ("colspan", "rowspan"):
                if attrs.get(k):
                    a["cols" if k == "colspan" else "rows"] = attrs[k]
            self._open("cell", a)
        elif tag == "caption":
            self._open("head")
        elif tag in ("tbody", "thead", "tfoot", "font", "span", "div"):
            pass
        else:
            self.warnings.append(tag)

    def handle_endtag(self, tag):
        if tag in INLINE:
            self._close(INLINE[tag][0])
        elif tag == "a":
            self._close("ref")
        elif tag in BLOCK:
            self._close({"table": "table", "blockquote": "quote"}.get(tag, "list"))
            self.block_depth = max(0, self.block_depth - 1)
            if not self.block_depth:
                self.out.append("".join(self.blk)); self.blk = []
        elif tag in ("li", "dd"):
            self._close("item")
        elif tag == "dt":
            self._close("label")
        elif tag == "tr":
            self._close("row")
        elif tag in ("td", "th"):
            self._close("cell")
        elif tag == "caption":
            self._close("head")

    def handle_data(self, data):
        if self.block_depth:
            if not data.strip():
                return
            t = escape(data.strip())
            if "quote" in self.stack:   # verse and letters: keep line breaks
                t = re.sub(r"\s*\r?\n(\s*\r?\n)*\s*", "<lb/>", t)
            else:
                t = re.sub(r"\s+", " ", t)
            self.blk.append(t)
            return
        parts = re.split(r"\r?\n\s*\r?\n", data)
        for i, part in enumerate(parts):
            if i:
                # paragraph break: close inline elements, end p, reopen them
                open_inline = list(self.stack)
                for n in reversed(open_inline):
                    self.cur.append("</%s>" % n)
                self._close_p()
                for n in open_inline:
                    self.cur.append("<%s>" % n)
            self.cur.append(escape(re.sub(r"\s*\r?\n\s*", " ", part)))

    def result(self):
        while self.stack:
            self._emit("</%s>" % self.stack.pop())
        if self.blk:
            self.out.append("".join(self.blk)); self.blk = []
            self.block_depth = 0
        self._close_p()
        return "\n".join(self.out)


IMAGES = {"src": None, "out": None, "copied": 0}


def image_url(src):
    """Image path in an old page -> path relative to the TEI file. Copies the
    image into the site when the archive has it."""
    if re.match(r"^[a-z]+:", src, re.I):
        return src
    path = posixpath.normpath(posixpath.join(PAGE_DIR[0], src)).lstrip("./")
    if IMAGES["src"] and os.path.isfile(os.path.join(IMAGES["src"], path)):
        dst = os.path.join(IMAGES["out"], path)
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(os.path.join(IMAGES["src"], path), dst)
            IMAGES["copied"] += 1
    path = urllib.parse.quote(path)
    return LINK_BASE[0] + "../" + path if LINK_BASE[0] else "../" + path


def note_to_tei(s, base=""):
    LINK_BASE[0] = base
    if not s:
        return "", []
    p = NoteToTEI()
    # some notes escape characters as in SQL (\-), strip stray backslashes
    p.feed(s.replace("\\-", "-"))
    p.close()
    return p.result(), p.warnings


def plain(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

# ---------------------------------------------------------------- TEI writer
#
# Entries follow the Carlton Common Ground entry format (schema/emelbourne.odd,
# a variant of Carlton's carlton.odd):
#   <TEI type="person|place|topic|object" subtype="entry|theme|...">
#     teiHeader  title, authors, idno type="entry" (the OHRM id), licence,
#                one <change> per event in the record's history
#     standOff   the subject (person / place, xml:id="subject"), dated events
#                (listEvent type="chronology"), links to other entries
#                (listRelation; @passive points at the other entry's file)
#     text       body: <div type="detail"> (the article), <div type="gallery">;
#                back: <div type="bibliography"> (references)
# Paths inside the TEI (other entries, images) are relative to the TEI file.

PUBLISHER = "eMelbourne: The Encyclopedia of Melbourne Online"
KIND = {"Person": "person", "Place": "place", "Cultural Artefact": "object"}  # everything else: topic
XMLDECL = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<?xml-model href="../schema/emelbourne.rng" type="application/xml" '
           'schematypens="http://relaxng.org/ns/structure/1.0"?>\n')


def x(s):
    return escape(clean(s))

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", clean(s).lower()).strip("-")

def iso(s):
    m = re.match(r"(\d{4})(-\d{2})?(-\d{2})?", s or "")
    if not m or m.group(1) == "0000":
        return None
    d = m.group(0)
    return re.sub(r"(-00)+$", "", d)

MONTHS = "january february march april may june july august september october november december".split()

def iso_shown(raw, shown):
    """ISO date cut to the precision the display text shows: OHRM stores a
    bare year as 1813-01-01, but the page says "1813" (or "c. 1813")."""
    d = iso(raw)
    if not d or not shown:
        return d
    words = re.findall(r"[a-z]+|\d+", shown.lower())
    has_month = any(w in MONTHS for w in words)
    has_day = has_month and any(w.isdigit() and len(w) <= 2 for w in words)
    return d[:10] if has_day else d[:7] if has_month else d[:4]

def attrs(**kw):
    return "".join(' %s=%s' % (k.rstrip("_").replace("__", ":"), quoteattr(str(v))) for k, v in kw.items() if v)

def authors_of(s):
    # OHRM title-cases joint credits as "Name And Name"
    return [a.strip() for a in re.split(r"\s+And\s+", clean(s)) if a.strip()]


def bibl(p):
    parts = []
    if p.get("author"):
        parts.append("<author>%s</author>" % x(p["author"]))
    t = clean(p.get("title"))
    if t:
        parts.append('<title level="%s">%s</title>' % ("a" if p.get("secondarytitle") else "m", escape(t)))
    if p.get("secondarytitle"):
        parts.append('<title level="m">%s</title>' % x(p["secondarytitle"]))
    if p.get("placepublished"):
        parts.append("<pubPlace>%s</pubPlace>" % x(p["placepublished"]))
    if p.get("publisher"):
        parts.append("<publisher>%s</publisher>" % x(p["publisher"]))
    if p.get("x_year"):
        parts.append("<date>%s</date>" % x(p["x_year"]))
    if p.get("pagenos"):
        parts.append('<biblScope unit="page">%s</biblScope>' % x(p["pagenos"]))
    if p.get("url"):
        parts.append("<ref%s>online</ref>" % attrs(target=clean(p["url"])))
    return "<bibl%s>%s</bibl>" % (attrs(xml__id=p["pubid"], type=slug(p.get("type"))), " ".join(parts))


def subject_xml(e, kind, ctx):
    eid, name = e["eid"], clean(e["ename"])
    alts = ctx["altnames"].get(eid, [])
    if kind == "person":
        if "," in name:
            sur, fore = [t.strip() for t in name.split(",", 1)]
            main = '<persName type="main"><forename>%s</forename> <surname>%s</surname></persName>' % (escape(fore), escape(sur))
        else:
            main = '<persName type="main">%s</persName>' % escape(name)
        out = [main]
        out += ['<persName%s>%s</persName>' % (attrs(type="alternative", subtype=slug(a["enalternatetype"])), x(a["enalternate"])) for a in alts]
        if e["egender"] in ("M", "F"):
            out.append('<sex value="%s"/>' % {"M": "1", "F": "2"}[e["egender"]])
        for tag, disp, raw, pl in (("birth", e["estartdate"], e["estart"], e["ebthplace"]),
                                   ("death", e["eenddate"], e["eend"], e["edthplace"])):
            if disp or raw or pl:
                txt = escape(clean(disp) or iso(raw) or "")
                if pl:
                    txt += (", " if txt else "") + "<placeName>%s</placeName>" % x(pl)
                out.append("<%s%s>%s</%s>" % (tag, attrs(when=iso_shown(raw, disp)), txt, tag))
        out += ["<occupation>%s</occupation>" % x(f["fname"]) for f in ctx["functions"].get(eid, [])]
        return '<listPerson><person xml:id="subject">%s</person></listPerson>' % "".join(out)
    if kind == "place":
        out = ['<placeName type="main">%s</placeName>' % escape(name)]
        out += ['<placeName%s>%s</placeName>' % (attrs(type="alternative", subtype=slug(a["enalternatetype"])), x(a["enalternate"])) for a in alts]
        if e["elocation"]:
            out.append('<location type="address"><address><addrLine>%s</addrLine></address></location>' % x(e["elocation"]))
        return '<listPlace><place xml:id="subject"%s>%s</place></listPlace>' % (
            attrs(from_=iso(e["estart"]), to=iso(e["eend"])), "".join(out))
    return ""


def chronology(e, kind):
    if kind == "person":
        return ""  # birth and death are on the person
    ev = []
    for label, disp, raw in (("Start", e["estartdate"], e["estart"]), ("End", e["eenddate"], e["eend"])):
        if iso(raw):
            ev.append("<event%s><label>%s: %s</label></event>" % (attrs(when=iso_shown(raw, disp)), label, x(disp) or iso(raw)))
    return '<listEvent type="chronology">%s</listEvent>' % "".join(ev) if ev else ""


def build_tei(e, ctx):
    eid = e["eid"]
    name = clean(e["ename"])
    etype = clean(e["etype"])
    kind = KIND.get(etype, "topic")
    body, warns = note_to_tei(e["esumnote"])
    o = [XMLDECL]
    o.append('<TEI xmlns="%s"%s xml:lang="en">' % (TEI_NS, attrs(type=kind, subtype=slug(etype))))
    o.append("<teiHeader><fileDesc><titleStmt><title>%s</title>" % escape(name))
    o += ["<author>%s</author>" % escape(a) for a in authors_of(e["eprepared"])]
    o.append("</titleStmt>")
    o.append('<publicationStmt><publisher>%s</publisher><idno type="entry">%s</idno>'
             '<availability><licence target="%s">CC BY-NC-SA 4.0</licence></availability></publicationStmt>'
             % (PUBLISHER, eid, LICENCE))
    o.append('<sourceDesc><p>Converted from the OHRM database of eMelbourne, '
             '<ref target="%s">doi:10.26188/23983911.v1</ref>.</p></sourceDesc></fileDesc>' % SOURCE_DOI)
    o.append('<revisionDesc status="published">')
    if iso(e["eappenddate"]):
        o.append('<change when="%s" type="created">Record created in the eMelbourne OHRM database.</change>' % iso(e["eappenddate"]))
    if iso(e["elastmodd"]) and iso(e["elastmodd"]) != iso(e["eappenddate"]):
        o.append('<change when="%s" type="edited">Record last changed in the eMelbourne OHRM database.</change>' % iso(e["elastmodd"]))
    o.append('<change type="converted">Converted to TEI from the 2023 figshare archive.</change>')
    o.append("</revisionDesc></teiHeader>")

    rel = []
    for r in ctx["related"].get(eid, []):
        t = ctx["names"].get(r["reid"])
        if t:
            rel.append('<relation name="related"%s active="#subject" passive="%s.xml"><desc>%s</desc></relation>'
                       % (attrs(type=slug(t[1])), r["reid"], escape(t[0])))
    stand = [subject_xml(e, kind, ctx), chronology(e, kind),
             "<listRelation>%s</listRelation>" % "".join(rel) if rel else ""]
    stand = [s for s in stand if s]
    if stand:
        o.append("<standOff>%s</standOff>" % "\n".join(stand))

    o.append("<text><body>")
    o.append('<div type="detail">%s</div>' % (body or "<p/>"))
    figs = []
    for r in ctx["dobjects"].get(eid, []):
        files = r["files"]
        img = files.get("image") or files.get("thumbnail")
        if not img:
            continue
        f = ["<head>%s</head>" % x(r["dotitle"])]
        f.append('<graphic url=%s/>' % quoteattr("../" + img))
        if files.get("thumbnail"):
            f.append('<graphic type="thumbnail" url=%s/>' % quoteattr("../" + files["thumbnail"]))
        desc = " ".join(m for m in (clean(r.get("docreator")), clean(r.get("dostartdate"))) if m)
        if desc:
            f.append("<p>%s</p>" % escape(desc))
        if r.get("dorights"):
            f.append('<note type="rights">%s</note>' % x(r["dorights"]))
        figs.append('<figure xml:id="%s">%s</figure>' % (r["doid"], "".join(f)))
    if figs:
        o.append('<div type="gallery" xml:id="gallery"><head>Gallery</head>%s</div>' % "".join(figs))
    o.append("</body>")
    pubs = ctx["pubs"].get(eid, [])
    if pubs:
        o.append('<back><div type="bibliography" xml:id="references"><head>References</head><listBibl>%s</listBibl></div></back>'
                 % "".join(bibl(p) for p in pubs))
    o.append("</text></TEI>\n")
    return "\n".join(o), warns, plain(e["esumnote"])

# ------------------------------------------------- site pages and navigation
#
# The old site's non-entity pages (home, about, help, ...) and its theme menu
# live in the OHRM tables HTMLADDITIONAL and HTMLVARIABLES.

SKIP_PAGES = {"basic-search.html", "search.html", "test_google.html"}   # replaced by the site's own search
KNOWN_PAGES = set()
HEADING = re.compile(r"<h([2-4])([^>]*)>(.*?)</h\1>", re.I | re.S)


def build_page(pid, title, html_src):
    src = (html_src or "").replace("$level_", "")
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    # feature images sit just before their heading: move them after it
    src = re.sub(r"(<img[^>]*>)\s*(<h[2-4][^>]*>.*?</h[2-4]>)", r"\2\1", src, flags=re.S | re.I)
    # split on headings: each heading starts a TEI <div> with a <head>
    parts, last, sections = [], 0, []
    heads = [m for m in HEADING.finditer(src) if "hidden" not in m.group(2)]
    pre = src[: heads[0].start()] if heads else src
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(src)
        sections.append((int(m.group(1)), plain(m.group(3)), src[m.end():end]))
    body = []
    t, _ = note_to_tei(HEADING.sub("", pre), "../")
    if t.strip():
        body.append("<div>%s</div>" % t)
    for level, head, chunk in sections:
        t, _ = note_to_tei(chunk, "../")
        body.append('<div rend="h%d"><head>%s</head>%s</div>' % (level, escape(head), t))
    return (XMLDECL.replace("../schema", "../../schema") +
            '<TEI xmlns="%s" type="topic" subtype="page" xml:lang="en">'
            "<teiHeader><fileDesc><titleStmt><title>%s</title></titleStmt>"
            '<publicationStmt><publisher>%s</publisher><idno type="page">%s</idno>'
            '<availability><licence target="%s">CC BY-NC-SA 4.0</licence></availability></publicationStmt>'
            '<sourceDesc><p>Converted from the eMelbourne OHRM database (site pages), '
            '<ref target="%s">doi:10.26188/23983911.v1</ref>.</p></sourceDesc></fileDesc>'
            '<revisionDesc status="published"><change type="converted">Converted to TEI from the 2023 figshare archive.</change></revisionDesc>'
            "</teiHeader><text><body>%s</body></text></TEI>\n"
            % (TEI_NS, escape(title), PUBLISHER, pid, LICENCE, SOURCE_DOI, "\n".join(body)))


def export_pages_and_nav(db, out, names, objects_src=None):
    pages = []
    var = {r["varname"]: r["varvalue"] for r in query(db, "select varname, varvalue from htmlvariables")}
    rows = [r for r in query(db, "select filename, pagetitle, contenttitle, contents from htmladditional order by filename")
            if r["filename"] not in SKIP_PAGES]
    KNOWN_PAGES.update(page_id(r["filename"]) for r in rows)
    IMAGES.update(src=objects_src, out=out)
    for r in rows:
        pid = page_id(r["filename"])
        PAGE_DIR[0] = posixpath.dirname(r["filename"])
        title = clean(r["contenttitle"] or r["pagetitle"])
        # pages made of a template variable ($CivicTreasures-Dobjects, ...): expand it
        src = re.sub(r"\$[A-Za-z][\w -]*\w", lambda m: var.get(m.group(0), m.group(0)), r["contents"] or "")
        if PAGE_DIR[0] == "" and re.search(r'href="objects/', src):
            pass  # variable lists are written relative to the site root
        tei = build_page(pid, title, src)
        os.makedirs(os.path.join(out, "tei", "pages"), exist_ok=True)
        with open(os.path.join(out, "tei", "pages", pid + ".xml"), "w", encoding="utf-8") as f:
            f.write(tei)
        write_js(os.path.join(out, "tei-js", "pages", pid + ".js"), "page:" + pid, tei)
        pages.append({"id": pid, "title": title, "group": pid.split("-")[0] if "-" in pid else ""})
    PAGE_DIR[0] = ""
    # theme menu, in the old site's order
    themes = []
    for href, label in re.findall(r'<a href="[^"]*?(EM\d{5})b\.htm">(.*?)</a>', var.get("$nav", "")):
        themes.append({"id": href, "name": clean(label)})
    in_focus = [{"id": i, "name": clean(n)} for i, n in
                re.findall(r'(EM\d{5})b\.htm"[^>]*>(.*?)</a>', var.get("$inFocus", ""))]
    write_js(os.path.join(out, "data", "nav.js"), "nav",
             {"themes": themes, "pages": pages, "inFocus": in_focus})
    return len(pages), len(themes)

# ---------------------------------------------------------------------- main

def write_js(path, key, value):
    """Write `EMEL.loaded(key, value)`. Loaded with a <script> tag, which
    browsers allow from file:// as well as from any web host."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("EMEL.loaded(%s,%s);\n" % (json.dumps(key), json.dumps(value, ensure_ascii=False, separators=(",", ":"))))

def export_objects(db, out, objects_src, names):
    """data/objects.js: every OHRM digital object (title, description, dates,
    rights, linked entries, PROV citation for the WWI items, and the image
    files that survive in the archive). Pages link to these as ohrm:Dxxxxxxxx."""
    objs = {}
    for d in query(db, "select * from dobject order by doid"):
        o = {k: clean(d[c]) for k, c in (("title", "dotitle"), ("type", "dotype"),
             ("description", "dodescription"), ("creator", "docreator"), ("place", "doplace"),
             ("physdesc", "dophysdesc"), ("rights", "dorights"), ("reference", "doreference"))}
        ds, de = clean(d["dostartdate"]), clean(d["doenddate"])
        o["date"] = ds + (" – " + de if de and (iso(d["doend"]) or de) != (iso(d["dostart"]) or ds) else "") if ds else de
        objs[d["doid"]] = {k: v for k, v in o.items() if v}
    for r in query(db, "select doid, eid from edorship order by doid, rating, eid"):
        if r["doid"] in objs and r["eid"] in names:
            objs[r["doid"]].setdefault("entries", []).append(r["eid"])
    for v in query(db, "select doid, dovtype, dov from dobjectversion "
                       "where dovtype in ('image','thumbnail') order by doid"):
        o = objs.get(v["doid"])
        if o is None or not v["dov"]:
            continue
        src = os.path.join(objects_src, v["dov"]) if objects_src else None
        if not (src and os.path.isfile(src)):
            continue
        dst = os.path.join(out, v["dov"])
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst); IMAGES["copied"] += 1
        o["image" if v["dovtype"] == "image" else "thumb"] = v["dov"]
    # Public Record Office Victoria items behind the Everyday War exhibition
    # (only present if the WW1-P0000/P0001 tables were loaded; see README)
    for t in ("ww1_p0000", "ww1_p0001"):
        try:
            rows = query(db, "select * from %s where coalesce(doid,'') <> '' order by identifier" % t)
        except subprocess.CalledProcessError:
            continue
        for r in rows:
            o = objs.get(r["doid"])
            if o is None or "prov" in o:
                continue
            g = lambda *ks: next((clean(r[k]) for k in ks if clean(r.get(k, "")) not in ("", "n/a")), "")
            ref = "VPRS %s/%s, unit %s" % (g("vprs"), g("consignmentnumber", "consignment_number"),
                                           g("unitnumber", "unit_number"))
            if g("filenumber", "top_file_number"):
                ref += ", file %s" % g("filenumber", "top_file_number")
            o["prov"] = {k: v for k, v in (("ref", ref), ("date", g("x_date")),
                         ("from", g("titlefrom", "title")),
                         ("subject", g("descriptionsubject", "description")),
                         ("pages", g("dobjecttotal"))) if v}
    write_js(os.path.join(out, "data", "objects.js"), "objects", objs)
    return len(objs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="emel")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ids", help="comma separated EIDs")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--objects", help="unzipped RO-Crate folder (contains objects/)")
    a = ap.parse_args()

    ents = query(a.db, "select * from entity order by eid")
    names = {e["eid"]: (clean(e["ename"]), clean(e["etype"])) for e in ents}
    wanted = set(names) if a.all else set((a.ids or "").split(","))
    wanted.discard("")
    if not wanted:
        sys.exit("give --ids or --all")

    rel = query(a.db, "select eid, reid, rerelationship, coalesce(reorder,'0') reorder "
                      "from relatedentity order by eid, reorder")
    related = {}
    seen = set()
    # relationships are stored both ways; dedupe and keep a stable order
    for r in rel:
        k = (r["eid"], r["reid"])
        if k in seen:
            continue
        seen.add(k)
        related.setdefault(r["eid"], []).append(r)
    for v in related.values():
        v.sort(key=lambda r: (names.get(r["reid"], ("", ""))[1] != "Theme", names.get(r["reid"], ("",))[0]))

    functions = by_key(query(a.db, "select x.eid, f.fname from efrship x join function f using(fid) "
                                    "order by x.eid, x.ordering, f.fname"), "eid")
    pubs = by_key(query(a.db, "select * from (select distinct on (x.eid, p.pubid) x.eid, p.* "
                               "from eprrship x join pubresource p using(pubid) order by x.eid, p.pubid) t "
                               "order by eid, author, x_year"), "eid")
    dob = query(a.db, "select x.eid, d.doid, d.dotitle, d.docreator, d.dostartdate, d.dorights, "
                      "v.dovtype, v.dov from edorship x join dobject d using(doid) "
                      "join dobjectversion v using(doid) where v.dovtype in ('image','thumbnail') "
                      "order by x.eid, x.rating, d.doid")
    dobjects = {}
    copied = 0
    for r in dob:
        if r["eid"] not in wanted:
            continue
        src = os.path.join(a.objects, r["dov"]) if a.objects else None
        if not (src and os.path.isfile(src)):
            continue  # image not in the archive: on the roadmap
        lst = dobjects.setdefault(r["eid"], [])
        d = next((d for d in lst if d["doid"] == r["doid"]), None)
        if not d:
            d = dict(r, files={}); lst.append(d)
        d["files"][r["dovtype"]] = r["dov"]
        dst = os.path.join(a.out, r["dov"])
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst); copied += 1

    altnames = by_key(query(a.db, "select eid, enalternate, enalternatetype from entityname "
                                  "where enalternate is not null order by eid, enalternate"), "eid")
    ctx = dict(names=names, related=related, functions=functions, pubs=pubs, dobjects=dobjects, altnames=altnames)
    os.makedirs(os.path.join(a.out, "tei"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
    index, warn_total = [], {}
    for e in ents:
        if e["eid"] not in wanted:
            continue
        tei, warns, text = build_tei(e, ctx)
        for w in warns:
            warn_total[w] = warn_total.get(w, 0) + 1
        with open(os.path.join(a.out, "tei", e["eid"] + ".xml"), "w", encoding="utf-8") as f:
            f.write(tei)
        index.append({
            "id": e["eid"], "name": names[e["eid"]][0], "type": names[e["eid"]][1],
            "author": clean(e["eprepared"]),
            "dates": " – ".join(d for d in (clean(e["estartdate"]), clean(e["eenddate"])) if d),
            "themes": [r["reid"] for r in related.get(e["eid"], []) if names.get(r["reid"], ("", ""))[1] == "Theme"],
            "img": (dobjects.get(e["eid"]) or [{"files": {}}])[0]["files"].get("thumbnail"),
            "text": text,
        })
        # The same TEI wrapped in a JS file, so the site works from file://
        # (double-click), where browsers block fetch() of local files.
        write_js(os.path.join(a.out, "tei-js", e["eid"] + ".js"), "tei:" + e["eid"], tei)
    write_js(os.path.join(a.out, "data", "index.js"), "index", index)
    # names of every entity, so links to not-yet-converted records still get a label
    write_js(os.path.join(a.out, "data", "names.js"), "names", {k: v[0] for k, v in names.items()})
    np, nt = export_pages_and_nav(a.db, a.out, names, a.objects)
    no = export_objects(a.db, a.out, a.objects, names)
    print("converted %d entities, %d site pages, %d menu themes, %d digital objects; copied %d images"
          % (len(index), np, nt, no, copied + IMAGES["copied"]), file=sys.stderr)
    if warn_total:
        print("unhandled tags (text kept):", warn_total, file=sys.stderr)


if __name__ == "__main__":
    main()

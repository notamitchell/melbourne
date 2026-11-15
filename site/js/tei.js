/* Minimal TEI -> HTML renderer for eMelbourne (no dependencies).
 *
 * Fetches a TEI file, parses it with DOMParser and walks the tree, mapping
 * each TEI element to an HTML element. Unknown elements become
 * <span class="tei-NAME"> so their text is never lost.
 */
(function (global) {
  "use strict";
  var NS = "http://www.tei-c.org/ns/1.0";

  function attr(n, a) { return n.getAttribute(a) || ""; }

  function el(tag, cls, kids) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }

  function entityHref(id) { return "entry.html?id=" + encodeURIComponent(id); }

  // element handlers: (teiNode, renderChildren) -> HTML node
  var H = {
    p: function (n, kids) { return el("p", null, kids()); },
    note: function (n, kids) { return el(attr(n, "type") === "rights" ? "small" : "span", "note", kids()); },
    hi: function (n, kids) {
      var r = attr(n, "rend");
      var tag = { italic: "em", bold: "strong", sup: "sup", sub: "sub", underline: "u" }[r] || "span";
      return el(tag, null, kids());
    },
    lb: function () { return document.createElement("br"); },
    ref: function (n, kids) {
      var a = el("a", null, kids()), t = attr(n, "target"), m = t.match(/^(?:\.\.\/)*(EM\d{5})\.xml$/);
      var o = t.match(/^ohrm:(D\d{8})$/), pg = !m && t.match(/^(?:\.\.\/|pages\/)*([a-z0-9_-]+)\.xml$/i);
      if (m) a.href = entityHref(m[1]);
      else if (o) { a.href = "object.html?id=" + o[1]; a.className = "object-link"; }   // OHRM digital object
      else if (pg) a.href = "page.html?p=" + encodeURIComponent(pg[1]);                // site page (tei/pages/)
      else if (t.charAt(0) === "#") a.href = t;
      else { a.href = t; a.rel = "noopener"; a.target = "_blank"; }
      // a link that is only an image (e.g. Civic Treasures thumbnails) needs a name for screen
      // readers, and for the text shown when the image is missing: the entry's Title, else the object id
      if (!n.textContent.trim()) {
        var name = "", lab = n.parentNode, item = lab && lab.localName === "label" && lab.nextElementSibling;
        if (item) Array.prototype.some.call(item.getElementsByTagName("label"), function (l) {
          if (l.textContent.trim() === "Title" && l.nextElementSibling) { name = l.nextElementSibling.textContent.trim(); return true; }
        });
        name = name || (n.querySelector("figDesc, head") || {}).textContent || (o ? "Digital object " + o[1] : t);
        a.setAttribute("aria-label", name);
        Array.prototype.forEach.call(a.getElementsByTagName("img"), function (i) { if (!i.alt) i.alt = name; });
      }
      return a;
    },
    ptr: function (n) {
      var t = attr(n, "target"), a = el("a");
      a.href = t; a.textContent = "online"; a.rel = "noopener"; a.target = "_blank";
      return a;
    },
    quote: function (n, kids) { return el(attr(n, "rend") === "block" ? "blockquote" : "q", null, kids()); },
    list: function (n, kids) {
      if (attr(n, "type") === "gloss") return el("dl", "gloss", kids());
      return el(attr(n, "rend") === "numbered" ? "ol" : "ul", null, kids());
    },
    item: function (n, kids) { return el(attr(n.parentNode, "type") === "gloss" ? "dd" : "li", null, kids()); },
    label: function (n, kids) { return el(attr(n.parentNode, "type") === "gloss" ? "dt" : "strong", null, kids()); },
    figDesc: function () { return null; },
    table: function (n, kids) { return el("div", "table-wrap", [el("table", null, kids())]); },
    row: function (n, kids) { return el("tr", null, kids()); },
    cell: function (n, kids) {
      var c = el(attr(n, "role") === "label" ? "th" : "td", null, kids());
      if (attr(n, "cols")) c.colSpan = +attr(n, "cols");
      if (attr(n, "rows")) c.rowSpan = +attr(n, "rows");
      return c;
    },
    head: function (n, kids) {
      var p = n.parentNode.localName;
      if (p === "table") return el("caption", null, kids());
      if (p === "figure") return el("figcaption", null, kids());
      return el(attr(n.parentNode, "rend") === "h4" ? "h3" : "h2", null, kids());
    },
    div: function (n, kids) {
      var s = el("section", "tei-div " + attr(n, "type"), kids());
      var id = n.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id");
      if (id) s.id = id;
      return s;
    },
    figure: function (n, kids) {
      var fig = el("figure");
      var full = n.querySelector("graphic:not([type])");
      var thumb = n.querySelector('graphic[type="thumbnail"]') || full;
      if (thumb) {
        var img = el("img"); img.loading = "lazy";
        img.alt = (n.querySelector("figDesc") || n.querySelector("head") || {}).textContent || "";
        // images not (yet) in the archive: hide rather than show a broken icon
        // (inside a link, keep the link usable by showing the description instead)
        img.onerror = function () {
          if (fig.parentNode && fig.parentNode.closest && fig.parentNode.closest("a") && img.alt) {
            var s = el("span", "img-missing"); s.textContent = img.alt; fig.parentNode.replaceChild(s, fig);
          } else fig.hidden = true;
        };
        img.src = siteUrl(attr(thumb, "url"));
        // inside a TEI <ref> the image is already a link: don't nest a second one
        for (var up = n.parentNode, inRef = false; up && up.nodeType === 1; up = up.parentNode) if (up.localName === "ref") { inRef = true; break; }
        if (inRef) fig.appendChild(img);
        else { var a = el("a", null, [img]); a.href = siteUrl(attr(full || thumb, "url")); fig.appendChild(a); }
      }
      if (!full && !thumb) return null;
      var cap = el("figcaption");
      Array.prototype.forEach.call(n.children, function (c) {
        var r = c.localName !== "graphic" && render(c);
        if (r) cap.appendChild(r);
      });
      if (cap.childNodes.length) fig.appendChild(cap);
      return fig;
    },
    graphic: function () { return null; },
    listBibl: function (n, kids) { return el("ol", "bibl", kids()); },
    bibl: function (n) {
      // author. title. secondary title. place: publisher, date. [online]
      var li = el("li"), parts = [];
      Array.prototype.forEach.call(n.children, function (c) {
        var node = render(c);
        if (c.localName === "title") { var i = el(attr(c, "level") === "a" ? "span" : "cite"); i.appendChild(node); node = i; }
        parts.push(node);
      });
      parts.forEach(function (p, i) { if (i) li.appendChild(document.createTextNode(i === parts.length - 1 && /^(ptr|ref)$/.test(n.lastElementChild.localName) ? " " : ", ")); if (p) li.appendChild(p); });
      return li;
    },
    anchor: function () { return null; }
  };
  ["body", "text", "back"].forEach(function (k) { H[k] = function (n, kids) { var f = document.createDocumentFragment(); kids().forEach(function (c) { if (c) f.appendChild(c); }); return f; }; });

  // paths in the TEI are relative to the TEI file in tei/; pages live at the site root
  function siteUrl(u) { return /^[a-z]+:/i.test(u) ? u : u.replace(/^(\.\.\/)+/, ""); }

  /* standOff: facts about the subject, then links to other entries */
  function facts(doc) {
    var dl = el("dl", "facts");
    function row(label, value) {
      if (!value) return;
      dl.appendChild(el("dt", null, [document.createTextNode(label)]));
      dl.appendChild(el("dd", null, [document.createTextNode(value)]));
    }
    function txt(n) { return n ? n.textContent.replace(/\s+/g, " ").trim() : ""; }
    var subject = Array.prototype.filter.call(doc.getElementsByTagNameNS(NS, "*"), function (e) {
      return e.getAttributeNS("http://www.w3.org/XML/1998/namespace", "id") === "subject";
    })[0];
    if (subject) {
      Array.prototype.forEach.call(subject.children, function (c) {
        if (attr(c, "type") === "alternative") row("Also known as", txt(c) + (attr(c, "subtype") ? " (" + attr(c, "subtype").replace(/-/g, " ") + ")" : ""));
      });
      row("Born", txt(subject.querySelector("birth")));
      row("Died", txt(subject.querySelector("death")));
      row("Occupation", Array.prototype.map.call(subject.querySelectorAll("occupation"), txt).join(", "));
      row("Location", txt(subject.querySelector("location addrLine")));
    }
    Array.prototype.forEach.call(doc.querySelectorAll('listEvent[type="chronology"] event'), function (e) {
      var l = txt(e.querySelector("label")), k = l.split(":")[0];
      row(k, l.slice(k.length + 1).trim());
    });
    return dl.childNodes.length ? dl : null;
  }

  function relations(doc) {
    var rels = doc.querySelectorAll("listRelation relation");
    if (!rels.length) return null;
    var ul = el("ul");
    Array.prototype.forEach.call(rels, function (r) {
      var m = attr(r, "passive").match(/(EM\d{5})\.xml$/), a = el("a");
      a.textContent = txt0(r.querySelector("desc"));
      if (m) { a.href = entityHref(m[1]); a.dataset.type = attr(r, "type"); }
      ul.appendChild(el("li", null, [a]));
    });
    return el("section", "tei-div related", [el("h2", null, [document.createTextNode("Related entries")]), ul]);
  }
  function txt0(n) { return n ? n.textContent.trim() : ""; }

  function render(node) {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return null;
    function kids() { return Array.prototype.map.call(node.childNodes, render).filter(Boolean); }
    var h = H[node.localName];
    if (h) return h(node, kids);
    return el("span", "tei-" + node.localName, kids());
  }

  // Data files are JS wrappers (EMEL.loaded(key, value)) loaded with <script>,
  // which works both from a web host and from file:// (double-clicked).
  var pending = {}, cache = {};
  global.EMEL = {
    loaded: function (key, value) {
      cache[key] = value;
      (pending[key] || []).forEach(function (p) { p.resolve(value); });
      delete pending[key];
    }
  };
  function data(key, src) {
    if (key in cache) return Promise.resolve(cache[key]);
    return new Promise(function (resolve, reject) {
      var first = !pending[key];
      (pending[key] = pending[key] || []).push({ resolve: resolve, reject: reject });
      if (!first) return;
      var s = document.createElement("script");
      s.src = src; s.charset = "utf-8"; s.async = true;
      s.onerror = function () {
        (pending[key] || []).forEach(function (p) { p.reject(new Error("missing " + src)); });
        delete pending[key];
      };
      document.head.appendChild(s);
    });
  }

  function load(id) {
    return data("tei:" + id, "tei-js/" + id + ".js").then(function (s) {
      var doc = new DOMParser().parseFromString(s, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new Error("bad TEI");
      return doc;
    });
  }

  var SUBTYPE = { entry: "Entry", theme: "Theme", person: "Person", place: "Place",
    "cultural-artefact": "Cultural artefact", concept: "Concept", event: "Event", page: "" };
  function header(doc) {
    function q(sel) { var x = doc.querySelector(sel); return x ? x.textContent.trim() : ""; }
    var authors = Array.prototype.map.call(doc.querySelectorAll("teiHeader titleStmt > author"), txt0);
    var st = doc.documentElement.getAttribute("subtype") || "";
    return {
      id: q('publicationStmt idno[type="entry"]'),
      type: SUBTYPE[st] != null ? SUBTYPE[st] : st,
      title: q("teiHeader titleStmt > title"),
      author: authors.length > 1 ? authors.slice(0, -1).join(", ") + " and " + authors[authors.length - 1] : (authors[0] || ""),
      licence: q("availability licence"),
      licenceUrl: (doc.querySelector("availability licence") || { getAttribute: function () { return ""; } }).getAttribute("target"),
      modified: (doc.querySelectorAll("revisionDesc change")[1] || { getAttribute: function () { return ""; } }).getAttribute("when")
    };
  }

  function loadPage(pid) {
    return data("page:" + pid, "tei-js/pages/" + pid + ".js").then(function (s) {
      return new DOMParser().parseFromString(s, "application/xml");
    });
  }

  global.TEI = { load: load, loadPage: loadPage, data: data, render: render, header: header,
    facts: facts, relations: relations, siteUrl: siteUrl, NS: NS };
})(window);

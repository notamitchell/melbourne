/* eMelbourne entry editor (editor.html). Plain JS, no build step; works when
 * double-clicked (file://) and on any static host.
 *
 * Adapted from the Carlton Common Ground contribution form: Quill for the
 * article, glam-embed.js for collection images, tei-compare.js for the
 * before/after view. Unlike Carlton's form, which rebuilds a whole entry from
 * its fields, this editor edits the TEI file in place: each part of the form
 * (title, authors, facts, article, gallery, related entries, references) is
 * written back only if it was changed, so anything the form doesn't show, and
 * every part left alone, is kept exactly as it was.
 *
 * Saving downloads tei/<ID>.xml (the master copy) and tei-js/<ID>.js (the same
 * TEI wrapped for file:// use, as tools/convert.py and tools/build_index.py
 * write it). Publishing is uploading those two files; see EDITING.md.
 */
(function () {
  "use strict";

  /* Set githubRepo (e.g. "unimelb/emelbourne") once the site is on GitHub, and
     the steps shown after saving link straight to the right upload pages. */
  var CONFIG = { githubRepo: "notamitchell/melbourne", branch: "main", sitePath: "site" };

  var NS = "http://www.tei-c.org/ns/1.0", XML_NS = "http://www.w3.org/XML/1998/namespace";
  var XMLDECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
  var LICENCE = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
  var PUBLISHER = "eMelbourne: The Encyclopedia of Melbourne Online";
  var TYPES = [["entry", "Entry"], ["theme", "Theme"], ["person", "Person"], ["place", "Place"],
    ["cultural-artefact", "Cultural artefact"], ["concept", "Concept"], ["event", "Event"]];
  var KIND = { person: "person", place: "place", "cultural-artefact": "object" }; // others: topic
  var INDEX_TYPE = { entry: "Entry", theme: "Theme", person: "Person", place: "Place",
    "cultural-artefact": "Cultural Artefact", concept: "Concept", event: "Event" };
  var DRAFT_KEY = "emel-editor-draft", NAME_KEY = "emel-editor-name";

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function squash(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function lines(s) { return (s || "").split("\n").map(squash).filter(Boolean); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function status(msg) { $("status").textContent = msg || ""; }

  /* ------------------------------------------------------------ TEI DOM helpers */
  function kids(n, name) { return n ? Array.prototype.filter.call(n.children, function (c) { return !name || c.localName === name; }) : []; }
  function kid(n, name) { return kids(n, name)[0] || null; }
  function all(n, name) { return n ? Array.prototype.slice.call(n.getElementsByTagNameNS(NS, name)) : []; }
  function txt(n) { return n ? squash(n.textContent) : ""; }
  function xmlId(n) { return n.getAttributeNS(XML_NS, "id") || ""; }
  function byType(list, type) { return list.filter(function (n) { return n.getAttribute("type") === type; }); }
  function remove(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }

  // A writer bound to one document: el("p", {rend: "x"}, "text", child, …)
  function writer(doc) {
    return function el(name, attrs) {
      var node = doc.createElementNS(NS, name);
      for (var k in attrs || {}) {
        var v = attrs[k];
        if (v == null || v === "") continue;
        if (k.indexOf("xml:") === 0) node.setAttributeNS(XML_NS, k, String(v)); else node.setAttribute(k, String(v));
      }
      for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
      return node;
      function append(parent, c) {
        if (c == null || c === false || c === "") return;
        if (Array.isArray(c)) { c.forEach(function (x) { append(parent, x); }); return; }
        parent.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
      }
    };
  }
  function nl(doc) { return doc.createTextNode("\n"); }

  /* Dates as written ("13 January 1819", "c. 1850", "1850s") → ISO for @when */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function iso(s) {
    s = s || "";
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; }, m;
    if ((m = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(s))) return m[0];
    if ((m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/.exec(s)) && MONTHS[m[2].toLowerCase()]) return m[3] + "-" + p2(MONTHS[m[2].toLowerCase()]) + "-" + p2(+m[1]);
    if ((m = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/.exec(s)) && MONTHS[m[1].toLowerCase()]) return m[2] + "-" + p2(MONTHS[m[1].toLowerCase()]);
    if ((m = /\b(\d{4})\b/.exec(s))) return m[1];
    return "";
  }

  // Links: other entries are written relative to the TEI file ("EM00018.xml")
  function localHref(href) {
    href = (href || "").trim();
    var m = /(?:^|\/|entry\.html\?id=)(EM\d{5})(?:\.xml|\.js)?(?:#.*)?$/i.exec(href) || /entry\.html\?id=(EM\d{5})/i.exec(href);
    return m ? m[1].toUpperCase() + ".xml" : href;
  }

  /* ================================================================ reading
     The TEI document → the values the form shows. Rows keep "o", their
     position in the original, so an unchanged row is written back as it was. */
  function subjectOf(doc) {
    return all(doc, "*").filter(function (e) { return xmlId(e) === "subject"; })[0] || null;
  }
  function detailDiv(doc) { return all(doc, "div").filter(function (d) { return d.getAttribute("type") === "detail"; })[0] || null; }
  function galleryDiv(doc) { return all(doc, "div").filter(function (d) { return d.getAttribute("type") === "gallery"; })[0] || null; }
  function chronology(doc) { return all(doc, "listEvent").filter(function (l) { return l.getAttribute("type") === "chronology"; })[0] || null; }
  function bibls(doc) { var back = all(doc, "back")[0]; return back ? all(back, "bibl") : []; }
  function ownText(n) { // a birth/death without its placeName
    if (!n) return "";
    var s = "";
    Array.prototype.forEach.call(n.childNodes, function (c) { if (!(c.nodeType === 1 && c.localName === "placeName")) s += c.textContent; });
    return squash(s).replace(/,$/, "").trim();
  }
  function glossList(doc) {
    var d = detailDiv(doc), first = d && d.firstElementChild;
    return first && first.localName === "list" && first.getAttribute("type") === "gloss" ? first : null;
  }

  function read(doc) {
    var root = doc.documentElement, titleStmt = all(doc, "titleStmt")[0];
    var subject = subjectOf(doc), m = {};
    m.title = txt(kid(titleStmt, "title"));
    m.subtype = root.getAttribute("subtype") || "entry";
    m.authors = kids(titleStmt, "author").map(txt).filter(Boolean);

    var person = subject && subject.localName === "person" ? subject : null;
    var main = person && byType(kids(person, "persName"), "main")[0];
    var birth = person && kid(person, "birth"), death = person && kid(person, "death");
    m.person = {
      forename: main ? (kid(main, "forename") ? txt(kid(main, "forename")) : (kid(main, "surname") ? "" : txt(main))) : "",
      surname: main ? txt(kid(main, "surname")) : "",
      born: ownText(birth), bornPlace: txt(birth && kid(birth, "placeName")),
      died: ownText(death), diedPlace: txt(death && kid(death, "placeName")),
      occupations: person ? kids(person, "occupation").map(txt) : [],
      other: person ? byType(kids(person, "persName"), "alternative").map(txt) : []
    };
    var place = subject && subject.localName === "place" ? subject : null;
    var ev = kids(chronology(doc), "event"), label = function (k) {
      var e = ev.filter(function (x) { return txt(kid(x, "label")).indexOf(k + ":") === 0; })[0];
      return e ? txt(kid(e, "label")).slice(k.length + 1).trim() : "";
    };
    m.dates = { start: label("Start"), end: label("End") };
    m.place = {
      address: place ? txt(all(place, "addrLine")[0]) : "",
      other: place ? byType(kids(place, "placeName"), "alternative").map(txt) : []
    };

    var gl = glossList(doc);
    m.gloss = gl ? kids(gl, "label").map(function (l, i) {
      var item = l.nextElementSibling && l.nextElementSibling.localName === "item" ? l.nextElementSibling : null;
      return { o: i, label: txt(l), value: txt(item) };
    }) : [];

    var g = galleryDiv(doc);
    m.gallery = g ? kids(g, "figure").map(function (f, i) {
      var full = kids(f, "graphic").filter(function (x) { return !x.getAttribute("type"); })[0];
      var thumb = byType(kids(f, "graphic"), "thumbnail")[0] || full;
      var rights = byType(kids(f, "note"), "rights")[0];
      return { o: i, src: full ? full.getAttribute("url") : "", thumb: thumb ? thumb.getAttribute("url") : "",
        caption: txt(kid(f, "head")), desc: kids(f, "p").map(txt).join(" "), credit: txt(rights),
        href: rights && all(rights, "ref")[0] ? all(rights, "ref")[0].getAttribute("target") : "" };
    }) : [];

    m.relations = all(doc, "relation").map(function (r, i) {
      var id = ((r.getAttribute("passive") || "").match(/EM\d{5}/) || [""])[0];
      return { o: i, id: id, name: txt(kid(r, "desc")), type: r.getAttribute("type") || "entry" };
    });

    m.refs = bibls(doc).map(function (b, i) {
      var titles = kids(b, "title"), a = titles.filter(function (t) { return t.getAttribute("level") === "a"; })[0];
      var mono = titles.filter(function (t) { return t !== a; });
      var link = kid(b, "ref") || kid(b, "ptr");
      var known = ["author", "title", "pubPlace", "publisher", "date", "biblScope", "ref", "ptr"];
      return { o: i,
        author: kids(b, "author").map(txt).join("; "),
        title: a ? txt(a) : txt(mono[0]),
        inTitle: a ? txt(mono[0]) : "",
        place: txt(kid(b, "pubPlace")), publisher: txt(kid(b, "publisher")), year: txt(kid(b, "date")),
        pages: txt(kid(b, "biblScope")), link: link ? link.getAttribute("target") || "" : "",
        // free text, or parts the form doesn't have fields for: shown, kept as written unless edited
        note: kids(b).some(function (c) { return known.indexOf(c.localName) < 0; }) || !kids(b).length ? txt(b) : "" };
    });

    m.articleHtml = articleToHtml(doc);
    return m;
  }

  /* The article (div type="detail") as the HTML Quill edits */
  function inlineHtml(node) {
    return Array.prototype.map.call(node.childNodes, function (c) {
      if (c.nodeType === 3) return esc(c.nodeValue);
      if (c.nodeType !== 1) return "";
      switch (c.localName) {
        case "hi": {
          var tag = { italic: "em", bold: "strong", underline: "u", sup: "sup", superscript: "sup", sub: "sub" }[c.getAttribute("rend")];
          return tag ? "<" + tag + ">" + inlineHtml(c) + "</" + tag + ">" : inlineHtml(c);
        }
        case "ref": return c.getAttribute("target") ? '<a href="' + esc(c.getAttribute("target")) + '">' + inlineHtml(c) + "</a>" : inlineHtml(c);
        case "lb": return "<br>";
        default: return inlineHtml(c);
      }
    }).join("");
  }
  function blockHtml(n) {
    switch (n.localName) {
      case "p": return n.textContent.trim() ? "<p>" + inlineHtml(n) + "</p>" : "";
      case "head": return "<h2>" + inlineHtml(n) + "</h2>";
      case "div": return kids(n).map(blockHtml).join("");
      case "quote": {
        var ps = kids(n, "p");
        // Quill keeps one <blockquote> per line
        var parts = ps.length ? ps.map(inlineHtml) : inlineHtml(n).split("<br>");
        return parts.filter(function (s) { return s.replace(/<[^>]+>/g, "").trim(); }).map(function (s) { return "<blockquote>" + s + "</blockquote>"; }).join("");
      }
      case "list": {
        if (n.getAttribute("type") === "gloss") // a gloss list inside the article: label and item on one line
          return kids(n, "label").map(function (l) { var it = l.nextElementSibling; return "<p><strong>" + inlineHtml(l) + "</strong> " + (it ? inlineHtml(it) : "") + "</p>"; }).join("");
        var t = n.getAttribute("rend") === "numbered" ? "ol" : "ul";
        return "<" + t + ">" + kids(n, "item").map(function (i) { return "<li>" + inlineHtml(i) + "</li>"; }).join("") + "</" + t + ">";
      }
      case "table": {
        var cap = kid(n, "head");
        return "<table>" + (cap ? "<caption>" + inlineHtml(cap) + "</caption>" : "") + "<tbody>" + kids(n, "row").map(function (r) {
          return "<tr>" + kids(r, "cell").map(function (c) {
            var tag = c.getAttribute("role") === "label" ? "th" : "td";
            return "<" + tag + (c.getAttribute("cols") ? ' colspan="' + c.getAttribute("cols") + '"' : "") + (c.getAttribute("rows") ? ' rowspan="' + c.getAttribute("rows") + '"' : "") + ">" + inlineHtml(c) + "</" + tag + ">";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
      }
      case "figure": {
        var g = kids(n, "graphic").filter(function (x) { return !x.getAttribute("type"); })[0] || kid(n, "graphic");
        var head = kid(n, "head"), ref = head && kid(head, "ref"), url = g ? TEI.siteUrl(g.getAttribute("url") || "") : "";
        return url ? '<figure class="ql-glam-image" data-src="' + esc(url) + '" data-href="' + esc(ref ? ref.getAttribute("target") || "" : url) +
          '" data-caption="' + esc(txt(head)) + '" data-alt="' + esc(txt(kid(n, "figDesc"))) + '"></figure>' : "";
      }
      default: return n.textContent.trim() ? "<p>" + inlineHtml(n) + "</p>" : "";
    }
  }
  function articleToHtml(doc) {
    var d = detailDiv(doc), gl = glossList(doc);
    return d ? kids(d).filter(function (c) { return c !== gl; }).map(blockHtml).join("") : "";
  }

  /* Quill HTML → TEI blocks (after Carlton's scripts/tei.js). Paragraphs before
     the first heading go straight in the detail div; each heading starts a
     <div> with that heading as its <head>. */
  var REND = { STRONG: "bold", B: "bold", EM: "italic", I: "italic", U: "underline", SUP: "sup", SUB: "sub" };
  function inlineParts(node, el) {
    var out = [];
    Array.prototype.forEach.call(node.childNodes, function (c) {
      if (c.nodeType === 3) { var t = c.nodeValue.replace(/ /g, " "); if (t) out.push(t); }
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") out.push(el("lb"));
        else if (c.tagName === "A" && c.getAttribute("href")) out.push(el("ref", { target: localHref(c.getAttribute("href")) }, inlineParts(c, el)));
        else if (REND[c.tagName]) out.push(el("hi", { rend: REND[c.tagName] }, inlineParts(c, el)));
        else out.push.apply(out, inlineParts(c, el));
      }
    });
    return out;
  }
  function blank(parts) { return parts.every(function (p) { return typeof p === "string" ? !p.trim() : p.localName !== "lb" && !p.textContent.trim(); }); }
  function tidy(parts) {
    var out = parts.slice();
    while (out.length && typeof out[0] !== "string" && out[0].localName === "lb") out.shift();
    while (out.length && typeof out[out.length - 1] !== "string" && out[out.length - 1].localName === "lb") out.pop();
    if (typeof out[0] === "string") out[0] = out[0].replace(/^\s+/, "");
    if (typeof out[out.length - 1] === "string") out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "");
    return out;
  }
  function htmlToBlocks(html, el) {
    var src = new DOMParser().parseFromString("<body>" + (html || "") + "</body>", "text/html").body;
    var intro = [], divs = [], current = intro, quote = null;
    var inline = function (n) { return inlineParts(n, el); };
    function block(node) {
      if (node.nodeType === 3) { if (node.nodeValue.trim()) current.push(el("p", null, node.nodeValue.trim())); return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag !== "BLOCKQUOTE") quote = null;
      if (tag === "BLOCKQUOTE") {
        var parts = tidy(inline(node));
        if (blank(parts)) return;
        // lines quoted one after another share a <quote>, a line break between them
        if (!quote) { quote = el("quote", { rend: "block" }); current.push(quote); } else quote.appendChild(el("lb"));
        parts.forEach(function (x) { quote.appendChild(typeof x === "string" ? quote.ownerDocument.createTextNode(x) : x); });
      } else if (/^H[1-6]$/.test(tag)) {
        var head = tidy(inline(node));
        current = [];
        divs.push({ head: blank(head) ? null : head, blocks: current });
      } else if (tag === "UL" || tag === "OL") {
        var items = Array.prototype.filter.call(node.children, function (li) { return li.tagName === "LI"; }).map(inline).filter(function (p) { return !blank(p); });
        if (items.length) current.push(el("list", { rend: tag === "OL" ? "numbered" : "bulleted" }, items.map(function (p) { return el("item", null, tidy(p)); })));
      } else if (tag === "TABLE") {
        var cap = node.querySelector("caption");
        var rows = Array.prototype.map.call(node.querySelectorAll("tr"), function (tr) {
          return el("row", null, Array.prototype.map.call(tr.children, function (td) {
            return el("cell", { role: td.tagName === "TH" ? "label" : null, cols: td.colSpan > 1 ? td.colSpan : null, rows: td.rowSpan > 1 ? td.rowSpan : null }, tidy(inline(td)));
          }));
        });
        if (rows.length) current.push(el("table", null, cap && cap.textContent.trim() ? el("head", null, tidy(inline(cap))) : null, rows));
      } else if (tag === "FIGURE") {
        var img = node.querySelector("img"), a = node.querySelector("figcaption a[href]");
        var url = node.getAttribute("data-src") || (img && img.getAttribute("src")) || "";
        if (!/^https?:\/\//i.test(url)) return;
        var href = node.getAttribute("data-href") || (a && a.getAttribute("href")) || "";
        var caption = squash(node.getAttribute("data-caption") || (node.querySelector("figcaption") || {}).textContent) || href;
        current.push(el("figure", null, el("graphic", { url: url }),
          caption ? el("head", null, href ? el("ref", { target: href }, caption) : caption) : null,
          squash(node.getAttribute("data-alt")) ? el("figDesc", null, squash(node.getAttribute("data-alt"))) : null));
      } else if (node.querySelector && node.querySelector("table")) {
        Array.prototype.forEach.call(node.childNodes, block); // Quill wraps tables in <div class="ql-table-embed">
      } else {
        var ps = tidy(inline(node));
        if (!blank(ps)) current.push(el("p", null, ps));
      }
    }
    Array.prototype.forEach.call(src.childNodes, block);
    return intro.concat(divs.filter(function (d) { return d.head || d.blocks.length; }).map(function (d) {
      return el("div", null, d.head ? el("head", null, d.head) : null, d.blocks);
    }));
  }

  /* ================================================================ writing
     Apply the form's values to a copy of the opened document. A part is
     rewritten only when its values differ from what was read. */
  function build(base, before, m, opts) {
    var doc = base.cloneNode(true), el = writer(doc), root = doc.documentElement;
    var titleStmt = all(doc, "titleStmt")[0];
    var changed = [];
    function part(key, fn) { if (!same(before[key], m[key])) { changed.push(key); fn(); } }

    part("title", function () { kid(titleStmt, "title").textContent = m.title; });
    part("subtype", function () {
      root.setAttribute("subtype", m.subtype);
      root.setAttribute("type", KIND[m.subtype] || "topic");
    });
    part("authors", function () {
      kids(titleStmt, "author").forEach(function (a) { if (a.previousSibling && a.previousSibling.nodeType === 3) remove(a.previousSibling); remove(a); });
      var at = kid(titleStmt, "title").nextSibling;
      m.authors.forEach(function (a) { titleStmt.insertBefore(nl(doc), at); titleStmt.insertBefore(el("author", null, a), at); });
    });

    // Facts: the subject (person / place) and the chronology, in standOff
    var factsChanged = ["subtype", "person", "dates", "place"].some(function (k) { return !same(before[k], m[k]); }) ||
      (m.subtype === "place" && !same(before.title, m.title));
    if (factsChanged) { changed.push("facts"); writeFacts(doc, el, before, m); }

    part("gloss", function () {
      var d = ensureDetail(doc, el), old = glossList(doc), oldLabels = old ? kids(old, "label") : [];
      if (!m.gloss.length) { remove(old); return; }
      var list = el("list", { type: "gloss" });
      m.gloss.forEach(function (r) {
        var o = before.gloss[r.o];
        if (o && o.label === r.label && o.value === r.value && oldLabels[r.o]) {
          var l = oldLabels[r.o];
          list.appendChild(l.cloneNode(true));
          if (l.nextElementSibling && l.nextElementSibling.localName === "item") list.appendChild(l.nextElementSibling.cloneNode(true));
        } else { list.appendChild(el("label", null, r.label)); list.appendChild(el("item", null, r.value)); }
      });
      if (old) d.replaceChild(list, old); else d.insertBefore(list, d.firstChild);
    });

    part("articleHtml", function () {
      var d = ensureDetail(doc, el), gl = glossList(doc);
      kids(d).forEach(function (c) { if (c !== gl) remove(c); });
      Array.prototype.slice.call(d.childNodes).forEach(function (c) { if (c.nodeType === 3) remove(c); });
      var blocks = htmlToBlocks(m.articleHtml, el);
      if (!blocks.length) blocks = [el("p")];
      blocks.forEach(function (b, i) { if (i || gl) d.appendChild(nl(doc)); d.appendChild(b); });
    });

    part("gallery", function () {
      var body = all(doc, "body")[0], old = galleryDiv(doc), oldFigs = old ? kids(old, "figure") : [];
      if (!m.gallery.length) { if (old) { if (old.previousSibling && old.previousSibling.nodeType === 3) remove(old.previousSibling); remove(old); } return; }
      var div = el("div", { type: "gallery", "xml:id": "gallery" }, el("head", null, "Gallery"));
      m.gallery.forEach(function (g) {
        var o = before.gallery[g.o];
        if (o && oldFigs[g.o] && same(o, g)) { div.appendChild(oldFigs[g.o].cloneNode(true)); return; }
        var f = o && oldFigs[g.o] ? oldFigs[g.o].cloneNode(true) : el("figure");
        if (o && oldFigs[g.o]) { // keep the images and id; rewrite the words
          kids(f).forEach(function (c) { if (c.localName !== "graphic") remove(c); });
          f.insertBefore(el("head", null, g.caption), f.firstChild);
        } else {
          f.appendChild(el("head", null, g.caption));
          f.appendChild(el("graphic", { url: g.src }));
        }
        if (g.desc) f.appendChild(el("p", null, g.desc));
        if (g.credit || g.href) f.appendChild(el("note", { type: "rights" }, g.href ? el("ref", { target: g.href }, g.credit || g.href) : g.credit));
        div.appendChild(f);
      });
      if (old) body.replaceChild(div, old);
      else { var d = ensureDetail(doc, el); body.insertBefore(div, d.nextSibling); body.insertBefore(nl(doc), div); }
    });

    part("relations", function () {
      var old = all(doc, "relation");
      var lr = all(doc, "listRelation")[0];
      if (!m.relations.length) { remove(lr); return; }
      var list = el("listRelation");
      m.relations.forEach(function (r) {
        var o = before.relations[r.o];
        if (o && o.id === r.id && old[r.o]) list.appendChild(old[r.o].cloneNode(true));
        else list.appendChild(el("relation", { name: "related", type: r.type, active: "#subject", passive: r.id + ".xml" }, el("desc", null, r.name)));
      });
      var so = ensureStandOff(doc, el);
      if (lr) lr.parentNode.replaceChild(list, lr); else { if (so.lastChild) so.appendChild(nl(doc)); so.appendChild(list); }
    });

    part("refs", function () {
      var old = bibls(doc), text = all(doc, "text")[0];
      var back = kid(text, "back");
      var div = back && kids(back, "div").filter(function (d) { return d.getAttribute("type") === "bibliography"; })[0];
      var keep = m.refs.filter(function (r) { return refText(r); });
      if (!keep.length) { if (div) remove(div); if (back && !kids(back).length) remove(back); return; }
      var lb = el("listBibl");
      keep.forEach(function (r) {
        var o = before.refs[r.o];
        if (o && old[r.o] && same(o, r)) { lb.appendChild(old[r.o].cloneNode(true)); return; }
        var b = el("bibl", o && old[r.o] ? { "xml:id": xmlId(old[r.o]), type: old[r.o].getAttribute("type") } : null);
        var parts = [];
        if (r.note && !(r.author || r.title)) parts.push(el("note", null, r.note));
        if (r.author) parts.push(el("author", null, r.author));
        if (r.title) parts.push(el("title", { level: r.inTitle ? "a" : "m" }, r.title));
        if (r.inTitle) parts.push(el("title", { level: "m" }, r.inTitle));
        if (r.place) parts.push(el("pubPlace", null, r.place));
        if (r.publisher) parts.push(el("publisher", null, r.publisher));
        if (r.year) parts.push(el("date", null, r.year));
        if (r.pages) parts.push(el("biblScope", { unit: "page" }, r.pages));
        if (r.link) parts.push(el("ref", { target: r.link }, "online"));
        parts.forEach(function (p, i) { if (i) b.appendChild(doc.createTextNode(" ")); b.appendChild(p); });
        lb.appendChild(b);
      });
      var newDiv = el("div", { type: "bibliography", "xml:id": "references" }, el("head", null, "References"), lb);
      if (div) back.replaceChild(newDiv, div);
      else {
        if (!back) { back = el("back"); text.appendChild(nl(doc)); text.appendChild(back); text.appendChild(nl(doc)); }
        back.appendChild(newDiv);
      }
    });

    // One line in the history for this save
    if (changed.length || opts.isNew) {
      var rd = all(doc, "revisionDesc")[0];
      var who = squash(opts.who), note = squash(opts.note).replace(/\.$/, "");
      var line = opts.isNew
        ? "Entry written" + (who ? " by " + who : "") + " in the eMelbourne editor" + (note ? ": " + note : "") + "."
        : "Edited" + (who ? " by " + who : "") + " in the eMelbourne editor" + (note ? ": " + note : "") + ".";
      var ch = el("change", { when: today(), type: opts.isNew ? "created" : "edited" }, line);
      // the same person saving again on the same day (a saved file opened again) replaces their line
      var prevCh = kids(rd, "change").pop();
      var mine = new RegExp("^(Edited|Entry written)" + (who ? " by " + who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "") + " in the eMelbourne editor");
      if (prevCh && prevCh.getAttribute("when") === today() && mine.test(squash(prevCh.textContent))) {
        if (prevCh.getAttribute("type") === "created") { ch.setAttribute("type", "created"); ch.textContent = line.replace(/^Edited/, "Entry written"); }
        rd.replaceChild(ch, prevCh);
      } else {
        var last = rd.lastChild && rd.lastChild.nodeType === 3 ? rd.lastChild : null;
        rd.insertBefore(ch, last);
        if (!ch.previousSibling || ch.previousSibling.nodeType !== 3) rd.insertBefore(nl(doc), ch);
        if (!last) rd.appendChild(nl(doc));
      }
    }
    return { doc: doc, changed: changed };
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function refText(r) { return [r.author, r.title, r.inTitle, r.place, r.publisher, r.year, r.pages, r.note].filter(Boolean).join(", ") + (r.link ? " (online)" : ""); }

  function ensureDetail(doc, el) {
    var d = detailDiv(doc);
    if (d) return d;
    var body = all(doc, "body")[0];
    d = el("div", { type: "detail" });
    body.insertBefore(d, body.firstChild); body.insertBefore(nl(doc), d);
    return d;
  }
  function ensureStandOff(doc, el) {
    var so = all(doc, "standOff")[0];
    if (so) return so;
    var header = all(doc, "teiHeader")[0];
    so = el("standOff");
    header.parentNode.insertBefore(nl(doc), header.nextSibling);
    header.parentNode.insertBefore(so, header.nextSibling.nextSibling);
    return so;
  }

  function writeFacts(doc, el, before, m) {
    var old = subjectOf(doc), so = all(doc, "standOff")[0];
    var oldList = old && old.parentNode;
    var subject = null;
    if (m.subtype === "person") {
      var p = m.person, keep = old && old.localName === "person" ? old : null;
      var main = p.surname ? el("persName", { type: "main" }, p.forename ? [el("forename", null, p.forename), " "] : null, el("surname", null, p.surname))
        : el("persName", { type: "main" }, p.forename || m.title);
      var oldAlts = keep ? byType(kids(keep, "persName"), "alternative") : [];
      var alts = p.other.map(function (n) {
        var o = oldAlts.filter(function (a) { return txt(a) === n; })[0];
        return o ? o.cloneNode(true) : el("persName", { type: "alternative" }, n);
      });
      var life = function (tag, date, place) {
        if (!date && !place) return null;
        return el(tag, { when: iso(date) }, date, date && place ? ", " : null, place ? el("placeName", null, place) : null);
      };
      var others = keep ? kids(keep).filter(function (c) { return ["persName", "birth", "death", "occupation"].indexOf(c.localName) < 0; }).map(function (c) { return c.cloneNode(true); }) : [];
      // keep an unchanged birth or death exactly as written (e.g. a cert attribute)
      var b = same([before.person.born, before.person.bornPlace], [p.born, p.bornPlace]) && keep && kid(keep, "birth") ? kid(keep, "birth").cloneNode(true) : life("birth", p.born, p.bornPlace);
      var d = same([before.person.died, before.person.diedPlace], [p.died, p.diedPlace]) && keep && kid(keep, "death") ? kid(keep, "death").cloneNode(true) : life("death", p.died, p.diedPlace);
      subject = el("listPerson", null, el("person", { "xml:id": "subject" }, main, alts, others, b, d,
        p.occupations.map(function (o) { return el("occupation", null, o); })));
    } else if (m.subtype === "place") {
      var oldPlace = old && old.localName === "place" ? old : null;
      var oldPAlts = oldPlace ? byType(kids(oldPlace, "placeName"), "alternative") : [];
      subject = el("listPlace", null, el("place", { "xml:id": "subject", from: iso(m.dates.start), to: iso(m.dates.end) },
        el("placeName", { type: "main" }, m.title),
        m.place.other.map(function (n) {
          var o = oldPAlts.filter(function (a) { return txt(a) === n; })[0];
          return o ? o.cloneNode(true) : el("placeName", { type: "alternative" }, n);
        }),
        m.place.address ? el("location", { type: "address" }, el("address", null, el("addrLine", null, m.place.address))) : null));
    }
    // chronology: start and end of anything that isn't a person
    var oldChron = chronology(doc), chron = null;
    if (m.subtype !== "person" && (m.dates.start || m.dates.end)) {
      if (oldChron && same(before.dates, m.dates)) chron = oldChron.cloneNode(true);
      else {
        chron = el("listEvent", { type: "chronology" });
        [["Start", m.dates.start], ["End", m.dates.end]].forEach(function (e) {
          if (e[1]) chron.appendChild(el("event", { when: iso(e[1]) }, el("label", null, e[0] + ": " + e[1])));
        });
      }
    }
    if (!so && !subject && !chron) return;
    so = ensureStandOff(doc, el);
    var lr = all(so, "listRelation")[0];
    if (oldList && oldList.parentNode === so) { if (subject) so.replaceChild(subject, oldList); else remove(oldList); }
    else if (subject) so.insertBefore(subject, so.firstChild);
    if (oldChron) { if (chron) so.replaceChild(chron, oldChron); else remove(oldChron); }
    else if (chron) so.insertBefore(chron, lr || null);
    // one list per line, as convert.py writes them
    Array.prototype.slice.call(so.childNodes).forEach(function (c) { if (c.nodeType === 3) remove(c); });
    kids(so).slice(1).forEach(function (c) { so.insertBefore(nl(doc), c); });
    if (!kids(so).length) { if (so.nextSibling && so.nextSibling.nodeType === 3) remove(so.nextSibling); remove(so); }
  }

  function serialize(doc) {
    var s = new XMLSerializer();
    var pis = Array.prototype.filter.call(doc.childNodes, function (n) { return n.nodeType === 7; }).map(function (n) { return s.serializeToString(n); });
    return XMLDECL + (pis.length ? pis.join("\n") + "\n\n" : "") + s.serializeToString(doc.documentElement) + "\n";
  }
  function wrapJs(id, xml) { return "EMEL.loaded(" + JSON.stringify("tei:" + id) + "," + JSON.stringify(xml) + ");\n"; }

  function template(id, subtype, title) {
    return XMLDECL +
      '<?xml-model href="../schema/emelbourne.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n\n' +
      '<TEI xmlns="' + NS + '" type="' + (KIND[subtype] || "topic") + '" subtype="' + subtype + '" xml:lang="en">\n' +
      "<teiHeader><fileDesc><titleStmt><title>" + esc(title) + "</title>\n</titleStmt>\n" +
      '<publicationStmt><publisher>' + PUBLISHER + '</publisher><idno type="entry">' + id + '</idno>' +
      '<availability><licence target="' + LICENCE + '">CC BY-NC-SA 4.0</licence></availability></publicationStmt>\n' +
      "<sourceDesc><p>Written in the eMelbourne editor.</p></sourceDesc></fileDesc>\n" +
      '<revisionDesc status="published">\n</revisionDesc></teiHeader>\n' +
      '<text><body>\n<div type="detail"><p/></div>\n</body>\n</text></TEI>\n';
  }

  // The search index row for an entry, as tools/build_index.py makes it
  function indexRow(doc, id) {
    var m = read(doc), subject = subjectOf(doc), img = null;
    var dates = subject && subject.localName === "person" ? [m.person.born, m.person.died] : [m.dates.start, m.dates.end];
    all(doc, "figure").some(function (f) {
      var g = byType(kids(f, "graphic"), "thumbnail")[0] || kid(f, "graphic");
      if (g && g.getAttribute("url")) { img = g.getAttribute("url").replace(/^(\.\.\/)+/, ""); return true; }
      return false;
    });
    return { id: id, name: m.title, type: INDEX_TYPE[m.subtype] || m.subtype, author: m.authors.join(" and "),
      dates: dates.filter(Boolean).join(" – "), themes: m.relations.filter(function (r) { return r.type === "theme"; }).map(function (r) { return r.id; }),
      img: img, text: txt(detailDiv(doc)) };
  }

  /* ================================================================ state */
  var S = null;      // { id, isNew, original (xml text, "" when new), base (doc), before (values) }
  var quill = null, glam = null, names = {}, nameList = [], articleBaseline = "", loading = false;

  function getNames() {
    return TEI.data("names", "data/names.js").then(function (n) {
      names = n;
      nameList = Object.keys(n).map(function (id) { return { id: id, name: n[id], key: norm(n[id]) + " " + id.toLowerCase() }; });
      nameList.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return n;
    });
  }
  function nextId() {
    var max = 0;
    Object.keys(names).forEach(function (id) { var n = +id.slice(2); if (n > max) max = n; });
    return "EM" + ("0000" + (max + 1)).slice(-5);
  }
  function search(q, limit) {
    var terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var exact = /^em\d{5}$/i.test(q.trim()) ? q.trim().toUpperCase() : "";
    var res = nameList.filter(function (it) { return terms.every(function (t) { return it.key.indexOf(t) >= 0; }); });
    res.sort(function (a, b) { return (b.id === exact) - (a.id === exact) || (norm(a.name).indexOf(terms[0]) === 0 ? -1 : 0) - (norm(b.name).indexOf(terms[0]) === 0 ? -1 : 0); });
    return res.slice(0, limit || 12);
  }
  function resultList(ul, items, onPick) {
    ul.innerHTML = "";
    items.forEach(function (it) {
      var li = h("li"), b = h("button", { type: "button" });
      b.appendChild(h("span", null, it.name)); b.appendChild(h("span", { "class": "ed-rid" }, it.id));
      b.addEventListener("click", function () { onPick(it); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  /* ------------------------------------------------------------ opening */
  function openXml(xml, info) {
    var doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "TEI")
      throw new Error("This file isn't an eMelbourne entry (it isn't readable TEI).");
    var id = txt(all(doc, "idno").filter(function (i) { return i.getAttribute("type") === "entry"; })[0]);
    if (!/^EM\d{5}$/.test(id)) throw new Error("This file has no eMelbourne ID (idno type=\"entry\").");
    S = { id: id, isNew: !!info.isNew, original: info.original != null ? info.original : xml, base: doc, before: read(doc) };
    fill(S.before);
    showEditor();
    status(info.isNew ? "New entry, not saved yet" : "");
  }
  function openId(id) {
    status("Opening " + id + "…");
    TEI.data("tei:" + id, "tei-js/" + id + ".js").then(function (xml) {
      if (!confirmLeave()) return;
      openXml(xml, {});
    }).catch(function (e) {
      status("");
      alertBox("Couldn't open " + id + ". " + (names[id] ? "Its file is missing from tei-js/ in this copy of the site." : "There's no entry with that ID.") + (e && e.message && !/missing/.test(e.message) ? " (" + e.message + ")" : ""));
    });
  }
  function alertBox(msg) { var p = $("new-msg"); p.textContent = msg; p.hidden = false; showStart(); }

  /* ------------------------------------------------------------ the form */
  function typeOptions(sel) {
    TYPES.forEach(function (t) { sel.appendChild(h("option", { value: t[0] }, t[1])); });
  }
  function fill(m) {
    loading = true;
    $("f-title").value = m.title;
    $("f-type").value = m.subtype;
    $("f-id").textContent = S.id;
    $("f-authors").value = m.authors.join("\n");
    $("p-forename").value = m.person.forename; $("p-surname").value = m.person.surname;
    $("p-born").value = m.person.born; $("p-bornplace").value = m.person.bornPlace;
    $("p-died").value = m.person.died; $("p-diedplace").value = m.person.diedPlace;
    $("p-occupations").value = m.person.occupations.join("\n"); $("p-other").value = m.person.other.join("\n");
    $("d-start").value = m.dates.start; $("d-end").value = m.dates.end;
    $("pl-address").value = m.place.address; $("pl-other").value = m.place.other.join("\n");
    $("gloss-rows").innerHTML = ""; m.gloss.forEach(addGloss);
    $("gallery-rows").innerHTML = ""; m.gallery.forEach(addFigure);
    $("rel-rows").innerHTML = ""; m.relations.forEach(addRelation);
    $("ref-rows").innerHTML = ""; m.refs.forEach(function (r) { addRef(r, false); });
    $("c-name").value = stored(NAME_KEY) || "";
    $("c-note").value = "";
    quill.setContents(quill.clipboard.convert(m.articleHtml || ""), "silent");
    quill.history.clear();
    glam.skipExisting();
    articleBaseline = quill.root.innerHTML;
    showType();
    loading = false;
  }
  function showType() {
    var t = $("f-type").value;
    $("sec-person").hidden = t !== "person";
    $("sec-dates").hidden = t === "person";
    $("place-fields").hidden = t !== "place";
  }

  // The form's values, in the same shape read() gives
  function collect() {
    var m = {}, b = S.before;
    m.title = squash($("f-title").value);
    m.subtype = $("f-type").value;
    m.authors = lines($("f-authors").value);
    m.person = { forename: squash($("p-forename").value), surname: squash($("p-surname").value),
      born: squash($("p-born").value), bornPlace: squash($("p-bornplace").value),
      died: squash($("p-died").value), diedPlace: squash($("p-diedplace").value),
      occupations: lines($("p-occupations").value), other: lines($("p-other").value) };
    m.dates = { start: squash($("d-start").value), end: squash($("d-end").value) };
    m.place = { address: squash($("pl-address").value), other: lines($("pl-other").value) };
    // fields of other types stay as read, so switching the type back and forth changes nothing
    if (m.subtype !== "person") m.person = b.person;
    if (m.subtype === "person") m.dates = b.dates;
    if (m.subtype !== "place") m.place = b.place;
    m.gloss = rows("gloss-rows").map(function (r) { return { o: r.o, label: squash(r.q("label").value), value: squash(r.q("value").value) }; })
      .filter(function (r) { return r.label || r.value; });
    m.gallery = rows("gallery-rows").map(function (r) {
      return { o: r.o, src: r.data.src, thumb: r.data.thumb, caption: squash(r.q("caption").value), desc: squash(r.q("desc").value),
        credit: squash(r.q("credit").value), href: r.data.href };
    });
    m.relations = rows("rel-rows").map(function (r) { return { o: r.o, id: r.data.id, name: r.data.name, type: r.data.type }; });
    m.refs = rows("ref-rows").map(function (r) {
      var v = { o: r.o };
      ["author", "title", "inTitle", "place", "publisher", "year", "pages", "link", "note"].forEach(function (k) { v[k] = squash(r.q(k).value); });
      return v;
    });
    m.articleHtml = quill.root.innerHTML === articleBaseline ? b.articleHtml : (quill.getText().trim() || quill.root.querySelector("figure, table") ? quill.root.innerHTML : "");
    return m;
  }
  function rows(id) {
    return Array.prototype.map.call($(id).children, function (row) {
      return { o: row.dataset.o === "" ? -1 : +row.dataset.o, data: JSON.parse(row.dataset.v || "{}"),
        q: function (k) { return row.querySelector('[data-k="' + k + '"]'); } };
    });
  }
  function rowShell(container, o, cls) {
    var row = h("div", { "class": cls }); row.dataset.o = o == null || o < 0 ? "" : String(o);
    container.appendChild(row); return row;
  }
  function field(row, k, label, value, attrs) {
    var wrap = h("label", { "class": "ed-f" }); wrap.appendChild(h("span", null, label));
    var input = h(attrs && attrs.multiline ? "textarea" : "input", { "data-k": k, rows: attrs && attrs.multiline ? 2 : null, placeholder: attrs && attrs.ph });
    input.value = value || ""; wrap.appendChild(input); row.appendChild(wrap); return input;
  }
  function tools(row, label) {
    var t = h("span", { "class": "ed-rowtools" });
    [["↑", "Move up", function () { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); }],
      ["↓", "Move down", function () { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); }],
      ["Remove", "Remove " + label, function () { row.parentNode.removeChild(row); }]].forEach(function (b) {
      var btn = h("button", { type: "button", "class": "ed-btn tiny ghost", "aria-label": b[1], title: b[1] }, b[0]);
      btn.addEventListener("click", function () { b[2](); changed(); });
      t.appendChild(btn);
    });
    row.appendChild(t);
  }

  function addGloss(r) {
    var row = rowShell($("gloss-rows"), r && r.o, "ed-row ed-gloss");
    field(row, "label", "Label", r ? r.label : "", { ph: "e.g. Artist:" });
    field(row, "value", "Value", r ? r.value : "");
    tools(row, "line");
    return row;
  }
  function addFigure(g) {
    var row = rowShell($("gallery-rows"), g.o, "ed-fig");
    row.dataset.v = JSON.stringify({ src: g.src, thumb: g.thumb, href: g.href });
    var img = h("img", { src: TEI.siteUrl(g.thumb || g.src), alt: "", loading: "lazy" });
    img.onerror = function () { img.replaceWith(h("span", { "class": "ed-noimg" }, "Image not in this copy of the site")); };
    row.appendChild(img);
    var f = h("div", { "class": "ed-figfields" }); row.appendChild(f);
    field(f, "caption", "Caption", g.caption);
    field(f, "desc", "Creator and date", g.desc, { ph: "e.g. Charles Nettleton, 1880" });
    field(f, "credit", "Credit", g.credit, { ph: "e.g. Courtesy State Library Victoria" });
    tools(row, "picture");
  }
  function addRelation(r) {
    var row = h("li", { "class": "ed-chip" }); row.dataset.o = r.o == null || r.o < 0 ? "" : String(r.o);
    row.dataset.v = JSON.stringify({ id: r.id, name: r.name, type: r.type });
    row.appendChild(h("span", null, r.name || r.id));
    row.appendChild(h("span", { "class": "ed-rid" }, (TYPES.filter(function (t) { return t[0] === r.type; })[0] || ["", r.type])[1]));
    var x = h("button", { type: "button", "class": "ed-btn tiny ghost", "aria-label": "Remove " + (r.name || r.id) }, "×");
    x.addEventListener("click", function () { row.parentNode.removeChild(row); changed(); });
    row.appendChild(x);
    $("rel-rows").appendChild(row);
  }
  function addRef(r, open) {
    r = r || {};
    var row = rowShell($("ref-rows"), r.o, "ed-ref");
    var d = h("details"); if (open) d.open = true;
    var s = h("summary"); var label = h("span", { "class": "ed-refsum" }, refText(r) || "New reference");
    s.appendChild(label); d.appendChild(s);
    var g = h("div", { "class": "ed-refgrid" }); d.appendChild(g);
    if (r.note) field(g, "note", "As written", r.note, { multiline: true }).parentNode.classList.add("span3");
    field(g, "author", "Author", r.author, { ph: "Surname, First names" });
    field(g, "title", "Title", r.title);
    field(g, "inTitle", "Published in (book or journal)", r.inTitle);
    field(g, "place", "Place", r.place, { ph: "e.g. Melbourne" });
    field(g, "publisher", "Publisher", r.publisher);
    field(g, "year", "Year", r.year);
    field(g, "pages", "Pages", r.pages);
    field(g, "link", "Link", r.link, { ph: "https://" }).parentNode.classList.add("span2");
    if (!r.note) { var hid = h("input", { type: "hidden", "data-k": "note" }); g.appendChild(hid); }
    g.addEventListener("input", function () {
      var v = {}; ["author", "title", "inTitle", "place", "publisher", "year", "pages", "link", "note"].forEach(function (k) { v[k] = squash(row.querySelector('[data-k="' + k + '"]').value); });
      label.textContent = refText(v) || "New reference";
    });
    row.appendChild(d);
    tools(row, "reference");
    return row;
  }

  /* ------------------------------------------------------------ the entry picker */
  var pickerDone = null;
  function pick(title, cb) {
    $("picker-h").textContent = title; $("picker-q").value = ""; $("picker-results").innerHTML = "";
    pickerDone = cb; $("picker").showModal(); $("picker-q").focus();
  }
  function relationType(id) {
    return TEI.data("tei:" + id, "tei-js/" + id + ".js").then(function (xml) {
      var st = (/subtype="([^"]+)"/.exec(xml) || [])[1];
      return st && st !== "page" ? st : "entry";
    }).catch(function () { return "entry"; });
  }

  /* ------------------------------------------------------------ gallery from a link */
  function addFromLink() {
    var url = $("gallery-url").value.trim(), msg = $("gallery-msg");
    if (!/^https?:\/\//i.test(url)) { msg.textContent = "Paste a full web address, starting with https://"; return; }
    msg.textContent = "Looking for the picture…";
    GlamEmbed.resolve(url).then(function (r) {
      if (!r) throw new Error("none");
      return GlamEmbed.firstLoadable(r.candidates || []).then(function (src) {
        if (!src) throw new Error("none");
        var credit = r.cite || (r.institution ? "Courtesy " + r.institution + (r.id ? ", " + r.id : "") : GlamEmbed.sourceFor(url).text);
        addFigure({ o: -1, src: src, thumb: src, href: url, caption: r.caption && r.caption !== r.cite ? r.caption : "", desc: "", credit: credit });
        $("gallery-url").value = ""; msg.textContent = "Added. Write a caption for it."; changed();
        var last = $("gallery-rows").lastElementChild; if (last) last.querySelector('[data-k="caption"]').focus();
      });
    }).catch(function () { msg.textContent = "No picture found at that link. Links to Trove, State Library Victoria, PROV, University of Melbourne Digitised Collections, IIIF images and image files work."; });
  }

  /* ------------------------------------------------------------ build, preview, compare */
  function current() {
    var m = collect();
    var r = build(S.base, S.before, m, { isNew: S.isNew, who: $("c-name").value, note: $("c-note").value });
    return { m: m, xml: serialize(r.doc), changed: r.changed };
  }
  function problems(m) {
    var p = [];
    if (!m.title) p.push("The entry needs a title.");
    if (m.subtype === "person" && !m.person.surname && !m.person.forename) p.push("Give the person's name under Facts about the person.");
    rows("gallery-rows").forEach(function (r) { if (!squash(r.q("caption").value)) p.push("Every picture in the gallery needs a caption."); });
    return p.filter(function (x, i) { return p.indexOf(x) === i; });
  }

  function preview() {
    var c = current(), frame = $("preview-frame");
    var base = location.href.replace(/[?#].*$/, "");
    frame.srcdoc = '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><base href="' + esc(base) + '" target="_blank">' +
      '<link rel="stylesheet" href="css/site.css"><script src="js/tei.js"><\/script><script src="js/app.js"><\/script></head>' +
      '<body data-page="editor"><header class="site"><span class="brand">eMelbourne</span></header><div class="layout"><aside id="side"></aside><main id="main"></main></div></body></html>';
    frame.onload = function () {
      var w = frame.contentWindow, d = frame.contentDocument;
      try {
        var doc = new w.DOMParser().parseFromString(c.xml, "application/xml");
        w.TEI.data("names", "data/names.js").catch(function () { return {}; }).then(function (nm) {
          var shown = Object.assign({}, nm); shown[S.id] = collect().title;
          var art = w.EMELSite.entryArticle(doc, S.id, shown);
          d.getElementById("main").appendChild(art);
          w.EMELSite.markMissing(art, shown); w.EMELSite.fixOldLinks(art);
        });
      } catch (e) { d.body.textContent = "The preview couldn't be made: " + e.message; }
    };
  }
  function compare() {
    var c = current(), out = $("compare-out");
    if (!S.original) { out.innerHTML = '<div class="ed-notice"><p>This is a new entry, so there is nothing to compare it with yet. Use Preview to check it.</p></div>'; return; }
    try {
      var r = TEICompare.table(S.original, c.xml, { old: "Before", new: "After", lost: "", title: "What you changed", same: "You haven't changed anything yet." });
      out.innerHTML = r.html;
    } catch (e) { out.textContent = "Couldn't compare: " + e.message; }
  }

  function tab(name) {
    ["edit", "preview", "compare"].forEach(function (t) {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("view-" + t).hidden = t !== name;
    });
    if (name === "preview") preview();
    if (name === "compare") compare();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------ saving */
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = h("a", { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  var lastSaved = null;
  function save() {
    var c = current(), p = problems(c.m);
    if (p.length) { tab("edit"); status(p[0]); window.alert(p.join("\n")); return; }
    if (!c.changed.length && !S.isNew && !window.confirm("You haven't changed anything. Save the files anyway?")) return;
    store(NAME_KEY, squash($("c-name").value));
    lastSaved = { id: S.id, xml: c.xml, js: wrapJs(S.id, c.xml), doc: new DOMParser().parseFromString(c.xml, "application/xml") };
    download(S.id + ".xml", lastSaved.xml, "application/xml");
    setTimeout(function () { download(S.id + ".js", lastSaved.js, "text/javascript"); }, 500);
    // the form keeps comparing with the entry as it was opened, so saving again
    // gives the same files with the later changes, and one line in the history
    store(DRAFT_KEY, null); dirty = false;
    status("Saved " + S.id);
    showSaved();
  }
  function showSaved() {
    var id = lastSaved.id;
    $("saved-xml").textContent = id + ".xml"; $("saved-js").textContent = id + ".js";
    var ol = $("saved-steps"); ol.innerHTML = "";
    var repo = CONFIG.githubRepo, up = function (dir) { return "https://github.com/" + repo + "/upload/" + CONFIG.branch + "/" + CONFIG.sitePath + "/" + dir; };
    var step = function (html) { var li = h("li"); li.innerHTML = html; ol.appendChild(li); };
    step(repo ? 'Open the <a href="' + up("tei") + '" target="_blank" rel="noopener">upload page for the <code>tei</code> folder</a> (sign in to GitHub if asked).'
      : "On GitHub, open the eMelbourne repository, then the <code>site</code> folder, then the <code>tei</code> folder. Choose <strong>Add file</strong> → <strong>Upload files</strong>.");
    step("Drag <code>" + id + ".xml</code> from your Downloads folder onto the page. Under <em>Commit changes</em>, write what you changed, then press <strong>Commit changes</strong>.");
    step(repo ? 'Open the <a href="' + up("tei-js") + '" target="_blank" rel="noopener">upload page for the <code>tei-js</code> folder</a> and do the same with <code>' + id + ".js</code>."
      : "Go back to the <code>site</code> folder, open <code>tei-js</code>, and do the same with <code>" + id + ".js</code>.");
    step("The site shows the change after a few minutes.");
    $("index-msg").textContent = "";
    $("saved").showModal();
  }
  function downloadIndex() {
    var msg = $("index-msg"); msg.textContent = "Loading the index…";
    Promise.all([TEI.data("index", "data/index.js"), getNames()]).then(function (r) {
      var idx = r[0].filter(function (row) { return row.id !== lastSaved.id; });
      idx.push(indexRow(lastSaved.doc, lastSaved.id));
      idx.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      var nm = Object.assign({}, r[1]); nm[lastSaved.id] = indexRow(lastSaved.doc, lastSaved.id).name;
      var sorted = {}; Object.keys(nm).sort().forEach(function (k) { sorted[k] = nm[k]; });
      download("index.js", "EMEL.loaded(\"index\"," + JSON.stringify(idx) + ");\n", "text/javascript");
      setTimeout(function () { download("names.js", "EMEL.loaded(\"names\"," + JSON.stringify(sorted) + ");\n", "text/javascript"); }, 500);
      msg.textContent = "Downloaded index.js and names.js. Upload both to site/data. They include only the entries in this copy of the site plus this one.";
    }).catch(function () { msg.textContent = "Couldn't load data/index.js from this copy of the site."; });
  }

  /* ------------------------------------------------------------ drafts (this browser only) */
  var dirty = false, draftTimer = null;
  function changed() {
    if (loading || !S) return;
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      var values = collect();
      values.articleHtml = quill.root.innerHTML;
      store(DRAFT_KEY, JSON.stringify({ id: S.id, isNew: S.isNew, original: S.original, base: serialize(S.base), values: values, when: new Date().toISOString() }));
      status("Draft kept in this browser");
    }, 800);
  }
  function confirmLeave() { return !dirty || window.confirm("You have unsaved changes to " + S.id + ". Leave them?"); }
  function checkDraft() {
    var raw = stored(DRAFT_KEY), d;
    try { d = raw && JSON.parse(raw); } catch (e) { d = null; }
    if (!d || !d.base) { $("draft-banner").hidden = true; return; }
    $("draft-what").textContent = (d.values && d.values.title || d.id) + " (" + d.id + "), " + new Date(d.when).toLocaleString();
    $("draft-banner").hidden = false;
    $("draft-restore").onclick = function () {
      try {
        openXml(d.base, { isNew: d.isNew, original: d.original });
        var v = d.values; loading = true;
        $("f-title").value = v.title; $("f-type").value = v.subtype; $("f-authors").value = v.authors.join("\n");
        $("p-forename").value = v.person.forename; $("p-surname").value = v.person.surname; $("p-born").value = v.person.born;
        $("p-bornplace").value = v.person.bornPlace; $("p-died").value = v.person.died; $("p-diedplace").value = v.person.diedPlace;
        $("p-occupations").value = v.person.occupations.join("\n"); $("p-other").value = v.person.other.join("\n");
        $("d-start").value = v.dates.start; $("d-end").value = v.dates.end; $("pl-address").value = v.place.address; $("pl-other").value = v.place.other.join("\n");
        $("gloss-rows").innerHTML = ""; v.gloss.forEach(addGloss);
        $("gallery-rows").innerHTML = ""; v.gallery.forEach(addFigure);
        $("rel-rows").innerHTML = ""; v.relations.forEach(addRelation);
        $("ref-rows").innerHTML = ""; v.refs.forEach(function (r) { addRef(r, false); });
        if (v.articleHtml !== articleBaseline) quill.setContents(quill.clipboard.convert(v.articleHtml || ""), "silent");
        showType(); loading = false; dirty = true;
        status("Carried on from your draft");
      } catch (e) { loading = false; window.alert("The draft couldn't be opened: " + e.message); }
    };
    $("draft-discard").onclick = function () { store(DRAFT_KEY, null); $("draft-banner").hidden = true; };
  }

  /* ------------------------------------------------------------ screens */
  function showStart() {
    $("start").hidden = false; $("editor").hidden = true;
    $("btn-save").hidden = true; $("btn-home").hidden = true; $("current").textContent = "";
    checkDraft();
    $("open-q").focus();
  }
  function showEditor() {
    $("start").hidden = true; $("editor").hidden = false;
    $("btn-save").hidden = false; $("btn-home").hidden = false;
    $("current").textContent = S.id + (S.isNew ? " (new)" : "");
    $("new-msg").hidden = true; $("file-msg").hidden = true;
    dirty = false; tab("edit");
  }

  /* ------------------------------------------------------------ Quill */
  function setupQuill() {
    // Tables are kept as they are (Quill can't edit them); they can be moved or deleted
    var BlockEmbed = Quill.import("blots/block/embed");
    class TableBlot extends BlockEmbed {
      static create(value) { var node = super.create(); node.innerHTML = value; node.setAttribute("contenteditable", "false"); return node; }
      static value(node) { return node.innerHTML; }
    }
    TableBlot.blotName = "tableHTML"; TableBlot.tagName = "div"; TableBlot.className = "ql-table-embed";
    Quill.register(TableBlot);

    // Links to other entries are relative ("EM00018.xml"), which Quill would
    // otherwise replace with about:blank when the page is opened from disk
    var Link = Quill.import("formats/link");
    class EntryLink extends Link {
      static create(value) { var node = super.create(value); node.removeAttribute("target"); node.removeAttribute("rel"); return node; }
      static sanitize(url) { return /^\s*(javascript|data|vbscript):/i.test(url || "") ? "about:blank" : url; }
    }
    Quill.register(EntryLink, true);

    quill = new Quill("#article", {
      modules: { toolbar: { container: "#toolbar", handlers: { entrylink: linkToEntry } } },
      formats: ["header", "bold", "italic", "underline", "script", "list", "blockquote", "link", "tableHTML", "glam-image"],
      placeholder: "Write the article here.",
      theme: "snow"
    });
    quill.clipboard.addMatcher("TABLE", function (node) { var Delta = Quill.import("delta"); return new Delta().insert({ tableHTML: node.outerHTML }); });
    glam = GlamEmbed.attach(quill);
    quill.on("text-change", function (d, o, source) { if (source !== "silent") changed(); });
  }
  function linkToEntry() {
    var range = quill.getSelection(true);
    pick("Link to an entry", function (it) {
      var href = it.id + ".xml";
      if (range && range.length) quill.formatText(range.index, range.length, "link", href, "user");
      else { var at = range ? range.index : quill.getLength() - 1; quill.insertText(at, it.name, "link", href, "user"); quill.setSelection(at + it.name.length, 0); }
    });
  }

  /* ------------------------------------------------------------ start up */
  function init() {
    typeOptions($("f-type")); typeOptions($("new-type"));
    setupQuill();

    $("open-q").addEventListener("input", function () { resultList($("open-results"), search(this.value), function (it) { openId(it.id); }); });
    $("open-q").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var v = this.value.trim().toUpperCase(), first = search(this.value)[0];
      if (/^EM\d{5}$/.test(v)) openId(v); else if (first) openId(first.id);
    });
    $("new-create").addEventListener("click", function () {
      var title = squash($("new-title").value), st = $("new-type").value, msg = $("new-msg");
      if (!title) { msg.textContent = "Give the new entry a title first."; msg.hidden = false; return; }
      var dup = nameList.filter(function (it) { return norm(it.name) === norm(title); })[0];
      if (dup && !window.confirm("There's already an entry called “" + dup.name + "” (" + dup.id + "). Start a new one anyway?")) return;
      var id = nextId(), xml = template(id, st, title);
      openXml(xml, { isNew: true, original: "" });
      if (st === "person" && title.indexOf(",") > 0) {
        $("p-surname").value = title.split(",")[0].trim(); $("p-forename").value = title.split(",").slice(1).join(",").trim();
      }
      quill.focus();
    });
    $("open-file").addEventListener("change", function () {
      var f = this.files[0], msg = $("file-msg"); if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var xml = String(r.result), id = (/<idno type="entry">(EM\d{5})<\/idno>/.exec(xml) || [])[1];
          // compare with the copy on the site, if there is one
          var withSite = function (orig) { openXml(xml, { original: orig, isNew: !orig }); if (!orig) status("Opened " + f.name + " (not on the site yet)"); else status("Opened " + f.name); };
          if (id && names[id]) TEI.data("tei:" + id, "tei-js/" + id + ".js").then(withSite, function () { withSite(""); });
          else withSite("");
        } catch (e) { msg.textContent = e.message; msg.hidden = false; }
      };
      r.readAsText(f, "utf-8");
      this.value = "";
    });

    $("f-type").addEventListener("change", function () { showType(); changed(); });
    $("view-edit").addEventListener("input", changed);
    $("view-edit").addEventListener("submit", function (e) { e.preventDefault(); });
    $("gloss-add").addEventListener("click", function () { addGloss(null).querySelector("input").focus(); });
    $("gallery-add").addEventListener("click", addFromLink);
    $("gallery-url").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addFromLink(); } });
    $("rel-add").addEventListener("click", function () {
      pick("Add a related entry", function (it) {
        if (rows("rel-rows").some(function (r) { return r.data.id === it.id; })) return;
        relationType(it.id).then(function (type) { addRelation({ o: -1, id: it.id, name: it.name, type: type }); changed(); });
      });
    });
    $("ref-add").addEventListener("click", function () { addRef({ o: -1 }, true).querySelector('[data-k="author"]').focus(); changed(); });
    $("picker-q").addEventListener("input", function () {
      resultList($("picker-results"), search(this.value), function (it) { $("picker").close(); if (pickerDone) pickerDone(it); });
    });
    ["edit", "preview", "compare"].forEach(function (t) { $("tab-" + t).addEventListener("click", function () { tab(t); }); });
    $("btn-save").addEventListener("click", save); $("btn-save2").addEventListener("click", save);
    $("btn-home").addEventListener("click", function () { if (confirmLeave()) { S = null; dirty = false; showStart(); } });
    $("again-xml").addEventListener("click", function (e) { e.preventDefault(); download(lastSaved.id + ".xml", lastSaved.xml, "application/xml"); });
    $("again-js").addEventListener("click", function (e) { e.preventDefault(); download(lastSaved.id + ".js", lastSaved.js, "text/javascript"); });
    $("index-dl").addEventListener("click", downloadIndex);
    $("help-link").addEventListener("click", function (e) { e.preventDefault(); $("help").showModal(); });
    window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

    getNames().catch(function () { status("Couldn't load data/names.js; open a saved file instead."); }).then(function () {
      var id = (new URLSearchParams(location.search).get("id") || "").toUpperCase();
      if (/^EM\d{5}$/.test(id)) { showStart(); openId(id); } else showStart();
    });
  }

  // exposed for testing and for the browser console
  window.EMELEditor = { read: read, build: build, serialize: serialize, template: template, indexRow: indexRow, wrapJs: wrapJs, iso: iso,
    htmlToBlocks: htmlToBlocks, articleToHtml: articleToHtml, quill: function () { return quill; }, state: function () { return S; }, current: function () { return S && current(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

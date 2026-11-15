/* eMelbourne site logic. Plain JS, no build step, works from file:// and any host.
 *
 * Navigation follows the old site (see the converted Help page):
 *   title banner: Home · About · Help · quick search
 *   content tabs: Themes · A to Z · Search
 * The theme list and its order come from the old site's menu (data/nav.js).
 */
(function () {
  "use strict";
  var TYPES = [
    ["Entry", "Entries"], ["Theme", "Themes"], ["Person", "People"], ["Place", "Places"],
    ["Cultural Artefact", "Cultural artefacts"], ["Concept", "Concepts"], ["Event", "Events"]];
  var TYPE_LABEL = {}; TYPES.forEach(function (t) { TYPE_LABEL[t[0]] = t[1]; });

  var cache = {};
  function data(key, file) { return cache[key] || (cache[key] = TEI.data(key, file)); }
  function getIndex() { return data("index", "data/index.js"); }
  function getNav() { return data("nav", "data/nav.js"); }
  function getNames() { return data("names", "data/names.js"); }
  function getObjects() { return data("objects", "data/objects.js"); }

  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function param(name) { return new URLSearchParams(location.search).get(name) || ""; }
  function entryHref(id) { return "entry.html?id=" + id; }
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function sortKey(s) { return norm(s).replace(/^(the|a|an) /, ""); }

  /* ------------------------------------------------------------ chrome */
  // One header for every page: brand, the five ways in, and search.
  // Experiments pages copy this markup by hand (they don't load app.js).
  var NAV = [["themes", "index.html#themes", "Themes"], ["browse", "browse.html", "A to Z"],
    ["exhibitions", "index.html#exhibitions", "Exhibitions"], ["onthisday", "experiments/onthisday.html", "On this day"], ["experiments", "experiments/index.html", "Experiments"],
    ["about", "page.html?p=about", "About"]];
  var EXHIBITIONS = [["everydaywar", "The Everyday War"], ["civictreasures", "Civic Treasures"],
    ["letterheads", "Letterheads"], ["infocus", "In Focus"]];

  function chrome(active) {
    var header = $("#site-header");
    header.innerHTML =
      '<div class="hd">' +
      '<a class="brand" href="index.html"><span class="brand-name">eMelbourne</span>' +
      '<span class="brand-tag">The Encyclopedia of Melbourne Online</span></a>' +
      '<form class="quick" action="search.html" role="search"><label class="sr" for="quick-q">Search eMelbourne</label>' +
      '<input id="quick-q" name="q" type="search" placeholder="Search people, places, events…" autocomplete="off">' +
      '<button type="submit">Search</button><a class="adv" href="advanced.html">Advanced search</a></form>' +
      '<nav class="top" aria-label="Site">' + NAV.map(function (n) {
        return '<a href="' + n[1] + '" data-k="' + n[0] + '">' + n[2] + "</a>";
      }).join("") + "</nav></div>";
    var t = $('nav.top [data-k="' + active + '"]', header);
    if (t) t.setAttribute("aria-current", "page");
    var q = $("#quick-q", header); if (q && active === "search") q.value = param("q");

    var foot = $("footer.site");
    if (foot && !$(".foot-nav", foot)) {
      var fn = h("nav", { "class": "foot-nav", "aria-label": "More" });
      [["page.html?p=about", "About eMelbourne"],
        ["advanced.html", "Advanced search"], ["experiments/index.html", "Experiments"], ["editor.html", "Edit an entry"]].forEach(function (l) {
        fn.appendChild(h("a", { href: l[0] }, l[1]));
      });
      foot.insertBefore(fn, foot.firstChild);
    }

    // the side panel is only used inside an exhibition, for its sections
    var side = $("#side");
    side.innerHTML = "";

    return Promise.all([getNav(), getNames()]).then(function (r) {
      var nav = r[0], pages = {}, cur = param("p");
      (nav.pages || []).forEach(function (p) { pages[p.id] = p; });
      var group = (pages[cur] || {}).group || "";
      var ex = EXHIBITIONS.filter(function (e) { return e[0] === cur || e[0] === group; })[0];
      if (ex) {
        var sub = nav.pages.filter(function (p) { return p.group === ex[0]; });
        var box = h("nav", { "class": "exhibit-nav", "aria-label": ex[1] });
        box.appendChild(h("p", { "class": "exhibit-label" }, "Exhibition"));
        var top = h("a", { href: "page.html?p=" + ex[0], "class": "exhibit-home" }, ex[1]);
        if (cur === ex[0]) top.setAttribute("aria-current", "page");
        box.appendChild(top);
        if (sub.length) {
          var ul = h("ul");
          sub.forEach(function (p) {
            var li = h("li"), a = h("a", { href: "page.html?p=" + p.id }, p.title);
            if (p.id === cur) a.setAttribute("aria-current", "page");
            li.appendChild(a); ul.appendChild(li);
          });
          box.appendChild(ul);
        }
        side.appendChild(box);
        var x = $('nav.top [data-k="exhibitions"]', header); if (x) x.setAttribute("aria-current", "page");
      }
      document.body.classList.toggle("has-side", !!side.firstChild);
      return nav;
    });
  }

  // "Home › Themes › Sport & Recreation" above a page title
  function crumbs(items) {
    var nav = h("nav", { "class": "crumbs", "aria-label": "Breadcrumb" }), ol = h("ol");
    [["index.html", "Home"]].concat(items).forEach(function (c) {
      var li = h("li");
      li.appendChild(c[0] ? h("a", { href: c[0] }, c[1]) : h("span", null, c[1]));
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    return nav;
  }

  // links to records that do not exist: mark them instead of leaving dead ends
  function markMissing(root, have) {
    Array.prototype.forEach.call(root.querySelectorAll('a[href^="entry.html?id="]'), function (a) {
      var id = a.getAttribute("href").split("=")[1];
      if (!have[id]) a.classList.add("not-converted");
    });
  }

  // old in-site links inside converted pages (biogs/EM…b.htm) -> new pages
  function fixOldLinks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
      var m = a.getAttribute("href").match(/(EM\d{5})[bg]\.htm/i);
      if (m) a.setAttribute("href", entryHref(m[1].toUpperCase()));
    });
  }

  // builds the entry <article> from a TEI document (also used by the editor's preview):
  // title block, then the text, with a rail of facts, themes and related records beside it
  function entryArticle(doc, id, names) {
    var meta = TEI.header(doc);
    var art = h("article", { "class": "entry" });
    var head = h("header", { "class": "entry-head" });
    head.appendChild(h("p", { "class": "kicker" }, meta.type));
    head.appendChild(h("h1", null, meta.title));
    if (meta.author) head.appendChild(h("p", { "class": "byline" }, "By " + meta.author));
    art.appendChild(head);

    var body = h("div", { "class": "entry-body" });
    [TEI.render(doc.querySelector("text > body")),
      doc.querySelector("text > back") && TEI.render(doc.querySelector("text > back"))]
      .forEach(function (n) { if (n) body.appendChild(n); });

    var rail = h("aside", { "class": "entry-rail", "aria-label": "About this record" });
    var facts = TEI.facts(doc);
    if (facts) { var fs = h("section", { "class": "rail-box facts-box" }); fs.appendChild(h("h2", null, "At a glance")); fs.appendChild(facts); rail.appendChild(fs); }
    var rel = TEI.relations(doc);
    if (rel) {
      var themeLinks = rel.querySelectorAll('a[data-type="theme"]');
      if (themeLinks.length) {
        var ts = h("section", { "class": "rail-box themes-box" }), tl = h("ul", { "class": "chips" });
        ts.appendChild(h("h2", null, themeLinks.length > 1 ? "Themes" : "Theme"));
        Array.prototype.forEach.call(themeLinks, function (a) { var li = a.parentNode; tl.appendChild(li); });
        ts.appendChild(tl); rail.appendChild(ts);
      }
      // a short list sits in the rail; a theme's long list goes under the text, in columns
      var nRel = rel.querySelectorAll("li").length;
      if (nRel > 24) { rel.classList.add("related-long"); var longRel = rel; }
      else if (nRel) { rel.classList.add("rail-box"); rail.appendChild(rel); }
    }
    if (rail.firstChild) { art.classList.add("has-rail"); art.appendChild(rail); }
    art.appendChild(body);
    if (longRel) {
      longRel.querySelector("h2").textContent = "Related entries (" + longRel.querySelectorAll("li").length + ")";
      body.appendChild(longRel);
    }

    var citeText = (meta.author ? meta.author + ", " : "") + "‘" + meta.title +
      "’, eMelbourne: The Encyclopedia of Melbourne Online, " + id + ".";
    var cs = h("section", { "class": "cite" });
    cs.appendChild(h("h2", null, "Cite this entry"));
    cs.appendChild(h("p", { "class": "cite-text" }, citeText));
    var tools = h("p", { "class": "cite-tools" });
    var copy = h("button", { type: "button", "class": "btn-quiet" }, "Copy citation");
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy citation"; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(citeText).then(done, function () {});
    });
    tools.appendChild(copy);
    tools.appendChild(h("a", { href: meta.licenceUrl, rel: "license" }, meta.licence));
    tools.appendChild(h("a", { href: "tei/" + id + ".xml" }, "TEI source"));
    cs.appendChild(tools);
    body.appendChild(cs);
    return art;
  }

  /* ------------------------------------------------------------ entry */
  function entryPage() {
    var id = param("id").toUpperCase(), main = $("#main");
    chrome(" ").then(function (nav) {
      if (!/^EM\d{5}$/.test(id)) { main.textContent = "No entry given."; return; }
      return Promise.all([TEI.load(id), getNames()]).then(function (res) {
        var doc = res[0], names = res[1], meta = TEI.header(doc);
        document.title = meta.title + " – eMelbourne";
        var art = entryArticle(doc, id, names);
        main.innerHTML = "";
        var themeIds = {}; (nav.themes || []).forEach(function (t) { themeIds[t.id] = t.name; });
        var first = Array.prototype.map.call(doc.querySelectorAll('listRelation relation[type="theme"]'), function (r) {
          return (r.getAttribute("passive").match(/EM\d{5}/) || [""])[0]; }).filter(function (t) { return themeIds[t]; })[0];
        var trail = meta.type === "Theme" ? [["index.html#themes", "Themes"]]
          : first ? [["index.html#themes", "Themes"], [entryHref(first), themeIds[first]]] : [["browse.html", "A to Z"]];
        main.appendChild(crumbs(trail));
        main.appendChild(art);
        markMissing(art, names);
        if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
      });
    }).catch(function () {
      getNames().then(function (names) {
        main.innerHTML = "";
        main.appendChild(h("h1", null, names[id] || id));
        main.appendChild(h("p", null, names[id]
          ? "This record exists in the eMelbourne data but its page could not be loaded."
          : "No record with this identifier."));
      });
    });
  }

  /* ------------------------------------------------- about, help, home */
  function renderPage(pid, into) {
    return TEI.loadPage(pid).then(function (doc) {
      var body = TEI.render(doc.querySelector("text"));
      into.appendChild(body);
      fixOldLinks(into);
      return getNames().then(function (names) { markMissing(into, names); return doc; });
    });
  }

  function pagePage() {
    var pid = param("p") || "about", main = $("#main");
    if (pid === "help") { location.replace("page.html?p=about"); return; }   // Help was retired
    chrome(pid).then(function (nav) {
      return renderPage(pid, main).then(function (doc) {
        var title = TEI.header(doc).title;
        document.title = title + " – eMelbourne";
        var p = (nav.pages || []).filter(function (x) { return x.id === pid; })[0] || {};
        var ex = EXHIBITIONS.filter(function (e) { return e[0] === pid || e[0] === p.group; })[0];
        var trail = ex ? [["index.html#exhibitions", "Exhibitions"]].concat(pid === ex[0] ? [] : [["page.html?p=" + ex[0], ex[1]]]) : [];
        main.insertBefore(h("h1", null, title), main.firstChild);
        main.insertBefore(crumbs(trail), main.firstChild);
      });
    }).catch(function () { main.textContent = "Page not found."; });
  }

  function homePage() {
    var main = $("#main");
    chrome("home").then(function (nav) {
      var intro = h("section", { "class": "hero" });
      intro.appendChild(h("p", { "class": "kicker" }, "The city past and present"));
      intro.appendChild(h("h1", null, "The Encyclopedia of Melbourne"));
      var f = h("form", { action: "search.html", "class": "big-search", role: "search" });
      f.appendChild(h("label", { "for": "home-q", "class": "sr" }, "Search eMelbourne"));
      f.appendChild(h("input", { id: "home-q", name: "q", type: "search", placeholder: "Search people, places, events…", autocomplete: "off" }));
      f.appendChild(h("button", { type: "submit" }, "Search"));
      intro.appendChild(f);
      var adv = h("p", { "class": "hero-links" }); adv.appendChild(h("a", { href: "advanced.html" }, "Advanced search"));
      intro.appendChild(adv);
      main.appendChild(intro);

      var themes = h("section", { id: "themes", "class": "home-sec" });
      themes.appendChild(h("h2", null, "Themes"));
      var ul = h("ul", { "class": "theme-tiles" });
      nav.themes.forEach(function (t) { var li = h("li"); li.appendChild(h("a", { href: entryHref(t.id) }, t.name)); ul.appendChild(li); });
      themes.appendChild(ul);
      main.appendChild(themes);

      var exs = h("section", { id: "exhibitions", "class": "home-sec" });
      exs.appendChild(h("h2", null, "Exhibitions"));
      var el = h("ul", { "class": "ex-cards" });
      EXHIBITIONS.forEach(function (e) {
        var li = h("li"), a = h("a", { href: "page.html?p=" + e[0] });
        a.appendChild(h("span", { "class": "ex-title" }, e[1]));
        a.dataset.ex = e[1].replace(/^The /, "");
        li.appendChild(a); el.appendChild(li);
      });
      exs.appendChild(el);
      main.appendChild(exs);

      var feat = h("section", { "class": "home-sec" });
      feat.appendChild(h("h2", null, "Features"));
      var fl = h("ul", { "class": "feat-cards" });
      feat.appendChild(fl);
      main.appendChild(feat);

      // the old home page's features, one card each; the exhibitions already have their own cards
      var src = h("div");
      return renderPage("home", src).then(function () {
        var exTitles = {}, exPages = {};
        EXHIBITIONS.forEach(function (e) { exTitles[e[1].replace(/^The /, "")] = 1; exPages["page.html?p=" + e[0]] = 1; });
        Array.prototype.forEach.call(src.querySelectorAll("section.tei-div"), function (sec) {
          var head = sec.querySelector("h2, h3"), title = head ? head.textContent.trim() : "";
          var link = Array.prototype.filter.call(sec.querySelectorAll("a[href]"), function (a) { return !a.querySelector("img"); }).pop();
          if (!title || !link) return;
          var href = link.getAttribute("href");
          var p = Array.prototype.filter.call(sec.querySelectorAll("p"), function (x) { return !x.closest("figure"); })[0], text = p ? p.textContent.replace(/\s*(Read More|Explore)\.{3}\s*$/i, "").trim() : "";
          var exCard = $('.ex-cards a[data-ex="' + title.replace(/^The /, "") + '"]');
          if (exCard && text) exCard.appendChild(h("span", { "class": "ex-desc" }, text));
          if (exPages[href] || exTitles[title.replace(/^The /, "")]) return;
          var li = h("li"), a = h("a", { href: href });
          if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
          a.appendChild(h("span", { "class": "feat-title" }, title));
          if (text) a.appendChild(h("span", { "class": "feat-desc" }, text));
          li.appendChild(a); fl.appendChild(li);
        });
      });
    });
  }

  /* ------------------------------------------------------------ A to Z */
  function browsePage() {
    var main = $("#main"), type = param("type") || "Entry", letter = (param("l") || "A").toUpperCase();
    chrome("browse").then(getIndex).then(function (idx) {
      document.title = "A to Z – eMelbourne";
      main.appendChild(crumbs([]));
      main.appendChild(h("h1", null, "A to Z"));
      var tnav = h("nav", { "class": "chips", "aria-label": "Type" });
      TYPES.forEach(function (t) {
        var n = idx.filter(function (i) { return i.type === t[0]; }).length;
        if (!n) return;
        var a = h("a", { href: "browse.html?type=" + encodeURIComponent(t[0]) }, t[1] + " " + n.toLocaleString("en-AU"));
        if (t[0] === type) a.setAttribute("aria-current", "page");
        tnav.appendChild(a);
      });
      main.appendChild(tnav);
      var items = idx.filter(function (i) { return i.type === type; });
      var letters = {};
      items.forEach(function (i) { letters[sortKey(i.name).charAt(0).toUpperCase()] = 1; });
      var lnav = h("nav", { "class": "letters", "aria-label": "Letter" });
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (L) {
        if (letters[L]) {
          var a = h("a", { href: "browse.html?type=" + encodeURIComponent(type) + "&l=" + L }, L);
          if (L === letter) a.setAttribute("aria-current", "page");
          lnav.appendChild(a);
        } else lnav.appendChild(h("span", null, L));
      });
      main.appendChild(lnav);
      if (!letters[letter]) letter = Object.keys(letters).sort()[0] || "A";
      var ul = h("ul", { "class": "az" });
      items.filter(function (i) { return sortKey(i.name).charAt(0).toUpperCase() === letter; })
        .sort(function (a, b) { return sortKey(a.name).localeCompare(sortKey(b.name)); })
        .forEach(function (i) { var li = h("li"); li.appendChild(h("a", { href: entryHref(i.id) }, i.name)); ul.appendChild(li); });
      main.appendChild(ul);
    });
  }

  /* ------------------------------------------------------------ search */
  function search(idx, q, type) {
    var terms = norm(q).split(/\s+/).filter(Boolean), res = [];
    idx.forEach(function (it) {
      if (type && it.type !== type) return;
      if (!terms.length) { res.push({ it: it, score: 0 }); return; }
      var name = norm(it.name), text = it._t || (it._t = norm(it.text)), score = 0;
      for (var i = 0; i < terms.length; i++) {
        var inName = name.indexOf(terms[i]) >= 0, inText = text.indexOf(terms[i]) >= 0;
        if (!inName && !inText) return;
        score += (inName ? 10 : 0) + (inText ? 1 : 0);
      }
      res.push({ it: it, score: score });
    });
    res.sort(function (a, b) { return b.score - a.score || sortKey(a.it.name).localeCompare(sortKey(b.it.name)); });
    return res.map(function (r) { return r.it; });
  }

  function snippet(it, q) {
    var text = it.text || "", t = norm(q).split(/\s+/).filter(Boolean)[0];
    var at = t ? norm(text).indexOf(t) : -1, start = at > 60 ? at - 60 : 0;
    return (start ? "…" : "") + text.slice(start, start + 220) + (text.length > start + 220 ? "…" : "");
  }

  function searchPage() {
    var main = $("#main");
    chrome("search").then(getIndex).then(function (idx) {
      document.title = "Search – eMelbourne";
      main.innerHTML =
        '<h1>Search</h1><form id="search" role="search"><input id="q" type="search" aria-label="Search" placeholder="e.g. cricket, Bourke Street, fountain" autocomplete="off">' +
        '<select id="type" aria-label="Type"><option value="">All types</option></select></form><p class="adv-link"><a id="adv" href="advanced.html">Advanced search</a></p><p id="count" class="muted"></p><ol id="results" class="results"></ol>';
      var input = $("#q"), sel = $("#type"), out = $("#results"), count = $("#count");
      TYPES.forEach(function (t) {
        var n = idx.filter(function (i) { return i.type === t[0]; }).length;
        if (n) sel.appendChild(h("option", { value: t[0] }, t[1] + " (" + n + ")"));
      });
      function run() {
        var q = input.value.trim(), res = search(idx, q, sel.value);
        $("#adv").href = "advanced.html" + (q ? "?q=" + encodeURIComponent(q) : "");
        out.innerHTML = "";
        count.textContent = res.length + (res.length === 1 ? " record" : " records");
        res.forEach(function (it) {
          var li = h("li");
          if (it.img) li.appendChild(h("img", { src: it.img, alt: "", loading: "lazy" }));
          var head = h("div", { "class": "r-head" });
          head.appendChild(h("a", { href: entryHref(it.id) }, it.name));
          head.appendChild(h("span", { "class": "r-type" }, it.type + (it.dates ? " · " + it.dates : "") + (it.author ? " · " + it.author : "")));
          li.appendChild(head);
          li.appendChild(h("p", null, snippet(it, q)));
          out.appendChild(li);
        });
        try { history.replaceState(null, "", "?" + new URLSearchParams({ q: q, type: sel.value }).toString()); } catch (e) { /* some browsers restrict this on file:// */ }
      }
      input.value = param("q"); sel.value = param("type");
      $("#search").addEventListener("submit", function (e) { e.preventDefault(); run(); });
      input.addEventListener("input", run);
      sel.addEventListener("change", run);
      run(); input.focus();
    });
  }

  /* ----------------------------------------------------------- object */
  // OHRM digital objects (data/objects.js): pictures, letters and other items
  // the old pages linked to as objects/D…htm
  function objectPage() {
    var id = param("id").toUpperCase(), main = $("#main");
    chrome(" ").then(function () { return Promise.all([getObjects(), getNames()]); }).then(function (r) {
      var o = r[0][id], names = r[1];
      main.innerHTML = "";
      if (!o) { main.appendChild(h("h1", null, id)); main.appendChild(h("p", null, "No digital object with this identifier.")); return; }
      document.title = (o.title || id) + " – eMelbourne";
      main.appendChild(crumbs((o.entries || []).slice(0, 1).map(function (e) { return [entryHref(e), names[e] || e]; })));
      var art = h("article", { "class": "object" });
      art.appendChild(h("p", { "class": "kicker" }, o.type ? o.type.charAt(0).toUpperCase() + o.type.slice(1) : "Digital object"));
      art.appendChild(h("h1", null, o.title || id));
      if (o.image || o.thumb) {
        var img = h("img", { src: o.image || o.thumb, alt: o.title || "" }), fig = h("figure");
        img.onerror = function () { fig.hidden = true; };
        var link = h("a", { href: o.image || o.thumb }); link.appendChild(img); fig.appendChild(link); art.appendChild(fig);
      } else {
        art.appendChild(h("p", { "class": "note" }, "The image for this item is not in the archive yet."));
      }
      if (o.description) art.appendChild(h("p", null, o.description));
      var dl = h("dl", { "class": "facts" });
      function row(k, v) { if (v) { dl.appendChild(h("dt", null, k)); dl.appendChild(h("dd", null, v)); } }
      row("Date", o.date); row("Creator", o.creator); row("Place", o.place);
      row("Physical description", o.physdesc); row("Reference", o.reference); row("Rights", o.rights);
      // the OHRM archival record the object comes from (tools/apply_leftovers.py)
      var arc = o.archive;
      if (arc && (o.reference || "").indexOf(arc.title) < 0) {
        dl.appendChild(h("dt", null, "Archival source"));
        var add = h("dd");
        if (arc.url) add.appendChild(h("a", { href: arc.url, target: "_blank", rel: "noopener" }, arc.title));
        else add.appendChild(document.createTextNode(arc.title));
        var rest = [arc.ref, arc.partOf ? "part of " + arc.partOf : "", arc.repository].filter(Boolean).join(", ");
        if (rest) add.appendChild(document.createTextNode(", " + rest));
        dl.appendChild(add);
      }
      if (o.prov) {
        row("Public Record Office Victoria", o.prov.ref + (o.prov.date ? " (" + o.prov.date + ")" : ""));
        if (o.prov.url) {   // the file's PROV catalogue record (enrichments/prov-links.csv)
          dl.appendChild(h("dt", null, "PROV catalogue"));
          var dd = h("dd"); dd.appendChild(h("a", { href: o.prov.url, target: "_blank", rel: "noopener" }, o.prov.citation || o.prov.url));
          dl.appendChild(dd);
        }
        if (o.prov.from) row("From", o.prov.from);
        if (o.prov.pages) row("Pages", o.prov.pages);
      }
      art.appendChild(dl);
      if (o.entries && o.entries.length) {
        var sec = h("section", { "class": "tei-div related" }), ul = h("ul");
        sec.appendChild(h("h2", null, "Related entries"));
        o.entries.forEach(function (e) { var li = h("li"); li.appendChild(h("a", { href: entryHref(e) }, names[e] || e)); ul.appendChild(li); });
        sec.appendChild(ul); art.appendChild(sec);
      }
      art.appendChild(h("p", { "class": "cite" }, "OHRM digital object " + id + "."));
      main.appendChild(art);
    }).catch(function () { main.textContent = "The digital objects list could not be loaded."; });
  }

  window.EMELSite = { entryArticle: entryArticle, markMissing: markMissing, fixOldLinks: fixOldLinks };

  document.addEventListener("DOMContentLoaded", function () {
    var pages = { entry: entryPage, page: pagePage, home: homePage, browse: browsePage, search: searchPage,
      object: objectPage, editor: function () { /* editor.js runs itself */ },
      advanced: function () { chrome("advanced"); /* js/advanced.js renders #main */ } };
    (pages[document.body.dataset.page] || homePage)();
  });
})();

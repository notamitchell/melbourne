/* eMelbourne advanced search (advanced.html). Plain JS, no build step, works from file://.
 *
 * Data: data/facets.js (one compact row per record, made by tools/build-facets.py from tei/),
 * data/nav.js (theme order), and data/index.js (article text), which is loaded only when
 * words are searched in the text.
 *
 * Within a facet the choices are alternatives (any of them); across facets every choice
 * must hold. Each facet's counts are worked out with every other choice applied, so a
 * choice with a count never gives an empty list. Everything chosen is kept in the address,
 * so a search can be bookmarked or sent.
 *
 * Word matching (after eLiebermann's law search): lower case, accents and apostrophes
 * ignored; "quoted phrases"; word* for word beginnings; -word to leave out; whole words or
 * parts of words; spelling tolerance lets names of five letters or more differ by one letter
 * (two from eight letters).
 */
(function () {
  "use strict";

  const TYPES = [["entry", "Entries"], ["person", "People"], ["place", "Places"], ["cultural-artefact", "Cultural artefacts"],
    ["theme", "Themes"], ["concept", "Concepts"], ["event", "Events"]];
  const TYPE_ONE = { entry: "Entry", person: "Person", place: "Place", "cultural-artefact": "Cultural artefact", theme: "Theme", concept: "Concept", event: "Event" };
  const WHERE = [["name", "Names"], ["text", "Article text"], ["bib", "References"]];
  const HAS = [["img", "Images"], ["bib", "References"], ["adb", "ADB biography"]];
  const BIB_KINDS = { "book": "Book", "edited-book": "Edited book", "book-section": "Book section", "journal-article": "Journal article",
    "newspaper-article": "Newspaper article", "resource": "Web resource", "resource-section": "Web page", "article": "Article",
    "journal": "Journal", "report": "Report", "manuscript": "Manuscript", "conference-paper": "Conference paper" };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const PAGE = 50;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, many) => n.toLocaleString("en-AU") + " " + (n === 1 ? one : many);
  const human = s => (s || "").replace(/-/g, " ").replace(/^./, c => c.toUpperCase());

  // ---- folding, as eLiebermann's law search does it
  function foldChar(c) { const d = c.normalize("NFD"); return d.length ? d[0] : c; }
  // same length as the input, so positions carry over to the original (for snippets)
  function foldKeep(s) { let o = ""; s = String(s || "").toLowerCase(); for (const c of s) o += foldChar(c); return o; }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/['’‘`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function near(a, b) {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 5 || !/^[a-z]+$/.test(a + b)) return false;
    return lev(a, b) <= (Math.min(a.length, b.length) >= 8 ? 2 : 1);
  }

  // ---- the query: words, "phrases", word*, -word
  function parse(q) {
    const terms = [], re = /(-?)"([^"]+)"|(-?)(\S+)/g; let m;
    while ((m = re.exec(q))) {
      if (m[2] != null) { const w = fold(m[2]); if (w) terms.push({ not: !!m[1], phrase: w, words: w.split(" ") }); }
      else {
        const wild = /\*$/.test(m[4]), w = fold(m[4]);
        if (!w) continue;
        w.split(" ").forEach((x, i, all) => terms.push({ not: !!m[3], word: x, wild: wild && i === all.length - 1 }));
      }
    }
    return terms;
  }
  function tokenMatch(t, tok, S) {
    if (t.wild) return tok.startsWith(t.word);
    if (S.match === "part") return tok.includes(t.word);
    return tok === t.word || (S.tol && near(tok, t.word));
  }
  // a term against a short folded string (a name, a reference)
  function termIn(t, folded, S) {
    if (!folded) return false;
    if (t.phrase) return (" " + folded + " ").includes(" " + t.phrase + " ") || (S.match === "part" && folded.includes(t.phrase));
    return folded.split(" ").some(tok => tokenMatch(t, tok, S));
  }

  // ---- data
  let rows = [], byId = {}, themes = [], themeName = {}, members = {}, bornIn = {}, text = null, textLoading = null;
  let vocab = null, foldedText = [];

  function prepare(facets, nav) {
    rows = facets;
    rows.forEach((r, i) => {
      r.i = i; byId[r.id] = r;
      r.fn = fold(r.n);
      r.fa = (r.alt || []).map(a => fold(a[0])).join(" ");
      r.fb = (r.bib || []).map(b => fold(b[1] + " " + b[2])).join(" ");
      r.sk = fold(r.n).replace(/^(the|a|an) /, "");
      (r.th || []).forEach(t => (members[t] = members[t] || []).push(r.id));
      ["b", "d"].forEach(k => { if (r[k] && r[k].pid) (bornIn[r[k].pid] = bornIn[r[k].pid] || []).push(r.id); });
    });
    // people have no themes of their own: they take the themes of the entries that name them
    rows.forEach(r => {
      r.ths = r.th || [];
      if (r.t === "person" && r.mn) r.ths = uniq([].concat(...r.mn.map(id => (byId[id] && byId[id].th) || [])));
    });
    themes = (nav.themes || []).filter(t => byId[t.id]);
    themes.forEach(t => (themeName[t.id] = t.name));
  }
  function loadText() {
    if (text) return Promise.resolve(text);
    if (!textLoading) textLoading = TEI.data("index", "data/index.js").then(idx => {
      text = {}; idx.forEach(x => (text[x.id] = x));
      vocab = new Map();
      rows.forEach(r => {
        const x = text[r.id], f = x ? fold(x.text) : "";
        foldedText[r.i] = f;
        new Set(f.split(" ")).forEach(tok => {
          if (!tok) return;
          let a = vocab.get(tok); if (!a) vocab.set(tok, a = []);
          a.push(r.i);
        });
      });
      return text;
    });
    return textLoading;
  }
  // rows whose article text has the term: a set of row numbers, and the words that matched
  function textHits(t, S, seen) {
    const out = new Set();
    if (t.phrase) {
      const first = { word: t.words[0] }, cand = textHits(first, { match: "whole" }, null);
      cand.forEach(i => { if ((" " + foldedText[i] + " ").includes(" " + t.phrase + " ")) out.add(i); });
      if (seen) seen.add(t.words.join(" "));
      return out;
    }
    if (!t.wild && S.match !== "part" && !S.tol) {
      (vocab.get(t.word) || []).forEach(i => out.add(i));
      if (seen) seen.add(t.word);
      return out;
    }
    vocab.forEach((list, tok) => {
      if (tokenMatch(t, tok, S)) { list.forEach(i => out.add(i)); if (seen && seen.size < 60) seen.add(tok); }
    });
    return out;
  }

  // ---- the search as chosen (and as the address keeps it)
  const S = {};
  function blank() {
    Object.assign(S, { q: "", where: new Set(["name", "text"]), match: "whole", tol: false,
      types: new Set(), th: new Set(), occ: new Set(), occAll: false, sex: "", altk: new Set(),
      by: ["", ""], dy: ["", ""], alive: "", bp: "", dp: "", au: new Set(),
      rel: "", steps: 1, ba: "", bt: "", bk: new Set(), byr: ["", ""], has: new Set(), sort: "", shown: PAGE });
  }
  const list = (p, k) => (p.get(k) || "").split("|").map(s => s.trim()).filter(Boolean);
  const range = (p, k) => { const v = (p.get(k) || "").split("-"); return [v[0] || "", v[1] || ""]; };
  function readAddress() {
    blank();
    const p = new URLSearchParams(location.search);
    S.q = p.get("q") || "";
    if (p.get("in")) S.where = new Set(list(p, "in").filter(k => WHERE.some(w => w[0] === k)));
    if (!S.where.size) S.where = new Set(["name", "text"]);
    S.match = p.get("m") === "part" ? "part" : "whole";
    S.tol = p.get("tol") === "1";
    S.types = new Set(list(p, "type")); S.th = new Set(list(p, "theme"));
    S.occ = new Set(list(p, "occ")); S.occAll = p.get("occm") === "all";
    S.sex = /^[mf]$/.test(p.get("sex")) ? p.get("sex") : "";
    S.altk = new Set(list(p, "alt"));
    S.by = range(p, "born"); S.dy = range(p, "died"); S.alive = p.get("alive") || "";
    S.bp = p.get("bp") || ""; S.dp = p.get("dp") || "";
    S.au = new Set(list(p, "author"));
    S.rel = p.get("rel") || ""; S.steps = p.get("steps") === "2" ? 2 : 1;
    S.ba = p.get("ba") || ""; S.bt = p.get("bt") || ""; S.bk = new Set(list(p, "bk")); S.byr = range(p, "byr");
    S.has = new Set(list(p, "has")); S.sort = p.get("sort") || "";
  }
  function writeAddress() {
    const p = new URLSearchParams();
    const set = (k, v) => { if (v) p.set(k, v); };
    set("q", S.q.trim());
    if (S.q.trim()) {
      if ([...S.where].sort().join("|") !== "name|text") set("in", [...S.where].join("|"));
      if (S.match === "part") set("m", "part");
      if (S.tol) set("tol", "1");
    }
    set("type", [...S.types].join("|")); set("theme", [...S.th].join("|"));
    set("occ", [...S.occ].join("|")); if (S.occAll && S.occ.size > 1) set("occm", "all");
    set("sex", S.sex); set("alt", [...S.altk].join("|"));
    if (S.by[0] || S.by[1]) set("born", S.by.join("-"));
    if (S.dy[0] || S.dy[1]) set("died", S.dy.join("-"));
    set("alive", S.alive); set("bp", S.bp.trim()); set("dp", S.dp.trim());
    set("author", [...S.au].join("|"));
    set("rel", S.rel); if (S.rel && S.steps === 2) set("steps", "2");
    set("ba", S.ba.trim()); set("bt", S.bt.trim()); set("bk", [...S.bk].join("|"));
    if (S.byr[0] || S.byr[1]) set("byr", S.byr.join("-"));
    set("has", [...S.has].join("|")); set("sort", S.sort);
    try { history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "")); } catch (e) { /* file:// in some browsers */ }
  }

  // ---- filters: one per facet, so each facet can be counted without its own choice
  const num = s => (/^-?\d{1,4}$/.test(String(s).trim()) ? +s : null);
  function inRange(ev, r) {
    const lo = num(r[0]), hi = num(r[1]);
    if (lo == null && hi == null) return true;
    if (!ev || ev.y == null) return false;
    return (lo == null || ev.y >= lo) && (hi == null || ev.y <= hi);
  }
  function neighbours(id) {
    const r = byId[id]; if (!r) return new Set();
    const out = new Set([].concat(r.rel || [], r.mn || [], r.th || [], members[id] || [], bornIn[id] || []));
    out.delete(id);
    return out;
  }
  function relatedSet() {
    const one = neighbours(S.rel);
    if (S.steps === 1) return one;
    const two = new Set(one);
    one.forEach(x => { if (!byId[x] || byId[x].t !== "theme") neighbours(x).forEach(y => two.add(y)); });
    two.delete(S.rel);
    return two;
  }

  let wordScore = null;   // row number -> score, when words are searched
  function runWords() {
    const terms = parse(S.q);
    wordScore = null;
    if (!terms.length) return { terms, seen: new Set() };
    const seen = new Set(), score = new Map(), wantText = S.where.has("text") && vocab;
    const pos = terms.filter(t => !t.not), neg = terms.filter(t => t.not);
    const textSets = wantText ? terms.map(t => textHits(t, S, t.not ? null : seen)) : null;
    rows.forEach(r => {
      let s = 0;
      for (let k = 0; k < terms.length; k++) {
        const t = terms[k];
        const inName = S.where.has("name") && (termIn(t, r.fn, S) || termIn(t, r.fa, S));
        const inBib = S.where.has("bib") && termIn(t, r.fb, S);
        const inText = wantText && textSets[k].has(r.i);
        const hit = inName || inBib || inText;
        if (t.not ? hit : !hit) return;
        if (!t.not) s += (inName ? 10 : 0) + (inText ? 2 : 0) + (inBib ? 1 : 0);
      }
      if (pos.length || neg.length) score.set(r.i, s);
    });
    wordScore = score;
    return { terms, seen };
  }

  function filters() {
    const f = {};
    if (wordScore) f.q = r => wordScore.has(r.i);
    if (S.types.size) f.type = r => S.types.has(r.t);
    if (S.th.size) f.th = r => r.ths.some(t => S.th.has(t)) || S.th.has(r.id);
    if (S.occ.size) f.occ = r => S.occAll ? [...S.occ].every(o => (r.occ || []).includes(o)) : (r.occ || []).some(o => S.occ.has(o));
    if (S.sex) f.sex = r => r.sex === S.sex;
    if (S.altk.size) f.altk = r => (r.alt || []).some(a => S.altk.has("any") || S.altk.has(a[1]));
    if (S.by[0] || S.by[1]) f.by = r => inRange(r.b, S.by);
    if (S.dy[0] || S.dy[1]) f.dy = r => inRange(r.d, S.dy);
    const alive = num(S.alive);
    if (alive != null) f.alive = r => r.b && r.b.y <= alive && (!r.d || r.d.y == null || r.d.y >= alive);
    if (S.bp.trim()) { const p = fold(S.bp); f.bp = r => !!(r.b && r.b.pl && (" " + fold(r.b.pl) + " ").includes(" " + p + " ")); }
    if (S.dp.trim()) { const p = fold(S.dp); f.dp = r => !!(r.d && r.d.pl && (" " + fold(r.d.pl) + " ").includes(" " + p + " ")); }
    if (S.au.size) f.au = r => (r.au || []).some(a => S.au.has(a));
    if (S.rel) { const set = relatedSet(); f.rel = r => set.has(r.id); }
    const ba = fold(S.ba), bt = fold(S.bt), blo = num(S.byr[0]), bhi = num(S.byr[1]);
    if (ba || bt || S.bk.size || blo != null || bhi != null)
      f.bib = r => (r.bib || []).some(b => (!ba || fold(b[1]).includes(ba)) && (!bt || bt.split(" ").every(w => fold(b[2]).split(" ").includes(w)))
        && (!S.bk.size || S.bk.has(b[0])) && (blo == null || (b[3] != null && b[3] >= blo)) && (bhi == null || (b[3] != null && b[3] <= bhi)));
    if (S.has.size) f.has = r => [...S.has].every(k => k === "bib" ? !!(r.bib && r.bib.length) || !!r.adb : !!r[k]);
    return f;
  }
  function apply(f, except) {
    const keys = Object.keys(f).filter(k => k !== except);
    return rows.filter(r => keys.every(k => f[k](r)));
  }
  function counts(base, values) {
    const c = {};
    base.forEach(r => values(r).forEach(v => { c[v] = (c[v] || 0) + 1; }));
    return c;
  }
  const uniq = a => [...new Set(a)];

  // ---- dates as the record knows them
  function when(ev) {
    if (!ev || ev.y == null) return "";
    let s = String(ev.y);
    if (ev.p === "month" && ev.m) s = MONTHS[ev.m - 1] + " " + s;
    if (ev.p === "day" && ev.m && ev.d) s = ev.d + " " + MONTHS[ev.m - 1] + " " + s;
    return (ev.c ? "c. " : "") + s;
  }
  function life(r) {
    if (!r.b && !r.d) return "";
    const b = r.b ? when(r.b) + (r.b.pl ? ", " + r.b.pl : "") : "", d = r.d ? when(r.d) + (r.d.pl ? ", " + r.d.pl : "") : "";
    return (b ? "Born " + b : "") + (b && d ? " · " : "") + (d ? "Died " + d : "");
  }

  // ---- snippets with the words that matched
  function snippet(raw, seen) {
    if (!raw) return "";
    if (!seen.size) return esc(raw.length > 240 ? raw.slice(0, 240).replace(/\s+\S*$/, "") + " …" : raw);
    const words = [...seen].sort((a, b) => b.length - a.length).map(w => w.split(" ").map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]+"));
    const re = new RegExp("(^|[^a-z0-9])(" + words.join("|") + ")(?![a-z0-9])", "g");
    const f = foldKeep(raw);
    if (f.length !== raw.length) return esc(raw.slice(0, 240)) + " …";
    re.lastIndex = 0;
    const m = re.exec(f);
    if (!m) return esc(raw.length > 240 ? raw.slice(0, 240).replace(/\s+\S*$/, "") + " …" : raw);
    const at = m.index + m[1].length;
    let a = Math.max(0, at - 110), z = Math.min(raw.length, at + 170);
    if (a > 0) a = raw.indexOf(" ", a) + 1;
    if (z < raw.length) z = raw.lastIndexOf(" ", z);
    const part = raw.slice(a, z), fp = f.slice(a, z);
    let out = "", last = 0, k;
    re.lastIndex = 0;
    while ((k = re.exec(fp))) {
      const s = k.index + k[1].length, e = s + k[2].length;
      out += esc(part.slice(last, s)) + "<mark>" + esc(part.slice(s, e)) + "</mark>";
      last = e;
      if (re.lastIndex === k.index) re.lastIndex++;
    }
    return (a > 0 ? "… " : "") + out + esc(part.slice(last)) + (z < raw.length ? " …" : "");
  }

  // ---- the panel
  const main = () => $("#main");
  function pills(name, items, isOn, extra) {
    return `<div class="adv-pills" role="group" data-pills="${name}"${extra || ""}>` + items.map(([k, label, n]) =>
      `<button type="button" class="adv-pill" data-k="${esc(k)}" aria-pressed="${isOn(k)}"${n === 0 && !isOn(k) ? " disabled" : ""}>${esc(label)}${n != null ? ` <span class="n">${n.toLocaleString("en-AU")}</span>` : ""}</button>`).join("") + "</div>";
  }
  function chips(name, values, label) {
    return values.length ? `<div class="adv-chips" data-chips="${name}">` + values.map(v =>
      `<button type="button" class="adv-chip" data-k="${esc(v)}" title="Take this away">${esc(label ? label(v) : v)} <span aria-hidden="true">✕</span></button>`).join("") + "</div>" : "";
  }
  function sec(key, title, body, open, active) {
    return `<details class="adv-sec${active ? " is-active" : ""}" data-sec="${key}"${open || active ? " open" : ""}><summary>${esc(title)}</summary><div class="adv-body">${body}</div></details>`;
  }
  const yr = (id, v, label) => `<input type="text" inputmode="numeric" id="${id}" value="${esc(v)}" placeholder="${label}" aria-label="${label}" maxlength="4" size="5">`;

  function build() {
    main().innerHTML = `
      <h1>Advanced search</h1>
      <p class="adv-lede">Combine words with the people, places, themes, dates and references recorded in each entry. Each choice shows how many records it would leave. <a href="search.html">Simple search</a></p>
      <div class="adv-layout">
        <form class="adv-panel" id="adv-panel" role="search" aria-label="Advanced search" autocomplete="off" onsubmit="return false">
          <div class="adv-sec adv-words is-open">
            <label class="adv-label" for="adv-q">Words</label>
            <input type="search" id="adv-q" placeholder='e.g. Wren tote · "Little Bourke" · cricket*' value="${esc(S.q)}">
            <div class="adv-sub">Look in</div><div id="adv-where"></div>
            <div class="adv-sub">Match</div><div id="adv-match"></div>
            <label class="adv-check"><input type="checkbox" id="adv-tol"${S.tol ? " checked" : ""}> Spelling tolerance</label>
            <p class="adv-help">Leave out a word with a minus: <i>gold -rush</i>.</p>
          </div>
          <div id="adv-facets"></div>
          <p><button type="button" class="adv-reset" id="adv-reset">Clear the search</button></p>
          <datalist id="dl-occ"></datalist><datalist id="dl-place"></datalist><datalist id="dl-author"></datalist><datalist id="dl-rec"></datalist>
        </form>
        <section class="adv-results" aria-live="polite">
          <div class="adv-summary" id="adv-summary"></div>
          <div class="adv-tools"><span id="adv-count"></span>
            <label>Sort <select id="adv-sort"><option value="">Best match</option><option value="name">Name</option><option value="born">Year of birth</option><option value="died">Year of death</option></select></label>
            <button type="button" class="adv-csv" id="adv-csv">Download CSV</button></div>
          <ol class="results adv-list" id="adv-list"></ol>
          <p><button type="button" class="adv-more" id="adv-more" hidden>Show more</button></p>
        </section>
      </div>`;
    // datalists: occupations, places, authors and records, filled once
    const occ = counts(rows, r => r.occ || []), pl = counts(rows, r => [r.b && r.b.pl, r.d && r.d.pl].filter(Boolean));
    const au = counts(rows, r => r.au || []);
    const opts = c => Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)).map(k => `<option value="${esc(k)}">`).join("");
    $("#dl-occ").innerHTML = opts(occ); $("#dl-place").innerHTML = opts(pl); $("#dl-author").innerHTML = opts(au);
    $("#dl-rec").innerHTML = rows.slice().sort((a, b) => a.sk.localeCompare(b.sk)).map(r => `<option value="${esc(r.n)} (${TYPE_ONE[r.t] || r.t})">`).join("");
    $("#adv-sort").value = S.sort;
    wire();
  }

  function drawFacets(f) {
    const cnt = (key, values) => counts(apply(f, key), values);
    const tc = cnt("type", r => [r.t]);
    const thc = cnt("th", r => uniq(r.ths.concat(r.t === "theme" ? [r.id] : [])));
    const oc = cnt("occ", r => r.occ || []);
    const sc = cnt("sex", r => r.sex ? [r.sex] : []);
    const ac = cnt("altk", r => uniq((r.alt || []).map(a => a[1]).concat(r.alt ? ["any"] : [])));
    const auc = cnt("au", r => r.au || []);
    const bkc = cnt("bib", r => uniq((r.bib || []).map(b => b[0])));
    const hc = cnt("has", r => HAS.map(h => h[0]).filter(k => k === "bib" ? (r.bib && r.bib.length) || r.adb : r[k]));
    const peopleOn = S.occ.size || S.sex || S.altk.size || S.by.join("") || S.dy.join("") || S.alive || S.bp || S.dp;
    const bibOn = S.ba || S.bt || S.bk.size || S.byr.join("");

    const topOcc = Object.keys(oc).filter(k => !S.occ.has(k)).sort((a, b) => oc[b] - oc[a] || a.localeCompare(b)).slice(0, 12);
    const altKinds = Object.keys(ac).filter(k => k !== "any").sort((a, b) => ac[b] - ac[a]);
    const topAu = Object.keys(auc).filter(k => !S.au.has(k)).sort((a, b) => auc[b] - auc[a] || a.localeCompare(b)).slice(0, 8);
    const relRow = byId[S.rel];

    $("#adv-facets").innerHTML =
      sec("type", "Type of record", pills("type", TYPES.map(([k, l]) => [k, l, tc[k] || 0]), k => S.types.has(k)), true, S.types.size) +
      sec("th", "Theme", pills("th", themes.map(t => [t.id, t.name, thc[t.id] || 0]), k => S.th.has(k), ' data-cols="1"'), false, S.th.size) +
      sec("people", "People", `
        <div class="adv-sub">Born</div><div class="adv-range">${yr("by0", S.by[0], "from")}<span>to</span>${yr("by1", S.by[1], "to")}</div>
        <div class="adv-sub">Died</div><div class="adv-range">${yr("dy0", S.dy[0], "from")}<span>to</span>${yr("dy1", S.dy[1], "to")}</div>
        <div class="adv-sub">Alive in</div><div class="adv-range">${yr("alive", S.alive, "year")}</div>
        <label class="adv-sub" for="bp">Born in</label><input type="text" id="bp" list="dl-place" value="${esc(S.bp)}" placeholder="e.g. Dublin, Carlton">
        <label class="adv-sub" for="dp">Died in</label><input type="text" id="dp" list="dl-place" value="${esc(S.dp)}" placeholder="e.g. Kew">
        <label class="adv-sub" for="occ-in">Occupation</label><input type="text" id="occ-in" list="dl-occ" placeholder="e.g. architect">
        ${chips("occ", [...S.occ])}
        ${S.occ.size > 1 ? pills("occm", [["any", "Any of them"], ["all", "All of them"]], k => (k === "all") === S.occAll) : ""}
        ${pills("occ", topOcc.map(k => [k, k, oc[k]]), () => false)}
        <div class="adv-sub">Sex</div>${pills("sex", [["m", "Male", sc.m || 0], ["f", "Female", sc.f || 0]], k => S.sex === k)}
        <div class="adv-sub">Other names</div>${pills("altk", [["any", "Any other name", ac.any || 0]].concat(altKinds.map(k => [k, human(k), ac[k]])), k => S.altk.has(k))}`, false, peopleOn) +
      sec("au", "Author of the entry", `<input type="text" id="au-in" list="dl-author" placeholder="e.g. Andrew Brown-May" aria-label="Author">
        ${chips("au", [...S.au])}${pills("au", topAu.map(k => [k, k, auc[k]]), () => false)}`, false, S.au.size) +
      sec("rel", "Related to", `<input type="text" id="rel-in" list="dl-rec" placeholder="e.g. Carlton, John Wren" aria-label="Related to record">
        ${relRow ? chips("rel", [S.rel], id => byId[id].n) + pills("steps", [["1", "Directly linked"], ["2", "Up to two links away"]], k => +k === S.steps) : ""}
        <p class="adv-help">Records linked to it either way: related entries, its themes, people born or died there, and people named in its text.</p>`, false, S.rel) +
      sec("bib", "References", `
        <label class="adv-sub" for="ba">Cited author</label><input type="text" id="ba" value="${esc(S.ba)}" placeholder="e.g. Davison">
        <label class="adv-sub" for="bt">Title words</label><input type="text" id="bt" value="${esc(S.bt)}" placeholder="e.g. marvellous Melbourne">
        <div class="adv-sub">Published</div><div class="adv-range">${yr("byr0", S.byr[0], "from")}<span>to</span>${yr("byr1", S.byr[1], "to")}</div>
        <div class="adv-sub">Kind</div>${pills("bk", Object.keys(bkc).sort((a, b) => bkc[b] - bkc[a]).map(k => [k, BIB_KINDS[k] || human(k), bkc[k]]), k => S.bk.has(k))}`, false, bibOn) +
      sec("has", "Has", pills("has", HAS.map(([k, l]) => [k, l, hc[k] || 0]), k => S.has.has(k)), false, S.has.size);

    $("#adv-where").innerHTML = pills("where", WHERE.map(([k, l]) => [k, l]), k => S.where.has(k));
    $("#adv-match").innerHTML = pills("match", [["whole", "Whole words"], ["part", "Parts of words"]], k => S.match === k);
  }

  function summary() {
    const bits = [];
    const add = (label, key, v) => bits.push(`<button type="button" class="adv-chip" data-clear="${key}" data-v="${esc(v || "")}" title="Take this away">${esc(label)} <span aria-hidden="true">✕</span></button>`);
    if (S.q.trim()) add("“" + S.q.trim() + "”", "q");
    S.types.forEach(t => add((TYPES.find(x => x[0] === t) || [t, t])[1], "types", t));
    S.th.forEach(t => add(themeName[t] || t, "th", t));
    const rg = (r, w) => (r[0] && r[1] ? `${w} ${r[0]}–${r[1]}` : r[0] ? `${w} ${r[0]} or later` : `${w} by ${r[1]}`);
    if (S.by.join("")) add(rg(S.by, "Born"), "by");
    if (S.dy.join("")) add(rg(S.dy, "Died"), "dy");
    if (S.alive) add("Alive in " + S.alive, "alive");
    if (S.bp.trim()) add("Born in " + S.bp, "bp");
    if (S.dp.trim()) add("Died in " + S.dp, "dp");
    S.occ.forEach(o => add(o, "occ", o));
    if (S.sex) add(S.sex === "m" ? "Male" : "Female", "sex");
    S.altk.forEach(k => add(k === "any" ? "Has another name" : human(k), "altk", k));
    S.au.forEach(a => add("By " + a, "au", a));
    if (S.rel && byId[S.rel]) add("Related to " + byId[S.rel].n, "rel");
    if (S.ba.trim()) add("Cites " + S.ba, "ba");
    if (S.bt.trim()) add("Reference title: " + S.bt, "bt");
    S.bk.forEach(k => add(BIB_KINDS[k] || human(k), "bk", k));
    if (S.byr.join("")) add(rg(S.byr, "Published"), "byr");
    S.has.forEach(k => add("Has " + HAS.find(h => h[0] === k)[1].toLowerCase(), "has", k));
    $("#adv-summary").innerHTML = bits.join("");
  }

  let current = [], lastSeen = new Set();
  function run() {
    const needText = S.q.trim() && S.where.has("text") && !vocab;
    if (needText) {
      $("#adv-count").textContent = "Loading the article text for the search…";
      loadText().then(run, () => { S.where.delete("text"); run(); });
      return;
    }
    const { seen } = runWords();
    lastSeen = seen;
    const f = filters();
    current = apply(f);
    const by = (k, dir) => (a, b) => {
      const x = a[k] && a[k].y, y = b[k] && b[k].y;
      if (x == null && y == null) return a.sk.localeCompare(b.sk);
      if (x == null) return 1; if (y == null) return -1;
      return (x - y) * dir || a.sk.localeCompare(b.sk);
    };
    const sorts = { name: (a, b) => a.sk.localeCompare(b.sk), born: by("b", 1), died: by("d", 1) };
    current.sort(sorts[S.sort] || (wordScore ? (a, b) => wordScore.get(b.i) - wordScore.get(a.i) || a.sk.localeCompare(b.sk) : sorts.name));
    drawFacets(f);
    summary();
    draw();
    writeAddress();
  }
  function draw() {
    const anything = Object.keys(filters()).length > 0;
    $("#adv-count").textContent = anything ? plural(current.length, "record", "records") : "All " + plural(rows.length, "record", "records") + ". Choose words or filters to narrow them.";
    $("#adv-list").innerHTML = current.slice(0, S.shown).map(r => {
      const x = text && text[r.id];
      const img = x && x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : "";
      const meta = [TYPE_ONE[r.t] || r.t];
      if (r.occ) meta.push(r.occ.join(", "));
      const l = life(r);
      const th = r.ths.map(t => themeName[t]).filter(Boolean);
      // the ADB stub ("View the full biographical record…") says nothing about the person
      const sn = x && !/^View the full biographical record/.test(x.text) ? snippet(x.text, lastSeen) : "";
      const alt = (r.alt || []).length ? `<p class="adv-alt">Also known as ${r.alt.map(a => esc(a[0])).join(", ")}</p>` : "";
      const linked = (r.mn || []).filter(id => byId[id]), more = linked.length > 6 ? ` and ${linked.length - 6} more` : "";
      const mn = linked.length ? `<p class="adv-themes">${r.t === "person" ? "Named in" : "Names"} ${linked.slice(0, 6).map(id => `<a href="entry.html?id=${id}">${esc(byId[id].n)}</a>`).join(", ")}${more}</p>` : "";
      return `<li>${img}<div class="r-head"><a href="entry.html?id=${r.id}">${esc(r.n)}</a><span class="r-type">${esc(meta.join(" · "))}${r.au ? " · by " + esc(r.au.join(", ")) : ""}</span></div>
        ${l ? `<p class="adv-life">${esc(l)}</p>` : ""}${alt}${sn ? `<p>${sn}</p>` : ""}${mn}${th.length ? `<p class="adv-themes">${r.th ? "" : "Named in entries on "}${th.map(esc).join(" · ")}</p>` : ""}</li>`;
    }).join("");
    $("#adv-more").hidden = current.length <= S.shown;
    $("#adv-more").textContent = "Show more (" + Math.min(PAGE, current.length - S.shown) + " of " + (current.length - S.shown).toLocaleString("en-AU") + " left)";
  }

  // ---- events
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { S.shown = PAGE; run(); }, 220); };
  const now = () => { clearTimeout(timer); S.shown = PAGE; run(); };
  const toggle = (set, k) => { if (set.has(k)) set.delete(k); else set.add(k); };
  function recordFrom(v) {
    const m = v.match(/^(.*) \(([^)]+)\)$/);
    const name = m ? m[1] : v, type = m ? m[2] : null;
    return rows.find(r => r.n === name && (!type || TYPE_ONE[r.t] === type)) || rows.find(r => fold(r.n) === fold(name));
  }
  function wire() {
    const panel = $("#adv-panel");
    $("#adv-q").addEventListener("input", e => { S.q = e.target.value; later(); });
    $("#adv-tol").addEventListener("change", e => { S.tol = e.target.checked; now(); });
    panel.addEventListener("click", e => {
      const b = e.target.closest("button[data-k]"); if (!b) return;
      const g = b.closest("[data-pills],[data-chips]"); if (!g) return;
      const name = g.dataset.pills || g.dataset.chips, k = b.dataset.k;
      if (g.dataset.chips) {
        if (name === "occ") S.occ.delete(k); else if (name === "au") S.au.delete(k); else if (name === "rel") S.rel = "";
        return now();
      }
      switch (name) {
        case "where": if (!(S.where.has(k) && S.where.size === 1)) toggle(S.where, k); break;
        case "match": S.match = k; break;
        case "type": toggle(S.types, k); break;
        case "th": toggle(S.th, k); break;
        case "occ": toggle(S.occ, k); break;
        case "occm": S.occAll = k === "all"; break;
        case "sex": S.sex = S.sex === k ? "" : k; break;
        case "altk": toggle(S.altk, k); break;
        case "au": toggle(S.au, k); break;
        case "steps": S.steps = +k; break;
        case "bk": toggle(S.bk, k); break;
        case "has": toggle(S.has, k); break;
      }
      now();
      const again = $(`[data-pills="${name}"] [data-k="${CSS.escape(k)}"]`); if (again) again.focus();
    });
    // typed boxes: years, places, reference words (redrawn panel keeps the focus)
    const typed = { by0: v => (S.by[0] = v), by1: v => (S.by[1] = v), dy0: v => (S.dy[0] = v), dy1: v => (S.dy[1] = v),
      alive: v => (S.alive = v), bp: v => (S.bp = v), dp: v => (S.dp = v), ba: v => (S.ba = v), bt: v => (S.bt = v),
      byr0: v => (S.byr[0] = v), byr1: v => (S.byr[1] = v) };
    panel.addEventListener("input", e => {
      const id = e.target.id;
      if (typed[id]) { typed[id](e.target.value); later(); }
    });
    // choosing from a list: occupation, author, record
    panel.addEventListener("change", e => {
      const id = e.target.id, v = e.target.value.trim(); if (!v) return;
      if (id === "occ-in" && rows.some(r => (r.occ || []).includes(v))) { S.occ.add(v); now(); }
      else if (id === "au-in" && rows.some(r => (r.au || []).includes(v))) { S.au.add(v); now(); }
      else if (id === "rel-in") { const r = recordFrom(v); if (r) { S.rel = r.id; now(); } }
    });
    $("#adv-summary").addEventListener("click", e => {
      const b = e.target.closest("[data-clear]"); if (!b) return;
      const k = b.dataset.clear, v = b.dataset.v;
      if (S[k] instanceof Set) S[k].delete(v);
      else if (Array.isArray(S[k])) S[k] = ["", ""];
      else S[k] = "";
      if (k === "q") $("#adv-q").value = "";
      now();
    });
    $("#adv-reset").addEventListener("click", () => { blank(); $("#adv-q").value = ""; $("#adv-tol").checked = false; $("#adv-sort").value = ""; now(); });
    $("#adv-sort").addEventListener("change", e => { S.sort = e.target.value; now(); });
    $("#adv-more").addEventListener("click", () => { S.shown += PAGE; draw(); });
    $("#adv-csv").addEventListener("click", csv);
  }
  // keep the cursor where it was when the panel is redrawn
  const redraw = drawFacets;
  drawFacets = function (f) {
    const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
    redraw(f);
    if (id && id !== "adv-q") { const el = document.getElementById(id); if (el && el !== a) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { /* not text */ } } }
  };

  function csv() {
    const q = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const base = location.href.replace(/advanced\.html.*$/, "");
    const lines = [["id", "type", "name", "born", "birthplace", "died", "deathplace", "occupations", "other names", "themes", "authors", "url"].join(",")];
    current.forEach(r => lines.push([r.id, TYPE_ONE[r.t] || r.t, r.n, when(r.b), r.b && r.b.pl, when(r.d), r.d && r.d.pl, (r.occ || []).join("; "),
      (r.alt || []).map(a => a[0]).join("; "), (r.th || []).map(t => themeName[t]).join("; "), (r.au || []).join("; "), base + "entry.html?id=" + r.id].map(q).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "emelbourne-search.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function start() {
    document.title = "Advanced search – eMelbourne";
    readAddress();
    Promise.all([TEI.data("facets", "data/facets.js"), TEI.data("nav", "data/nav.js")]).then(([facets, nav]) => {
      prepare(facets, nav);
      build();
      run();
      // the article text, for snippets and pictures, once the page is up
      if (!text) setTimeout(() => loadText().then(() => { if (!S.q.trim() || !S.where.has("text")) draw(); else run(); }), 400);
    }).catch(err => { main().innerHTML = "<h1>Advanced search</h1><p>The search index (data/facets.js) could not be loaded. " + esc(err.message) + "</p>"; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

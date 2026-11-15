/* Shared by the experiment pages: loads data/facets.js (and nav.js) with script tags,
 * so the pages work from file:// as well as on any host. No libraries. */
(function () {
  "use strict";
  const store = {};
  window.EMEL = { loaded: (k, v) => { store[k] = v; } };   // data files call EMEL.loaded(key, value)
  function load(key, src) {
    if (store[key]) return Promise.resolve(store[key]);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.charset = "utf-8";
      s.onload = () => (store[key] ? res(store[key]) : rej(new Error(src + " did not load")));
      s.onerror = () => rej(new Error("missing " + src));
      document.head.appendChild(s);
    });
  }

  // Occupation groups: 608 occupations in the TEI, folded into eight groups by keyword.
  // A person goes in the group of the first of their occupations that matches.
  const GROUPS = [
    ["politics", "Politics & government", /politic|premier|prime minister|governor|mayor|public servant|administrator|diplomat|councillor|parliament|statesman|colonial secretary|treasurer|speaker|official/],
    ["law", "Law & justice", /judge|lawyer|barrister|solicitor|magistrate|jurist|police|attorney|chief justice|crown prosecutor/],
    ["business", "Business & the land", /business|merchant|manufactur|company|banker|retail|publican|brewer|financier|industrialist|accountant|pastoral|grazier|farmer|squatter|landowner|vigneron|trader|shipowner|builder|contractor|auctioneer|hotel|importer|investor|entrepreneur|storekeeper|draper/],
    ["arts", "Arts, letters & media", /artist|painter|sculptor|poet|writer|author|novelist|musician|composer|actor|actress|singer|photographer|critic|journalist|newspaper|editor|publisher|broadcaster|theatr|dancer|illustrator|cartoonist|historian|librarian|engraver|designer/],
    ["science", "Medicine & science", /surgeon|physician|medical|doctor|nurse|scientist|botanist|chemist|geologist|astronomer|naturalist|pharmac|dentist|zoologist|psychiatrist|bacteriologist|pathologist|meteorologist|physicist|anatomist/],
    ["building", "Architecture & engineering", /architect|engineer|surveyor|town planner|inventor/],
    ["church", "Religion & education", /clergy|bishop|priest|minister of religion|archbishop|educationist|teacher|headmaster|headmistress|academic|professor|scholar|nun|missionary|cleric|vice-chancellor|lecturer|rabbi/],
    ["service", "Military, sport & reform", /soldier|army|naval|navy|air force|general|military|cricketer|footballer|sport|jockey|athlete|boxer|swimmer|rower|tennis|golfer|trade unionist|unionist|philanthropist|reformer|feminist|activist|social worker|charity|welfare/]
  ];
  function group(occs) {
    for (const o of occs || []) {
      const s = o.toLowerCase();
      for (const g of GROUPS) if (g[2].test(s)) return g[0];
    }
    return "other";
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Object dates are display strings: "29 May 1977", "December 1970 – December 1970", "1895 – 1915".
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  function parseDate(s) {
    if (!s) return null;
    const one = t => {
      let m = t.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
      if (m && MONTHS.includes(m[2].toLowerCase())) return { y: +m[3], m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: +m[1], p: "day" };
      m = t.match(/^([A-Za-z]+) (\d{4})$/);
      if (m && MONTHS.includes(m[1].toLowerCase())) return { y: +m[2], m: MONTHS.indexOf(m[1].toLowerCase()) + 1, p: "month" };
      m = t.match(/^(\d{4})$/);
      return m ? { y: +m[1], p: "year" } : null;
    };
    const parts = String(s).split(/\s+[–-]\s+/).map(x => one(x.trim()));
    if (!parts[0]) return null;
    const out = parts[0];
    if (parts[1] && (parts[1].y !== out.y || parts[1].m !== out.m || parts[1].d !== out.d)) { out.to = parts[1].y; if (out.p === "day") out.p = "range"; else out.p = out.to === out.y ? out.p : "range"; }
    return out;
  }

  window.Exp = {
    load, esc, group, parseDate, MONTHS: MONTHS.map(m => m[0].toUpperCase() + m.slice(1)),
    objects: () => load("objects", "../data/objects.js"),
    object: id => "../object.html?id=" + id,
    GROUPS: GROUPS.map(g => [g[0], g[1]]).concat([["other", "Other or not recorded"]]),
    facets: () => load("facets", "../data/facets.js"),
    nav: () => load("nav", "../data/nav.js"),
    entry: id => "../entry.html?id=" + id
  };
})();

/* Shared by the map experiments: a pan-and-zoom SVG map of Melbourne and Victoria drawn from
 * data/basemap.js (simplified Vicmap outlines, built by tools/geocode.py basemap). Plain d3, no tiles,
 * so it works offline and from file://. Coordinates are [lat, long]; extents are [west, south, east, north]. */
(function () {
  "use strict";
  const COS = Math.cos(37.8 * Math.PI / 180);           // flattening for Melbourne's latitude
  const X = lon => lon * COS, Y = lat => -lat;
  const Maps = {
    METRO: [144.55, -38.2, 145.55, -37.5],
    CITY: [144.947, -37.8255, 144.977, -37.803],
    VIC: [140.9, -39.2, 150.0, -33.95],
    around: (ll, d) => [ll[1] - d / COS, ll[0] - d, ll[1] + d / COS, ll[0] + d],
    basemap: () => Exp.load("basemap", "../data/basemap.js"),

    make(holder, base, opts) {
      const W = Math.max(320, holder.clientWidth - 16), H = Math.round(Math.min(680, Math.max(360, W * 0.72)));
      const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "map-svg")
        .attr("role", "img").attr("aria-label", opts.label || "Map of Melbourne; the list under it gives the same information");
      const root = svg.append("g");
      // planar coordinates -> pixels at zoom 1, fitted to the starting extent
      const fit = e => { const s = Math.min(W / (X(e[2]) - X(e[0])), H / (Y(e[1]) - Y(e[3]))); return s; };
      const e0 = opts.extent, s0 = fit(e0);
      const cx = (X(e0[0]) + X(e0[2])) / 2, cy = (Y(e0[1]) + Y(e0[3])) / 2;
      const px = lon => (X(lon) - cx) * s0 + W / 2, py = lat => (Y(lat) - cy) * s0 + H / 2;
      const ring = r => "M" + r.map(p => px(p[0]).toFixed(1) + "," + py(p[1]).toFixed(1)).join("L") + "Z";
      const line = l => "M" + l.map(p => px(p[0]).toFixed(2) + "," + py(p[1]).toFixed(2)).join("L");
      root.append("g").attr("class", "map-land").selectAll("path").data(base.vic).join("path").attr("d", ring);
      root.append("g").attr("class", "map-loc").selectAll("path").data(base.loc).join("path")
        .attr("d", d => d.r.map(ring).join("")).append("title").text(d => d.n);
      if (opts.grid) root.append("g").attr("class", "map-grid").selectAll("path").data(base.grid).join("path").attr("d", d => line(d.l));
      const labels = root.append("g").attr("class", "map-labels");
      const layer = root.append("g");
      const tip = d3.select(holder).append("div").attr("class", "exp-tip").style("display", "none");
      holder.replaceChildren(svg.node(), tip.node());

      let k = 1, hooks = [];
      const zoom = d3.zoom().scaleExtent([0.08, 400]).on("zoom", ev => {
        k = ev.transform.k; root.attr("transform", ev.transform); drawLabels(); hooks.forEach(f => f(k));
      });
      svg.call(zoom).on("dblclick.zoom", null);
      function drawLabels() {   // suburb names once zoomed in enough to read them
        const show = k > (opts.labelsAt || 6) ? base.loc : [];
        labels.selectAll("text").data(show, d => d.n).join("text").attr("x", d => px(d.c[0])).attr("y", d => py(d.c[1]))
          .style("font-size", (11 / k) + "px").attr("text-anchor", "middle").text(d => d.n);
      }
      const api = {
        svg, layer, W, H,
        x: ll => px(ll[1]), y: ll => py(ll[0]), k: () => k,
        onzoom: f => hooks.push(f),
        zoomTo(e, ms) {
          const s = fit(e) / s0, mx = (px(e[0]) + px(e[2])) / 2, my = (py(e[1]) + py(e[3])) / 2;
          svg.transition().duration(ms ?? 600).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-mx, -my));
        },
        tip(ev, html) {
          if (!ev) { tip.style("display", "none"); return; }
          const b = holder.getBoundingClientRect();
          tip.html(html).style("display", null);
          const tw = tip.node().offsetWidth, x = ev.clientX - b.left + 12;
          tip.style("left", Math.min(x, b.width - tw - 8) + "px").style("top", (ev.clientY - b.top + 12) + "px");
        }
      };
      return api;
    }
  };
  window.Maps = Maps;
})();

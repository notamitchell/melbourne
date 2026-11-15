"""Add PROV catalogue links (enrichments/prov-links.csv, status=matched) to
  - site/data/objects.js: prov.citation and prov.url for each matched object
  - site/tei/pages/*.xml: after each <ref target="ohrm:Dxxxxxxxx"> entry's <item>, a link
    <ref type="source" target="https://prov.vic.gov.au/archive/...">PROV VPRS ...</ref>
Safe to re-run: links already present are left alone. Then run tools/build_index.py.
Usage: python3 tools/apply_prov_links.py [site]"""
import csv, json, os, re, sys
from xml.sax.saxutils import escape, quoteattr
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
site = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'site')
links = {r['doid']: r for r in csv.DictReader(open(os.path.join(root, 'enrichments', 'prov-links.csv'), encoding='utf-8'))
         if r['status'] == 'matched'}

p = os.path.join(site, 'data', 'objects.js')
s = open(p, encoding='utf-8').read()
a, b = s.index('{'), s.rindex('}') + 1
objs = json.loads(s[a:b])
n_obj = 0
for k, r in links.items():
    o = objs.get(k)
    if o and 'prov' in o:
        if o['prov'].get('url') != r['prov_url']: n_obj += 1
        o['prov'].update(citation=r['prov_citation'], url=r['prov_url'])
open(p, 'w', encoding='utf-8').write(s[:a] + json.dumps(objs, ensure_ascii=False, separators=(',', ':')) + s[b:])

# <label><ref target="ohrm:D…">…</ref></label><item>…</item>
pat = re.compile(r'(<label><ref target="ohrm:(D\d{8})">.*?</ref></label><item>)(.*?)(</item>)', re.S)
n_tei, pages = 0, set()
d = os.path.join(site, 'tei', 'pages')
for f in sorted(os.listdir(d)):
    if not f.endswith('.xml'): continue
    fp = os.path.join(d, f); x = open(fp, encoding='utf-8').read()
    def sub(m):
        global n_tei
        r = links.get(m[2])
        if not r or 'prov.vic.gov.au/archive/' in m[3]: return m[0]
        n_tei += 1; pages.add(f)
        return '%s%s <ref type="source" target=%s>PROV %s</ref>%s' % (
            m[1], m[3], quoteattr(r['prov_url']), escape(r['prov_citation']), m[4])
    y = pat.sub(sub, x)
    if y != x: open(fp, 'w', encoding='utf-8').write(y)
print('objects.js: %d objects linked; TEI: %d links added in %d pages' % (n_obj, n_tei, len(pages)))

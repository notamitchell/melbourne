"""Match Everyday War letters (data/objects.js 'prov' refs) to PROV catalogue records.
File citations in PROV are 'VPRS 3183/P0001, YY/NNNN'; YY comes from the letter's date.
Usage: python3 prov_links.py site/data/objects.js out.csv"""
import json, re, sys, csv, urllib.request, urllib.parse, time
s = open(sys.argv[1], encoding='utf-8').read()
d = json.loads(s[s.index('{'):s.rindex('}') + 1])
def q(query):
    u = 'https://api.prov.vic.gov.au/search/query?' + urllib.parse.urlencode(
        {'wt': 'json', 'rows': 5, 'fl': '_id,citation,title,iiif-manifest', 'q': query})
    for i in range(3):
        try: return json.load(urllib.request.urlopen(u, timeout=30))['response']['docs']
        except Exception: time.sleep(2 * (i + 1))
    return None
w = csv.writer(open(sys.argv[2], 'w', newline='', encoding='utf-8'))
w.writerow(['doid', 'ref', 'date', 'prov_citation', 'prov_id', 'prov_url', 'digitised', 'status'])
for k, v in d.items():
    p = v.get('prov')
    if not p: continue
    m = re.search(r'VPRS (\d+)/P/?(\d+), unit (\d+)(?:, file (\w+))?', p['ref'])
    yr = re.search(r'(\d{4})\s*$', p.get('date') or v.get('date') or '')
    if not (m and m[4] and yr):
        w.writerow([k, p['ref'], p.get('date', ''), '', '', '', '', 'no file number']); continue
    cit = 'VPRS %s/P%04d, %s/%s' % (m[1], int(m[2]), yr[1][2:], m[4])
    docs = q('citation:"%s"' % cit)
    if docs is None: st, r = 'lookup failed', None
    else: r = docs[0] if len(docs) == 1 else None; st = 'matched' if r else ('ambiguous' if docs else 'not found')
    w.writerow([k, p['ref'], p.get('date', ''), cit, r and r['_id'] or '',
                r and 'https://prov.vic.gov.au/archive/' + r['_id'] or '', 'yes' if r and r.get('iiif-manifest') else 'no', st])

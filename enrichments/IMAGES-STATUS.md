# Embedding images from GLAM sources: where things stand (paused 15 Nov 2026)

The site has not been changed. Images are still served from site/objects/ as before.

## What each source holds
- **PROV**: the Everyday War letters (VPRS 3183/P0000 and P0001) are not digitised online. PROV's API lists
  0 digitised items in those consignments; only P0002 (1920s) has images. `enrichments/prov-links.csv`
  matches each letter to its PROV catalogue record. The PROV citation is "VPRS 3183/P0001, YY/NNNN",
  where YY is the year of the letter's date. The table is built by `tools/prov_links.py`. Nothing has been
  written into the site yet.
- **SLV**: the Primo catalogue at find.slv.vic.gov.au matches our image numbers (a10633 finds the right record).
  Lookups need the catalogue's anonymous guest token, and this environment's safety check wanted the owner's
  explicit approval first. 12 objects also carry old SLV Voyager docIds in `reference`.
- **City of Melbourne**: citycollection.melbourne.vic.gov.au redirects to a maintenance notice. Open data
  (public-memorials-and-sculptures, outdoor-artworks) has no images.
- **UoM Digitised Collections**: a bot wall (Imperva) blocks scripted API access.
- **Old site**: www.emelbourne.net.au is still live and shows the objects we're missing. It is not on the allowed domains.

## Next steps when resumed
1. With the old site allowed and SLV lookups approved, resolve SLV records to IIIF URLs.
2. Write `graphic url` (external) plus a source link into the TEI galleries and objects.js, keeping the local file as a fallback.
3. Validate with tools/validate.sh and test via file://.

# Leftovers from the OHRM import (for content tidy-up)

Written from the eMelbourne OHRM database (figshare doi:10.26188/23983911.v1). Nothing in tei/ was changed.

- `unmapped-tags.csv`: HTML in entry texts that the converter had no TEI mapping for. Only one is left:
  an `<h3>Climate by Months</h3>` heading in EM00360 (Climate), whose text is kept as plain text.
  Site pages are not listed, because their h2–h4 headings become TEI headings and their div wrappers are layout only.
- `unlinked-bibliography.csv`: all 31 publications that no entry cites, with every field. The 23 listed first are linked
  to nothing at all. The last 8 are linked only to other resources (`related_resources` column).
- `unlinked-digital-objects.csv`: the 8 digital objects that no entry uses, with every field plus their file versions.
- `unlinked-archival-records.csv`: the 61 archival records that no entry links to, with every field plus the repository name.
- `object-archives.csv`: doid, arcid for each of the 1,477 digital objects that name an archival record.
- `archival-records.csv`: every archival record (arcid, repository name, title, reference, reference link, level),
  plus `ispartof`, the parent record's arcid from the OHRM isPartOf relation (child isPartOf parent).

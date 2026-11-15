"""Regenerate schema/emelbourne.rng from schema/emelbourne.odd with the TEI Stylesheets
(odd2odd.xsl, then odd2relax.xsl), run in Saxon HE through its Python package.

  pip install saxonche
  git clone --depth 1 --branch v7.61.0 https://github.com/TEIC/Stylesheets tei-xsl
  python3 tools/build_schema.py tei-xsl

The TEI source is the p5subset.xml bundled with the Stylesheets (v7.61.0 ships P5 4.12.0).
Then run tools/validate.sh."""
import os, sys
from saxonche import PySaxonProcessor

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
xsl = os.path.abspath(sys.argv[1])
odd = os.path.join(root, "schema", "emelbourne.odd")
out = os.path.join(root, "schema", "emelbourne.rng")
compiled = os.path.join(os.path.dirname(xsl), "emelbourne.compiled.odd")   # intermediate, kept outside the site
with PySaxonProcessor(license=False) as p:
    x = p.new_xslt30_processor()
    t = x.compile_stylesheet(stylesheet_file=os.path.join(xsl, "odds", "odd2odd.xsl"))
    t.set_parameter("defaultSource", p.make_string_value("file://" + os.path.join(xsl, "source", "p5subset.xml")))
    t.set_parameter("selectedSchema", p.make_string_value("emelbourne"))
    t.transform_to_file(source_file=odd, output_file=compiled)
    t = x.compile_stylesheet(stylesheet_file=os.path.join(xsl, "odds", "odd2relax.xsl"))
    t.transform_to_file(source_file=compiled, output_file=out)
print("wrote", out, os.path.getsize(out), "bytes")

#!/bin/sh
# Check every TEI file against the eMelbourne schema.
# Needs Java and jing; the simplest way to get jing is: pip install jingtrang
# Usage: tools/validate.sh [site-folder]   (default: site)
SITE="${1:-site}"
DIR="$(dirname "$0")/.."
find "$SITE/tei" -name '*.xml' -print0 | xargs -0 pyjing "$DIR/schema/emelbourne.rng" && echo "All TEI files are valid."  # jing reports problems as "error" or "fatal" (not well-formed)

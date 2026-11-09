"""`python3 -P -m amauta.extras.wiki_explain list|write ...`: the CLI the amauta-wiki-explain skill runs."""
import sys

from .wikiexplain import main

sys.exit(main())

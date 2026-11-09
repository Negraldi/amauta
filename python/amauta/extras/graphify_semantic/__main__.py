"""`python3 -P -m amauta.extras.graphify_semantic ...`: the CLI the graphify-semantic skill runs."""
import sys

from .semantic_plan import main

sys.exit(main())

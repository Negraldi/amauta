"""SQL for the per-session facts every page shows the same way (Today, Usage > Sessions, project and session pages).

Each fragment is a correlated subquery over the whole session (alias `u` must be the usage_messages row of that session),
so a date filter on the outer query never changes what a session is said to be."""
from __future__ import annotations

# The model with the most messages; ties go to the first name, like the session page's Models list (count, then name).
MAIN_MODEL = ("(SELECT coalesce(m.model, 'unknown') FROM usage_messages m WHERE m.session_id = u.session_id "
              "GROUP BY coalesce(m.model, 'unknown') ORDER BY count(*) DESC, 1 LIMIT 1)")
# How many models answered in the session ("claude-opus-5-5 +1" when it is 2).
MODEL_COUNT = "(SELECT count(DISTINCT coalesce(m.model, 'unknown')) FROM usage_messages m WHERE m.session_id = u.session_id)"

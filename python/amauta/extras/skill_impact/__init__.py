"""Skill impact (extra): compares sessions that loaded a skill with sessions that did not, and keeps a per-skill change log.

Extension points: `home.impact` (the Home rail ranking) and `skill.impact` (the block on a skill page).
"""
from . import skillhist, skillimpact

POINTS = {
    "home.impact": skillimpact.ranking,
    "skill.impact": skillhist.block,
}

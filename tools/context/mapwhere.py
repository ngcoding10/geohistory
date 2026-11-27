"""Which state the map shows at a point in a year (the same rules as tools/audit.py: a state within 8 km wins
over open sea and over the pale sketch-map rows). Returns (territory name, power key, ruler) or None."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from geo import PolyIndex, near_index  # noqa: E402
import yearly  # noqa: E402

_cache = {}
NEAR_KM = 8.0


def where(lon, lat, y):
    if not yearly.source(y):
        return None
    key = yearly.map_key(y)
    if key not in _cache:
        if len(_cache) > 40:
            _cache.clear()
        pols = yearly.year_doc(y)
        _cache[key] = (PolyIndex([(i, p['g']) for i, p in enumerate(pols)]), pols)
    pi, pols = _cache[key]
    k = pi.lookup(lon, lat)
    if k is None or pols[k].get('u'):
        k2 = near_index(pi, lon, lat, NEAR_KM, accept=lambda i: not pols[i].get('u'))
        k = k2 if k2 is not None else k
    if k is None or pols[k].get('u'):
        return None
    p = pols[k]
    return p['n'], p['p'], p.get('s') or None

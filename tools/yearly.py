"""Yearly border maps: CShapes 2.0 for 1886-2019, Cliopatria for 3400 BC-1885 (stored at change years). One place to ask "which map
covers this year, and what is on it" for event placement, the audit and the ruled-by history."""
import os
from common import DATA, read_json

_R = {}


def ranges():
    if not _R:
        for src in ('cshapes', 'clio'):
            p = os.path.join(DATA, src, 'index.json')
            if os.path.exists(p):
                i = read_json(p)
                _R[src] = (i['from'], i['to'])
    return _R


def source(y):
    for src, (a, b) in ranges().items():
        if a <= y <= b:
            return src
    return None


def year_doc(y):
    """[{n, p, s, a, g}] for a year with a yearly map, else None."""
    src = source(y)
    if src == 'cshapes':
        import build_cshapes
        return build_cshapes.year_doc(y)
    if src == 'clio':
        import build_clio
        return build_clio.year_doc(y)
    return None


def map_key(y):
    """A key that is the same for every year sharing one stored map (Cliopatria stores change years only)."""
    src = source(y)
    if src == 'clio':
        import build_clio
        return ('clio', build_clio.stored_year(y, build_clio._cache()[2]))
    return (src, y) if src else None

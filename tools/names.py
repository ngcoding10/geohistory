"""Display names and aliases for territories (tools/curated/names.json), shared by the map builds, the
search index and the audit so that they agree on what a territory is called."""
import os
from common import TOOLS, read_json

_N = {}


def _load():
    if not _N:
        d = read_json(os.path.join(TOOLS, 'curated', 'names.json'))
        _N['r'], _N['a'] = d['rename'], d['aliases']
    return _N


def display(name):
    """The name shown in the app for a name as a map source spells it."""
    return _load()['r'].get(name, name) if name else name


def aliases(name):
    return _load()['a'].get(name, [])

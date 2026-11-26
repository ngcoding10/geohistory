"""Step 2e: curated territory changes before 1886, checked against Wikidata -> data/changes.json."""
import os
from common import TOOLS, DATA, read_json, write_json, log
from verify import wikidata_years, check


def main():
    ch = read_json(os.path.join(TOOLS, 'curated', 'territory_changes.json'))['changes']
    wd = wikidata_years([c['wiki'] for c in ch])
    out = []
    ok = 0
    for c in ch:
        v, note = check(c['y'], wd.get(c['wiki']))
        ok += v
        e = dict(c)
        e['verified'] = v
        e['check'] = note
        out.append(e)
    write_json(os.path.join(DATA, 'changes.json'), {'changes': out})
    log(f'territory changes: {len(out)}, {ok} verified against Wikidata')
    cen = read_json(os.path.join(TOOLS, 'curated', 'centuries.json'))['centuries']
    write_json(os.path.join(DATA, 'centuries.json'), {'centuries': cen})
    log(f'century summaries: {len(cen)} (narrative, unverified)')
    for e in out:
        if not e['verified']:
            log(f"  unverified: {e['y']} {e['wiki']}: {e['check']}")


if __name__ == '__main__':
    main()

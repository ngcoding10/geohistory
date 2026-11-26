"""Step 2d: who held each territory over time, from every border map (data/history/ruledby.json).

For each territory name: runs of consecutive maps with the same ruler, as
[first map year, last map year, ruler or "" when self-ruling, "m" (world snapshots), "q" (Cliopatria years)
or "c" (CShapes years)].
"""
import os
from common import DATA, TOOLS, read_json, write_json, log


def main():
    runs = {}

    def add(name, y, ruler, src):
        lst = runs.setdefault(name, [])
        if lst and lst[-1][2] == ruler and lst[-1][3] == src:
            lst[-1][1] = y
        else:
            lst.append([y, y, ruler, src])

    snaps = read_json(os.path.join(DATA, 'borders', 'index.json'))['snapshots']
    cs = read_json(os.path.join(DATA, 'cshapes', 'index.json'))
    clio = read_json(os.path.join(DATA, 'clio', 'index.json'))
    yearly = lambda y: cs['from'] <= y <= cs['to'] or clio['from'] <= y <= clio['to']
    seq = [('m', s['y']) for s in snaps if not yearly(s['y'])]
    seq += [('c', y) for y in range(cs['from'], cs['to'] + 1)] + [('q', y) for y in clio['years']]
    seq.sort(key=lambda x: x[1])
    for src, y in seq:
        if src == 'm':
            for p in read_json(os.path.join(DATA, 'borders', f'{y}.json'))['polities']:
                add(p['n'], y, p.get('s', ''), 'm')
        elif src == 'q':
            for r in read_json(os.path.join(DATA, 'clio', 'years', f'{y}.json'))['rows']:
                add(r[1], y, r[3] or '', 'm' if len(r) >= 5 else 'q')
        else:
            for r in read_json(os.path.join(DATA, 'cshapes', 'years', f'{y}.json'))['rows']:
                add(r[1], y, r[3] or '', 'c')
    # notes on known source errors and the alias table, for the territory panel
    notes = read_json(os.path.join(TOOLS, 'curated', 'map_notes.json'))['notes']
    al = read_json(os.path.join(TOOLS, 'curated', 'names.json'))['aliases']
    write_json(os.path.join(DATA, 'mapnotes.json'), {'notes': notes, 'aliases': {n: v for n, v in al.items() if n in runs}})
    size = write_json(os.path.join(DATA, 'history', 'ruledby.json'), runs)
    log(f'ruled-by history: {len(runs)} names, {size // 1024} KB')


if __name__ == '__main__':
    main()

"""Version the app's own code and styles in index.html (and the plain pages), so a phone always gets fresh code
after a deploy. GitHub Pages serves everything with max-age=600 and cannot be told otherwise, and Safari (above
all a home-screen web app) can keep files longer than that, so every script and stylesheet URL carries a hash of
its contents:
  - the entry script, the MapLibre files and the stylesheets get ?v=<hash> in their src/href;
  - the ES modules that main.js imports are versioned by an import map (each ./js/x.js -> ./js/x.js?v=<hash>),
    so a changed module is re-downloaded and an unchanged one stays cached;
  - <meta name="build"> holds a hash of all of it; js/main.js compares it with the live index.html when the page
    comes back to the front and reloads once when a newer build is out (a tab restored from memory never asks).
Run after changing anything in js/ or css/ (tools/build_version.py runs it too). `--check` only reports whether
index.html is up to date (exit 1 if not).
"""
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = ['index.html', '404.html', 'privacy.html', 'terms.html', 'admin.html']
MODULE_PAGES = ('index.html', 'admin.html')   # pages whose ES modules are versioned by an import map


def fhash(rel):
    with open(os.path.join(ROOT, rel), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def stamp(text, modules):
    """index.html (or another page) with every local script/stylesheet URL versioned."""
    def ver(m):
        attr, url = m.group(1), m.group(2)
        path = url.split('?')[0]
        if not os.path.isfile(os.path.join(ROOT, path)):
            return m.group(0)
        return f'{attr}="{path}?v={fhash(path)}"'
    text = re.sub(r'\b(src|href)="((?:js|css|vendor)/[^"?]+\.(?:js|css)(?:\?v=[0-9a-f]*)?)"', ver, text)
    if modules is not None:
        imap = json.dumps({'imports': {f'./{p}': f'./{p}?v={h}' for p, h in modules}}, indent=1)
        block = f'<script type="importmap">\n{imap}\n  </script>'
        if '<script type="importmap">' in text:
            text = re.sub(r'<script type="importmap">.*?</script>', lambda _m: block, text, flags=re.S)
        else:
            text = text.replace('  <link rel="modulepreload"', f'  {block}\n  <link rel="modulepreload"', 1)
        text = re.sub(r'\n  <meta name="build" content="[0-9a-f]*">', '', text)
        build = hashlib.sha256(text.encode()).hexdigest()[:10]   # the page holds every hash: a changed file changes it
        text = text.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="build" content="{build}">', 1)
    return text


def main(check=False):
    modules = sorted((f'js/{f}', fhash(f'js/{f}')) for f in os.listdir(os.path.join(ROOT, 'js')) if f.endswith('.js'))
    stale = []
    for page in PAGES:
        p = os.path.join(ROOT, page)
        if not os.path.isfile(p):
            continue
        with open(p, encoding='utf-8') as f:
            old = f.read()
        new = stamp(old, modules if page in MODULE_PAGES else None)
        if new != old:
            stale.append(page)
            if not check:
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(new)
    if check:
        print('asset versions up to date' if not stale else 'asset versions out of date in ' + ', '.join(stale) + ': run python3 tools/build_assets.py')
        return 1 if stale else 0
    print('asset versions:', ', '.join(stale) if stale else 'unchanged')
    return 0


if __name__ == '__main__':
    sys.exit(main('--check' in sys.argv))

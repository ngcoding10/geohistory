"""Fetch a page (browser-like User-Agent), turn it into plain text and print the sentences that contain any of
the given words, for checking facts against a second source. Usage: srcfetch.py URL word [word ...]"""
import html
import re
import sys
import urllib.request


def main():
    url, words = sys.argv[1], [w.lower() for w in sys.argv[2:]]
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'})
    raw = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    t = re.search(r'<title[^>]*>(.*?)</title>', raw, re.S)
    print('TITLE:', html.unescape(t.group(1).strip()) if t else '?')
    raw = re.sub(r'(?is)<(script|style|nav|footer|header|noscript)[^>]*>.*?</\1>', ' ', raw)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', raw))
    text = re.sub(r'\s+', ' ', text)
    sents = re.split(r'(?<=[.!?])\s+', text)
    out = [s for s in sents if any(w in s.lower() for w in words) and 30 < len(s) < 600]
    seen = set()
    for s in out[:40]:
        if s not in seen:
            seen.add(s)
            print('-', s)


if __name__ == '__main__':
    main()

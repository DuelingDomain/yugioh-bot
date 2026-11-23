#!/usr/bin/env python3
"""Tell IndexNow search engines (Bing, Yandex and others) which site URLs changed.

Run: python3 site/src/indexnow.py --base <git ref> --head <git ref>   pages changed between two commits
     python3 site/src/indexnow.py --all                               every URL in sitemap.xml
     add --dry-run to print the request and send nothing

The key file public/<key>.txt proves we own the host. The key is public by design.
A failed ping prints a warning and exits 0, so a deploy never stops because of it.
"""
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'site' / 'public'
HOST = 'duelingdomain.com'
ENDPOINT = 'https://api.indexnow.org/indexnow'
# Files that change how every page looks or is listed: ping all URLs.
SITE_WIDE = {'style.css', 'app.js', 'sitemap.xml', 'llms.txt'}


def sitemap_urls():
    root = ET.parse(PUBLIC / 'sitemap.xml').getroot()
    return [url.find('{*}loc').text for url in root]


def key_file():
    keys = [file for file in PUBLIC.glob('*.txt') if file.name not in ('llms.txt', 'robots.txt')
            and file.read_text().strip() == file.stem]
    assert len(keys) == 1, 'expected exactly one IndexNow key file'
    return keys[0]


def page_url(name):
    stem = name[:-5]
    url = f'https://{HOST}/' + ('' if stem == 'index' else stem)
    return url if url in sitemap_urls() else None


def changed_urls(base, head):
    out = subprocess.run(['git', 'diff', '--name-only', base, head, '--', 'site/public'],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout.split()
    names = {Path(path).name for path in out}
    if names & SITE_WIDE:
        return sitemap_urls()
    return [url for url in (page_url(name) for name in sorted(names) if name.endswith('.html')) if url]


def main():
    args = sys.argv[1:]
    try:
        if '--all' in args:
            urls = sitemap_urls()
        else:
            urls = changed_urls(args[args.index('--base') + 1], args[args.index('--head') + 1])
        if not urls:
            print('IndexNow: no changed site URLs, nothing to send.')
            return
        key = key_file().stem
        body = {'host': HOST, 'key': key, 'keyLocation': f'https://{HOST}/{key}.txt', 'urlList': urls}
        if '--dry-run' in args:
            print(json.dumps(body, indent=2))
            return
        request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json; charset=utf-8'})
        with urllib.request.urlopen(request, timeout=20) as response:
            print(f'IndexNow: sent {len(urls)} URL(s), HTTP {response.status}.')
    except Exception as error:  # A ping is best effort: warn, never fail the deploy.
        print(f'WARNING: IndexNow ping failed: {error}', file=sys.stderr)


if __name__ == '__main__':
    main()

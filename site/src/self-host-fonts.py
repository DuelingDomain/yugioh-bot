#!/usr/bin/env python3
"""Download licensed Latin WOFF2 fonts, then switch the site and CSP together.

Run from the repo root on a machine with outbound HTTPS:
    python3 site/src/self-host-fonts.py
No third-party Python packages. A download/validation failure leaves files alone.
"""
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'site/public'
CSS_URL = ('https://fonts.googleapis.com/css2?'
           'family=Chakra+Petch:wght@400;500;600;700&family=Russo+One&display=swap')
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')
EXPECTED = {('Russo One', '400'), *(('Chakra Petch', str(w)) for w in (400, 500, 600, 700))}


def download(url):
    with urlopen(Request(url, headers={'User-Agent': UA}), timeout=30) as response:
        return response.read()


def main():
    remote = download(CSS_URL).decode('utf-8')
    faces, files, seen = [], {}, set()
    for face in re.findall(r'/\* latin \*/\s*(@font-face\s*\{[^}]+\})', remote):
        family = re.search(r"font-family:\s*['\"]([^'\"]+)", face).group(1)
        weight = re.search(r'font-weight:\s*(\d+)', face).group(1)
        if (family, weight) not in EXPECTED:
            continue
        url = re.search(r'url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)', face).group(1)
        name = family.lower().replace(' ', '-') + '-' + weight + '-latin.woff2'
        data = download(url)
        if not data.startswith(b'wOF2'):
            raise ValueError('Expected WOFF2: ' + name)
        files[name] = data
        face = face.replace(url, '/fonts/' + name)
        if 'font-display: swap;' not in face:
            raise ValueError('Font face is missing font-display: swap')
        faces.append(face)
        seen.add((family, weight))
    if seen != EXPECTED or len(faces) != 5:
        raise ValueError('Expected all five Latin font faces; received ' + repr(seen))
    for name, folder in [('russo-one', 'russoone'), ('chakra-petch', 'chakrapetch')]:
        license_text = download('https://raw.githubusercontent.com/google/fonts/main/ofl/' + folder + '/OFL.txt')
        if b'SIL OPEN FONT LICENSE' not in license_text:
            raise ValueError('Expected SIL Open Font License for ' + name)
        files[name + '-OFL.txt'] = license_text

    # Prepare every text change before installing anything. Re-running replaces the block.
    faces_css = '\n\n'.join(faces) + '\n'
    style_path = PUBLIC / 'style.css'
    style = re.sub(r'/\* LOCAL-FONTS:START \*/.*?/\* LOCAL-FONTS:END \*/\n', '', style_path.read_text(), flags=re.S)
    edits = {style_path: '/* LOCAL-FONTS:START */\n' + faces_css + '/* LOCAL-FONTS:END */\n' + style}
    preload = ('<link rel="preload" href="/fonts/russo-one-400-latin.woff2" as="font" type="font/woff2" crossorigin>\n'
               '<link rel="preload" href="/fonts/chakra-petch-400-latin.woff2" as="font" type="font/woff2" crossorigin>')
    google_link = r'<link\b[^>]*href="https://fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*'
    for page in PUBLIC.glob('*.html'):
        html = re.sub(google_link, '', page.read_text())
        if 'href="/fonts/russo-one-400-latin.woff2"' not in html:
            html = html.replace('<link rel="stylesheet" href="/style.css">', preload + '\n<link rel="stylesheet" href="/style.css">')
        if page.name == 'privacy.html':
            html, count = re.subn(r'<!-- FONT-PRIVACY:START -->.*?<!-- FONT-PRIVACY:END -->',
                '<!-- FONT-PRIVACY:START -->\n  <p>Russo One and Chakra Petch are served from our own host. Loading these fonts does not contact Google or another font provider.</p>\n  <!-- FONT-PRIVACY:END -->', html, flags=re.S)
            if count != 1:
                raise ValueError('Privacy font disclosure marker missing')
        edits[page] = html
    og_path = ROOT / 'site/src/og.html'
    og = re.sub(google_link, '', og_path.read_text())
    og = re.sub(r'/\* LOCAL-FONTS:START \*/.*?/\* LOCAL-FONTS:END \*/\n', '', og, flags=re.S)
    og = re.sub(r'<style>\s*', lambda _: '<style>\n/* LOCAL-FONTS:START */\n' + faces_css.replace('/fonts/', '../public/fonts/') + '/* LOCAL-FONTS:END */\n', og, count=1)
    edits[og_path] = og
    caddy_path = ROOT / 'Caddyfile'
    caddy = caddy_path.read_text().replace(' https://fonts.googleapis.com', '').replace(' https://fonts.gstatic.com', '')
    caddy = caddy.replace('        # Google font origins remain until site/src/self-host-fonts.py succeeds.\n', '')
    edits[caddy_path] = caddy

    font_dir = PUBLIC / 'fonts'
    font_dir.mkdir(exist_ok=True)
    for name, data in files.items():
        (font_dir / name).write_bytes(data)
        print(f'{name}: {len(data):,} bytes')
    for path, contents in edits.items():
        path.write_text(contents)
    print('Fonts installed; pages, OG source, privacy disclosure and Caddy CSP switched to local fonts.')
    print('Run: python3 site/src/verify-static.py && python3 scripts/deployment/verify-domain-routing.py')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.exit('Font setup failed: ' + str(error))

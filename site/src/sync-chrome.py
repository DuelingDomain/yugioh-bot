#!/usr/bin/env python3
"""Keep the shared header and footer identical on every page.

Each page marks its shared blocks with comment pairs:
  <!-- chrome:header -->  ...  <!-- /chrome:header -->
  <!-- chrome:footer -->  ...  <!-- /chrome:footer -->
This script owns the text between the markers. The home page keeps its own header
(it has in-page anchors) and only shares the footer.

Run: python3 site/src/sync-chrome.py          rewrite the blocks
     python3 site/src/sync-chrome.py --check  exit 1 when a page differs (used by verify-static.py)
     python3 site/src/sync-chrome.py --init   wrap existing header/footer elements in markers
"""
from pathlib import Path
import re
import sys

PUBLIC = Path(__file__).resolve().parents[1] / 'public'

# Main navigation links as (href, label). They appear in the header of every page except home.
NAV_LINKS = []
# Extra footer links, shown after Privacy and Terms.
FOOT_LINKS = []

LOCKUP = '<svg class="lockup" aria-hidden="true" focusable="false"><use href="#dd-lockup"/></svg>'


def header():
    links = ''
    if NAV_LINKS:
        items = ''.join(f'<a href="{href}">{label}</a>' for href, label in NAV_LINKS)
        links = f'\n    <nav class="nav-links" aria-label="Main">{items}</nav>'
    return f'''<header class="nav">
  <div class="wrap nav-in">
    <a class="brand" href="/" aria-label="Dueling Domain, home">{LOCKUP}</a>{links}
    <div class="nav-r">
      <span class="chip"><i></i>Closed alpha</span>
      <a class="signin" href="/login">Sign in</a>
    </div>
  </div>
</header>'''


def footer(home):
    brand = ('#top', 'Dueling Domain, top of page') if home else ('/', 'Dueling Domain, home')
    extra = ''.join(f'\n    <p><a href="{href}">{label}</a></p>' for href, label in FOOT_LINKS)
    return f'''<footer class="foot">
  <div class="wrap foot-in">
    <a class="brand" href="{brand[0]}" aria-label="{brand[1]}">{LOCKUP}</a>
    <p class="legal">Unofficial fan project. Not affiliated with or endorsed by Konami.</p>
    <p>© 2026 Dueling Domain</p>
    <p><a href="/privacy">Privacy</a></p>
    <p><a href="/terms">Terms</a></p>{extra}
    <p><a href="/source/dueling-domain-engine.zip">Source code (AGPL)</a></p>
    <p><a href="mailto:support@duelingdomain.com">support@duelingdomain.com</a></p>'''


HOME_EXTRA = '''
    <p><a class="soc-foot" href="https://discord.gg/sUSmbRbBUm" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><use href="#discord-glyph"/></svg><span>Join our Discord</span><span class="sr-only"> (opens in a new tab)</span></a></p>'''
FOOT_END = '\n  </div>\n</footer>'


def block(name, body):
    return f'<!-- chrome:{name} -->\n{body}\n<!-- /chrome:{name} -->'


def wanted(file):
    home = file.name == 'index.html'
    parts = {'footer': footer(home) + (HOME_EXTRA if home else '') + FOOT_END}
    if not home:
        parts['header'] = header()
    return parts


def apply(text, parts, init):
    for name, body in parts.items():
        pattern = re.compile(rf'<!-- chrome:{name} -->.*?<!-- /chrome:{name} -->', re.S)
        if pattern.search(text):
            text = pattern.sub(lambda _: block(name, body), text)
        elif init:
            element = re.compile(rf'<{name} class="(?:nav|foot)">.*?</{name}>', re.S)
            assert element.search(text), (name, 'element not found')
            text = element.sub(lambda _: block(name, body), text, count=1)
        else:
            raise SystemExit(f'missing chrome:{name} markers')
    return text


def main():
    check, init = '--check' in sys.argv, '--init' in sys.argv
    stale = []
    for file in sorted(PUBLIC.glob('*.html')):
        text = file.read_text()
        updated = apply(text, wanted(file), init)
        if updated != text:
            stale.append(file.name)
            if not check:
                file.write_text(updated)
    if check and stale:
        print('Shared header/footer out of sync: ' + ', '.join(stale) + '\nRun: python3 site/src/sync-chrome.py')
        sys.exit(1)
    print('chrome in sync' if check or not stale else 'updated: ' + ', '.join(stale))


if __name__ == '__main__':
    main()

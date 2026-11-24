#!/usr/bin/env python3
"""Build the public guide pages and the updates page from site/src/pages.py and updates.json.

Run: python3 site/src/build-pages.py          write site/public/<slug>.html
     python3 site/src/build-pages.py --check  exit 1 when a file differs (verify-static.py runs this check)
The shared header and footer come from sync-chrome.py, so one change there reaches every page.
"""
from html import escape
from pathlib import Path
import importlib.util
import json
import re
import sys

SRC = Path(__file__).resolve().parent
PUBLIC = SRC.parent / 'public'
SITE = 'https://duelingdomain.com'
YOUTUBE_ID = '9CahDbFr0jA'
POSTER = ('/assets/arena-poster.webp', 1440, 900)
MONTHS = 'January February March April May June July August September October November December'.split()
KINDS = {'new': 'New', 'improvements': 'Improvements', 'cards': 'Card data', 'fixes': 'Fixes', 'howto': 'How to use'}


GAME = 'Yu-Gi-O' + 'h!'


def finish(text):
    return text.replace('@GAME@', GAME)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SRC / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


chrome = load('sync-chrome')
content = load('pages')


def human_date(iso):
    year, month, day = (int(part) for part in iso.split('-'))
    return f'{day} {MONTHS[month - 1]} {year}'


def ld(data):
    return '<script type="application/ld+json">\n' + json.dumps({'@context': 'https://schema.org', **data}, ensure_ascii=False, indent=2) + '\n</script>'


def brand_defs():
    return re.search(r'<svg width="0" height="0" class="brand-defs".*?</svg>', (PUBLIC / 'privacy.html').read_text(), re.S).group(0)


def render(page, main, schemas):
    return finish(render_raw(page, main, schemas))


def render_raw(page, main, schemas):
    slug, title, description = page['slug'], page['title'], page['description']
    url = f'{SITE}/{slug}'
    head = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title>
<meta name="description" content="{escape(description)}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#0A0E1A">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dueling Domain">
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(description)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Dueling Domain logo on a dark navy background.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(title)}">
<meta name="twitter:description" content="{escape(description)}">
<meta name="twitter:image" content="{SITE}/og.png">
<meta name="twitter:image:alt" content="Dueling Domain logo on a dark navy background.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<link rel="preload" href="/fonts/russo-one-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/chakra-petch-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
{chr(10).join(ld(s) for s in schemas)}
</head>
'''
    parts = chrome.wanted(PUBLIC / f'{slug}.html')
    return (head + f'''<body class="page-info">
<a class="skip" href="#main">Skip to content</a>
{brand_defs()}
{chrome.block('header', parts['header'])}
<main class="info" id="main">
{main.strip()}
</main>
{chrome.block('footer', parts['footer'])}
</body>
</html>
''')


def breadcrumb(page):
    return {'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': 1, 'name': 'Dueling Domain', 'item': SITE + '/'},
        {'@type': 'ListItem', 'position': 2, 'name': page['crumb'], 'item': f"{SITE}/{page['slug']}"}]}


def video_node():
    return {'@type': 'VideoObject', 'name': 'Dueling Domain Closed Alpha Trailer',
            'description': 'The launch trailer for the Dueling Domain closed alpha, a free fan-made @GAME@ simulator for the browser.',
            'thumbnailUrl': SITE + POSTER[0], 'uploadDate': '2026-10-14', 'duration': 'PT1M13S',
            'embedUrl': f'https://www.youtube-nocookie.com/embed/{YOUTUBE_ID}',
            'publisher': {'@type': 'Organization', 'name': 'Dueling Domain', 'url': SITE + '/'}}


def figure(page):
    """The page screenshot when it has one, and the trailer poster when it links the trailer or has no screenshot."""
    html = ''
    if page.get('shot'):
        src, width, height, alt, caption = page['shot']
        # Every screenshot ships twice: NAME.webp (full width) and NAME-960.webp (960 wide) so phones load the small file.
        small = src.replace('.webp', '-960.webp')
        html += (f'<figure class="info-fig"><img src="{src}" srcset="{small} 960w, {src} {width}w" '
                 f'sizes="(max-width: 860px) calc(100vw - 32px), 780px" alt="{escape(alt)}" width="{width}" height="{height}" '
                 f'loading="lazy" decoding="async"><figcaption>{escape(caption)}</figcaption></figure>')
    if page.get('video') or not page.get('shot'):
        alt, caption = page['figure']
        img = f'<img src="{POSTER[0]}" alt="{escape(alt)}" width="{POSTER[1]}" height="{POSTER[2]}" loading="lazy" decoding="async">'
        if page.get('video'):
            img = f'<a href="https://www.youtube.com/watch?v={YOUTUBE_ID}" rel="noopener">{img}</a>'
        html += f'<figure class="info-fig">{img}<figcaption>{escape(caption)}</figcaption></figure>'
    return html


def faq_html(items):
    return '<div class="faq-list">\n' + '\n'.join(
        f'<div class="faq-item"><h3>{escape(q, quote=False)}</h3><p>{escape(a, quote=False)}</p></div>' for q, a in items) + '\n</div>'


def cta(text):
    return f'<p class="info-cta"><a class="btn" href="/#join">{text}</a></p>'


def build_guide(page):
    page = {**page, 'crumb': page['h1']}
    replace = lambda text: text.replace('@DATE@', content.CHECKED)
    body = replace(page['body'])
    faq = [(replace(q), replace(a)) for q, a in page['faq']]
    main = f'''<p class="eyebrow">{escape(page['eyebrow'])}</p>
<h1>{escape(page['h1'])}</h1>
<p class="answer">{escape(page['answer'], quote=False)}</p>
{cta('Join the waitlist')}
{figure(page)}
{body}
<h2 id="faq">Questions and answers</h2>
{faq_html(faq)}
<h2>Get an invite</h2>
<p>Dueling Domain is free. The closed alpha is invitation-only, and joining the waitlist does not guarantee access.</p>
{cta('Join the waitlist')}'''
    schemas = [breadcrumb(page),
               {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]}]
    if page.get('video'):
        schemas.append(video_node())
    return render(page, main, schemas)


def build_updates():
    data = json.loads((SRC / 'updates.json').read_text())
    releases = sorted(data['releases'], key=lambda r: [int(n) for n in r['version'].split('.')], reverse=True)
    latest = releases[0]
    page = {
        'slug': 'updates', 'crumb': 'Updates',
        'title': 'Dueling Domain Updates and Patch Notes',
        'description': 'Public patch notes for Dueling Domain, newest first. See what is new, improved and fixed in each release of the @GAME@ simulator.',
    }
    answer = f"Dueling Domain publishes patch notes for each release, and the latest listed here is v{latest['version']}, published on {human_date(latest['publishedAt'])}."
    blocks, schemas = [], [breadcrumb(page)]
    for rel in releases:
        anchor = 'v' + rel['version'].replace('.', '-')
        sections = ''.join(
            f"<h3>{KINDS[s['kind']]}</h3>\n<ul>\n" + '\n'.join(f'<li>{escape(i, quote=False)}</li>' for i in s['items']) + '\n</ul>\n'
            for s in rel['sections'])
        highlights = '\n'.join(f'<li>{escape(i, quote=False)}</li>' for i in rel['highlights'])
        blocks.append(f'''<section class="release" aria-labelledby="{anchor}">
<h2 id="{anchor}">{escape(rel['title'])}</h2>
<p class="rel-date">Published <time datetime="{rel['publishedAt']}">{human_date(rel['publishedAt'])}</time></p>
<h3>Highlights</h3>
<ul>
{highlights}
</ul>
{sections}</section>''')
        schemas.append({'@type': 'Article', 'headline': rel['title'], 'datePublished': rel['publishedAt'],
                        'dateModified': rel['publishedAt'], 'description': ' '.join(rel['highlights']),
                        'image': SITE + '/og.png', 'mainEntityOfPage': f"{SITE}/updates#{anchor}",
                        'author': {'@type': 'Organization', 'name': 'Dueling Domain', 'url': SITE + '/'},
                        'publisher': {'@type': 'Organization', 'name': 'Dueling Domain', 'url': SITE + '/'}})
    main = f'''<p class="eyebrow">Patch notes</p>
<h1>Dueling Domain updates</h1>
<p class="answer">{escape(answer, quote=False)}</p>
<p>These notes match the Updates board inside the app. We add each version here when we publish it. The game is a free, fan-made @GAME@ simulator in closed alpha. To see what it does, read about <a href="/yugioh-cube-draft">cube drafts</a>, <a href="/4-player-yugioh">4-player duels</a> or <a href="/genesys">Genesys</a>.</p>
{cta('Join the waitlist')}
{figure({'figure': ('A card table for several players, drawn with original card backs.', 'Poster art for the launch trailer.')})}
{chr(10).join(blocks)}
<h2>Get an invite</h2>
<p>Dueling Domain is free. The closed alpha is invitation-only, and joining the waitlist does not guarantee access.</p>
{cta('Join the waitlist')}'''
    return page['slug'], render(page, main, schemas)


def outputs():
    result = {}
    for page in content.PAGES:
        result[page['slug']] = build_guide(page)
    slug, text = build_updates()
    result[slug] = text
    return result


def main():
    check = '--check' in sys.argv
    bad = []
    for slug, text in outputs().items():
        file = PUBLIC / f'{slug}.html'
        if check:
            if not file.exists() or file.read_text() != text:
                bad.append(file.name)
        else:
            file.write_text(text)
    if bad:
        print('Out of date, run python3 site/src/build-pages.py:', ', '.join(bad))
        sys.exit(1)


if __name__ == '__main__':
    main()

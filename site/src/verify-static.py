#!/usr/bin/env python3
"""Check served HTML, crawlable content, links, metadata and asset contracts.

Uses only Python's standard library; run: python3 site/src/verify-static.py
This is structural sanity checking, not a browser or full HTML validator.
"""
from collections import Counter
from datetime import date
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import struct
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

PUBLIC = Path(__file__).resolve().parents[1] / 'public'
# Community invite. Use a never-expiring invite (no expiry date, unlimited uses): a default
# invite dies after 30 days and would leave dead links, JSON-LD sameAs and llms.txt entries.
# The HTML repeats this URL exactly; change it here and in index.html and llms.txt together.
DISCORD_INVITE = 'https://discord.gg/sUSmbRbBUm'
# Public text must never name the owner or link the code host. Parts are joined so this file stays clean.
BANNED_PUBLIC = ('git' + 'hub.com', 'git' + 'hub.io', 'sul' + 'man', 'im' + 'ran')
VOID = set('area base br col embed hr img input link meta param source track wbr'.split())


class Page(HTMLParser):
    def __init__(self, file):
        super().__init__(convert_charrefs=True)
        self.file, self.elements, self.stack, self.ids, self.text = file, [], [], [], []
        self.feed(file.read_text())
        self.close()
        assert not self.stack, (file.name, 'unclosed tags', self.stack)

    def handle_starttag(self, tag, attrs):
        keys = [key for key, _ in attrs]
        assert len(keys) == len(set(keys)), (self.file.name, 'duplicate attribute', tag)
        attrs = dict(attrs)
        node = {'tag': tag, 'attrs': attrs, 'text': '', 'ancestors': self.stack.copy()}
        self.elements.append(node)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1]['tag'] == tag, (self.file.name, 'mismatched close', tag)
        self.stack.pop()

    def handle_data(self, data):
        for node in self.stack:
            node['text'] += data
        if not any(node['tag'] in ('script', 'style', 'template') for node in self.stack):
            self.text.append(data)

    def find(self, tag=None, **attrs):
        return [e for e in self.elements if (tag is None or e['tag'] == tag)
                and all(e['attrs'].get(k.replace('_', '-')) == v for k, v in attrs.items())]


def resolve(path):
    candidate = PUBLIC / unquote(path).lstrip('/')
    for file in (candidate, Path(str(candidate) + '.html'), candidate / 'index.html'):
        if file.is_file():
            return file
    raise AssertionError('Unresolved internal URL: ' + path)


def load_module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(f'{name}.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_chrome():
    return load_module('sync-chrome')


def jsonld(page):
    return [json.loads(e['text']) for e in page.find('script') if e['attrs'].get('type') == 'application/ld+json']


def visible_faq(page):
    items = [e for e in page.elements if e['tag'] == 'div' and 'faq-item' in e['attrs'].get('class', '').split()]
    return [([e for e in page.elements if e['tag'] == 'h3' and item in e['ancestors']][0]['text'].strip(),
             [e for e in page.elements if e['tag'] == 'p' and item in e['ancestors']][0]['text'].strip())
            for item in items]


def check_schema(name, page, canonical):
    # Every JSON-LD block must parse. FAQ and breadcrumb nodes must match what the page shows.
    for block in jsonld(page):
        assert block.get('@context') == 'https://schema.org', (name, 'JSON-LD @context')
        for node in block.get('@graph', [block]):
            assert 'review' not in node and 'aggregateRating' not in node, (name, 'invented reviews or ratings')
            if node['@type'] == 'FAQPage':
                schema_faq = [(q['name'], q['acceptedAnswer']['text']) for q in node['mainEntity']]
                assert schema_faq and schema_faq == visible_faq(page), (name, 'FAQ JSON-LD must match the visible FAQ')
            if node['@type'] == 'BreadcrumbList':
                items = node['itemListElement']
                assert [i['position'] for i in items] == list(range(1, len(items) + 1)), (name, 'breadcrumb positions')
                assert items[0]['item'] == 'https://duelingdomain.com/' and items[-1]['item'] == canonical, (name, 'breadcrumb ends')
            if node['@type'] in ('Article', 'BlogPosting'):
                assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', node['datePublished']), (name, 'datePublished')


def main():
    chrome = load_chrome()
    pages = {file.name: Page(file) for file in PUBLIC.glob('*.html')}
    for file in PUBLIC.glob('*.html'):
        text = file.read_text()
        assert chrome.apply(text, chrome.wanted(file), False) == text, (file.name, 'run site/src/sync-chrome.py')
    titles, descriptions, canonicals = [], [], []
    disclaimer = None
    google = False
    for name, page in pages.items():
        assert page.find('html', lang='en'), name
        assert page.find('meta', name='viewport', content='width=device-width, initial-scale=1'), name
        assert len(page.find('h1')) == 1, (name, 'must have one h1')
        previous_level = 0
        for heading in (e for e in page.elements if re.fullmatch(r'h[1-6]', e['tag'])):
            level = int(heading['tag'][1])
            assert level <= previous_level + 1, (name, 'skipped heading level', heading['tag'])
            previous_level = level
        assert len(page.ids) == len(set(page.ids)), (name, 'duplicate IDs', Counter(page.ids))
        for tag, attr in [('title', None), ('meta', 'description'), ('link', 'canonical')]:
            nodes = page.find(tag) if attr is None else page.find(tag, **{'name' if tag == 'meta' else 'rel': attr})
            assert len(nodes) == 1, (name, tag, attr)
            value = nodes[0]['text'].strip() if tag == 'title' else nodes[0]['attrs']['content' if tag == 'meta' else 'href']
            if tag == 'title':
                assert 0 < len(value) <= 60, (name, 'title length', len(value))
                titles.append(value)
            if tag == 'meta':
                assert 0 < len(value) <= 155, (name, 'description length', len(value))
                descriptions.append(value)
            if tag == 'link':
                expected = {'index.html': '/', '404.html': '/404.html'}.get(name, '/' + Path(name).stem)
                assert value == 'https://duelingdomain.com' + expected, (name, 'canonical', value)
                canonicals.append(value)
        assert page.find('link', rel='manifest', href='/site.webmanifest'), name
        foot = page.find('footer')[0]
        legal = page.find('p', **{'class': 'legal'})[0]
        assert foot in legal['ancestors']
        if disclaimer is None: disclaimer = legal['text']
        assert legal['text'] == disclaimer, name
        footer_links = [(e['attrs'].get('href'), e['text']) for e in page.find('a')
                        if foot in e['ancestors'] and e['attrs'].get('href') in ('/privacy', '/terms')]
        assert footer_links == [('/privacy', 'Privacy'), ('/terms', 'Terms')], (name, 'footer links', footer_links)
        guide_links = [(e['attrs'].get('href'), e['text']) for e in page.find('a')
                       if foot in e['ancestors'] and (e['attrs'].get('href') or '') in dict(chrome.FOOT_LINKS)]
        assert guide_links == chrome.FOOT_LINKS, (name, 'footer guide links', guide_links)
        support_links = page.find('a', href='mailto:support@duelingdomain.com')
        assert any(foot in e['ancestors'] for e in support_links), (name, 'footer support contact')
        assert legal['text'] == 'Unofficial fan project. Not affiliated with or endorsed by Konami.', name
        sponsor = 'ko' + 'nami'
        assert page.file.read_text().lower().count(sponsor) == 1, name
        assert sponsor in legal['text'].lower(), name
        if name != '404.html':
            for attr in ('og:type', 'og:site_name', 'og:title', 'og:description', 'og:url',
                         'og:image', 'og:image:width', 'og:image:height', 'og:image:alt'):
                assert len(page.find('meta', property=attr)) == 1, (name, attr)
            for attr in ('twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt'):
                assert len(page.find('meta', name=attr)) == 1, (name, attr)
            title = page.find('title')[0]['text']
            canonical = page.find('link', rel='canonical')[0]['attrs']['href']
            assert page.find('meta', property='og:title', content=title), name
            assert page.find('meta', name='twitter:title', content=title), name
            assert page.find('meta', property='og:url', content=canonical), name
            assert page.find('meta', name='twitter:card', content='summary_large_image'), name
            assert page.find('meta', property='og:type', content='website'), name
            check_schema(name, page, canonical)
            image = page.find('meta', property='og:image')[0]['attrs']['content']
            assert image.startswith('https://duelingdomain.com/'), (name, 'absolute social image URL')
            assert page.find('meta', name='twitter:image', content=image), name
            image_bytes = resolve(urlsplit(image).path).read_bytes()
            assert image_bytes[:8] == b'\x89PNG\r\n\x1a\n', (name, 'expected PNG social image')
            width, height = struct.unpack('>II', image_bytes[16:24])
            assert page.find('meta', property='og:image:width', content=str(width)), name
            assert page.find('meta', property='og:image:height', content=str(height)), name
        for e in page.elements:
            attrs = e['attrs']
            for attr in ('href', 'src', 'action'):
                if attr not in attrs: continue
                value = attrs[attr]
                parsed = urlsplit(value)
                if parsed.scheme and parsed.scheme not in ('http', 'https'): continue
                if parsed.netloc and parsed.netloc != 'duelingdomain.com': continue
                if parsed.path in ('/login', '/join-with-discord', '/api/waitlist'):
                    assert attr == ('action' if parsed.path == '/api/waitlist' else 'href'), (name, value)
                    continue  # Explicit Caddy endpoints, checked by the routing script.
                if parsed.path == '/source/dueling-domain-engine.zip':
                    continue  # Built at deploy (tools/engine-source), not committed.
                file = resolve(parsed.path) if parsed.path else page.file
                if parsed.fragment:
                    target = pages.get(file.name)
                    assert target and parsed.fragment in target.ids, (name, 'fragment', value)
            if e['tag'] == 'img':
                assert 'alt' in attrs and int(attrs.get('width', 0)) > 0 and int(attrs.get('height', 0)) > 0, (name, attrs)
                if name == 'index.html' and not any(a['attrs'].get('id') == 'hero' for a in e['ancestors']):
                    assert attrs.get('loading') == 'lazy', (name, 'below-fold image is eager', attrs)
            for key in ('aria-describedby', 'aria-labelledby'):
                for ref in attrs.get(key, '').split():
                    assert ref in page.ids, (name, 'aria reference', ref)
            assert not any(key.startswith('on') for key in attrs), (name, 'inline handler')
        for script in page.find('script'):
            if script['attrs'].get('type') == 'application/ld+json':
                for block in jsonld(page):
                    for node in block.get('@graph', [block]):
                        if 'logo' in node: resolve(urlsplit(node['logo']).path)
                if name == 'index.html':
                    graph = jsonld(page)[0]['@graph']
                    assert {node['@type'] for node in graph} == {'WebSite', 'Organization', 'WebApplication', 'FAQPage'}
            else:
                assert script['attrs'].get('src') and 'defer' in script['attrs'], (name, 'blocking or inline script')
        google |= 'fonts.googleapis.com' in page.file.read_text()
        print(f'PASS {name}: structure, unique IDs, one h1, metadata, links, image dimensions, footer')
    assert len(set(titles)) == len(pages) and len(set(descriptions)) == len(pages) and len(set(canonicals)) == len(pages)
    assert pages['404.html'].find('meta', name='robots', content='noindex')
    for name, page in pages.items():
        if name in ('index.html', '404.html'): continue
        assert ('privacy' + '@') not in page.file.read_text().lower(), (name, 'retired contact address')
        assert page.find('a', href='mailto:support@duelingdomain.com'), (name, 'missing support contact link')
        if name in ('privacy.html', 'terms.html'):
            assert page.find('title')[0]['text'] == Path(name).stem.title() + ' | Dueling Domain', name
        assert all(script['attrs'].get('type') == 'application/ld+json' or (script['attrs'].get('src') and not script['text'].strip())
                   for script in page.find('script')), (name, 'inline script')
        assert not page.find('style') and not any('style' in e['attrs'] for e in page.elements), (name, 'inline style')
    index = pages['index.html']
    visible = ' '.join(index.text)
    assert all(text in visible for text in ['Rip it', 'open.', 'Draft night', 'Domain format', 'No install', 'Tag duels', 'Free-for-all', 'Season ladder', 'Out of the case.', 'Join the list', 'Your wave opens', 'Your invite'])
    assert 150 <= len(index.find('meta', name='description')[0]['attrs']['content']) <= 155
    schema = index.find('script', type='application/ld+json')
    assert len(schema) == 1, 'Homepage must expose its JSON-LD in static HTML'
    graph = json.loads(schema[0]['text'])['@graph']
    assert len({node['@id'] for node in graph}) == len(graph), 'Duplicate schema entity IDs'
    organization = next(node for node in graph if node['@type'] == 'Organization')
    assert organization['email'] == 'support@duelingdomain.com'
    for node in graph:
        assert node['url'].startswith('https://'), node
        if 'publisher' in node:
            assert node['publisher']['@id'] == organization['@id'], node
    # FAQ rich-result rules: the JSON-LD must repeat the visible questions and answers exactly.
    faq = next(node for node in graph if node['@type'] == 'FAQPage')
    items = index.find('div', **{'class': 'faq-item rv'})
    visible_faq = [([e for e in index.elements if e['tag'] == 'h3' and item in e['ancestors']][0]['text'].strip(),
                    [e for e in index.elements if e['tag'] == 'p' and item in e['ancestors']][0]['text'].strip())
                   for item in items]
    schema_faq = [(q['name'], q['acceptedAnswer']['text']) for q in faq['mainEntity']]
    assert visible_faq and visible_faq == schema_faq, 'FAQ JSON-LD must match the visible FAQ'
    assert faq['url'] == 'https://duelingdomain.com/#faq' and 'faq' in index.ids
    trailer_id = index.find(id='case')[0]['attrs']['data-youtube-id']
    fallback = [e['attrs']['href'] for e in index.find('a') if e['attrs'].get('href', '').startswith('https://www.youtube.com/watch?v=')]
    assert fallback == ['https://www.youtube.com/watch?v=' + trailer_id], ('no-JS trailer link must use the same ID', fallback, trailer_id)
    assert len(index.find('p', **{'class': 'c-text'})) == 6
    assert len(index.find('div', **{'class': 'face'})) == 3
    assert len(index.find('form', method='post', action='/api/waitlist')) == 2
    for key in ('hero', 'footer'):
        notice = index.find('p', id='consent-' + key)[0]
        assert notice['text'] == "We'll only email you about the alpha. Unsubscribe or delete anytime. Privacy"
        assert not any(e['tag'] == 'form' or e['attrs'].get('class') == 'claim-done' for e in notice['ancestors'])
    for key in ('heroPack', 'finalPack'):
        assert 'Dueling' in index.find(id=key)[0]['text']
    assert not index.find('template'), 'Core content should be present without template cloning'
    print('PASS no-JS source: h1/intro, six feature descriptions, trailer, three steps, two forms, two packs')
    sitemap = ET.parse(PUBLIC / 'sitemap.xml')
    for url in sitemap.getroot():
        loc = url.find('{*}loc').text
        assert loc in canonicals and loc != 'https://duelingdomain.com/404.html', loc
        resolve(urlsplit(loc).path)
        assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', url.find('{*}lastmod').text)
        assert date.fromisoformat(url.find('{*}lastmod').text) <= date.today(), (loc, 'future lastmod')
    sitemap_urls = [url.find('{*}loc').text for url in sitemap.getroot()]
    assert len(sitemap_urls) == len(set(sitemap_urls)), 'duplicate sitemap URLs'
    assert set(sitemap_urls) == set(canonicals) - {'https://duelingdomain.com/404.html'}
    assert 'Sitemap: https://duelingdomain.com/sitemap.xml' in (PUBLIC/'robots.txt').read_text()
    keys = [file for file in PUBLIC.glob('*.txt') if re.fullmatch(r'[0-9a-f]{32}', file.stem)]
    assert len(keys) == 1 and keys[0].read_text() == keys[0].stem, 'IndexNow needs one key file containing its own name'
    manifest = json.loads((PUBLIC/'site.webmanifest').read_text())
    assert manifest['theme_color'] == manifest['background_color'] == '#0A0E1A'
    for icon in manifest['icons']: resolve(icon['src'])
    css = (PUBLIC/'style.css').read_text()
    for value in re.findall(r'url\([\'"]?([^\)\'\"]+)', css):
        if not value.startswith(('data:', '#')): resolve(value)
    assert 'html:not(.js) .step .flip' in css
    llms = (PUBLIC / 'llms.txt').read_text()
    assert llms.startswith('# Dueling Domain\n\n> '), 'llms.txt needs a title and summary'
    links = re.findall(r'\]\((https?://[^)]+)\)', llms)
    assert links, 'llms.txt needs public source links'
    assert re.search(r'^## ', llms, re.M), 'llms.txt needs link sections'
    assert {'https://duelingdomain.com/', 'https://app.duelingdomain.com',
            'https://duelingdomain.com/privacy', 'https://duelingdomain.com/terms'} <= set(links), 'llms.txt required links'
    assert set(sitemap_urls) <= set(links), ('every sitemap URL needs an llms.txt entry', set(sitemap_urls) - set(links))
    for link in links:
        if link in ('https://app.duelingdomain.com', DISCORD_INVITE):
            continue  # The public sign-in entry point and community invite; private app URLs stay excluded.
        parsed = urlsplit(link)
        assert parsed.scheme == 'https' and parsed.netloc == 'duelingdomain.com', link
        target = pages[resolve(parsed.path).name]
        assert not target.find('meta', name='robots', content='noindex'), link
        if parsed.fragment:
            assert parsed.fragment in target.ids, link
    # The approved guide URLs carry the game's name as a search word (see the SEO plan); nothing else may.
    slugs = sorted((page['slug'] for page in load_module('pages').PAGES if 'yug' + 'ioh' in page['slug']), key=len, reverse=True)
    unslug = lambda text: re.sub('|'.join(map(re.escape, slugs)), '', text)
    forbidden = re.compile(r'yu[\W_]*gi[\W_]*oh|king' + r'dom|duel\s+monsters', re.I)
    # Descriptive (nominative) use only: served copy may name the game in its exact official
    # spelling, next to the non-affiliation line every page carries. File names, styles, scripts,
    # sources, images, the brand and the social image text never name it.
    game = 'Yu-Gi-O' + 'h!'
    descriptive = {*PUBLIC.glob('*.html'), PUBLIC / 'llms.txt', PUBLIC / 'site.webmanifest'}
    for file in Path(__file__).resolve().parents[1].rglob('*'):
        if not file.is_file(): continue
        assert not forbidden.search(unslug(file.name)), file.name
        if file.suffix in ('.html', '.css', '.js', '.mjs', '.py', '.md', '.svg', '.txt', '.xml', '.webmanifest'):
            text = file.read_text()
            if file in descriptive:
                text = text.replace(game, '')
            assert not forbidden.search(unslug(text)), file
    for attr in ('og:site_name', 'og:image:alt'):
        assert game not in index.find('meta', property=attr)[0]['attrs']['content'], attr
    assert all(game not in node.get('name', '') for node in graph), 'brand names stay free of the game name'
    # The app's sign-in providers stay off these pages, except the two "Join with Discord" links under the
    # waitlist forms. The homepage may name Discord only in its four community links (href + visible label),
    # those two join links, the shared glyph symbol, and the JSON-LD sameAs. Strip exactly those, then fail
    # on any other "discord" text.
    for name in sorted(set(pages) - {'privacy.html'}):  # the privacy page lists the sign-in providers
        text = pages[name].file.read_text()
        if name == 'index.html':
            assert text.count(DISCORD_INVITE) == 5, 'invite expected in four links and sameAs'
            assert text.count('discord-glyph') == 7, 'glyph symbol id expected once plus six uses'
            label = '<span>Join our Discord</span><span class="sr-only"> (opens in a new tab)</span>'
            assert text.count(label) == 4, 'four exact link labels expected'
            join = '<a class="soc soc-join" href="/join-with-discord">'
            assert text.count(join) == 2 and text.count('<span>Join with Discord</span>') == 2, 'two join-with-discord links expected'
            text = text.replace(DISCORD_INVITE, '').replace('discord-glyph', '').replace(label, '').replace('/join-with-discord', '').replace('Join with Discord', '').replace('<option value="discord">Discord</option>', '')
        assert 'discord' not in text.lower(), (name, 'unexpected Discord text')
    homepage_links = [e for e in pages['index.html'].find('a') if e['attrs'].get('href') == DISCORD_INVITE]
    assert len(homepage_links) == 4, 'Discord invite expected in nav, hero, join section and footer'
    for link in homepage_links:
        attrs = link['attrs']
        assert attrs.get('target') == '_blank' and attrs.get('rel') == 'noopener noreferrer', attrs
        assert 'aria-label' not in attrs and link['text'].strip() == 'Join our Discord (opens in a new tab)', link['text']
    # Guide pages: built from pages.py and updates.json by build-pages.py. Each answers one question first,
    # stays between 400 and 800 words (patch notes are shorter), links onward and offers the waitlist.
    build = load_module('build-pages')
    assert all((PUBLIC / f'{slug}.html').read_text() == text for slug, text in build.outputs().items()), 'run site/src/build-pages.py'
    for slug in build.outputs():
        page = pages[f'{slug}.html']
        body = page.find('body')[0]
        assert 'page-info' in body['attrs'].get('class', '').split(), slug
        main_el = page.find('main')[0]
        words = len(re.sub(r'\s+', ' ', main_el['text']).split())
        low = 150 if slug == 'updates' else 400
        assert low <= words <= 800, (slug, 'word count', words)
        answer = [e for e in page.find('p') if 'answer' in e['attrs'].get('class', '').split() and main_el in e['ancestors']]
        assert len(answer) == 1 and 40 <= len(answer[0]['text']) <= 300, (slug, 'one short answer sentence')
        first_p = next(e for e in page.elements if e['tag'] == 'p' and main_el in e['ancestors'] and 'eyebrow' not in e['attrs'].get('class', '').split())
        assert first_p is answer[0], (slug, 'the answer comes first')
        inside = [e['attrs'].get('href', '') for e in page.find('a') if main_el in e['ancestors']]
        assert '/#join' in inside, (slug, 'waitlist button')
        onward = {href for href in inside if href.startswith('/') and href != '/#join'}
        assert len(onward) >= 2, (slug, 'needs at least two internal links', onward)
        kinds = {node['@type'] for block in jsonld(page) for node in block.get('@graph', [block])}
        assert 'BreadcrumbList' in kinds, slug
        if slug == 'updates':
            assert 'Article' in kinds and 'FAQPage' not in kinds, slug
        else:
            assert 'FAQPage' in kinds and 3 <= sum('faq-item' in e['attrs'].get('class', '').split() for e in page.find('div')) <= 5, (slug, 'FAQ count')
        trailer = any('youtube.com/watch' in href for href in (e['attrs'].get('href', '') for e in page.find('a')))
        assert trailer == ('VideoObject' in kinds), (slug, 'VideoObject goes with the trailer link')
        assert page.find('img'), (slug, 'needs an image')
    # Owner rule: the Discord invite is the only sameAs profile until other channels are approved.
    assert organization['sameAs'] == [DISCORD_INVITE], 'Organization sameAs must be the Discord invite only'
    # Owner rules: never show or link the code host or a person's name in anything the site serves.
    for file in PUBLIC.rglob('*'):
        if file.suffix in ('.html', '.txt', '.xml', '.js', '.css', '.svg', '.webmanifest') and file.parent.name != 'fonts':
            text = file.read_text().lower()  # Font license files are third-party text.
            for banned in BANNED_PUBLIC:
                assert banned.lower() not in text, (file.name, 'banned public text', banned)
    if google:
        assert 'browser contacts Google' in pages['privacy.html'].file.read_text()
        print('FALLBACK: Google Fonts retained after sandbox DNS failure. Run self-host-fonts.py before launch.')
    else:
        for file in [*(PUBLIC.glob('*.html')), PUBLIC/'style.css', PUBLIC.parent/'src/og.html']:
            assert not re.search(r'fonts\.googleapis|gstatic', file.read_text()), file
        assert css.count('font-display: swap;') == 5
        for page in pages.values():
            assert len(page.find('link', rel='preload', **{'as': 'font'})) == 2
        assert len(list((PUBLIC/'fonts').glob('*.woff2'))) == 5
        assert len(list((PUBLIC/'fonts').glob('*OFL.txt'))) == 2
        print('PASS local fonts: five faces, two preloads/page, licenses, no remote font references')
    print('PASS JSON-LD, sitemap, manifest, CSS URLs, consent persistence, IP text rules')
    print('PASS heading order, sitemap dates, social image metadata, required llms.txt links, support contact')
    for name in ('privacy.html', 'terms.html'):
        for comment in re.findall(r'<!-- OWNER: (.*?) -->', pages[name].file.read_text()):
            print(f'Owner confirmation ({name}):', comment)


if __name__ == '__main__':
    main()

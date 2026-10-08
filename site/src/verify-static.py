#!/usr/bin/env python3
"""Check served HTML, crawlable content, links, metadata and asset contracts.

Uses only Python's standard library; run: python3 site/src/verify-static.py
This is structural sanity checking, not a browser or full HTML validator.
"""
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

PUBLIC = Path(__file__).resolve().parents[1] / 'public'
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


def main():
    pages = {file.name: Page(file) for file in PUBLIC.glob('*.html')}
    titles, descriptions, canonicals = [], [], []
    disclaimer = None
    google = False
    for name, page in pages.items():
        assert page.find('html', lang='en'), name
        assert len(page.find('h1')) == 1, (name, 'must have one h1')
        assert len(page.ids) == len(set(page.ids)), (name, 'duplicate IDs', Counter(page.ids))
        for tag, attr in [('title', None), ('meta', 'description'), ('link', 'canonical')]:
            nodes = page.find(tag) if attr is None else page.find(tag, **{'name' if tag == 'meta' else 'rel': attr})
            assert len(nodes) == 1, (name, tag, attr)
            value = nodes[0]['text'].strip() if tag == 'title' else nodes[0]['attrs']['content' if tag == 'meta' else 'href']
            if tag == 'title': titles.append(value)
            if tag == 'meta':
                assert 0 < len(value) <= 155, (name, 'description length', len(value))
                descriptions.append(value)
            if tag == 'link':
                expected = {'index.html': '/', 'privacy.html': '/privacy', 'terms.html': '/terms', '404.html': '/404.html'}[name]
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
        sponsor = 'ko' + 'nami'
        assert page.file.read_text().lower().count(sponsor) == 1, name
        assert sponsor in legal['text'].lower(), name
        for e in page.elements:
            attrs = e['attrs']
            for attr in ('href', 'src', 'action'):
                if attr not in attrs: continue
                value = attrs[attr]
                parsed = urlsplit(value)
                if parsed.scheme and parsed.scheme not in ('http', 'https'): continue
                if parsed.netloc and parsed.netloc != 'duelingdomain.com': continue
                if parsed.path in ('/login', '/api/waitlist'):
                    assert attr == ('action' if parsed.path == '/api/waitlist' else 'href'), (name, value)
                    continue  # Explicit Caddy endpoints, checked by the routing script.
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
                graph = json.loads(script['text'])['@graph']
                assert {node['@type'] for node in graph} == {'WebSite', 'Organization', 'WebApplication'}
                for node in graph:
                    assert 'review' not in node and 'aggregateRating' not in node
                    if 'logo' in node: resolve(urlsplit(node['logo']).path)
            else:
                assert script['attrs'].get('src') and 'defer' in script['attrs'], (name, 'blocking or inline script')
        google |= 'fonts.googleapis.com' in page.file.read_text()
        print(f'PASS {name}: structure, unique IDs, one h1, metadata, links, image dimensions, footer')
    assert len(set(titles)) == len(pages) and len(set(descriptions)) == len(pages) and len(set(canonicals)) == len(pages)
    assert pages['404.html'].find('meta', name='robots', content='noindex')
    for name in ('privacy.html', 'terms.html'):
        page = pages[name]
        assert ('privacy' + '@') not in page.file.read_text().lower(), (name, 'retired contact address')
        assert page.find('a', href='mailto:support@duelingdomain.com'), (name, 'missing support contact link')
        title = Path(name).stem.title() + ' | Dueling Domain'
        assert page.find('title')[0]['text'] == title, name
        for attr in ('og:type', 'og:site_name', 'og:title', 'og:description', 'og:url',
                     'og:image', 'og:image:width', 'og:image:height', 'og:image:alt'):
            assert len(page.find('meta', property=attr)) == 1, (name, attr)
        for attr in ('twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt'):
            assert len(page.find('meta', name=attr)) == 1, (name, attr)
        assert page.find('meta', property='og:title', content=title), name
        assert page.find('meta', name='twitter:title', content=title), name
        canonical = page.find('link', rel='canonical')[0]['attrs']['href']
        assert page.find('meta', property='og:url', content=canonical), name
        assert all(script['attrs'].get('src') and not script['text'].strip()
                   for script in page.find('script')), (name, 'inline script')
        assert not page.find('style') and not any('style' in e['attrs'] for e in page.elements), (name, 'inline style')
    index = pages['index.html']
    visible = ' '.join(index.text)
    assert all(text in visible for text in ['Rip it', 'open.', 'Draft night', 'Domain format', 'No install', 'Tag duels', 'Free-for-all', 'Season ladder', 'Behind glass, for now.', 'Join the list', 'Your wave opens', 'Your invite'])
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
    sitemap_urls = [url.find('{*}loc').text for url in sitemap.getroot()]
    assert len(sitemap_urls) == len(set(sitemap_urls)) == 3
    assert set(sitemap_urls) == set(canonicals) - {'https://duelingdomain.com/404.html'}
    assert 'Sitemap: https://duelingdomain.com/sitemap.xml' in (PUBLIC/'robots.txt').read_text()
    manifest = json.loads((PUBLIC/'site.webmanifest').read_text())
    assert manifest['theme_color'] == manifest['background_color'] == '#0A0E1A'
    for icon in manifest['icons']: resolve(icon['src'])
    css = (PUBLIC/'style.css').read_text()
    for value in re.findall(r'url\([\'"]?([^\)\'\"]+)', css):
        if not value.startswith(('data:', '#')): resolve(value)
    assert 'html:not(.js) .step .flip' in css
    forbidden = re.compile(r'yu[\W_]*gi[\W_]*oh|king' + r'dom|duel\s+monsters', re.I)
    for file in Path(__file__).resolve().parents[1].rglob('*'):
        if not file.is_file(): continue
        assert not forbidden.search(file.name), file.name
        if file.suffix in ('.html', '.css', '.js', '.mjs', '.py', '.md', '.svg', '.txt', '.xml', '.webmanifest'):
            assert not forbidden.search(file.read_text()), file
    for name in ('index.html', '404.html', 'terms.html'):
        assert 'discord' not in pages[name].file.read_text().lower(), name
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
    for name in ('privacy.html', 'terms.html'):
        for comment in re.findall(r'<!-- OWNER: (.*?) -->', pages[name].file.read_text()):
            print(f'Owner confirmation ({name}):', comment)


if __name__ == '__main__':
    main()

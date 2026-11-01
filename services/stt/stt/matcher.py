"""Conservative card normalization with lexical and Double Metaphone matching.

Spans are half-open Unicode character offsets in the unmodified transcript.
The full catalog is consulted only for multiword names, or after a card-action cue.
"""
from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path
import re
import sqlite3
import unicodedata
from metaphone import doublemetaphone
from rapidfuzz import fuzz, process

STAPLES = {
    'Ash Blossom & Joyous Spring': ['ash', 'ash blossom'],
    'Infinite Impermanence': ['imperm'],
    'Nibiru, the Primal Being': ['nib', 'nibiru'],
    'Called by the Grave': ['called by'],
    'Maxx "C"': ['maxx c', 'max c'],
    'Effect Veiler': ['veiler'],
    'Droll & Lock Bird': ['droll', 'droll and lock bird'],
    'Ghost Belle & Haunted Mansion': ['ghost belle'],
    'Crossout Designator': ['crossout'],
    'Harpie\'s Feather Duster': ['feather duster'],
    'Monster Reborn': [], 'Raigeki': [], 'Pot of Prosperity': [],
    'Triple Tactics Talent': ['talents'],
}
CUES = {'activate', 'activation', 'summon', 'summoning', 'chain', 'set', 'play', 'with', 'send', 'discard', 'tribute', 'banish', 'target', 'attack', 'attacks'}
BOUNDARIES = CUES | {'i', 'my', 'your', 'to', 'the', 'directly', 'phase', 'damage', 'take', 'moving'}

@lru_cache(maxsize=32768)
def clean(text: str) -> str:
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower().replace('&', ' and ')
    return ' '.join(re.findall(r'[a-z0-9]+', text))

@lru_cache(maxsize=32768)
def phonetic(text: str) -> tuple[str, str]:
    return doublemetaphone(text)

@dataclass(frozen=True)
class Card:
    name: str
    passcode: int


def load_catalog(path: Path) -> tuple[list[Card], str]:
    if path.suffix in {'.cdb', '.sqlite', '.db'}:
        # Read-only: never migrate or lock the application's catalog.
        with sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True) as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            query = ('''SELECT coalesce(a.id, t.id), t.name FROM texts t
                        JOIN datas d ON d.id=t.id
                        LEFT JOIN texts a ON a.id=d.alias AND a.name=t.name'''
                     if 'texts' in tables else 'SELECT ygoprodeck_id, name FROM card_catalog')
            cards = list({Card(str(name), int(code)) for code, name in db.execute(query) if name})
        return cards, str(path)
    payload = json.loads(path.read_text())
    rows = payload.get('data', payload) if isinstance(payload, dict) else payload
    return [Card(row['name'], int(row.get('id', row.get('passcode')))) for row in rows], str(path)

class CardMatcher:
    def __init__(self, cards: list[Card]):
        # Catalog loader resolves alternate artwork aliases to canonical passcodes.
        self.cards = {clean(c.name): c for c in sorted(cards, key=lambda c: c.passcode, reverse=True)}
        self.full = {name: (card, False) for name, card in self.cards.items()}
        self.staples = {}
        for name, aliases in STAPLES.items():
            card = self.cards.get(clean(name))
            if card:
                for alias in [name, *aliases]:
                    self.staples[clean(alias)] = (card, True)
        for name in self.full:
            phonetic(name)

    def match(self, text: str, hotwords: list[str] | None = None) -> dict:
        preferred = dict(self.staples)
        for word in hotwords or []:
            name = clean(word)
            if name in self.cards:
                preferred[name] = (self.cards[name], True)
        tokens = list(re.finditer(r"[\w]+(?:['’][\w]+)?|&", text))
        candidates = []
        for start in range(len(tokens)):
            preceding = clean(tokens[start - 1].group()) if start else ''
            cue = preceding in CUES
            for size in range(min(12, len(tokens) - start), 0, -1):
                end = start + size
                span = [tokens[start].start(), tokens[end - 1].end()]
                phrase = clean(text[span[0]:span[1]])
                words = phrase.split()
                exact = phrase in self.full or phrase in preferred
                if not words or (not exact and (words[0] in BOUNDARIES or words[-1] in BOUNDARIES)):
                    continue
                # Never consume a verb/phase inside a possible card span.
                if not exact and any(w in CUES | {'phase', 'damage', 'directly'} for w in words):
                    continue
                if len(words) == 1 and not cue and phrase not in preferred:
                    continue
                pools = [(preferred, 0.83)]
                if cue or len(words) >= 2:
                    pools.append((self.full, 0.93))
                for pool, threshold in pools:
                    if not pool:
                        continue
                    hits = process.extract(phrase, pool.keys(), scorer=fuzz.ratio, score_cutoff=70, limit=3)
                    for name, lexical, _ in hits:
                        card, priority = pool[name]
                        if name != clean(card.name) and end < len(tokens):
                            if clean(tokens[end].group()) not in BOUNDARIES and not re.search(r'[,.;!?]', text[span[1]:tokens[end].start()]):
                                continue
                        if abs(len(name.split()) - len(words)) > 1:
                            continue
                        a, b = set(filter(None, phonetic(phrase))), set(filter(None, phonetic(name)))
                        phone = 100 if a & b else max((fuzz.ratio(x, y) for x in a for y in b), default=0)
                        score = (0.82 * lexical + 0.18 * phone) / 100
                        if priority and len(words) >= 2 and a & b:
                            score = max(score, 0.88)
                        if score < threshold or (len(words) == 1 and lexical < 85):
                            continue
                        candidates.append((score + (0.015 if priority else 0), size, span, card, score, phrase == clean(card.name)))
        selected = []
        for _, _, span, card, score, exact in sorted(candidates, key=lambda c: (c[5], c[1] if c[5] else 0, c[0], c[1]), reverse=True):
            if any(span[0] < s['span'][1] and s['span'][0] < span[1] for s in selected):
                continue
            selected.append({'name': card.name, 'passcode': card.passcode, 'score': round(score, 4), 'span': span})
        selected.sort(key=lambda s: s['span'][0])
        normalized = text
        for match in reversed(selected):
            a, b = match['span']
            normalized = normalized[:a] + match['name'] + normalized[b:]
        return {'text': text, 'normalizedText': normalized, 'cardMatches': selected}

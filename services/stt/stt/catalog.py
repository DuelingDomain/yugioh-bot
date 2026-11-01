"""Resolve an existing local catalog, or cache YGOPRODeck's names on first start."""
import json
import os
from pathlib import Path
import urllib.request
from .download import MODEL_ROOT, DATA_ROOT


def catalog_path() -> Path:
    explicit = os.getenv('STT_CARD_CATALOG')
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise FileNotFoundError(f'STT_CARD_CATALOG does not exist: {path}')
        return path
    local = DATA_ROOT / 'duel-engine/cards.cdb'
    if local.is_file():
        return local
    target = MODEL_ROOT / 'card-names.json'
    if not target.is_file():
        # Only names/passcodes are retained, never card images or descriptions.
        request = urllib.request.Request('https://db.ygoprodeck.com/api/v7/cardinfo.php', headers={'User-Agent': 'DuelingDomain-STT/1.0'})
        with urllib.request.urlopen(request, timeout=120) as response:
            cards = json.load(response)['data']
        MODEL_ROOT.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.partial')
        temporary.write_text(json.dumps([{'id': c['id'], 'name': c['name']} for c in cards]))
        temporary.replace(target)
    return target

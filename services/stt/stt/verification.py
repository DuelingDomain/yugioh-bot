"""Best-effort second-pass policy; scores are matcher similarities, not probabilities."""
import re

COMMAND = re.compile(r'\b(?:attack(?:s|ing|ed)?|lp|life(?:\s*points?)?|damage|pay|lose|lost|gain|recover|take)\b', re.I)


def needs_verification(result, threshold):
    return bool(COMMAND.search(result['text'])) or any(
        match['score'] < threshold for match in result['cardMatches'])


def has_card_correction(original, verified, confidence):
    previous = {match['passcode'] for match in original['cardMatches']}
    return any(match['score'] >= confidence and match['passcode'] not in previous
               for match in verified['cardMatches'])

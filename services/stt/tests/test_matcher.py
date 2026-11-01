"""Small regression test: card correction must preserve commands and player names."""
import unittest
from stt.matcher import Card, CardMatcher

class MatcherTest(unittest.TestCase):
    def test_card_spans_and_command_negatives(self):
        matcher = CardMatcher([
            Card('Blue-Eyes White Dragon', 89631139),
            Card('Dark Magician', 46986414),
            Card('Ash Blossom & Joyous Spring', 14558127),
            Card('Battle', 1),  # Short catalog names must not hijack phase commands.
            Card('Imran', 2),
        ])
        text = 'Blue eyes white dragoon attacks dark magician'
        result = matcher.match(text, ['Blue-Eyes White Dragon', 'Dark Magician'])
        self.assertEqual(result['normalizedText'], 'Blue-Eyes White Dragon attacks Dark Magician')
        self.assertEqual([m['passcode'] for m in result['cardMatches']], [89631139, 46986414])
        self.assertEqual(text[slice(*result['cardMatches'][0]['span'])], 'Blue eyes white dragoon')
        self.assertEqual(matcher.match('I activate ash blossom and joyous spring')['cardMatches'][0]['passcode'], 14558127)
        self.assertEqual(matcher.match('I activate ash')['cardMatches'][0]['passcode'], 14558127)
        self.assertEqual(matcher.match('I activate ashe', ['Ash Blossom & Joyous Spring'])['cardMatches'][0]['passcode'], 14558127)
        for command in ['moving to standby phase', 'battle phase', 'take 2400 damage', 'Imran attack directly', 'I summon something incomprehensible']:
            self.assertEqual(matcher.match(command)['cardMatches'], [], command)
        self.assertEqual(matcher.match('I summon dark magician')['cardMatches'][0]['span'], [9, 22])

if __name__ == '__main__':
    unittest.main()

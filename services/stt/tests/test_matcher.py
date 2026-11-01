"""Small regression test: card correction must preserve commands and player names."""
import unittest
from stt.matcher import Card, CardMatcher

class MatcherTest(unittest.TestCase):
    def test_verification_policy(self):
        from stt.verification import needs_verification, has_card_correction
        def result(text='end turn', *matches):
            return {'text': text, 'cardMatches': [dict(passcode=code, score=score) for code, score in matches]}
        self.assertFalse(needs_verification(result(), .95))
        self.assertFalse(needs_verification(result('summon', (1, .95)), .95))
        self.assertTrue(needs_verification(result('summon', (1, .94)), .95))
        for text in ['attack directly', 'Blue Eyes attacks', 'take 2400 damage', 'pay 800 LP', 'gain eight hundred life points', 'lose 500', 'recover 1000', 'take 2400', 'set my life to 8000']:
            self.assertTrue(needs_verification(result(text), .95), text)
        original = result('summon', (1, .88))
        self.assertFalse(has_card_correction(original, result('summon', (1, 1)), .95))
        self.assertFalse(has_card_correction(original, result('summon', (2, .94)), .95))
        self.assertFalse(has_card_correction(original, result(), .95))
        self.assertTrue(has_card_correction(original, result('summon', (2, .95)), .95))
        self.assertTrue(has_card_correction(result('attack'), result('attack', (2, 1)), .95))

    def test_card_spans_and_command_negatives(self):
        matcher = CardMatcher([
            Card('Blue-Eyes White Dragon', 89631139),
            Card('Dark Magician', 46986414),
            Card('Dark Magician Girl', 38033121),
            Card('Ash Blossom & Joyous Spring', 14558127),
            Card('Battle', 1),  # Short catalog names must not hijack phase commands.
            Card('Imran', 2),
            Card('Set Rotation', 73468603),
            Card('Raigeki', 12580477),
        ])
        text = 'Blue eyes white dragoon attacks dark magician'
        result = matcher.match(text, ['Blue-Eyes White Dragon', 'Dark Magician'])
        self.assertEqual(result['normalizedText'], 'Blue-Eyes White Dragon attacks Dark Magician')
        self.assertEqual([m['passcode'] for m in result['cardMatches']], [89631139, 46986414])
        self.assertEqual(text[slice(*result['cardMatches'][0]['span'])], 'Blue eyes white dragoon')
        self.assertEqual(matcher.match('I activate ash blossom and joyous spring')['cardMatches'][0]['passcode'], 14558127)
        self.assertEqual(matcher.match('I activate ash')['cardMatches'][0]['passcode'], 14558127)
        self.assertEqual(matcher.match('I activate ashe', ['Ash Blossom & Joyous Spring'])['cardMatches'][0]['passcode'], 14558127)
        self.assertEqual(matcher.match('I activate Set Rotation')['cardMatches'][0]['passcode'], 73468603)
        self.assertEqual(matcher.match('Raigeki')['cardMatches'][0]['passcode'], 12580477)
        for command in ['moving to standby phase', 'battle phase', 'take 2400 damage', 'Imran attack directly', 'I summon something incomprehensible']:
            self.assertEqual(matcher.match(command)['cardMatches'], [], command)
        self.assertEqual(matcher.match('I summon dark magician')['cardMatches'][0]['span'], [9, 22])
        self.assertEqual(matcher.match('I summon Dark Magician Girl', ['Dark Magician'])['cardMatches'][0]['passcode'], 38033121)

if __name__ == '__main__':
    unittest.main()

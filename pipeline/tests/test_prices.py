import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prices import apply_td_prices, quote_for  # noqa: E402


MARKETS = {
    "td": [{"player": "Jonah Coleman", "point": 0.5, "over": {"bestAmerican": -130, "bestBook": "espnbet"}}],
    "rush_yds": [
        {"player": "Jonah Coleman", "point": 74.5, "over": {"bestAmerican": -110, "bestBook": "fanduel"}},
    ],
}


class PriceTest(unittest.TestCase):
    def test_exact_line_is_used_and_a_different_line_is_not_invented(self):
        found = quote_for(MARKETS, "td", "Jonah Coleman", "over", 0.5)
        self.assertEqual(found["price"], -130)
        self.assertEqual(found["book"], "theScore Bet")
        missed = quote_for(MARKETS, "rush_yds", "Jonah Coleman", "over", 80.5)
        self.assertEqual(missed, {"mismatch": 74.5})
        self.assertIsNone(quote_for(MARKETS, "td", "Nobody", "over", 0.5))

    def test_a_saved_price_is_not_replaced(self):
        game = {"key": "DEN@PIT", "sides": [{"rows": [{
            "confident": {"player": "Jonah Coleman", "prop": "Anytime TD", "price": "-125", "book": "Polymarket"},
            "relativelySafe": None,
            "upside": [{"player": "Jonah Coleman", "prop": "2+ TDs", "price": None, "book": None}],
        }]}]}
        apply_td_prices(game, {"td": MARKETS["td"], "td2": []}, "Nov 27, 11:00 AM ET", "https://getoddy.com/example")
        self.assertEqual(game["sides"][0]["rows"][0]["confident"]["price"], "-125")
        self.assertEqual(game["sides"][0]["rows"][0]["confident"]["book"], "Polymarket")


if __name__ == "__main__":
    unittest.main()

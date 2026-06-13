"""
Unit tests for the deterministic backend logic.

Run from the project root:
    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest

# Make the project root importable when running from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


class TestAssessBudget(unittest.TestCase):
    def test_comfortably_within(self):
        r = app.assess_budget(per_day_cost=100, budget=300)
        self.assertEqual(r["klass"], "ok")
        self.assertIn("headroom", r["advice"])

    def test_tight_but_feasible(self):
        # ratio between 0.85 and 1.0
        r = app.assess_budget(per_day_cost=95, budget=100)
        self.assertEqual(r["klass"], "warn")

    def test_over_budget(self):
        r = app.assess_budget(per_day_cost=150, budget=100)
        self.assertEqual(r["klass"], "over")
        self.assertIn("Over by", r["advice"])

    def test_boundary_at_85_percent_is_ok(self):
        r = app.assess_budget(per_day_cost=85, budget=100)
        self.assertEqual(r["klass"], "ok")

    def test_zero_budget_does_not_crash(self):
        r = app.assess_budget(per_day_cost=50, budget=0)
        self.assertEqual(r["klass"], "over")  # division guarded by max(budget,1)


class TestValidate(unittest.TestCase):
    def test_clamps_people_and_budget(self):
        out = app.validate({"breakfast": True, "people": 999, "budget": -5})
        self.assertEqual(out["people"], 12)      # capped at 12
        self.assertEqual(out["budget"], 1)       # floored at 1

    def test_requires_at_least_one_meal(self):
        with self.assertRaises(ValueError):
            app.validate({"people": 2, "budget": 300})

    def test_unknown_diet_defaults_to_veg(self):
        out = app.validate({"lunch": True, "diet": "carnivore-only"})
        self.assertEqual(out["diet"], "veg")

    def test_daytext_is_capped(self):
        out = app.validate({"dinner": True, "dayText": "x" * 5000})
        self.assertLessEqual(len(out["dayText"]), 600)

    def test_non_dict_payload_rejected(self):
        with self.assertRaises(ValueError):
            app.validate(["not", "a", "dict"])


class TestNormalize(unittest.TestCase):
    def base_params(self):
        return {"people": 2, "budget": 300, "meals": ["breakfast"], "diet": "veg",
                "cuisine": "indian", "maxPrep": 45, "dayText": ""}

    def test_scales_cost_by_people_and_aggregates_grocery(self):
        tool_input = {
            "meals": [
                {"slot": "breakfast", "name": "Poha", "prep_minutes": 15,
                 "cost_per_serving": 25, "ingredients": ["Onion 1", "Peanuts 15g"]},
            ],
            "substitutions": [{"from": "paneer", "swap": "tofu", "note": "cheaper"}],
        }
        out = app.normalize(tool_input, self.base_params())
        self.assertEqual(out["plan"]["breakfast"]["mealCost"], 50)  # 25 * 2 people
        self.assertEqual(out["budget"]["perDayCost"], 50)
        self.assertEqual(len(out["grocery"]), 2)
        self.assertEqual(out["source"], "ai")

    def test_ignores_invalid_meal_slot(self):
        tool_input = {"meals": [{"slot": "brunch", "name": "X", "prep_minutes": 5,
                                 "cost_per_serving": 10, "ingredients": []}],
                      "substitutions": []}
        out = app.normalize(tool_input, self.base_params())
        self.assertEqual(out["plan"], {})


class TestParseJsonBlock(unittest.TestCase):
    def test_strips_code_fences(self):
        raw = '```json\n{"meals": [], "substitutions": []}\n```'
        self.assertEqual(app.parse_json_block(raw), {"meals": [], "substitutions": []})

    def test_extracts_object_from_surrounding_prose(self):
        raw = 'Sure! Here is your plan: {"meals": [], "substitutions": []} Enjoy.'
        self.assertEqual(app.parse_json_block(raw), {"meals": [], "substitutions": []})


if __name__ == "__main__":
    unittest.main()

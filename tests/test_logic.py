"""
Unit tests for the deterministic backend logic that must stay trustworthy:
wellness scoring, crisis detection, input validation, and normalization.

Run from the project root:
    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest

# Make the project root importable when running from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402


class TestAssessWellness(unittest.TestCase):
    def test_high_mood_good_sleep_is_steady(self):
        r = app.assess_wellness(mood=5, sleep_hours=8, trigger_count=0)
        self.assertEqual(r["klass"], "ok")
        self.assertEqual(r["state"], "Steady")
        self.assertGreaterEqual(r["score"], 75)

    def test_low_mood_poor_sleep_many_triggers_is_overwhelmed(self):
        r = app.assess_wellness(mood=1, sleep_hours=3, trigger_count=4)
        self.assertEqual(r["klass"], "over")
        self.assertEqual(r["state"], "Overwhelmed")

    def test_score_is_clamped_between_5_and_100(self):
        low = app.assess_wellness(mood=1, sleep_hours=0, trigger_count=10)
        high = app.assess_wellness(mood=5, sleep_hours=9, trigger_count=0)
        self.assertGreaterEqual(low["score"], 5)
        self.assertLessEqual(high["score"], 100)

    def test_missing_sleep_does_not_crash(self):
        r = app.assess_wellness(mood=3, sleep_hours=None, trigger_count=2)
        self.assertIn(r["klass"], ("ok", "warn", "over"))

    def test_poor_sleep_lowers_score(self):
        rested = app.assess_wellness(mood=3, sleep_hours=8, trigger_count=0)
        tired = app.assess_wellness(mood=3, sleep_hours=4, trigger_count=0)
        self.assertLess(tired["score"], rested["score"])


class TestDetectCrisis(unittest.TestCase):
    def test_normal_text_is_not_crisis(self):
        self.assertFalse(app.detect_crisis("Stressed about my NEET mock scores")["crisis"])

    def test_self_harm_text_is_crisis_with_helplines(self):
        r = app.detect_crisis("honestly I want to die, there's no point")
        self.assertTrue(r["crisis"])
        self.assertTrue(len(r["helplines"]) >= 1)
        self.assertIn("14416", r["helplines"][0]["contact"])

    def test_detection_is_case_insensitive(self):
        self.assertTrue(app.detect_crisis("I want to KILL MYSELF")["crisis"])

    def test_empty_text_is_safe(self):
        self.assertFalse(app.detect_crisis("")["crisis"])
        self.assertFalse(app.detect_crisis(None)["crisis"])


class TestValidateReflect(unittest.TestCase):
    def test_clamps_out_of_range_values(self):
        out = app.validate_reflect({
            "mood": 99, "journal": "tired and behind on the syllabus",
            "sleepHours": 200, "daysToExam": "40", "exam": "jee",
        })
        self.assertEqual(out["mood"], 5)
        self.assertEqual(out["sleepHours"], 24)
        self.assertEqual(out["daysToExam"], 40)
        self.assertEqual(out["exam"], "jee")

    def test_unknown_exam_defaults_to_other(self):
        out = app.validate_reflect({"journal": "feeling low today", "exam": "olympiad"})
        self.assertEqual(out["exam"], "other")

    def test_empty_journal_rejected(self):
        with self.assertRaises(ValueError):
            app.validate_reflect({"journal": "  "})

    def test_blank_optional_fields_become_none(self):
        out = app.validate_reflect({"journal": "okay day", "sleepHours": "", "daysToExam": ""})
        self.assertIsNone(out["sleepHours"])
        self.assertIsNone(out["daysToExam"])

    def test_journal_is_length_capped(self):
        out = app.validate_reflect({"journal": "x" * 5000})
        self.assertLessEqual(len(out["journal"]), 2000)


class TestNormalize(unittest.TestCase):
    def _params(self):
        return {"mood": 2, "journal": "j", "exam": "neet", "daysToExam": 30, "sleepHours": 5}

    def test_shapes_model_output_and_adds_wellness(self):
        tool_input = {
            "emotion": "anxious",
            "triggers": [{"label": "Behind on syllabus", "category": "academic"}],
            "patterns": "You tie worth to scores.",
            "strategies": [{"title": "Time-box", "detail": "25 min timer"}],
            "mindfulness": {"name": "Box breathing", "duration": "2 min", "steps": ["in", "out"]},
            "encouragement": "You've got this.",
        }
        out = app.normalize(tool_input, self._params(), {"crisis": False})
        self.assertEqual(out["source"], "ai")
        self.assertEqual(len(out["triggers"]), 1)
        self.assertEqual(len(out["strategies"]), 1)
        self.assertIn("score", out["wellness"])
        self.assertEqual(out["safety"]["crisis"], False)

    def test_missing_mindfulness_gets_default(self):
        out = app.normalize({"emotion": "low"}, self._params(), {"crisis": False})
        self.assertTrue(out["mindfulness"]["steps"])  # default steps filled in

    def test_drops_malformed_triggers(self):
        out = app.normalize({"triggers": ["not-a-dict", {"category": "x"}]}, self._params(), {"crisis": False})
        self.assertEqual(out["triggers"], [])  # neither has a label


class TestCleanAnonId(unittest.TestCase):
    def test_strips_unsafe_chars(self):
        self.assertEqual(app.clean_anon_id("ab.cd/../x'; DROP"), "abcdxDROP")

    def test_caps_length(self):
        self.assertLessEqual(len(app.clean_anon_id("a" * 200)), 64)

    def test_empty_becomes_none(self):
        self.assertIsNone(app.clean_anon_id(""))
        self.assertIsNone(app.clean_anon_id(None))

    def test_keeps_uuid(self):
        uid = "550e8400-e29b-41d4-a716-446655440000"
        self.assertEqual(app.clean_anon_id(uid), uid)


class TestBuildCheckinRow(unittest.TestCase):
    def _res(self):
        return {
            "emotion": "anxious", "source": "ai",
            "wellness": {"score": 42, "state": "Strained"},
            "triggers": [{"label": "Behind", "category": "academic"}],
            "safety": {"crisis": True},
        }

    def test_maps_fields(self):
        row = app.build_checkin_row("user-1", {"mood": 2, "exam": "neet", "journal": "tired", "sleepHours": 5, "daysToExam": 30}, self._res())
        self.assertEqual(row["anon_id"], "user-1")
        self.assertEqual(row["mood"], 2)
        self.assertEqual(row["wellness_score"], 42)
        self.assertEqual(row["wellness_state"], "Strained")
        self.assertTrue(row["crisis"])
        self.assertEqual(len(row["triggers"]), 1)

    def test_clamps_and_defaults(self):
        row = app.build_checkin_row("u", {"mood": 99, "journal": "x" * 5000}, {})
        self.assertEqual(row["mood"], 5)
        self.assertLessEqual(len(row["journal"]), 2000)
        self.assertEqual(row["wellness_score"], 0)
        self.assertFalse(row["crisis"])
        self.assertEqual(row["triggers"], [])

    def test_handles_missing_optional_numbers(self):
        row = app.build_checkin_row("u", {"mood": 3, "journal": "ok", "sleepHours": "", "daysToExam": ""}, self._res())
        self.assertIsNone(row["sleep_hours"])
        self.assertIsNone(row["days_to_exam"])


class TestParseJsonBlock(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(app.parse_json_block('{"a": 1}'), {"a": 1})

    def test_strips_code_fences(self):
        self.assertEqual(app.parse_json_block('```json\n{"a": 1}\n```'), {"a": 1})

    def test_extracts_json_amid_prose(self):
        self.assertEqual(app.parse_json_block('Here you go: {"a": 1} hope that helps'), {"a": 1})


if __name__ == "__main__":
    unittest.main()

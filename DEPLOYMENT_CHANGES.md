# Deployed version — changes / updates

> Submission-ready summary (955 characters, under the 1000 limit).

MannMitra: a GenAI mental-wellness companion for students facing high-stakes exams (NEET/JEE/CUET/CAT/GATE/UPSC/boards).

Updates in this deployment:
• Daily check-in: an LLM analyses open-ended journaling + mood to surface hidden stress triggers and emotional patterns, returning tailored coping strategies, an adaptive mindfulness exercise and encouragement.
• Always-on companion chat for real-time empathetic support.
• "My history" wellness-trend chart, stored in Supabase via a per-device anonymous ID (localStorage fallback).
• Safety: server-side crisis detection with verified India helplines (Tele-MANAS 14416), never left to the model.
• Deterministic wellness score; full offline fallback so it works without a key.
• Security: CSP + headers, input validation, HTML-escaping, Supabase RLS.
• Performance: pooled HTTP sessions, lazy clients, static caching.
• Clean modular code, 35 tests, ARIA accessibility, warm light theme.

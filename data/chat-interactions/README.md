# Chatbot Interaction Logs

The application writes local chatbot interaction records here as JSON Lines in
`chatbot-interactions.jsonl`.

The log is intended to improve the app-help question bank and action parser.
Records include the user's prompt, response metadata, action summary, and form
state keys only. They do not store the full calculator form state. PAN,
Aadhaar, email, and phone-like values are redacted before storage.

Set `CHATBOT_INTERACTION_LOG_DIR` to redirect logs during tests or local
experiments.

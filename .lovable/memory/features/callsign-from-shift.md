Callsign and operator_id are always populated from the active shift record, never extracted from transcripts.

- The assess prompt explicitly tells Claude to set callsign and operator_id to null
- LiveTab overrides structured.callsign and structured.operator_id from getSession() after every assessment call
- This eliminates Whisper misread issues (e.g. "Delta Force", "Autocontrol", truncated NATO phonetics)
- All callsign extraction instructions and Whisper correction tables removed from the assess prompt

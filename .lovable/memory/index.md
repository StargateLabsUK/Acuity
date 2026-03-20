Design constraints and preferences for Herald project

- Minimum font size on mobile: 18px (text-lg). No text-xs, text-sm, text-base, or inline fontSize < 18 on mobile.
- Command page background: --herald-command-bg: #1A1E24
- Mobile report detail: no scrolling boxes, content expands to fit
- Feed items styled as cards with rounded-lg, shadow-sm, bg-card
- Shift login uses Barlow Condensed 800 for wordmark and button
- Session data (callsign, operator_id, service, station) attached to every report
- Reports tab filtered by current session callsign + today's date
- Command dashboard has filter bar: service, callsign, time range
- Reports only saved to DB after HERALD confirm (not on assessment)
- Data mismatch is shown on Herald field app only, not editable on Command

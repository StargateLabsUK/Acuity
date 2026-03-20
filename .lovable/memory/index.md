Design constraints and preferences for Herald project

- Minimum font size on mobile: 18px (text-lg). No text-xs, text-sm, text-base, or inline fontSize < 18 on mobile.
- Command page background: --herald-command-bg: #1A1E24
- Mobile report detail: no scrolling boxes, content expands to fit
- Feed items styled as cards with rounded-lg, shadow-sm, bg-card
- Shift login uses Barlow Condensed 800 for wordmark and button
- Session data (callsign, operator_id, service, station) attached to every report
- Reports tab filtered by current session callsign + today's date
- Command dashboard has filter bar: service, callsign, time range
- Shifts table in Supabase: id, callsign, service, station, operator_id, started_at, ended_at
- shift_id column on herald_reports links reports to shifts
- sync-shift edge function handles start/end shift actions
- herald-session.ts stores shift_id in localStorage session, syncs to Supabase
- OPS LOG tab on Command: shift history with expandable reports, search by incident/collar/callsign, filter by service/station/date
- herald-sync.ts attaches shift_id to every synced report payload

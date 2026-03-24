Design constraints and preferences for Herald project

- Minimum font size on mobile: 18px (text-lg). No text-xs, text-sm, text-base, or inline fontSize < 18 on mobile.
- Command page background: --herald-command-bg: #1A1E24
- Mobile report detail: no scrolling boxes, content expands to fit
- Feed items styled as cards with rounded-lg, shadow-sm, bg-card
- Shift login uses Barlow Condensed 800 for wordmark and button
- Session data (callsign, operator_id, service, station, trust_id) attached to every report
- Reports tab filtered by current session callsign + today's date
- Command dashboard has filter bar: service, callsign, time range
- Trust PIN cached on device for 30 days via localStorage (herald_trust key)
- trust_id column on herald_reports, incident_transmissions, shifts
- /login page for command/admin users (Supabase Auth)
- /admin page for admin role only (4 tabs: Trusts, Users, Audit, Devices)
- Seed: Arion Test Trust (PIN 123456), arran@arion.industries (admin), command@arion.industries (command), password Herald2026!
- MFA bypass: 000000 accepted for Arion Test Trust

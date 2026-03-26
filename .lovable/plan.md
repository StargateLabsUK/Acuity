

## Shift Link Code System

**Goal**: Crew starts shift on iPad → gets a 6-digit code → enters code on handheld device → handheld joins the same shift session without re-entering details.

### Flow

```text
iPad (Incidents page)                    Handheld (/ page)
─────────────────────                    ─────────────────
1. Crew logs in via ShiftLogin           
2. System generates 6-digit link code    
3. Code displayed on screen              
                                         4. Opens / page, sees "Enter link code"
                                         5. Enters 6-digit code
                                         6. Fetches shift details from DB
                                         7. Session loaded → LiveTab appears
```

### Database Changes

**New table: `shift_link_codes`**
- `id` uuid PK
- `shift_id` uuid (references shifts)
- `code` text (6-digit numeric, unique)
- `trust_id` uuid
- `session_data` jsonb (full HeraldSession object)
- `created_at` timestamptz
- `expires_at` timestamptz (e.g. 15 minutes from creation)
- `used_at` timestamptz (nullable — marks code as consumed)

RLS: anon/authenticated can select and insert.

### Edge Function: `link-shift`

Two actions:
- **`generate`**: Called after shift starts on iPad. Creates a random 6-digit code, stores it with the shift session data, returns the code. Expires after 15 min.
- **`redeem`**: Called from handheld. Takes the 6-digit code, validates it's not expired/used, returns the full session data, marks code as used.

### Frontend Changes

1. **`src/components/herald/ShiftLinkCode.tsx`** (new)
   - Displayed on the Incidents page after shift login
   - Shows the 6-digit code in large monospaced text
   - "Generate new code" button to refresh
   - Auto-generates code on mount by calling the edge function

2. **`src/components/herald/ShiftLogin.tsx`** (modify)
   - Add a "Link to existing shift" option below the BEGIN SHIFT button
   - When tapped, shows 6-digit code entry (similar to TrustPinEntry)
   - On valid code, loads the session and starts

3. **`src/pages/Incidents.tsx`** (modify)
   - After shift login, show the link code component (e.g. in the shift details area above Active Incidents)

4. **`src/pages/Index.tsx`** (modify)
   - ShiftLogin already gates access — the new "link to shift" flow in ShiftLogin handles everything

5. **`src/lib/herald-session.ts`** (modify)
   - Add `generateLinkCode(session)` and `redeemLinkCode(code)` API functions calling the edge function

### Technical Details

- Code generation: random 6-digit numeric string, collision-checked against active codes
- Expiry: 15 minutes, enforced server-side
- A code can only be used once (set `used_at` on redemption)
- The handheld gets the same `shift_id`, `callsign`, `trust_id`, etc. so all reports link to the same shift
- Multiple handhelds could link to the same shift if needed (remove single-use constraint later)


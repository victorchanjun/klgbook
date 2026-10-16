# PG Booker — PerfectGym Booking Script Generator

Single-file generator (open `index.html` in any browser) that produces a paste-into-console
auto-booker for PerfectGym client portals (Kallang, State Sport Centres, etc.).

Built 2026-10-17 from:
- **klgbook** (victorchanjun) — the 3-step wizard API, clock sync, session pool, wave firing
- **Badminton_Duc** (sagameko) — login endpoint, `GetWeeklySchedule` availability API,
  `RuleId` returned from step 2, MyBookings/Cancel endpoints
- **PerfectGym help docs** — per-member-rate booking windows (7d vs 14d), slot generation logic
- klgbook's **commit history** — the rate-limiting arc (nuclear → 429 storms → conservative)

## Usage
1. Open `index.html`, fill in base URL / clubId / zoneTypeId (all visible in the portal's
   FacilityBooking URL), email + password, target date, priority times, duration.
2. Generate → copy script.
3. Open the portal, **log out**, open DevTools console, paste, Enter. Keep tab + screen awake.
4. Console logs the run; on success: `[BOOKED!]` + payment redirect.

Generated handle exposes `stop()`, `status()`, `stats()` on the returned object.

## What it does (and why)
- **Auto-login + mid-run re-login** — JWTs die after 30 min inactivity; the script logs in
  itself and re-authenticates on 401/403 mid-run. No token juggling during long waits.
- **Server-clock sync** (median of 3 Date-header samples) — firing is timed to the *server's*
  open instant, not your clock.
- **Auto open-detection** — polls `GetWeeklySchedule` (15s → 5s → 3s → 1s as open approaches)
  and fires the instant the slot turns `Bookable`. Booking windows vary by member rate
  (7/14/21/28 days), so no hardcoded "T−7d" assumption. Fallback trigger: zones appearing in
  the wizard `Start` response.
- **Priority-time fall-through** — best time taken? Waves automatically move to the next
  priority time and rebuild the session pool.
- **Session pool + adaptive waves** — one wizard session per court, refreshed on a keepalive
  cycle; wave interval widens ×1.6 on 429s (cap 5s) and tightens on 10 healthy waves.
  Presets: conservative (2s/1/1), balanced (800ms/1/2), nuclear (250ms/2/3).
- **Sniper** — after the open window, keeps polling (8s) until N hours before the slot and
  fires on cancellations. This is the big super-peak edge: released slots are where bookings
  actually get made.
- **Auto ruleId** — read from step 2's response (as the real portal does); no hardcoded 19.
- **Wizard auto-detect** — probes `BuyProductBeforeBookingFacility` then `BookFacility`
  (SG vs AU portal variants) on first run.
- **Dedupe** — parallel shots can double-book the same slot; after a booking, the script
  lists MyBookings and cancels duplicates for the same slot/time.
- **Wake lock** — keeps the screen awake (auto-reacquires on release).

## Verified
End-to-end Node simulation against a mock PerfectGym server (all 3 wizard endpoints,
availability API, login, MyBookings/Cancel): slot-open detection → pool build → booking,
mid-run 401 → automatic re-login, duplicate booking → automatic cancel. All pass.
`node --check` clean; generated script contains no backticks/`${` (safe as a template literal).

## Honest limitations
- **Payment still required** — a booking is only confirmed after you complete payment
  (portal redirect / email instructions). No script can skip this.
- **Rate limiting is a real opponent** — sustained aggressive firing (nuclear preset) risks
  401/403/account flags. Balanced is the sane default; adaptive pacing backs off
  automatically on 429s.
- **API drift** — PerfectGym changes endpoints occasionally (Badminton_Duc's README says the
  same). If the wizard probe fails, open the portal's Network tab, find the `Start` call,
  and update the candidate list in `resolveWizard()`.
- **ToS** — aggressive automation may breach your club's terms. Use at your own discretion.
- Not tested against the live server (no credentials); the simulation covers the logic,
  not PerfectGym's live rate-limit thresholds.

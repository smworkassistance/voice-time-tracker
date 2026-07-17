# Voice Time Tracker — Architecture Reference

> **Purpose of this file:** a precise, current-state technical map of the
> system, written so a new Claude Code session (or Videh, returning after a
> break) can regain full working context without re-deriving it from git
> history or chat logs. This file should be kept accurate as things change —
> if you make an architectural change, update this file in the same
> sitting. For the *why* behind design decisions, see `PHILOSOPHY.md`.

## 1. System overview

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  index.html          │      │  Cloudflare Worker    │      │  Google Cloud    │
│  (GitHub Pages,       │─────▶│  orange-violet-75d5   │─────▶│  Speech-to-Text  │
│  static, single file) │      │  .workers.dev         │      │                  │
│                       │      │  (holds all secrets)  │      └─────────────────┘
│  localStorage = source│      │                       │      ┌─────────────────┐
│  of truth on-device   │◀─────│  Supabase REST calls  │      │  Gemini 2.5      │
└──────────┬────────────┘      │  (service_role key)   │─────▶│  Flash           │
           │                    └──────────┬────────────┘      └─────────────────┘
           │ fire-and-forget                │
           │ cloud sync                      ▼
           │                    ┌──────────────────────┐
           └───────────────────▶│  Supabase Postgres     │
                                 │  ("chain-app" project) │
                                 └──────────────────────┘
```

Nothing calls Google or Gemini directly from the browser — everything
routes through the Worker, which is the only place API keys live.

## 2. Repository layout

```
VOICE_TIME_TRACKER_SPEC.md   Original thought-flow / user-journey doc (Videh's
                              initial vision). Now stale on technical details
                              (predates cloud STT, Supabase, behavioral
                              analysis) but left as-is as a historical record.
PHILOSOPHY.md                 Design principles (see that file).
ARCHITECTURE.md               This file.
index.html                    The LIVE app — what's actually deployed and used
                              daily. Only ever overwritten on explicit
                              "promote this version" instruction from Videh.
index-vX.html                 Preview/experiment builds sitting at repo root.
                              Each is a full standalone copy with one feature
                              (or a deliberate merge of two) added on top of
                              whatever index.html was at the time it branched.
                              Live at
                              smworkassistance.github.io/voice-time-tracker/index-vX.html
                              for testing before promotion.
versions/                     Archive of every index.html that was ever live,
                              plus every preview build that has been
                              superseded. Nothing here is deployed or tested
                              against — pure history.
worker/src/index.js           The Cloudflare Worker source. NOT versioned the
                              way the frontend is — there is only ever one
                              current version, edited in place and
                              redeployed. Git history is its version record.
worker/supabase-schema.sql    DDL for both Supabase tables. Run manually in
                              the Supabase SQL editor — not applied by any
                              migration tooling.
worker/wrangler.toml,
worker/package.json           Present for a possible future switch to
                              wrangler-CLI deploys. Not currently used —
                              deploys are done by pasting worker/src/index.js
                              into the Cloudflare dashboard's Quick Edit and
                              clicking Deploy (see §6).
```

## 3. Current live state (check this before assuming what's deployed)

As of the last promotion (`git log` — "Promote v1.10 to live"), `index.html`
has: three timers, voice logging via Cloudflare-proxied Google STT,
Gemini-based tag classification (Hindi/Hinglish-aware), the full-day
editable timeline (tappable gaps, splitting, edit/delete any entry),
light/dark mode, and cross-device sync of the live running activity.

It does **not** yet have (these exist only in unpromoted previews,
currently up to `index-v1.15.html`): the full-screen Reports page, the
focus heatmap, the recurring-activities view, the focus-consistency
sparkline, or the AI prediction narrative. Do not assume any preview
feature is live without checking `index.html` directly (`grep` for a
distinctive function name is the fastest check, e.g. `computeHeatmapData`,
`report-header`).

**To see the exact feature set of the live file at any point in time**, the
promotion commits are the ones to read (search git log for "Promote").
Everything between two promotion commits is preview-only.

## 4. Client-side data model (`state`, persisted to `localStorage`)

Grows slightly with each preview version as new caches are added. Shape as
of `index-v1.15.html` (the most complete version so far):

```js
{
  history: {
    "YYYY-MM-DD": [
      { id, name, tag, rawText, start, end, duration }, ...
    ]
  },
  currentActivity: { id, name, tag, rawText, start } | null,
  currentActivityUpdatedAt: <ms timestamp>,   // for cross-device last-write-wins
  todayKey: "YYYY-MM-DD",
  lang: "en-IN" | "hi-IN",
  theme: "dark" | "light",
  insightsCache: { "YYYY-MM-DD": { score, insightsHtml } },      // per-day AI insights, past days only
  recurringCache: { entryCount, clusters } | null,                // Gemini name-clustering result
  predictionCache: { entryCount, predictions } | null              // AI prediction narrative
}
```

`entryCount`-keyed caches are invalidated by comparing against the current
total count of logged entries — cheap way to detect "new data exists" without
a real change-tracking system. `insightsCache` never caches *today* (today's
data is still changing); it only caches completed past days.

## 5. Cloudflare Worker — endpoints

All routes live in the single `fetch` handler in `worker/src/index.js`.
CORS is locked to `https://smworkassistance.github.io` plus `null` (covers
local `file://` testing, where browsers send `Origin: null`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/transcribe` | Takes a base64 WAV + language code, calls Google Cloud Speech-to-Text, returns `{ transcript }`. |
| POST | `/insights` | Takes a day's activities, generates the day's AI insights + score, and re-derives every activity's tag from `rawText` (see Philosophy §2/§7). Accepts `sleepMs` (currently always 0/unused — the sleep-awareness feature that would have populated it was abandoned, see §8). |
| POST | `/sync` | Replace-the-day upsert: deletes all rows for a `day_key` in `voice_tracker_activities`, then re-inserts the given array. Used for both normal logging and retroactive edits. |
| GET | `/history` | Returns all rows from `voice_tracker_activities`, grouped by `day_key` — used to hydrate a fresh browser/device. |
| GET | `/current` | Reads the single row (`id='singleton'`) from `voice_tracker_current_state` — the cross-device "what's running right now" pointer. |
| POST | `/current` | Upserts that same row. Client calls this from `startNewActivity`/`closeCurrentActivity` centrally, not from every call site individually. |
| POST | `/cluster-activities` | Takes distinct activity names, asks Gemini to group same-habit variants (different phrasing/language) into clusters. Cached client-side by total entry count. |
| POST | `/predict` | Takes the heatmap's best/worst window, top recurring activities, the fragmentation correlation, and last 7 days' scores; asks Gemini for 3-4 grounded forward-looking predictions. Ties the other three behavioral views together. |

**Deploy target:** `orange-violet-75d5.smworkassistance.workers.dev`
(Cloudflare account tied to the `smworkassistance` org).

**Secrets** (set via the Cloudflare dashboard, Settings → Variables and
Secrets — never in code): `GOOGLE_STT_API_KEY`, `GEMINI_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

## 6. Redeploying the Worker

There is no CI/CD and no wrangler-CLI deploy in current use.
The process, every time `worker/src/index.js` changes:
1. Open the Cloudflare dashboard → the `orange-violet-75d5` Worker → Quick
   Edit.
2. Select all existing code, replace with the full contents of
   `worker/src/index.js`.
3. Click Deploy.
4. If secrets changed, update them under Settings → Variables and Secrets
   (separate from the code deploy).

There is no staging Worker — this one Worker serves both local `file://`
testing and the live production frontend, distinguished only by the CORS
allowlist (`null` for local, the real origin for production).

## 7. Supabase — data layer

**Project:** `chain-app` (an existing Supabase project belonging to a
different app of Videh's — reused because the Supabase free tier caps
projects at 2 and both slots were already spoken for by `CLAR` and
`chain-app` itself; see git history "Rename Supabase table to
voice_tracker_activities"). Tables are prefixed `voice_tracker_` specifically
to avoid colliding with that other app's schema.

**Tables** (DDL in `worker/supabase-schema.sql`):

- **`voice_tracker_activities`** — every finished (or retroactively
  edited) activity entry. Columns: `id` (text PK, matches the client-side
  entry id), `day_key` (date), `name`, `tag`, `raw_text`, `start_ms`,
  `end_ms`, `duration_ms`, `created_at`.
- **`voice_tracker_current_state`** — single row (`id='singleton'`)
  mirroring whatever activity is currently running, for cross-device pickup.
  Columns: `id`, `activity_id`, `name`, `tag`, `raw_text`, `start_ms`,
  `updated_at`.

**Access model:** Row Level Security is enabled on both tables with **zero
policies** — this denies all access via the public `anon`/`authenticated`
roles entirely. Only the Worker's `service_role` key (which always bypasses
RLS) can read or write. Explicit `grant usage on schema public` /
`grant all on table ... to service_role` statements are required in
addition to enabling RLS — **this was the cause of a real "permission
denied for table" bug** the first time each table was created; if a new
table is ever added, run both the RLS-enable and the explicit grants, or
expect the same failure.

**Key type:** Supabase's newer "Secret key" (`sb_secret_...`, under
Settings → API Keys → "Publishable and secret API keys") works identically
to the legacy `service_role` JWT for this purpose — either can be used as
`SUPABASE_SERVICE_KEY`. Never use the "Publishable key" (`sb_publishable_...`)
for this — that's the new name for the old `anon` key and is subject to RLS.

## 8. Third-party services

- **Google Cloud Speech-to-Text**: separate Google Cloud project (not
  Supabase's `chain-app`). API key restricted to this one API,
  no application restriction (called server-side from the Worker, which has
  no single stable IP to restrict by). Encoding: client records raw PCM via
  Web Audio API and encodes it as LINEAR16 WAV client-side (not
  MediaRecorder — chosen specifically because Safari/iOS's MediaRecorder
  output format isn't reliably accepted by Google STT, whereas raw
  Web-Audio-API PCM capture works identically across all browsers,
  including Safari).
- **Gemini 2.5 Flash**: `gemini-2.5-flash` via the Generative Language API,
  called with `generationConfig: { responseMimeType: "application/json" }`
  to force valid JSON responses. Used for: tag classification, day-end
  insights, activity-name clustering, and the prediction narrative.
- **GitHub Pages**: hosts the static frontend at
  `smworkassistance.github.io/voice-time-tracker/`. Deploys automatically
  on push to `main` — no build step, plain static files.

## 9. Version history (one line each — see git log for full commit messages)

| Version | What it added |
|---|---|
| v1.0–v1.2 | Original MVP: three timers, Web Speech API voice input, localStorage only. |
| — | Migrated voice input from Web Speech API to Cloudflare-proxied Google Cloud STT (Web Speech API doesn't exist on iOS Safari at all). |
| — | Added Supabase cloud persistence, Gemini day-end insights, Hindi/Hinglish-aware tag classification. |
| v1.3 | Donut chart + 7-day trend chart in the day-end report (never merged into the main line — see §10). |
| v1.4–v1.6 | Voice-recording UX iterations: tap-to-record → press-and-hold → WhatsApp-style live waveform + timer. |
| v1.7 | Sleep-window heuristics + stale-timer alert + a date-picker Reports view. The sleep/stale-timer heuristics were explicitly abandoned (see Philosophy §4) in favor of the editable-timeline approach; the date-picker/Reports-button idea was later resurrected into v1.11. |
| v1.8 | The full-day editable timeline: gaps rendered as tappable entries, splitting via "save and continue with the remainder." |
| v1.9 | Cross-device sync of the live running activity (polling-based, last-write-wins). |
| v1.10 | Merge of v1.8 + v1.9 (they'd branched independently from the same base) — **this is what's currently live**. |
| — | Removed hardcoded CLAR/Shreemant goal context from the Worker (Philosophy §5). |
| v1.11 | Full-screen Reports page (replacing the small modal) + resurrected date-picker/"view anytime" access. |
| v1.12 | Focus heatmap (day-of-week × time-of-day), with the "gaps count as low marks" scoring rule. |
| v1.13 | Recurring-activities view, Gemini-clustered by name similarity. |
| v1.14 | Focus-consistency sparkline (daily activity-switch count vs. score correlation). |
| v1.15 | AI prediction narrative, synthesizing the heatmap/recurring/fragmentation data into forward-looking insights. |

## 10. Known gaps / open items

- **v1.3's charts were never merged forward.** v1.8 onward all branched
  from a pre-v1.3 baseline, so the donut/trend-chart work exists only in
  `versions/index-v1.3.html`, disconnected from the current line. If chart
  visuals are wanted again, they'd need to be re-implemented against the
  current architecture rather than merged.
- **Second-device history doesn't live-refresh.** `/current` polling keeps
  the *running activity* in sync across devices, but a finished lap closed
  on one device won't appear in another device's local history until that
  second device reloads (`hydrateHistoryFromCloud` runs once at page load,
  not on an interval). Known and accepted limitation, not a bug.
- **Recurring-activity clustering falls back silently on failure.** If the
  `/cluster-activities` call fails, the whole section just hides rather
  than showing exact-name (unclustered) groups. Simple exact-match grouping
  was considered as a fallback but not implemented.
- **No editable in-app goal-context setting.** Discussed as an alternative
  to hardcoding (Philosophy §5) and explicitly deferred rather than either
  built or rejected — worth revisiting if goal-aware classification is
  wanted again.
- **`worker/wrangler.toml` / `package.json` are vestigial.** They reflect an
  earlier plan to deploy via `wrangler` CLI that was superseded by using the
  Cloudflare dashboard's Quick Edit directly. Harmless to leave, but don't
  assume `wrangler deploy` is how this actually gets deployed (see §6).

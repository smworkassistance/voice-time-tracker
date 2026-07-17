# Voice Time Tracker — Design Philosophy

> **Purpose of this file:** These are the principles that should constrain
> every future change to this app, whether made by Videh or by a Claude Code
> session with no memory of how they were arrived at. If a proposed feature
> or fix contradicts something here, that's a signal to pause and check
> *why* the principle exists (each one below says why) before overriding it.
> This file does not change often — it documents settled decisions, not
> in-progress ones. For what currently exists and how it's wired together,
> see `ARCHITECTURE.md`.

## 1. Voice-first, never type

The original and still-central premise: Videh should be able to track his
entire day without typing anything. Every text input in the app is a
*fallback* (mic denied, transcription failed, manual correction), never the
primary path. If a new feature can only be operated by typing, that's a
design smell, not just a missing nice-to-have.

## 2. The spoken tag is always the truth

If Videh says "useful," "necessary," "waste," or "semi-useful" — in English,
Hindi, or Hinglish — that tag is final. AI classification exists only to
fill in the *gaps* he leaves (an activity he forgot to tag), never to
second-guess a tag he actually spoke. This is why the `/insights` prompt
re-reads the full `rawText` (not a locally-parsed guess) before deciding a
tag: the local keyword-matcher is known to be unreliable on non-English
phrasing, so a mismatch there gets corrected — but a genuinely *spoken* tag
never gets overridden by AI judgment.

**Why it matters:** the moment the app starts "helpfully" overriding what
the user explicitly said, it stops being a trustworthy record of their own
self-assessment, which is the entire point of a self-tracking tool.

## 3. Every minute of the day gets accounted for

The laps list is not just a log of what was *recorded* — it's a full
timeline of the day, with gaps rendered as explicit, tappable "Unaccounted"
entries rather than silently omitted. Nothing about the day should be
invisible just because it wasn't logged.

**Why it matters:** a time tracker that only shows you the good parts (or
the logged parts) can't tell you anything true about where your day
actually went.

## 4. Insufficient data is itself a signal, not a blank

This is the specific, deliberate design call behind the focus heatmap:
a hole in your logging counts *against* that time window's score, exactly
like logged waste would — it is not rendered as a neutral "no data" gray
cell. The reasoning (Videh's own framing): inconsistent tracking is itself
a behavioral pattern worth surfacing, not something to paper over with a
neutral placeholder. The only case that gets a genuinely neutral
"hasn't happened yet" placeholder is a calendar window that is
chronologically in the future relative to the observed history — that's a
different thing from "you had the chance to log this and didn't."

**Why it matters:** a heatmap that quietly treats missing data as neutral
would let inconsistent tracking hide behind an average, defeating the
purpose of the whole behavioral-analysis layer.

## 5. No hardcoded personal goals in the AI layer

Earlier versions baked "CLAR" and "Shreemant" project descriptions directly
into the Worker's prompt as permanent context. This was deliberately removed
(see git history: "Remove hardcoded CLAR/Shreemant goal context"). The
Worker now only uses generic, universal productivity heuristics (focused
work = useful, meetings = necessary, scrolling = waste) as a fallback when
no tag was spoken.

**Why it matters:** personal goals evolve; code shouldn't have to be edited
and redeployed every time they do. If goal-aware classification is wanted
again, it should be a piece of state the user can edit *in the app*
(synced, not hardcoded) — this was discussed and explicitly deferred, not
forgotten. See "Open questions" in `ARCHITECTURE.md`.

## 6. Predictions and insights are framed constructively, never as blame

Behavioral insights (the heatmap, the fragmentation correlation, the
prediction narrative) are explicitly instructed to frame findings as
*"this is likely to continue unless..."* rather than asserting fault, and
to always include at least one note about what's working well. Colors for
"waste" use a muted tone, not alarm-red.

**Why it matters (the psychology behind this, reasoned through before any
of these features were built):**
- **Self-determination theory**: shaming feedback measurably reduces
  engagement with self-tracking tools. A tool that makes the user want to
  stop looking at it has failed regardless of how accurate its data is.
- **Peak-end rule**: people remember and are motivated by best/worst
  moments far more than an average — so reports should surface a specific
  best window/day, not just a flat score.
- **Loss aversion / framing**: "you wasted 2 hours" reads as punishment;
  "here's what's likely to keep happening" reads as information the user
  can act on.

## 7. Behavioral patterns are *checked* against the data, not asserted

The fragmentation view (does switching activities often correlate with a
lower score?) explicitly computes this per-user rather than asserting
"context-switching is bad" as a universal rule — because it might not be
true for this specific person, and asserting an unverified rule as fact
would be dishonest. The same spirit applies to the heatmap and predictions:
every claim is grounded in an actual number from Videh's own log, with a
stated minimum sample size (e.g. 6+ days) before any correlation is claimed
at all. Below that threshold, the honest answer is "not enough data yet,"
never a confident-sounding guess dressed up as a pattern.

**Why it matters:** this is what separates real behavioral analysis from
horoscope-style flattery that sounds insightful but would say the same
thing to anyone.

## 8. Secrets never reach the client

The frontend is a static file on GitHub Pages — anything embedded in it is
public, permanently, to anyone who views source. Every call to Google Cloud
Speech-to-Text or Gemini goes through the Cloudflare Worker, which holds
the actual API keys as encrypted secrets. The browser never sees them.

## 9. Offline-first, cloud-second

`localStorage` is the source of truth on any given device. Cloud sync
(Supabase, via the Worker) is a best-effort mirror — every sync call is
fire-and-forget with a silent catch, and a failed sync must never corrupt,
block, or lose local data. The app must remain fully usable with no
internet connection except for voice transcription and AI insights, which
degrade gracefully to a manual-entry fallback.

## 10. Every new version is a new file; the live file only changes on explicit promotion

Every experimental change is built as a new `index-vX.html`, tested, and
only copied over the live `index.html` when the user explicitly says to
promote it. This means the live app is never mid-experiment — it's always
either "last known good" or "last known good, freshly promoted." See
`ARCHITECTURE.md` for the exact mechanics and current version state.

## 11. Verify computations with a standalone simulation before shipping

Several real bugs in this project were caught specifically by writing a
throwaway Node script that exercised the aggregation/scoring logic against
hand-built sample data *before* embedding it in the HTML — not by reasoning
about the code alone. Established examples: a date-key zero-padding bug in
a test harness (caught, harmless in production since real `dayKey`s are
always correctly padded), a sub-minute-gap clamping edge case in the entry
editor, and an async-ordering bug where predictions could read a stale
cache because a dependency wasn't awaited. Any new piece of non-trivial
aggregation math (correlation, scoring, clustering, timeline math) should
get this same treatment, not just a syntax check.

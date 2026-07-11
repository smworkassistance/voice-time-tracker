# VOICE TIME TRACKER — Complete Specification

> **Owner:** Videh Paliiwal
> **Purpose:** Personal voice-activated time tracking app — Apple Clock (Timer + Stopwatch + Lap) inspired, but with voice-tagged activities and AI-generated daily/weekly insights.
> **Note for Claude Code:** This file contains the THOUGHT FLOW and USER JOURNEY only. Database schema, architecture, tech stack decisions — YOU decide the best approach. Backend preference: Supabase (project already exists: `shreemant-tools`, Singapore region). Frontend preference: single-file HTML (offline-friendly) OR lightweight web app — your call based on what suits the features best.

---

## 1. CORE CONCEPT

Ek personal time tracking system jo:
- **Three parallel timers** chalaye (Day / Week / Activity)
- **Voice-activated activity logging** kare — user kabhi type nahi karega, sirf bolega
- **User voice mein hi productivity tag bhi bolega** (useful / waste / necessary)
- **Day end aur week end par AI insights + graphs** de

**Ultimate goal:** Life ka time control. Accurate timesheet banti rahe bina manual effort ke. Videh ko har waqt clarity rahe ki time kahan invest ho raha hai.

---

## 2. THREE PARALLEL TIMERS

Teeno independent hain — ek doosre ko affect nahi karte.

### Timer 1: DAY TIMER
- **Start:** Raat 12:00 AM (automatic, roz)
- **Shows:** Elapsed time + **Remaining time** — e.g. "23 hours 15 minutes remaining for day closing"
- **Reset:** Automatic at midnight

### Timer 2: WEEK TIMER
- **Start:** Monday 12:00 AM (automatic, har hafte)
- **Shows:** Elapsed + **Remaining** — e.g. "3 days remaining to close this week"
- **Reset:** Automatic every Monday midnight

### Timer 3: ACTIVITY TIMER (Stopwatch + Lap style)
- **Start:** Jab user "Start" dabaye ya pehla lap de
- **Lap:** Har naye kaam par lap — purani activity ka duration lock ho jata hai, nayi activity ka timer 0 se shuru
- **Shows:** Current activity name + elapsed time — e.g. "15m 32s — CLAR Work"
- **Idle state:** Jab koi activity nahi chal rahi

---

## 3. VOICE INPUT FLOW (Core Feature)

### Kab bolna hai:
- Activity start karte waqt
- Har lap par (activity switch karte waqt)

### Kya bolna hai — FORMAT:
User ek hi sentence mein **activity + productivity tag** bolega:

```
"CLAR work, useful"
"Instagram scrolling, time waste"
"Salesperson meeting, necessary but unplanned"
"Construction site visit, useful"
"Employee ne kaam bataya, necessary"
"Learning video, useful"
```

### Kya hota hai bolne ke baad:
1. Voice → Transcription (Hindi + English mixed / Hinglish support ZAROORI hai)
2. Transcribed text screen par dikhe with **Confirm button** — galat ho to edit kar sake (ya re-record)
3. AI/parser text ko structure kare:
   - `activity_name` (e.g. "CLAR work")
   - `user_tag` (useful / waste / necessary / semi-useful — user ne jo bola)
   - `raw_voice_text` (original transcription bhi save rahe)
4. Previous activity ka duration lock, nayi activity start

### Voice Recognition — Approach:
- **Phase 1 (default):** Web Speech API — free, browser built-in. Hinglish accuracy test karo.
- **Phase 2 (agar accuracy kam ho):** Google Cloud Speech-to-Text ya Anthropic API se transcription+parsing. Accuracy CRITICAL hai — Videh Hinglish mein bolta hai.
- **Fallback:** Agar transcription fail ho, audio note save karke baad mein process karne ka option.

### Important:
- User ko LIKHNA NAHI hai — kabhi bhi. Poora system voice-first hai.
- Agar user tag bolna bhool jaye (sirf "CLAR work" bola), to AI baad mein day-end analysis mein khud judgment lagaye (Section 5 framework se).

---

## 4. COMPLETE DAY FLOW (User Journey)

### Raat 12:00 AM
- Day Timer + Week Timer automatic chal rahe hain
- Activity Timer: IDLE
- 12 AM – 6 AM: Default REST period (auto-marked, no tracking needed)

### Subah ~6:00 AM — Kaam shuru
1. User app kholta hai, "Start" dabata hai
2. Bolta hai: "CLAR work, useful"
3. Activity timer start
4. Display: Day remaining, Week remaining, Current activity + elapsed

### Din bhar — Har activity switch par
1. "Lap" dabao
2. Naya kaam bolo with tag
3. Purani activity log ho gayi, nayi shuru

**Example — Interruption scenario:**
- 6:00 AM: "CLAR work, useful" → chal raha hai
- 7:30 AM: Salesperson aa gaya → Lap → "Salesperson meeting, necessary but unplanned"
- 9:00 AM: Meeting khatam → Lap → "CLAR work continue, useful"
- Log: CLAR 1h30m (useful) | Salesperson 1h30m (necessary/unplanned) | CLAR resumed...

### Mid-Day Insight (optional check anytime)
User kabhi bhi dekhe:
- Aaj ab tak kitna useful / necessary / waste
- Kitna time bacha day mein
- Quick % score

### Raat — Day End
- User "End Day" dabaye YA 12 AM automatic close
- **AI Day Report generate ho** (Section 6)

---

## 5. AI JUDGMENT FRAMEWORK

AI ka role: **Primarily structuring, secondarily judgment.**

### Priority order:
1. **User ka bola hua tag = final truth.** Agar user ne "useful" bola to useful hai. AI override NAHI karega.
2. **Tag missing ho** to AI context se classify kare:
   - CLAR / learning / development / deep work → **Useful**
   - Shreemant / store / construction / business → **Useful** (goal-aligned business)
   - Meeting / email / admin / employee kaam → **Necessary / Semi-useful**
   - Scrolling / random browsing / procrastination → **Waste**
3. **Context-aware judgment for ambiguous cases:**
   - "Scrolling" alone = waste, BUT "Scrolling — customer research for Shreemant" = semi-useful
   - Salesperson ne 1.5 ghanta kha liya = necessary interruption, BUT AI insight de: "Next time time-box to 30 min"

### Goal Alignment Layer:
- AI ke paas Videh ke goals ka context hona chahiye:
  - **CLAR** — mind management app, promotions, improvements (personal calling)
  - **Shreemant** — operational excellence, construction project, business growth
  - Long-term: financial independence → self-running business → helping people manage minds
- Har activity ko goals se compare kare: HIGH / NEUTRAL / LOW alignment
- (Optional future: Notion se weekly priorities auto-fetch)

### Interruption Intelligence:
- Repeated interruptions detect kare: "Is hafte 5 baar salesperson visits — total 6h gaya. Pattern ban raha hai."
- Unavoidable vs self-imposed distinguish kare
- Actionable suggestions de, judgment/blame nahi

---

## 6. DAY END REPORT

### Trigger: "End Day" button ya 12 AM auto

### Report contents:

```
📊 TODAY'S TIME REPORT — [Date]

⏱️ TIME ALLOCATION:
├─ Useful: Xh Ym (Z%)          ✅
│   ├─ CLAR: ...
│   ├─ Shreemant: ...
│   └─ Learning: ...
├─ Necessary: Xh Ym (Z%)       ⚠️
│   ├─ Meetings: ...
│   └─ Employee tasks: ...
├─ Time Waste: Xh Ym (Z%)      ❌
│   └─ Scrolling: ...
└─ Rest/Unaccounted: Xh (Z%)

🎯 PRODUCTIVITY SCORE: XX/100

🔍 AI INSIGHTS (3-4 short, actionable, Hinglish):
1. "Aaj 36% productive — kal se better!"
2. "Salesperson meeting 1.5h — agli baar 30 min time-box karo."
3. "Scrolling 1.5h → 30m karne se week transform ho jayega."

📈 TREND: Yesterday vs Today comparison
```

### Visuals:
1. **Pie Chart** — Useful / Necessary / Waste / Rest breakdown
2. **Bar Chart** — Last 7 days productivity trend
3. **Activity Table** — har activity, duration, tag

---

## 7. WEEK END SUMMARY

### Trigger: Sunday 11:59 PM (ya Monday ko pichle week ka dekh sake)

```
📊 WEEKLY REPORT — [Date Range]

🎯 ACTIVITY BREAKDOWN (total hours + %):
CLAR / Shreemant / Learning / Meetings / Waste / Rest

📈 METRICS:
├─ Avg Daily Productivity %
├─ Best Day / Worst Day
├─ Goal Alignment %

🔑 KEY INSIGHTS:
- Patterns (recurring interruptions, waste trends)
- Goal progress (CLAR target vs actual, Shreemant target vs actual)

💡 NEXT WEEK RECOMMENDATIONS:
- Specific, actionable, time-boxed suggestions
```

---

## 8. UI REQUIREMENTS (High-Level)

### Main Screen (Apple Clock inspired — clean, dark, minimal):
- **Top:** Day Timer (remaining prominent) + Week Timer (remaining)
- **Center:** Activity Timer — BIG display, current activity name, elapsed time
- **Buttons:** Start / Lap (with voice) / Stop / End Day
- **Below:** Today's laps list (Apple stopwatch style) — activity name, duration, tag color-coded
  - Useful = green, Necessary = yellow/orange, Waste = red

### Reports Screen:
- Day report + Week report tabs
- Charts (pie, bar)
- History browse (past days)

### Design language:
- Dark mode default, Apple-like minimal aesthetic
- Mobile-first (Videh phone par use karega mostly), desktop bhi kaam kare
- Bade, easily tappable buttons — one-hand use

---

## 9. EDGE CASES

1. **Uncertain duration activity:** Lap tab tak chalta rahe jab tak user next lap na de. No time limit.
2. **User bolna bhool gaya tag:** AI day-end par classify kare (Section 5).
3. **App band ho gaya / browser close:** Timer state persist hona chahiye — reopen par continue (timestamps se calculate, not live counting).
4. **Midnight cross during activity:** Activity chal rahi hai aur 12 AM ho gaya → activity ka time split ho: kal ke din mein kal ka portion, aaj ke din mein aaj ka.
5. **Rest period (12 AM – 6 AM):** Auto-rest, tracking optional. User chahe to raat mein bhi activity log kar sake (override).
6. **No internet:** Voice + timer offline kaam kare (localStorage buffer), internet aane par Supabase sync.
7. **Duplicate/accidental lap:** Undo last lap option.
8. **Transcription galat:** Confirm/Edit step har voice input ke baad.

---

## 10. TECH PREFERENCES (Claude Code decides final architecture)

- **Backend:** Supabase (existing project: `shreemant-tools`, Singapore) — tables/schema tumhara decision
- **Frontend:** Single-file HTML preferred (Videh ke sab tools aise hi hain — offline-reliable, GitHub Pages par host: smworkassistance.github.io). Agar features ke liye zaroori ho to structure change kar sakte ho, but justify karo.
- **Voice:** Web Speech API first → upgrade path to cloud STT if accuracy insufficient. Hinglish support non-negotiable.
- **AI Insights:** Anthropic API call for day-end/week-end report generation (activity data → structured Hinglish insights)
- **Charts:** Lightweight library (Chart.js ya similar)
- **Storage philosophy:** Offline-first with cloud sync. Timer accuracy timestamp-based (not interval counting) — battery/tab-switch safe.
- **Hosting:** GitHub Pages (smworkassistance account)

---

## 11. BUILD PHASES (Suggested)

### Phase 1 — Core Timer + Voice (MVP)
- Three timers working (Day/Week/Activity with remaining display)
- Lap system with voice input (Web Speech API) + confirm/edit
- localStorage persistence
- Basic laps list with color-coded tags

### Phase 2 — Supabase + Reports
- Cloud sync
- Day End report with pie/bar charts
- History view

### Phase 3 — AI Insights
- Anthropic API integration for day/week insights
- Goal alignment layer
- Pattern detection (interruptions, waste trends)

### Phase 4 — Polish
- Week end summary automation
- Mid-day insight widget
- Undo, edge case hardening

---

## 12. SUCCESS CRITERIA

- Videh bina type kiye poora din track kar sake — sirf voice + 2 buttons (Start/Lap)
- Har waqt pata rahe: day/week mein kitna bacha, current activity kitni chali
- Day end par 30 second mein poori clarity mil jaye — kahan time gaya, kya useful tha
- Hinglish voice 90%+ accurate transcribe ho
- App offline bhi reliable chale, data kabhi lost na ho

---

*Jay Maharaj 🙏 — Time is the ultimate currency. Is app se Videh apni life ka time control karega.*

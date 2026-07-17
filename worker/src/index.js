// Voice Time Tracker — backend glue.
// Keeps Google Cloud STT + Gemini API keys server-side; the static frontend
// (GitHub Pages) calls these two endpoints instead of calling Google directly.

// "null" covers local file:// testing (browsers send Origin: null for those requests).
const ALLOWED_ORIGINS = ["https://smworkassistance.github.io", "null"];

// Generic productivity heuristics -- no personal goal/project context baked
// in here. The tag the user speaks is always the real signal; this only
// covers the fallback case where they forgot to say one.
const PRODUCTIVITY_HEURISTICS = `
General guidance for classifying an activity when no tag was spoken:
- Focused/deep work, learning, skill-building → USEFUL
- Meetings, admin, coordination, replying to people, errands → NECESSARY
- Scrolling, random browsing, entertainment, procrastination → WASTE
- Activities that are a mix of the above, or genuinely unclear → SEMI-USEFUL
`.trim();

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function handleTranscribe(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { audioBase64, sampleRateHertz, languageCode } = body;
  if (!audioBase64) return json({ error: "audioBase64 is required" }, 400, origin);

  const primaryLang = languageCode || "en-IN";
  const altLang = primaryLang === "hi-IN" ? "en-IN" : "hi-IN";

  const sttRes = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${env.GOOGLE_STT_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          encoding: "LINEAR16",
          sampleRateHertz: sampleRateHertz || 16000,
          languageCode: primaryLang,
          alternativeLanguageCodes: [altLang],
          enableAutomaticPunctuation: true,
        },
        audio: { content: audioBase64 },
      }),
    }
  );

  const sttData = await sttRes.json();
  if (!sttRes.ok) {
    return json({ error: sttData.error?.message || "Google STT request failed" }, 502, origin);
  }

  const transcript = (sttData.results || [])
    .map((r) => r.alternatives?.[0]?.transcript || "")
    .join(" ")
    .trim();

  return json({ transcript }, 200, origin);
}

async function handleInsights(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { dateLabel, activities, dayElapsedMs, sleepMs } = body;
  if (!Array.isArray(activities)) return json({ error: "activities array is required" }, 400, origin);

  const activityLines = activities
    .map((a) => `- "${a.name}" — ${a.tag || "untagged"} — ${Math.round(a.duration / 60000)} min`)
    .join("\n");

  const taggable = activities.filter((a) => a.id);
  const classifyBlock = taggable.length
    ? `\nFor EACH activity below, determine the correct tag by understanding what the user actually said (raw_text), not just the quick local guess shown as "current tag". The user may state the tag in English, Hindi, or Hinglish (e.g. "useful"/"upyogi", "necessary"/"zaroori", "waste"/"faltu"/"bekaar"/"time waste", "semi-useful"). If they clearly stated a tag in any of these forms, use exactly that — even if it differs from or contradicts the current tag, which came from a simple keyword matcher that often misses non-English phrasing. If they did NOT state any tag at all, classify it using the general guidance below. Always output exactly one classification per activity id listed here, even when it just confirms the current tag.\nActivities:\n${taggable.map((a) => `- id "${a.id}": said "${a.rawText || a.name}" (current tag: ${a.tag || "none"})`).join("\n")}\n`
    : "";

  const prompt = `
You are analyzing a personal time-tracking log for ${dateLabel || "today"}.
${PRODUCTIVITY_HEURISTICS}

Total day elapsed so far: ${Math.round((dayElapsedMs || 0) / 60000)} minutes.
${sleepMs ? `Of that, ${Math.round(sleepMs / 60000)} minutes is normal 12am-6am sleep, already excluded from "unaccounted" time -- do NOT mention this as wasted, untracked, or something to explain.` : ""}

Activity log:
${activityLines || "(no activities logged)"}
${classifyBlock}
Respond ONLY with JSON in this exact shape:
{
  "score": <integer 0-100, productivity score>,
  "insights": ["<short actionable Hinglish insight>", "... 3-4 total"],
  "classifications": [{"id": "<activity id>", "tag": "<useful|necessary|waste|semi-useful>"}, ...]
}
Include one classifications entry per activity id listed above (empty array only if there were no activities).
Insights must be short, specific, actionable, and in Hinglish (mix of Hindi+English), matching the tone of a friendly coach — not generic praise.
`.trim();

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const geminiData = await geminiRes.json();
  if (!geminiRes.ok) {
    return json({ error: geminiData.error?.message || "Gemini request failed" }, 502, origin);
  }

  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return json({ error: "Gemini returned unparseable output", raw: text }, 502, origin);
  }

  return json({ score: parsed.score, insights: parsed.insights || [], classifications: parsed.classifications || [] }, 200, origin);
}

async function handleSync(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { dayKey, activities } = body;
  if (!dayKey || !Array.isArray(activities)) {
    return json({ error: "dayKey and activities array are required" }, 400, origin);
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  // Replace-the-day strategy: wipe existing rows for this day, then re-insert
  // the full current log. Simplest way to handle edits/undo without diffing.
  const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/voice_tracker_activities?day_key=eq.${dayKey}`, {
    method: "DELETE",
    headers,
  });
  if (!delRes.ok) {
    const err = await delRes.json().catch(() => ({}));
    return json({ error: err.message || "Supabase delete failed" }, 502, origin);
  }

  if (activities.length > 0) {
    const rows = activities.map((a) => ({
      id: a.id,
      day_key: dayKey,
      name: a.name,
      tag: a.tag || null,
      raw_text: a.rawText || "",
      start_ms: a.start,
      end_ms: a.end,
      duration_ms: a.duration,
    }));
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/voice_tracker_activities`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!insRes.ok) {
      const err = await insRes.json().catch(() => ({}));
      return json({ error: err.message || "Supabase insert failed" }, 502, origin);
    }
  }

  return json({ ok: true }, 200, origin);
}

async function handleHistory(request, env) {
  const origin = request.headers.get("Origin");
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/voice_tracker_activities?select=*&order=day_key.asc,start_ms.asc`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  const rows = await res.json();
  if (!res.ok) {
    return json({ error: rows.message || "Supabase history fetch failed" }, 502, origin);
  }

  const history = {};
  for (const r of rows) {
    if (!history[r.day_key]) history[r.day_key] = [];
    history[r.day_key].push({
      id: r.id,
      name: r.name,
      tag: r.tag,
      rawText: r.raw_text,
      start: Number(r.start_ms),
      end: Number(r.end_ms),
      duration: Number(r.duration_ms),
    });
  }
  return json({ history }, 200, origin);
}

async function handleGetCurrent(request, env) {
  const origin = request.headers.get("Origin");
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/voice_tracker_current_state?id=eq.singleton&select=*`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  const rows = await res.json();
  if (!res.ok) {
    return json({ error: rows.message || "Supabase current-state fetch failed" }, 502, origin);
  }
  const row = rows[0];
  if (!row) return json({ activityId: null, updatedAt: 0 }, 200, origin);
  return json(
    {
      activityId: row.activity_id,
      name: row.name,
      tag: row.tag,
      rawText: row.raw_text,
      start: row.start_ms ? Number(row.start_ms) : null,
      updatedAt: Number(row.updated_at) || 0,
    },
    200,
    origin
  );
}

async function handleSetCurrent(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { activityId, name, tag, rawText, start, updatedAt } = body;

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/voice_tracker_current_state?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        id: "singleton",
        activity_id: activityId || null,
        name: name || null,
        tag: tag || null,
        raw_text: rawText || null,
        start_ms: start || null,
        updated_at: updatedAt || Date.now(),
      },
    ]),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ error: err.message || "Supabase current-state upsert failed" }, 502, origin);
  }
  return json({ ok: true }, 200, origin);
}

async function handleClusterActivities(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { names } = body;
  if (!Array.isArray(names) || names.length === 0) {
    return json({ clusters: [] }, 200, origin);
  }

  const nameList = names.map((n, i) => `${i + 1}. "${n}"`).join("\n");

  const prompt = `
Here is a list of distinct activity names from a personal voice-logged time-tracking app. Different phrasings, capitalizations, continuations, or Hindi/Hinglish variants often refer to the SAME real-world recurring activity (e.g. "CLAR work", "CLAR work continue", "clar kaam" are likely the same thing).

Group these into clusters of the same real-world activity. Every name must appear in exactly one cluster, including names that are unique (a cluster of one is fine).

Names:
${nameList}

Respond ONLY with JSON in this exact shape:
{
  "clusters": [
    { "label": "<short canonical name for this recurring activity>", "members": ["<exact name from the list above>", ...] },
    ...
  ]
}
`.trim();

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const geminiData = await geminiRes.json();
  if (!geminiRes.ok) {
    return json({ error: geminiData.error?.message || "Gemini request failed" }, 502, origin);
  }

  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return json({ error: "Gemini returned unparseable output", raw: text }, 502, origin);
  }

  return json({ clusters: parsed.clusters || [] }, 200, origin);
}

async function handlePredict(request, env) {
  const origin = request.headers.get("Origin");
  const body = await request.json();
  const { bestWindow, worstWindow, recurringActivities, fragmentationInsight, recentScores } = body;

  const recurringLines = (recurringActivities || [])
    .map((a) => `- "${a.label}" — ${a.totalMinutes} min total across ${a.count} times, tagged ${a.tag || "mixed"}`)
    .join("\n");

  const scoreLines = (recentScores || [])
    .map((s) => `- ${s.dayKey}: ${s.score}/100`)
    .join("\n");

  const fragText = fragmentationInsight
    ? `Days with more than ${fragmentationInsight.medianLaps} activity switches average ${fragmentationInsight.avgHigh}/100, vs ${fragmentationInsight.avgLow}/100 on calmer days.`
    : "Not enough data yet to know if activity-switching affects this person's score.";

  const prompt = `
You are analyzing real behavioral data from a personal voice-logged time-tracking app, to predict what's LIKELY to keep happening if nothing changes, and give forward-looking advice grounded in this specific data -- not generic productivity tips.

Best focus window observed: ${bestWindow ? `${bestWindow.day} ${bestWindow.block} (score ${bestWindow.score}/100)` : "not enough data yet"}
Worst focus window observed: ${worstWindow ? `${worstWindow.day} ${worstWindow.block} (score ${worstWindow.score}/100)` : "not enough data yet"}

Top recurring activities:
${recurringLines || "(none yet)"}

Activity-switching pattern: ${fragText}

Recent daily scores:
${scoreLines || "(none yet)"}

Write 3-4 short, specific, forward-looking predictions/insights in Hinglish (mix of Hindi+English). Each one must reference an actual number or window from the data above -- no vague generic advice. Include at least one encouraging note about what's working well. Frame predictions as "this is likely to continue unless..." rather than blame.

Respond ONLY with JSON in this exact shape:
{ "predictions": ["<short specific prediction/insight>", "... 3-4 total"] }
`.trim();

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const geminiData = await geminiRes.json();
  if (!geminiRes.ok) {
    return json({ error: geminiData.error?.message || "Gemini request failed" }, 502, origin);
  }

  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return json({ error: "Gemini returned unparseable output", raw: text }, 502, origin);
  }

  return json({ predictions: parsed.predictions || [] }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/transcribe") {
        return await handleTranscribe(request, env);
      }
      if (request.method === "POST" && url.pathname === "/insights") {
        return await handleInsights(request, env);
      }
      if (request.method === "POST" && url.pathname === "/sync") {
        return await handleSync(request, env);
      }
      if (request.method === "GET" && url.pathname === "/history") {
        return await handleHistory(request, env);
      }
      if (request.method === "GET" && url.pathname === "/current") {
        return await handleGetCurrent(request, env);
      }
      if (request.method === "POST" && url.pathname === "/current") {
        return await handleSetCurrent(request, env);
      }
      if (request.method === "POST" && url.pathname === "/cluster-activities") {
        return await handleClusterActivities(request, env);
      }
      if (request.method === "POST" && url.pathname === "/predict") {
        return await handlePredict(request, env);
      }
    } catch (err) {
      return json({ error: err.message || "Unexpected error" }, 500, origin);
    }

    return json({ error: "Not found" }, 404, origin);
  },
};

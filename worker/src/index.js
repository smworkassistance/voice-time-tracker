// Voice Time Tracker — backend glue.
// Keeps Google Cloud STT + Gemini API keys server-side; the static frontend
// (GitHub Pages) calls these two endpoints instead of calling Google directly.

// "null" covers local file:// testing (browsers send Origin: null for those requests).
const ALLOWED_ORIGINS = ["https://smworkassistance.github.io", "null"];

const GOAL_CONTEXT = `
Videh's goals, for judging activity alignment:
- CLAR: a mind-management app — his personal calling. Building/improving it, or learning that feeds it, is HIGH alignment.
- Shreemant: operational excellence, construction project, business growth. Store/construction/business work is HIGH alignment.
- Long-term goal: financial independence via a self-running business, eventually helping people manage their minds.
- Meetings, admin, employee coordination = usually NECESSARY, not high/low.
- Scrolling, random browsing, procrastination = usually WASTE, unless explicitly tied to research for CLAR/Shreemant.
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
  const { dateLabel, activities, dayElapsedMs } = body;
  if (!Array.isArray(activities)) return json({ error: "activities array is required" }, 400, origin);

  const activityLines = activities
    .map((a) => `- "${a.name}" — ${a.tag || "untagged"} — ${Math.round(a.duration / 60000)} min`)
    .join("\n");

  const prompt = `
You are analyzing a personal time-tracking log for ${dateLabel || "today"}.
${GOAL_CONTEXT}

Total day elapsed so far: ${Math.round((dayElapsedMs || 0) / 60000)} minutes.

Activity log:
${activityLines || "(no activities logged)"}

Respond ONLY with JSON in this exact shape:
{
  "score": <integer 0-100, productivity score>,
  "insights": ["<short actionable Hinglish insight>", "... 3-4 total"]
}
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

  return json({ score: parsed.score, insights: parsed.insights || [] }, 200, origin);
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
  const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/activities?day_key=eq.${dayKey}`, {
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
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/activities`, {
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
    `${env.SUPABASE_URL}/rest/v1/activities?select=*&order=day_key.asc,start_ms.asc`,
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
    } catch (err) {
      return json({ error: err.message || "Unexpected error" }, 500, origin);
    }

    return json({ error: "Not found" }, 404, origin);
  },
};

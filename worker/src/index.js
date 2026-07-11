// Voice Time Tracker — backend glue.
// Keeps Google Cloud STT + Gemini API keys server-side; the static frontend
// (GitHub Pages) calls these two endpoints instead of calling Google directly.

const ALLOWED_ORIGIN = "*"; // TODO: once deployed, restrict to your GitHub Pages origin.

const GOAL_CONTEXT = `
Videh's goals, for judging activity alignment:
- CLAR: a mind-management app — his personal calling. Building/improving it, or learning that feeds it, is HIGH alignment.
- Shreemant: operational excellence, construction project, business growth. Store/construction/business work is HIGH alignment.
- Long-term goal: financial independence via a self-running business, eventually helping people manage their minds.
- Meetings, admin, employee coordination = usually NECESSARY, not high/low.
- Scrolling, random browsing, procrastination = usually WASTE, unless explicitly tied to research for CLAR/Shreemant.
`.trim();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function handleTranscribe(request, env) {
  const body = await request.json();
  const { audioBase64, sampleRateHertz, languageCode } = body;
  if (!audioBase64) return json({ error: "audioBase64 is required" }, 400);

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
    return json({ error: sttData.error?.message || "Google STT request failed" }, 502);
  }

  const transcript = (sttData.results || [])
    .map((r) => r.alternatives?.[0]?.transcript || "")
    .join(" ")
    .trim();

  return json({ transcript });
}

async function handleInsights(request, env) {
  const body = await request.json();
  const { dateLabel, activities, dayElapsedMs } = body;
  if (!Array.isArray(activities)) return json({ error: "activities array is required" }, 400);

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
    return json({ error: geminiData.error?.message || "Gemini request failed" }, 502);
  }

  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return json({ error: "Gemini returned unparseable output", raw: text }, 502);
  }

  return json({ score: parsed.score, insights: parsed.insights || [] });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/transcribe") {
        return await handleTranscribe(request, env);
      }
      if (request.method === "POST" && url.pathname === "/insights") {
        return await handleInsights(request, env);
      }
    } catch (err) {
      return json({ error: err.message || "Unexpected error" }, 500);
    }

    return json({ error: "Not found" }, 404);
  },
};

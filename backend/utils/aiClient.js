// AI client: tries Gemini first, automatically falls back to Groq if Gemini fails
// (quota/rate limit exceeded, server error, timeout, missing key, empty answer...).
// It exposes the same shape as the Groq SDK -> aiClient.chat.completions.create({ messages, temperature })
// so the controllers don't need to know which provider answered.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const TIMEOUT_MS = 60000;

let groqClient = null;
const getGroq = () => {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
  if (!groqClient) {
    const Groq = require("groq-sdk");
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
};

const callGemini = async ({ messages, temperature }) => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");

  const body = {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (typeof temperature === "number") body.generationConfig = { temperature };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response");

  return { choices: [{ message: { role: "assistant", content: text } }], provider: "gemini" };
};

const callGroq = async ({ messages, temperature }) => {
  const params = { messages, model: GROQ_MODEL };
  if (typeof temperature === "number") params.temperature = temperature;
  const completion = await getGroq().chat.completions.create(params);
  completion.provider = "groq";
  return completion;
};

const create = async (params) => {
  try {
    const result = await callGemini(params);
    console.log("🤖 AI answered by: Gemini");
    return result;
  } catch (geminiErr) {
    console.warn(`⚠️  Gemini failed (${geminiErr.message}) -> switching to Groq backup`);
    try {
      const result = await callGroq(params);
      console.log("🤖 AI answered by: Groq (backup)");
      return result;
    } catch (groqErr) {
      console.error(`❌ Groq backup also failed: ${groqErr.message}`);
      throw new Error(`Both AI providers failed. Gemini: ${geminiErr.message} | Groq: ${groqErr.message}`);
    }
  }
};

module.exports = { chat: { completions: { create } } };
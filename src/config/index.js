import "dotenv/config";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

export const config = {
  leadsquared: {
    host: process.env.LEADSQUARED_HOST,
    accessKey: process.env.LEADSQUARED_ACCESS_KEY,
    secretKey: process.env.LEADSQUARED_SECRET_KEY,
    // "header" keeps keys out of URLs/logs. Use "query" only if your
    // LeadSquared region rejects header auth.
    authMode: process.env.LEADSQUARED_AUTH_MODE || "header",
    timeoutMs: Number(process.env.LEADSQUARED_TIMEOUT_MS || 30000)
  },

  paths: {
    dataDir: DATA_DIR,
    db: path.join(DATA_DIR, "jobs.db"),
    callsDir: path.join(DATA_DIR, "calls"),
    legacyProcessedFile: path.resolve("./processed-calls.json")
  },

  python: process.env.PYTHON_BIN || "./whisper-env/bin/python",

  whisper: {
    // "mlx" runs on the Mac GPU; "openai" is the original openai-whisper.
    backend: process.env.WHISPER_BACKEND || "mlx",
    model:
      process.env.WHISPER_MODEL || "mlx-community/whisper-large-v3-turbo",
    // "en" also romanizes Hinglish, which the LLM reads fine.
    // Use "auto" to let Whisper detect the language.
    language: process.env.WHISPER_LANGUAGE || "en",
    // Words Whisper should expect. Helps names, courses and numbers.
    prompt:
      process.env.WHISPER_PROMPT ??
      "Sales call between a course counsellor and a prospective student about an online course: " +
        "data analytics, data science, full stack development, SQL, Excel, Python, placement, EMI, fees, demo, batch. " +
        "Degrees: B.Tech, BCA, MCA, B.Com, BBA, MBA, B.Sc, M.Sc, BA. " +
        "Cities: Bangalore, Hyderabad, Chennai, Pune, Mumbai, Delhi, Kolkata, Visakhapatnam, Vijayawada, Noida, Gurgaon."
  },

  audio: {
    // Resample to 16 kHz + noise filter before Whisper.
    preprocess: process.env.AUDIO_PREPROCESS !== "false"
  },

  llm: {
    model:
      process.env.LLM_MODEL ||
      "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 1800)
  },

  notes: {
    // "html" renders bold labels and bullet lists in the LeadSquared Notes tab.
    // Use "text" if your account shows raw tags.
    format: process.env.NOTE_FORMAT === "text" ? "text" : "html"
  },

  // Which LeadSquared activities count as recorded calls.
  // LeadSquared telephony activity codes: 21 = inbound, 22 = outbound.
  // Override with CALL_EVENT_CODES=22 to audit outbound calls only.
  callEventCodes: (process.env.CALL_EVENT_CODES || "21,22")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),

  // Calls shorter than this are not audited: a full pitch takes 10-15 min,
  // and short calls rarely show the lead's intent.
  minCallSeconds: Number(process.env.MIN_CALL_MINUTES || 7) * 60,

  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3)
};

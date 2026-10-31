import { config } from "../config/index.js";
import {
  BACKGROUNDS,
  CALL_TYPES,
  CURRENT_STATUSES,
  DEMO_STATUSES,
  NON_SALES_CALL_TYPES,
  OUTCOMES,
  emptyAnalysisTemplate
} from "../config/schema.js";
import { run } from "../lib/exec.js";

// Pulls the first complete, balanced JSON object out of model output.
export function extractJson(text) {
  const start = text.indexOf("{");

  if (start === -1) {
    throw new Error("No JSON object found in model output.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }

  throw new Error("Incomplete JSON in model output.");
}

export function buildPrompt(transcript) {
  return `
You audit phone calls made by course counsellors at an online education company.
The COUNSELLOR places the call. The other person is the LEAD (a prospective student)
or an already enrolled student. The transcript has no speaker labels: work out who
is speaking from context.

Return ONLY one JSON object. No markdown, no text outside the JSON.

RULES
1. Never invent anything. Every value must come from what is said in the transcript.
2. Unknown or not mentioned = null (or [] for lists, "unknown" for enums).
3. Facts about the lead must be said by the lead or confirmed by the lead.
4. Keep text short and factual. No filler like "the customer expressed".

CALL TYPE (call_type), one of:
- sales_conversation: counsellor pitches or discusses a course with a prospective lead
- existing_student_support: call with an already enrolled student about progress, doubts, support
- call_screening: the phone's automated assistant answered ("record your name and reason for calling")
- customer_unavailable: someone answered but the intended person is not available
- no_answer: no real conversation (only hellos, silence, call cut immediately)
- ivr: operator/network message (switched off, not reachable, does not exist, busy)
- wrong_number, voicemail, other, unknown

FIELDS
- call_summary: 1-2 sentences on what happened in the call and how it ended. Do NOT repeat profile
  details (education, location, job) here; they have their own fields.
- customer.current_status: ${CURRENT_STATUSES.join(" | ")}
- customer.background: ${BACKGROUNDS.join(" | ")} (tech = engineering/CS/IT education or job)
- customer.graduation_year, qualification, experience, designation, company, location: as stated, else null
- intent: one short line: what the lead wants (e.g. "Career switch to data analytics")
- goals: extra specific goals beyond intent (target role, salary, timeline). [] if nothing new.
  Never repeat the intent.
- interest_level: hot (wants to proceed / book demo / asks about payment), warm (interested, undecided),
  cold (not interested / no need), unknown
- interest_reason: max 8 words explaining the interest_level (e.g. "wants demo, fee concern")
- course_discussed: course name if discussed, else null
- fees_discussed: one line on fees / EMI / scholarship / budget if discussed, else null
- demo_status: ${DEMO_STATUSES.join(" | ")}
- objections: each concern the lead raised, the counsellor's reply (null if none) and whether it was resolved
- next_steps: concrete agreed actions only. owner: counsellor | lead. when: as said ("tomorrow 6 pm"), else null
- key_quotes: up to 2 short sentences said BY THE LEAD (never the counsellor), copied EXACTLY,
  word for word, that best show the lead's intent or objections. No questions. [] if none.
- outcome: ${OUTCOMES.join(" | ")}
- follow_up_required: true only if the transcript shows another contact is needed
- audit_applicable: true only for sales_conversation
- audit: for sales_conversation only, true only with clear evidence:
  profiling_completed (asked about education/work/background), need_identified (understood the lead's goal),
  objection_handled (answered at least one objection), closing_attempted (asked for demo/enrolment/payment/next step)

JSON SHAPE
${JSON.stringify(emptyAnalysisTemplate(), null, 2)}

Valid call_type values: ${CALL_TYPES.join(", ")}
Non-sales call types (audit_applicable must be false): ${NON_SALES_CALL_TYPES.join(", ")}

TRANSCRIPT
${transcript}
`;
}

// The model can't know how long its answer will be, so progress is the
// share of a typical answer written so far, held below 100% until done.
const TYPICAL_ANSWER_CHARS = 2200;

async function runModel(prompt, signal, onProgress) {
  let written = 0;
  return run(config.python, [
    "-m",
    "mlx_lm",
    "generate",
    "--model",
    config.llm.model,
    "--prompt",
    prompt,
    "--max-tokens",
    String(config.llm.maxTokens)
  ], {
    label: "LLM (mlx_lm)",
    signal,
    onStdout: (chunk) => {
      written += chunk.length;
      onProgress?.(Math.min(0.95, written / TYPICAL_ANSWER_CHARS));
    }
  });
}

// One retry: small local models occasionally emit broken JSON.
export async function analyze(transcript, { signal, onProgress } = {}) {
  const prompt = buildPrompt(transcript);
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await runModel(prompt, signal, onProgress);
    try {
      return { analysis: extractJson(output), attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Model returned invalid JSON twice: ${lastError.message}`);
}

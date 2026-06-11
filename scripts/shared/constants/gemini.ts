export const REQUEST_TIMEOUT_MS = 300000;
export const FILE_TTL_MS = 40 * 60 * 60 * 1000;
export const FILE_PROCESSING_POLL_MS = 1000;
export const FILE_PROCESSING_TIMEOUT_MS = 300000;

export const KNOWN_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
] as const;

export const STRUCTURED_SUFFIX = `

---
ALSO, on a separate final line, output exactly one machine-readable block listing EVERY question visible on the screen as a JSON array:
[[QDATA]][{"question":"<full question text>","options":["<choice 1>","<choice 2>"],"correct":"<the correct answer text or label>"}][[/QDATA]]
Rules: valid minified JSON ARRAY, one object per question in screen order, no markdown, escape inner quotes, "options" is [] if there are no listed choices, include ALL questions if there are several, always output the block even if unsure.`;

export const QDATA_RE = /\[\[QDATA\]\]\s*([\s\S]*?)\s*\[\[\/QDATA\]\]/i;

export const DEFAULT_PROMPT_TEXT = `You are an expert test solver. Analyze the screenshot carefully.

TASK: Find and solve ALL questions/tests visible on the screen.

RULES:
- Single choice: output the number (e.g., 2)
- Multiple correct answers: comma-separated (e.g., 1,3,4)
- Multiple questions on screen: semicolon-separated (e.g., 1;3;2)
- Matching: pairs (e.g., 1-б,2-а,3-в)
- Open-ended: short answer word/phrase in Ukrainian
- True/False: Так or Ні

IMPORTANT:
- Read ALL text carefully before answering
- If reference materials are provided (PDFs, images, text, etc.), use them to find the correct answer
- Answer based on the content, not guessing
- Output ONLY in format below, nothing else

FORMAT: Відповідь: [your answer]

Example: Відповідь: 3`;

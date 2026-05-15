import type { ParsedQuestion } from './types';

// A server-controlled instruction appended after the (user-customizable)
// prompt. It asks the model for an extra machine-readable block so we can
// archive every question/options/correct answer without changing the short
// answer the overlay shows.
export const STRUCTURED_SUFFIX = `

---
ALSO, on a separate final line, output exactly one machine-readable block listing EVERY question visible on the screen as a JSON array:
[[QDATA]][{"question":"<full question text>","options":["<choice 1>","<choice 2>"],"correct":"<the correct answer text or label>"}][[/QDATA]]
Rules: valid minified JSON ARRAY, one object per question in screen order, no markdown, escape inner quotes, "options" is [] if there are no listed choices, include ALL questions if there are several, always output the block even if unsure.`;

const QDATA_RE = /\[\[QDATA\]\]\s*([\s\S]*?)\s*\[\[\/QDATA\]\]/i;

function stripStructured(text: string): string {
  return text.replace(QDATA_RE, '').trim();
}

function coerce(raw: unknown): ParsedQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === 'string' ? o.question : '';
  const correct = typeof o.correct === 'string' ? o.correct : '';
  const options = Array.isArray(o.options) ? o.options.map((x) => String(x)) : [];
  if (!question && !correct && !options.length) return null;
  return { question, options, correct };
}

export function parseStructured(text: string): ParsedQuestion[] {
  const m = text.match(QDATA_RE);
  if (!m?.[1]) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map(coerce).filter((q): q is ParsedQuestion => q !== null);
}

export function parseResultText(raw: string): string {
  const text = stripStructured(raw);
  const answerPatterns = [/Відповідь:\s*([^\n]+)/i, /Answer:\s*([^\n]+)/i];
  for (const pattern of answerPatterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.slice(0, 60);
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '0';

  const conciseAnswer = lines.find((line) => {
    return (
      /^\d+(?:,\d+)*$/.test(line) ||
      /^\d+(?:;\d+)*$/.test(line) ||
      /^\d+-[а-яa-z](?:,\d+-[а-яa-z])*$/i.test(line) ||
      /^(так|ні)$/i.test(line)
    );
  });

  return (conciseAnswer ?? lines[0] ?? '0').slice(0, 60);
}

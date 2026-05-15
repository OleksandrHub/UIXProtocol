// A server-controlled instruction appended after the (user-customizable)
// prompt. It asks the model for an extra machine-readable block so we can
// archive the question/options/correct answer without changing the short
// answer the overlay shows.
export const STRUCTURED_SUFFIX = `

---
ALSO, on a separate final line, output exactly one machine-readable block:
[[QDATA]]{"question":"<full question text>","options":["<choice 1>","<choice 2>"],"correct":"<the correct answer text or label>"}[[/QDATA]]
Rules: valid minified JSON, no markdown, escape inner quotes, "options" is [] if there are no listed choices, always include the block even if unsure.`;

const QDATA_RE = /\[\[QDATA\]\]\s*([\s\S]*?)\s*\[\[\/QDATA\]\]/i;

function stripStructured(text: string): string {
  return text.replace(QDATA_RE, '').trim();
}

export interface StructuredResult {
  question: string;
  options: string[];
  correct: string;
}

export function parseStructured(text: string): StructuredResult {
  const empty: StructuredResult = { question: '', options: [], correct: '' };
  const m = text.match(QDATA_RE);
  if (!m?.[1]) return empty;
  try {
    const parsed = JSON.parse(m[1].trim()) as Partial<StructuredResult>;
    return {
      question: typeof parsed.question === 'string' ? parsed.question : '',
      options: Array.isArray(parsed.options)
        ? parsed.options.map((o) => String(o))
        : [],
      correct: typeof parsed.correct === 'string' ? parsed.correct : '',
    };
  } catch {
    return empty;
  }
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

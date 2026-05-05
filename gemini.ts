const PROMPT = `You are an expert test solver. Analyze the screenshot carefully.

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
- Answer based on the content, not guessing
- Output ONLY in format below, nothing else

FORMAT: Відповідь: [your answer]

Example: Відповідь: 3`;

const MODELS = [
  'gemini-2.5-flash',
  // 'gemini-2.5-flash-lite',
  // 'gemini-2.5-pro',
  //'gemini-3-flash-preview',
];

const REQUEST_TIMEOUT_MS = 20000;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function parseResultText(text: string): string {
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

async function callGemini(
  apiKey: string,
  model: string,
  imageBase64: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      thinkingConfig: { thinkingBudget: model.includes('pro') ? 8000 : 2000 },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text.trim()) throw new Error('empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function solveWithGemini(
  apiKeys: string[],
  imageBase64: string
): Promise<string> {
  let lastError: unknown;
  for (const model of MODELS) {
    for (const key of apiKeys) {
      try {
        const text = await callGemini(key, model, imageBase64);
        return parseResultText(text);
      } catch (e) {
        lastError = e;
        console.error(
          `[Gemini] ${model} key ${key.slice(0, 8)}…: ${(e as Error).message}`
        );
      }
    }
  }
  throw lastError ?? new Error('all keys/models failed');
}

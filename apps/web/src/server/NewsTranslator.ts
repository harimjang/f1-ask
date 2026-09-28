import { applyNewsTranslation, NewsItem } from "@f1/domain";

// 뉴스 제목·요약을 대상 로케일로 LLM 번역한다 (docs 계획 §백로그 A). 서버 전용.
//
// 프로바이더 추상화(answerQuestion 툴 루프)는 번역에 과하므로, GeminiProvider 와 같은 REST
// 엔드포인트를 직접 한 번 호출한다. **키가 없거나 실패하면 원문을 그대로 돌려준다**(무해한 폴백)
// — 현재 배포처럼 AI 키가 없으면 뉴스는 영어 원문으로 남는다(회귀 없음).

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// 영어 포함 — 영어 로케일도 발췌를 그대로 두지 않고 요약을 새로 쓴다(사용자 요청).
const LANGUAGE: Record<string, string> = {
  en: "English",
  ko: "Korean",
  ja: "Japanese",
};

const resolveModel = (): string =>
  (process.env.GEMINI_MODEL ?? "gemini-3.5-flash").replace(/^models\//, "");

// 한 번의 호출로 배치 전체를 번역한다(항목 수와 무관하게 1요청). 실패 시 원문 유지.
export const translateNews = async (
  items: NewsItem[],
  locale: string,
): Promise<NewsItem[]> => {
  const apiKey = process.env.GEMINI_API_KEY;
  const language = LANGUAGE[locale];

  // en(원문)·키 없음·대상 언어 아님·빈 목록 → 번역하지 않는다.
  if (
    apiKey === undefined ||
    apiKey.length === 0 ||
    language === undefined ||
    items.length === 0
  ) {
    return items;
  }

  try {
    // 입력은 excerpt(원문 발췌·소스)로 준다 — 모델이 이를 근거로 summary 를 새로 쓴다.
    const payload = items.map((item) => ({
      id: item.id,
      title: item.title,
      excerpt: item.summary ?? "",
    }));

    const system =
      `You localize Formula 1 news for ${language} readers. For each item do two things: ` +
      `(1) render the title in ${language} (translate if needed; keep driver surnames, team, ` +
      `sponsor and circuit names, and "Grand Prix" idiomatic); ` +
      `(2) write a fresh, concise ONE-sentence summary in ${language} of what the article is ` +
      `about, based on the title and the provided excerpt — do NOT copy the excerpt verbatim ` +
      `or just its opening; capture the key point in your own words. ` +
      `Return ONLY a JSON array of objects {id, title, summary} with the SAME ids. ` +
      `No commentary, no code fences.`;

    const body = {
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4_096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    const response = await fetch(
      `${GEMINI_BASE}/models/${resolveModel()}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    if (!response.ok) {
      return items;
    }

    const json: unknown = await response.json();
    const parts =
      (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
        ?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part) => part.text ?? "").join("");

    return applyNewsTranslation(items, text, locale);
  } catch {
    // 타임아웃·네트워크·파싱 실패 — 원문 유지.
    return items;
  }
};

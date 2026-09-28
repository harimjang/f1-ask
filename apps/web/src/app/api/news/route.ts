import { NEWS_FEEDS, NewsFeedConfig } from "@/lib/RssNewsFeeds";
import { createOpenF1ClientOptions } from "@/server/OpenF1ServerClient";
import { translateNews } from "@/server/NewsTranslator";
import {
  dedupeNewsItems,
  extractDriverTags,
  loadRoster,
  NewsItem,
  parseNewsFeedXml,
  sortNewsItems,
} from "@f1/domain";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

// 실제 F1 뉴스 RSS/Atom 을 서버측에서 모아 정규화해 돌려주는 라우트 (docs/28).
//
// 서버에서만 외부 피드를 가져온다 — 클라이언트는 CORS·파서 없이 이 JSON 만 소비한다.
// 결과는 5분 캐시한다(뉴스는 실시간이 아니고, 매 방문마다 외부 피드를 때리지 않게).
export const revalidate = 300;

// 피드 한 개가 느리거나 죽어도 전체가 막히면 안 된다 — 개별 타임아웃 + allSettled.
const FEED_TIMEOUT_MS = 8000;
const MAX_ITEMS = 40;
const SEASON_YEAR = 2026;

const fetchFeed = async (feed: NewsFeedConfig): Promise<NewsItem[]> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

    const response = await fetch(feed.url, {
      signal: controller.signal,
      // 일부 피드는 브라우저 UA 를 요구한다(봇 차단). 표기용 UA 를 단다.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Racepilot/1.0)" },
      next: { revalidate },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return [];
    }

    const xml = await response.text();

    return parseNewsFeedXml(xml, {
      sourceName: feed.sourceName,
      kind: feed.kind,
    });
  } catch {
    // 네트워크 오류·타임아웃·파싱 실패 — 이 피드만 건너뛴다.
    return [];
  }
};

// 원문(영어) 뉴스 — 로케일 무관. 피드 + 로스터를 병렬로 받아, 각 기사에 언급된 드라이버
// 코드 해시태그를 붙인다(로스터 매칭). 태그는 코드라 언어 무관 → 번역 후에도 그대로 유지된다.
const getBaseNews = unstable_cache(
  async (): Promise<NewsItem[]> => {
    const [settled, roster] = await Promise.all([
      Promise.allSettled(NEWS_FEEDS.map(fetchFeed)),
      loadRoster({
        year: SEASON_YEAR,
        clientOptions: createOpenF1ClientOptions(revalidate),
        nowMs: Date.now(),
      }).catch(() => []),
    ]);

    const collected = settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );

    const items = sortNewsItems(dedupeNewsItems(collected)).slice(0, MAX_ITEMS);

    const drivers = roster.flatMap((team) =>
      team.drivers.map((driver) => ({
        code: driver.code,
        fullName: driver.fullName,
      })),
    );

    if (drivers.length === 0) {
      return items;
    }

    return items.map((item) => ({
      ...item,
      driverTags: extractDriverTags(
        `${item.title} ${item.summary ?? ""}`,
        drivers,
      ),
    }));
  },
  ["news-base", "v2"],
  { revalidate, tags: ["news"] },
);

// 로케일별 번역 결과를 캐시한다 — LLM 을 매 요청마다 부르지 않게(5분당 로케일별 1회).
// AI 키가 없으면 translateNews 가 원문을 그대로 돌려주므로 en 과 동일해진다(무해).
const getLocalizedNews = (locale: string): Promise<NewsItem[]> =>
  unstable_cache(
    async (): Promise<NewsItem[]> => translateNews(await getBaseNews(), locale),
    ["news-localized", "v3", locale],
    { revalidate, tags: ["news"] },
  )();

export const GET = async (request: Request) => {
  const locale = new URL(request.url).searchParams.get("locale") ?? "en";

  return NextResponse.json({ items: await getLocalizedNews(locale) });
};

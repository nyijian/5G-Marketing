import { extractCcgpUrls } from "./common.js";
import { delay, fetchText } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  outcome: ProviderOutcome;
}

function officialSearchUrl(input: {
  keyword: string;
  searchType: 1 | 2;
  page: number;
  startDate: string;
  endDate: string;
  province: string;
  zoneId: string;
}): string {
  const parameters = new URLSearchParams({
    searchtype: String(input.searchType),
    page_index: String(input.page),
    bidSort: "0",
    buyerName: "",
    projectId: "",
    pinMu: "0",
    bidType: "0",
    dbselect: "bidx",
    kw: input.keyword,
    start_time: input.startDate.replaceAll("-", ":"),
    end_time: input.endDate.replaceAll("-", ":"),
    timeType: "6",
    displayZone: input.province.replace(/省$/, ""),
    zoneId: input.zoneId,
    pppStatus: "0",
    agentName: "",
  });
  return `https://search.ccgp.gov.cn/bxsearch?${parameters.toString()}`;
}

function blocked(text: string): boolean {
  return /访问过于频繁|频繁访问|请稍后再试|安全验证|事件ID/.test(text);
}

export async function discoverFromCcgpSearch(input: {
  keywords: string[];
  startDate: string;
  endDate: string;
  maxPages: number;
  province: string;
  regionCode: string;
  zoneId: string;
}): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  let queriesAttempted = 0;
  let pagesAttempted = 0;
  let successfulPages = 0;
  let rateLimited = false;

  outer: for (const keyword of input.keywords) {
    // “全文”索引同时覆盖公告标题和正文。仅跑一次可避免关键词扩展后
    // 标题/全文双跑造成请求量翻倍，并降低触发站点频控的概率。
    for (const searchType of [2] as const) {
      queriesAttempted += 1;
      for (let page = 1; page <= input.maxPages; page += 1) {
        pagesAttempted += 1;
        const url = officialSearchUrl({
          keyword,
          searchType,
          page,
          startDate: input.startDate,
          endDate: input.endDate,
          province: input.province,
          zoneId: input.zoneId,
        });
        try {
          const response = await fetchText(url, {
            retries: 1,
            referer: "https://www.ccgp.gov.cn/",
          });
          if (blocked(response.text)) {
            rateLimited = true;
            errors.push("中国政府采购网站内检索返回“访问过于频繁”，已停止继续请求");
            break outer;
          }
          successfulPages += 1;
          const urls = extractCcgpUrls(response.text);
          for (const detailUrl of urls) {
            candidates.push({
              sourceKey: "ccgp",
              sourcePlatform: "中国政府采购网",
              url: detailUrl,
              discoveredBy: "中国政府采购网站内全文索引检索（含标题与正文）",
              query: keyword,
              scope: `中国政府采购网；地区${input.province}；发布日期${input.startDate}至${input.endDate}；每个关键词/检索类型最多${input.maxPages}页`,
              isKnownSample: false,
              provinceHint: input.province,
              regionCodeHint: input.regionCode,
              referer: "https://www.ccgp.gov.cn/",
              titleHint: null,
              publishAtHint: null,
              documentIdHint: null,
              metadata: {},
            });
          }
          // 站内检索有明显的频率保护；即使本页是0条，也不要立刻切换关键词连续请求。
          await delay(3_200 + Math.floor(Math.random() * 800));
          if (urls.length === 0) break;
        } catch (error) {
          errors.push(`${keyword}/全文索引/第${page}页：${String(error)}`);
          break;
        }
      }
    }
  }

  let status: ProviderOutcome["status"];
  if (rateLimited && successfulPages === 0) status = "failed";
  else if (errors.length > 0 && successfulPages > 0) status = "partial";
  else if (successfulPages > 0 && candidates.length === 0) status = "success_zero";
  else if (successfulPages > 0) status = "success";
  else status = "failed";

  return {
    candidates,
    outcome: {
      provider: "中国政府采购网站内检索",
      sourcePlatform: "中国政府采购网",
      scope: `${input.province}；全文索引（含标题与正文）；${input.keywords.length}个关键词；${input.startDate}至${input.endDate}；每词最多${input.maxPages}页`,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      queriesAttempted,
      pagesAttempted,
      candidatesFound: new Set(candidates.map((candidate) => candidate.url)).size,
      error: errors.length ? errors.join(" | ") : null,
    },
  };
}

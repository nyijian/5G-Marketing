import { extractCcgpUrls } from "./common.js";
import { delay, fetchText } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

function searchUrl(query: string, page: number): string {
  const parameters = new URLSearchParams({
    q: query,
    count: "50",
    first: String((page - 1) * 50 + 1),
    setlang: "zh-hans",
  });
  return `https://www.bing.com/search?${parameters.toString()}`;
}

function blocked(text: string): boolean {
  return /unusual traffic|verify you are a human|请输入以下字符|检测到异常流量/i.test(text);
}

export async function discoverFromPublicSearch(input: {
  keywords: string[];
  startDate: string;
  endDate: string;
  maxPages: number;
  province: string;
  regionCode: string;
}): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  let queriesAttempted = 0;
  let pagesAttempted = 0;
  let successfulPages = 0;
  const exclusiveEnd = new Date(`${input.endDate}T00:00:00+08:00`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  const beforeDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(exclusiveEnd);

  for (const keyword of input.keywords) {
    const query = `site:ccgp.gov.cn/cggg/ "${keyword}" "${input.province.replace(/省$/, "")}" after:${input.startDate} before:${beforeDate}`;
    queriesAttempted += 1;
    for (let page = 1; page <= input.maxPages; page += 1) {
      pagesAttempted += 1;
      try {
        const response = await fetchText(searchUrl(query, page), { retries: 1 });
        if (blocked(response.text)) {
          errors.push(`${keyword}/第${page}页：公开搜索触发人机验证`);
          break;
        }
        successfulPages += 1;
        const urls = extractCcgpUrls(response.text);
        for (const url of urls) {
          candidates.push({
            sourceKey: "ccgp",
            sourcePlatform: "中国政府采购网",
            url,
            discoveredBy: "公开搜索（Bing）",
            query,
            scope: `Bing已索引的中国政府采购网公告；地区关键词${input.province}；日期语法${input.startDate}至${input.endDate}；每关键词最多${input.maxPages}页；非平台全量`,
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
        if (urls.length === 0) break;
        await delay(450);
      } catch (error) {
        errors.push(`${keyword}/第${page}页：${String(error)}`);
        break;
      }
    }
  }

  let status: ProviderOutcome["status"];
  if (successfulPages === 0) status = "failed";
  else if (errors.length > 0) status = "partial";
  else if (candidates.length === 0) status = "success_zero";
  else status = "success";

  return {
    candidates,
    outcome: {
      provider: "公开搜索发现（Bing）",
      sourcePlatform: "公开搜索→中国政府采购网详情",
      scope: `Bing索引；${input.province}；${input.keywords.length}个关键词；${input.startDate}至${input.endDate}；每词最多${input.maxPages}页；不等于中国政府采购网全量`,
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

export function seedOutcome(count: number): ProviderOutcome {
  const now = new Date().toISOString();
  return {
    provider: "固定验证种子",
    sourcePlatform: "中国政府采购网",
    scope: "用户指定样本及首轮公开搜索确认的固定URL；只用于回归与兜底，不代表检索覆盖",
    status: count > 0 ? "success" : "success_zero",
    startedAt: now,
    finishedAt: now,
    queriesAttempted: 0,
    pagesAttempted: 0,
    candidatesFound: count,
    error: null,
  };
}

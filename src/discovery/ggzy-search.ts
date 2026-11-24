import { delay, postFormJson } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

interface GgzyRecord {
  id: string;
  publishTime: string | null;
  informationType: string | null;
  informationTypeText: string | null;
  province: string | null;
  provinceText: string | null;
  cityText: string | null;
  title: string;
  tenderProjectCode: string | null;
  url: string;
}

interface GgzyResponse {
  code: number;
  message?: string;
  data?: {
    records?: GgzyRecord[];
    pages?: number | string;
    total?: number | string;
  };
}

function detailUrl(record: GgzyRecord): string {
  const page = new URL(record.url, "https://www.ggzy.gov.cn");
  page.pathname = page.pathname.replace("/html/a/", "/html/b/");
  return page.href;
}

function codeMessage(response: GgzyResponse): string {
  if (response.code === 829) return "全国公共资源交易平台要求验证码";
  if (response.code === 800) return "全国公共资源交易平台提示操作过于频繁";
  if (response.code === 804) return "全国公共资源交易平台要求进一步细化查询条件";
  if (response.code === 801) return `全国公共资源交易平台查询错误：${response.message ?? "未知错误"}`;
  return `全国公共资源交易平台返回未知状态 code=${response.code}：${response.message ?? ""}`;
}

export async function discoverFromGgzy(input: {
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
  let stopAll = false;

  for (const keyword of input.keywords) {
    if (stopAll) break;
    queriesAttempted += 1;
    for (let page = 1; page <= input.maxPages; page += 1) {
      pagesAttempted += 1;
      try {
        const response = await postFormJson<GgzyResponse>(
          "https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList",
          {
            SOURCE_TYPE: "1",
            DEAL_TIME: "06",
            TIMEBEGIN: input.startDate,
            TIMEEND: input.endDate,
            DEAL_PROVINCE: input.regionCode,
            FINDTXT: keyword,
            PAGENUMBER: String(page),
          },
          {
            retries: 1,
            referer: "https://www.ggzy.gov.cn/deal/dealList.html",
            headers: {
              "X-Pass-Token": "",
            },
          },
        );
        if (response.code !== 200) {
          errors.push(`${keyword}/第${page}页：${codeMessage(response)}`);
          if ([800, 829].includes(response.code)) stopAll = true;
          break;
        }
        successfulPages += 1;
        const records = response.data?.records ?? [];
        for (const record of records) {
          candidates.push({
            sourceKey: "ggzy",
            sourcePlatform: "全国公共资源交易平台",
            url: detailUrl(record),
            discoveredBy: "全国公共资源交易平台官方接口",
            query: keyword,
            scope: `${input.province}（${input.regionCode}）；${input.startDate}至${input.endDate}；每关键词最多${input.maxPages}页`,
            isKnownSample: false,
            provinceHint: record.provinceText ?? input.province,
            regionCodeHint: record.province ?? input.regionCode,
            referer: "https://www.ggzy.gov.cn/deal/dealList.html",
            titleHint: record.title,
            publishAtHint: record.publishTime,
            documentIdHint: record.id,
            metadata: {
              informationType: record.informationType,
              informationTypeText: record.informationTypeText,
              cityText: record.cityText,
              tenderProjectCode: record.tenderProjectCode,
            },
          });
        }
        const pageCount = Number(response.data?.pages ?? 1);
        await delay(850 + Math.floor(Math.random() * 450));
        if (records.length === 0 || page >= pageCount) break;
      } catch (error) {
        errors.push(`${keyword}/第${page}页：${error instanceof Error ? error.message : String(error)}`);
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
      provider: "全国公共资源交易平台官方检索",
      sourcePlatform: "全国公共资源交易平台",
      scope: `${input.province}；官方交易公开接口；${input.keywords.length}个关键词；${input.startDate}至${input.endDate}；每词最多${input.maxPages}页`,
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

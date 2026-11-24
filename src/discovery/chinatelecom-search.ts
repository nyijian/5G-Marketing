import { delay, postJson } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

interface TelecomRecord {
  id: string;
  docTitle: string;
  docCode: string | null;
  pStartDate: string | null;
  pEndDate: string | null;
  createDate: string;
  docType: string | null;
  docTypeCode: string;
  provinceCode: string;
  provinceName: string | null;
  docId: string;
  securityViewCode: string;
}

interface TelecomResponse {
  code: number;
  msg?: string;
  data?: {
    pageInfo?: {
      list?: TelecomRecord[];
      hasNextPage?: boolean;
    };
  };
}

const PROVINCE_CODES = ["13", "CM", "EM"] as const;
const TITLE_QUERIES = ["5G", "UPF", "专网"] as const;

function browserDetailUrl(record: TelecomRecord): string {
  const parameters = new URLSearchParams({
    id: record.docId,
    type: "2",
    docTypeCode: record.docTypeCode,
    securityViewCode: record.securityViewCode,
  });
  return `https://caigou.chinatelecom.com.cn/DeclareDetails?${parameters.toString()}`;
}

function inWindow(value: string, startDate: string, endDate: string): boolean {
  const date = value.slice(0, 10);
  return date >= startDate && date <= endDate;
}

export async function discoverFromChinaTelecom(input: {
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

  for (const provinceCode of PROVINCE_CODES) {
    for (const keyword of TITLE_QUERIES) {
      queriesAttempted += 1;
      for (let page = 1; page <= input.maxPages; page += 1) {
        pagesAttempted += 1;
        try {
          const response = await postJson<TelecomResponse>(
            "https://caigou.chinatelecom.com.cn/portal/base/announcementJoin/queryListNew",
            {
              pageNum: page,
              pageSize: 50,
              type: "or1ez",
              title: keyword,
              provinceCode,
              noticeSummary: "",
            },
            { retries: 1, referer: "https://caigou.chinatelecom.com.cn/search" },
          );
          if (response.code !== 200) {
            errors.push(`${provinceCode}/${keyword}/第${page}页：${response.msg ?? `code=${response.code}`}`);
            break;
          }
          successfulPages += 1;
          const pageInfo = response.data?.pageInfo;
          const records = pageInfo?.list ?? [];
          for (const record of records) {
            if (!inWindow(record.createDate, input.startDate, input.endDate)) continue;
            candidates.push({
              sourceKey: "chinatelecom",
              sourcePlatform: "中国电信阳光采购网",
              url: browserDetailUrl(record),
              discoveredBy: "中国电信阳光采购网官方列表接口",
              query: `标题含${keyword}；省份代码${provinceCode}`,
              scope: `${input.province}（集团四川/终端四川/集成四川）；标题检索5G、UPF、专网；客户端按${input.startDate}至${input.endDate}过滤；每组最多${input.maxPages}页`,
              isKnownSample: false,
              provinceHint: input.province,
              regionCodeHint: input.regionCode,
              referer: "https://caigou.chinatelecom.com.cn/search",
              titleHint: record.docTitle,
              publishAtHint: record.createDate,
              documentIdHint: record.docId,
              metadata: {
                docCode: record.docCode,
                docType: record.docType,
                docTypeCode: record.docTypeCode,
                securityViewCode: record.securityViewCode,
                pStartDate: record.pStartDate,
                pEndDate: record.pEndDate,
                provinceCode,
              },
            });
          }
          await delay(450 + Math.floor(Math.random() * 350));
          if (records.length === 0 || pageInfo?.hasNextPage !== true) break;
        } catch (error) {
          errors.push(`${provinceCode}/${keyword}/第${page}页：${error instanceof Error ? error.message : String(error)}`);
          break;
        }
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
      provider: "中国电信阳光采购网官方检索",
      sourcePlatform: "中国电信阳光采购网",
      scope: `${input.province}；集团四川/终端四川/集成四川；标题关键词5G、UPF、专网；${input.startDate}至${input.endDate}；每组最多${input.maxPages}页`,
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

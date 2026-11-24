import { delay, fetchText, postJson } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

const ORIGIN = "https://ggzyjy.sc.gov.cn";
const SEARCH_PATH = "/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew";
const PAGE_SIZE = 12;

interface SichuanGgzyRecord {
  id: string;
  categorynum: string | null;
  title: string | null;
  titlenew: string | null;
  content: string | null;
  webdate: string | null;
  infodate: string | null;
  linkurl: string | null;
  zhuanzai: string | null;
  tradingsourcevalue: string | null;
  tradetypevalue: string | null;
}

interface SichuanGgzyResponse {
  result?: {
    totalcount?: number | string;
    records?: SichuanGgzyRecord[];
  };
}

function searchBody(keyword: string, startDate: string, endDate: string, page: number): object {
  return {
    token: "",
    pn: (page - 1) * PAGE_SIZE,
    rn: PAGE_SIZE,
    sdt: "",
    edt: "",
    wd: "",
    inc_wd: "",
    exc_wd: "",
    fields: "",
    cnum: "",
    sort: '{"ordernum":"0","webdate":"0"}',
    ssort: "",
    cl: 10_000,
    terminal: "",
    condition: [
      {
        fieldName: "categorynum",
        equal: "002",
        notEqual: null,
        equalList: null,
        notEqualList: null,
        isLike: true,
        likeType: 2,
      },
      {
        fieldName: "titlenew",
        equal: keyword,
        notEqual: null,
        equalList: null,
        notEqualList: null,
        isLike: true,
        likeType: 0,
      },
    ],
    time: [{
      fieldName: "webdate",
      startTime: `${startDate} 00:00:00`,
      endTime: `${endDate} 23:59:59`,
    }],
    highlights: "",
    statistics: null,
    unionCondition: null,
    accuracy: "",
    noParticiple: "1",
    searchRange: null,
    noWd: true,
  };
}

function detailUrl(record: SichuanGgzyRecord): string | null {
  if (!record.linkurl) return null;
  try {
    return new URL(record.linkurl, ORIGIN).href;
  } catch {
    return null;
  }
}

export async function discoverFromSichuanGgzy(input: {
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

  for (const keyword of input.keywords) {
    queriesAttempted += 1;
    for (let page = 1; page <= input.maxPages; page += 1) {
      pagesAttempted += 1;
      try {
        const response = await postJson<SichuanGgzyResponse>(
          `${ORIGIN}${SEARCH_PATH}`,
          searchBody(keyword, input.startDate, input.endDate, page),
          { retries: 1, referer: `${ORIGIN}/jyxx/transactionInfo.html` },
        );
        if (!response.result) throw new Error("官方检索接口未返回result");
        successfulPages += 1;
        const records = response.result.records ?? [];
        const total = Number(response.result.totalcount ?? records.length);
        for (const record of records) {
          const url = detailUrl(record);
          const title = record.titlenew ?? record.title;
          if (!url || !title) continue;
          candidates.push({
            sourceKey: "sichuanggzy",
            sourcePlatform: "四川省公共资源交易信息网",
            url,
            discoveredBy: "四川省公共资源交易信息网官方检索接口",
            query: keyword,
            scope: `${input.province}；交易信息标题检索；${input.startDate}至${input.endDate}；每词最多${input.maxPages}页`,
            isKnownSample: false,
            provinceHint: input.province,
            regionCodeHint: input.regionCode,
            referer: `${ORIGIN}/jyxx/transactionInfo.html`,
            titleHint: title,
            publishAtHint: record.webdate ?? record.infodate,
            documentIdHint: record.id,
            metadata: {
              content: record.content,
              categorynum: record.categorynum,
              zhuanzai: record.zhuanzai,
              tradingsourcevalue: record.tradingsourcevalue,
              tradetypevalue: record.tradetypevalue,
            },
          });
        }
        await delay(300 + Math.floor(Math.random() * 250));
        if (records.length === 0 || !Number.isFinite(total) || page * PAGE_SIZE >= total) break;
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
      provider: "四川省公共资源交易信息网官方检索",
      sourcePlatform: "四川省公共资源交易信息网",
      scope: `${input.province}；官方交易信息标题检索；${input.keywords.length}个关键词；${input.startDate}至${input.endDate}；每词最多${input.maxPages}页`,
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function fetchSichuanGgzyDetailHtml(candidate: DiscoveryCandidate): Promise<string> {
  const content = candidate.metadata.content;
  if (!content) {
    return (await fetchText(candidate.url, {
      retries: 2,
      ...(candidate.referer ? { referer: candidate.referer } : {}),
    })).text;
  }
  const title = candidate.titleHint ?? "四川省公共资源交易公告";
  const publishAt = candidate.publishAtHint ?? "";
  return `<!doctype html><html lang="zh-CN"><body>
    <div class="vF_detail_header"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(publishAt)}</span></div>
    <div class="vF_detail_content">${content}</div>
  </body></html>`;
}

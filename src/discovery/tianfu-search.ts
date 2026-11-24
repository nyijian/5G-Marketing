import { createDecipheriv } from "node:crypto";
import { delay } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

const SEARCH_TERMS = ["5G", "专网", "UPF"] as const;
const PAGE_SIZE = 100;
const AES_KEY = Buffer.from("1221567981QWEASD", "utf8");

const PORTALS = [
  {
    key: "tianfu",
    host: "https://www.tfygcgfw.com",
    platform: "天府阳光采购服务平台",
  },
  {
    key: "scenergy",
    host: "https://scny.tfygcgfw.com",
    platform: "四川能源天府阳光采购服务平台",
  },
] as const;

const PHASES = [
  { endpoint: "tenderDoc", route: "bidding", label: "采购/招标公告" },
  { endpoint: "publicity", route: "winningbid", label: "中标候选人公示" },
  { endpoint: "result", route: "winning", label: "中标（成交）结果公告" },
  { endpoint: "change", route: "change", label: "更正/变更公告" },
  { endpoint: "termination", route: "failed", label: "终止/异常公告" },
] as const;

type PhaseEndpoint = (typeof PHASES)[number]["endpoint"];

interface TianfuResponse<T> {
  status: string | number;
  msg?: string;
  data?: T | null;
}

interface TianfuListData {
  page?: {
    page?: number;
    totalPages?: number;
    pageSize?: number;
    totalElements?: number;
  };
  data?: TianfuRecord[];
}

interface TianfuRecord {
  id: string;
  planId?: string | number | null;
  type?: string | number | null;
  projectName?: string | null;
  planName?: string | null;
  publishTime?: string | null;
  deadline?: string | null;
  planUnique?: string | null;
  demanderId?: string | null;
  tenantName?: string | null;
  isOutside?: string | number | null;
  phase?: string | number | null;
  identity?: string | null;
  planCode?: string | null;
  orgName?: string | null;
}

interface TianfuDetail {
  id?: string | number | null;
  pid?: string | null;
  code?: string | null;
  userName?: string | null;
  demanderId?: string | null;
  orgname?: string | null;
  projectname?: string | null;
  deadline?: string | null;
  publishTime?: string | null;
  issueTime?: string | null;
  estimatetotal?: string | number | null;
  changeId?: string | null;
  name?: string | null;
  content?: string | null;
  bidStatus?: string | number | null;
  proctype?: string | number | null;
  type?: string | number | null;
  [key: string]: unknown;
}

function sourceKey(value: "tianfu" | "scenergy"): DiscoveryCandidate["sourceKey"] {
  return value;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function inWindow(value: string | null | undefined, startDate: string, endDate: string): boolean {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= startDate && date <= endDate;
}

function decryptRouteId(value: string): string {
  if (!value || !/[+/=]/.test(value)) return value;
  try {
    const decipher = createDecipheriv("aes-128-ecb", AES_KEY, null);
    decipher.setAutoPadding(true);
    return Buffer.concat([
      decipher.update(Buffer.from(value, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return value;
  }
}

function phaseFor(endpoint: PhaseEndpoint): (typeof PHASES)[number] {
  const phase = PHASES.find((item) => item.endpoint === endpoint);
  if (!phase) throw new Error(`未知天府阳光公告阶段：${endpoint}`);
  return phase;
}

function browserUrl(host: string, endpoint: PhaseEndpoint, id: string): string {
  return `${host}/transaction/${phaseFor(endpoint).route}/${encodeURIComponent(id)}`;
}

function metadataValue(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function shouldKeepListHit(record: TianfuRecord, keyword: string): boolean {
  // 平台是分词模糊检索：“专网”会命中“川网、管网、国网”等大量噪声。
  // 5G/UPF足够特异，可保留正文弱命中的泛化标题；“专网”先要求标题中有完整词。
  if (keyword !== "专网") return true;
  return normalize(`${record.planName ?? ""} ${record.projectName ?? ""}`).includes("专网");
}

async function getJson<T>(url: URL, retries = 1): Promise<TianfuResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `${url.origin}/`,
        },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return JSON.parse(text) as TianfuResponse<T>;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(800 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function mergeCandidate(
  candidates: Map<string, DiscoveryCandidate>,
  key: string,
  candidate: DiscoveryCandidate,
): void {
  const current = candidates.get(key);
  if (!current) {
    candidates.set(key, candidate);
    return;
  }
  const queries = [...new Set([current.query, candidate.query].flatMap((value) => value.split("、")))];
  current.query = queries.join("、");
  current.metadata.matchedKeywords = current.query;
}

export async function discoverFromTianfu(input: {
  startDate: string;
  endDate: string;
  maxPages: number;
  province: string;
  regionCode: string;
}): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const candidates = new Map<string, DiscoveryCandidate>();
  const errors: string[] = [];
  const truncated: string[] = [];
  let queriesAttempted = 0;
  let pagesAttempted = 0;
  let successfulPages = 0;
  let rateLimited = false;

  portalLoop: for (const portal of PORTALS) {
    for (const phase of PHASES) {
      for (const keyword of SEARCH_TERMS) {
        queriesAttempted += 1;
        for (let page = 1; page <= input.maxPages; page += 1) {
          pagesAttempted += 1;
          const url = new URL(`${portal.host}/supplier/tender/search/${phase.endpoint}`);
          url.searchParams.set("page", String(page));
          url.searchParams.set("pageSize", String(PAGE_SIZE));
          url.searchParams.set("rows", String(PAGE_SIZE));
          url.searchParams.set("keyword", keyword);

          try {
            const response = await getJson<TianfuListData>(url);
            if (String(response.status) === "5") {
              rateLimited = true;
              errors.push(`${portal.platform}返回“${response.msg ?? "当前IP限制访问"}”，需要滑块验证`);
              continue portalLoop;
            }
            if (String(response.status) !== "0" || !response.data) {
              errors.push(`${portal.platform}/${phase.label}/${keyword}/第${page}页：${response.msg ?? `status=${response.status}`}`);
              break;
            }

            successfulPages += 1;
            const records = response.data.data ?? [];
            for (const record of records) {
              if (!record.id || !inWindow(record.publishTime, input.startDate, input.endDate)) continue;
              if (!shouldKeepListHit(record, keyword)) continue;
              const routeId = decryptRouteId(record.id);
              const urlValue = browserUrl(portal.host, phase.endpoint, routeId);
              const candidate: DiscoveryCandidate = {
                sourceKey: sourceKey(portal.key),
                sourcePlatform: portal.platform,
                url: urlValue,
                discoveredBy: `${portal.platform}官方公开列表接口`,
                query: keyword,
                scope: `${input.province}；${portal.platform}；标题/正文模糊检索5G、专网、UPF并做标题去噪；客户端按${input.startDate}至${input.endDate}过滤；公告、候选、结果、变更、终止各最多${input.maxPages}页`,
                isKnownSample: false,
                provinceHint: input.province,
                regionCodeHint: input.regionCode,
                referer: `${portal.host}/transaction`,
                titleHint: record.planName ?? record.projectName ?? null,
                publishAtHint: record.publishTime ?? null,
                documentIdHint: routeId,
                metadata: {
                  host: portal.host,
                  endpoint: phase.endpoint,
                  route: phase.route,
                  phaseLabel: phase.label,
                  encryptedId: record.id,
                  routeId,
                  planId: metadataValue(record.planId),
                  type: metadataValue(record.type),
                  projectName: record.projectName ?? null,
                  planName: record.planName ?? null,
                  deadline: record.deadline ?? null,
                  planUnique: record.planUnique ?? null,
                  demanderId: record.demanderId ?? null,
                  tenantName: record.tenantName ?? null,
                  isOutside: metadataValue(record.isOutside),
                  identity: record.identity ?? null,
                  planCode: record.planCode ?? null,
                  orgName: record.orgName ?? null,
                  matchedKeywords: keyword,
                },
              };
              mergeCandidate(candidates, `${portal.key}|${phase.endpoint}|${routeId}`, candidate);
            }

            const totalPages = Number(response.data.page?.totalPages ?? 1);
            if (page >= input.maxPages && totalPages > input.maxPages) {
              truncated.push(`${portal.platform}/${phase.label}/${keyword}共${totalPages}页，本次读取${input.maxPages}页`);
            }
            await delay(1_100 + Math.floor(Math.random() * 600));
            if (records.length === 0 || page >= totalPages) break;
          } catch (error) {
            errors.push(`${portal.platform}/${phase.label}/${keyword}/第${page}页：${error instanceof Error ? error.message : String(error)}`);
            break;
          }
        }
      }
    }
  }

  const result = [...candidates.values()];
  let status: ProviderOutcome["status"];
  // 状态 5 是站点明确返回的滑块/IP 限制：来源可达但本轮覆盖不完整，
  // 与网络不可达或接口整体失败区分，按 partial 记录。
  if (rateLimited) status = "partial";
  else if (successfulPages === 0) status = "failed";
  else if (errors.length > 0 || truncated.length > 0 || rateLimited) status = "partial";
  else if (result.length === 0) status = "success_zero";
  else status = "success";

  return {
    candidates: result,
    outcome: {
      provider: "天府阳光采购服务平台官方检索",
      sourcePlatform: "天府阳光采购服务平台；四川能源天府阳光采购服务平台",
      scope: `${input.province}；主站+四川能源；5G/专网/UPF；公告、候选、结果、变更、终止；客户端按${input.startDate}至${input.endDate}过滤；每组合最多${input.maxPages}页`,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      queriesAttempted,
      pagesAttempted,
      candidatesFound: result.length,
      error: [...errors, ...truncated].join(" | ") || null,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function detailDeadlineLine(content: string): string {
  const raw = content.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
  const value = raw.match(
    /(?:响应文件|投标文件)(?:递交|提交)?截止时间(?:为)?[：:\s]*((?:20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?)(?:\s+\d{1,2}(?::\d{2}){1,2})?)/,
  )?.[1];
  return value ? `<p>提交响应文件截止时间：${escapeHtml(value)}</p>` : "";
}

function phaseBreadcrumb(endpoint: PhaseEndpoint, content: string): string {
  if (endpoint === "tenderDoc") {
    if (/直接采购/.test(content)) return "直接采购公告";
    if (/竞争性磋商/.test(content)) return "竞争性磋商公告";
    if (/询价/.test(content)) return "询价公告";
    return "采购/招标公告";
  }
  return phaseFor(endpoint).label;
}

function moneyText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  return /(元|万元|亿元)/.test(text) ? text : `${text}元`;
}

/**
 * 天府阳光详情是公开JSON接口。此函数包装成通用解析器可识别的HTML，
 * 文件下载/参与投标仍可能要求供应商登录。
 */
export async function fetchTianfuDetailHtml(candidate: DiscoveryCandidate): Promise<string> {
  const host = candidate.metadata.host;
  const endpoint = candidate.metadata.endpoint as PhaseEndpoint | null;
  const routeId = candidate.metadata.routeId ?? candidate.documentIdHint;
  if (!host || !endpoint || !routeId || !PHASES.some((item) => item.endpoint === endpoint)) {
    throw new Error("天府阳光候选缺少详情请求参数");
  }

  const url = new URL(`${host}/supplier/tender/details/${endpoint}/${encodeURIComponent(routeId)}`);
  const response = await getJson<TianfuDetail>(url, 2);
  if (String(response.status) === "5") {
    throw new Error(`天府阳光详情接口受限：${response.msg ?? "需要滑块验证"}`);
  }
  if (String(response.status) !== "0" || !response.data) {
    throw new Error(`天府阳光详情接口失败：${response.msg ?? `status=${response.status}`}`);
  }

  const data = response.data;
  const title = String(data.name ?? data.projectname ?? candidate.titleHint ?? "天府阳光采购公告");
  const publishAt = String(data.publishTime ?? candidate.publishAtHint ?? "");
  const content = String(data.content ?? "");
  const tenantName = String(data.userName ?? candidate.metadata.tenantName ?? "");
  const orgName = String(data.orgname ?? candidate.metadata.orgName ?? "");
  const buyer = tenantName && orgName && tenantName !== orgName
    ? `${tenantName}（${orgName}）`
    : tenantName || orgName;
  const projectCode = String(data.code ?? candidate.metadata.planCode ?? "");
  const methodLine = /直接采购/.test(content) ? "<p>采购方式：直接采购</p>" : "";
  const budget = moneyText(data.estimatetotal);

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <div class="vF_location">${escapeHtml(phaseBreadcrumb(endpoint, content))}</div>
  <div class="vF_detail_header">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(publishAt)} 来源：${escapeHtml(candidate.sourcePlatform)}</p>
  </div>
  <table>
    ${buyer ? `<tr><td>采购单位</td><td>${escapeHtml(buyer)}</td></tr>` : ""}
    <tr><td>行政区域</td><td>四川省</td></tr>
    ${budget ? `<tr><td>预算金额</td><td>${escapeHtml(budget)}</td></tr>` : ""}
  </table>
  <div class="vF_detail_content">
    ${projectCode ? `<p>项目编号：${escapeHtml(projectCode)}</p>` : ""}
    ${methodLine}
    ${detailDeadlineLine(content)}
    ${content}
  </div>
</body>
</html>`;
}

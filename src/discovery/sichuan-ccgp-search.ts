import {
  constants,
  createHash,
  publicEncrypt,
} from "node:crypto";
import { delay } from "../http.js";
import type { DiscoveryCandidate, ProviderOutcome } from "../types.js";
import type { DiscoveryResult } from "./ccgp-search.js";

const ORIGIN = "https://www.ccgp-sichuan.gov.cn";
const CONFIG_PATH = "/gpcms-center-web/static/config.js";
const LIST_PATH = "/gpcms/rest/web/v2/info/selectInfoMoreChannel";
const DETAIL_PATH = "/gpcms/rest/web/v2/info/getInfoById";
const SITE_ID = "94c965cc-c55d-4f92-8469-d5875c68bd04";
const NOTICE_CHANNEL = "c5bff13f-21ca-4dac-b158-cb40accd3035";
const PAGE_LIMIT = 40;
const SOURCE_KEY: DiscoveryCandidate["sourceKey"] = "sichuanccgp";

interface SichuanCcgpApiResponse<T> {
  code: string | number;
  msg?: string;
  data?: T | null;
}

interface SichuanCcgpRecord {
  id: string;
  title: string;
  channel: string | null;
  noticeTime: string | null;
  noticeId: string | null;
  noticeType: string | null;
  noticeTypeName?: string | null;
  regionName: string | null;
  regionCode: string | null;
  purchaser: string | null;
  agency: string | null;
  purchaseManner: string | null;
  purchaseMannerName?: string | null;
  purchaseNature: string | null;
  openTenderCode: string | null;
  openTenderTime: string | null;
  expireTime: string | null;
  budget: string | null;
  planId: string | null;
  planCodes: string | null;
  dataSource: string | null;
  description: string | null;
  content?: string | null;
  attchList?: Array<{
    fileName?: string | null;
    fileUrl?: string | null;
    fileExt?: string | null;
  }> | null;
}

interface SichuanCcgpListData {
  rows?: SichuanCcgpRecord[];
  total?: number | string;
}

let publicKeyPromise: Promise<string> | null = null;

function hash(algorithm: "sha1" | "md5", value: string): string {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

async function fetchPublicKey(): Promise<string> {
  const response = await fetch(`${ORIGIN}${CONFIG_PATH}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/javascript,*/*;q=0.8",
      Referer: `${ORIGIN}/`,
    },
  });
  if (!response.ok) {
    throw new Error(`读取四川政府采购网签名配置失败：HTTP ${response.status}`);
  }
  const config = await response.text();
  const encoded = config.match(/RSAPublicKey\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (!encoded) throw new Error("四川政府采购网配置中未找到 RSAPublicKey");

  const base64 = String.fromCharCode(
    ...encoded.split(",").map((value) => {
      const number = Number(value.trim());
      if (!Number.isInteger(number)) throw new Error("四川政府采购网 RSAPublicKey 格式异常");
      return number;
    }),
  );
  const lines = base64.match(/.{1,64}/g);
  if (!lines) throw new Error("四川政府采购网 RSAPublicKey 内容为空");
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

async function getPublicKey(): Promise<string> {
  if (!publicKeyPromise) {
    publicKeyPromise = fetchPublicKey().catch((error) => {
      publicKeyPromise = null;
      throw error;
    });
  }
  return publicKeyPromise;
}

async function signedHeaders(path: string): Promise<Record<string, string>> {
  // 官网前端分别生成常规签名时间和 RSA 签名时间，两者不要求完全相同。
  const rsaTime = Date.now();
  const encrypted = publicEncrypt(
    {
      key: await getPublicKey(),
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(`${path}$$${rsaTime}`, "utf8"),
  ).toString("base64");
  const time = Date.now();
  const sign = hash("md5", hash("sha1", `${time}_${path}_bosssoft_platform_095285`));
  return {
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: `${ORIGIN}/`,
    nsssjss: encrypted,
    time: String(time),
    url: path,
    sign,
  };
}

async function signedGet<T>(
  path: string,
  parameters: Record<string, string>,
  retries = 1,
): Promise<SichuanCcgpApiResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const url = new URL(path, ORIGIN);
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
      url.searchParams.set("_t", String(Date.now()));
      const response = await fetch(url, {
        signal: controller.signal,
        headers: await signedHeaders(path),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return JSON.parse(text) as SichuanCcgpApiResponse<T>;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await delay(700 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function officialRegionCode(regionCode: string): string {
  // 四川站把全省视为“不限区划”；510000/510001 会被解释成某个具体层级。
  return /^51000[01]$/.test(regionCode) ? "" : regionCode;
}

function detailPageUrl(record: SichuanCcgpRecord): string {
  const url = new URL("/maincms-web/article", ORIGIN);
  url.searchParams.set("type", "notice");
  url.searchParams.set("id", record.id);
  if (record.planId) url.searchParams.set("planId", record.planId);
  if (record.channel) url.searchParams.set("channel", record.channel);
  return url.href;
}

function metadataValue(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toCandidate(
  record: SichuanCcgpRecord,
  input: {
    keyword: string;
    startDate: string;
    endDate: string;
    province: string;
    regionCode: string;
    total: number;
  },
): DiscoveryCandidate {
  return {
    sourceKey: SOURCE_KEY,
    sourcePlatform: "四川政府采购网",
    url: detailPageUrl(record),
    discoveredBy: "四川政府采购网官方公开列表接口（关键词检索）",
    query: input.keyword,
    scope: `${input.province}；标题关键词“${input.keyword}”；发布日期${input.startDate}至${input.endDate}；接口每词最多返回${PAGE_LIMIT}条且不可可靠翻页`,
    isKnownSample: false,
    provinceHint: input.province,
    regionCodeHint: record.regionCode ?? input.regionCode,
    referer: `${ORIGIN}/maincms-web/noticeInformation?typeId=ggxx`,
    titleHint: record.title,
    publishAtHint: record.noticeTime,
    documentIdHint: record.id,
    metadata: {
      id: record.id,
      planId: record.planId,
      channel: record.channel ?? NOTICE_CHANNEL,
      siteId: SITE_ID,
      noticeId: record.noticeId,
      noticeType: record.noticeType,
      noticeTypeName: record.noticeTypeName ?? null,
      regionName: record.regionName,
      purchaser: record.purchaser,
      agency: record.agency,
      purchaseManner: record.purchaseManner,
      purchaseMannerName: record.purchaseMannerName ?? null,
      purchaseNature: record.purchaseNature,
      openTenderCode: record.openTenderCode,
      openTenderTime: record.openTenderTime,
      expireTime: record.expireTime,
      budget: record.budget,
      planCodes: record.planCodes,
      dataSource: record.dataSource,
      matchedKeywords: input.keyword,
      queryTotal: metadataValue(input.total),
    },
  };
}

function mergeKeyword(existing: DiscoveryCandidate, keyword: string): void {
  const values = (existing.metadata.matchedKeywords ?? existing.query)
    .split("、")
    .filter(Boolean);
  if (!values.includes(keyword)) values.push(keyword);
  existing.metadata.matchedKeywords = values.join("、");
  existing.query = values.join("、");
}

export async function discoverFromSichuanCcgp(input: {
  keywords: string[];
  startDate: string;
  endDate: string;
  province: string;
  regionCode: string;
}): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const candidates = new Map<string, DiscoveryCandidate>();
  const errors: string[] = [];
  const truncated: string[] = [];
  const keywords = [...new Set(input.keywords.map((value) => value.trim()).filter(Boolean))];
  let successfulQueries = 0;
  let queriesAttempted = 0;

  for (const keyword of keywords) {
    queriesAttempted += 1;
    try {
      const response = await signedGet<SichuanCcgpListData>(LIST_PATH, {
        siteId: SITE_ID,
        channel: NOTICE_CHANNEL,
        title: keyword,
        noticeType: "",
        regionCode: officialRegionCode(input.regionCode),
        cityOrArea: "",
        operationStartTime: `${input.startDate} 00:00:00`,
        operationEndTime: `${input.endDate} 23:59:59`,
        currPage: "1",
        pageSize: String(PAGE_LIMIT),
      });
      if (String(response.code) !== "200") {
        errors.push(`${keyword}：${response.msg ?? `code=${response.code}`}`);
        continue;
      }

      successfulQueries += 1;
      // 四川站对“成功但0条”的查询可能返回 data=null，不能把“操作成功”误记成错误。
      const rows = response.data?.rows ?? [];
      const total = Number(response.data?.total ?? rows.length);
      if (rows.length >= PAGE_LIMIT || (Number.isFinite(total) && total > rows.length)) {
        truncated.push(`${keyword}（总数${Number.isFinite(total) ? total : "未知"}，返回${rows.length}）`);
      }

      for (const record of rows) {
        if (!record.id || !record.title) continue;
        const current = candidates.get(record.id);
        if (current) mergeKeyword(current, keyword);
        else {
          candidates.set(record.id, toCandidate(record, {
            keyword,
            startDate: input.startDate,
            endDate: input.endDate,
            province: input.province,
            regionCode: input.regionCode,
            total: Number.isFinite(total) ? total : rows.length,
          }));
        }
      }
      await delay(300 + Math.floor(Math.random() * 250));
    } catch (error) {
      errors.push(`${keyword}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const result = [...candidates.values()];
  let status: ProviderOutcome["status"];
  if (successfulQueries === 0) status = "failed";
  else if (errors.length > 0 || truncated.length > 0) status = "partial";
  else if (result.length === 0) status = "success_zero";
  else status = "success";

  const limitations = truncated.length > 0
    ? `命中接口单词上限，可能漏项：${truncated.join("、")}`
    : null;
  return {
    candidates: result,
    outcome: {
      provider: "四川政府采购网官方公开列表接口",
      sourcePlatform: "四川政府采购网",
      scope: `${input.province}；官方公开列表接口；${keywords.length}个标题关键词；${input.startDate}至${input.endDate}；每词最多${PAGE_LIMIT}条且不可可靠翻页`,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      queriesAttempted,
      pagesAttempted: queriesAttempted,
      candidatesFound: result.length,
      error: [...errors, ...(limitations ? [limitations] : [])].join(" | ") || null,
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

function candidateId(candidate: DiscoveryCandidate): string {
  const metadataId = candidate.metadata.id;
  if (metadataId) return metadataId;
  if (candidate.documentIdHint) return candidate.documentIdHint;
  const id = new URL(candidate.url).searchParams.get("id");
  if (id) return id;
  throw new Error("四川政府采购网候选记录缺少详情 id");
}

/**
 * 四川站详情页是 SPA。此函数直接读取官方详情 JSON，并包装成现有通用 HTML
 * 解析器可识别的结构；不依赖对 article 页面执行浏览器脚本。
 */
export async function fetchSichuanCcgpDetailHtml(candidate: DiscoveryCandidate): Promise<string> {
  const response = await signedGet<SichuanCcgpRecord>(DETAIL_PATH, {
    id: candidateId(candidate),
  });
  if (String(response.code) !== "200" || !response.data) {
    throw new Error(`四川政府采购网详情接口失败：${response.msg ?? `code=${response.code}`}`);
  }
  const detail = response.data;
  if (!detail.content) throw new Error("四川政府采购网详情接口未返回公告正文");

  const title = detail.title || candidate.titleHint || "四川政府采购公告";
  const publishAt = detail.noticeTime || candidate.publishAtHint || "";
  const attachments = (detail.attchList ?? [])
    .filter((item) => item.fileUrl)
    .map((item) => {
      const baseName = item.fileName || "附件";
      const name = item.fileExt && !baseName.toLowerCase().endsWith(item.fileExt.toLowerCase())
        ? `${baseName}${item.fileExt}`
        : baseName;
      return `<a href="${escapeHtml(item.fileUrl ?? "")}" target="_blank">${escapeHtml(name)}</a>`;
    })
    .join("\n");
  const summary = [
    ["采购单位", detail.purchaser],
    ["行政区域", detail.regionName],
    ["公告时间", publishAt],
    ["预算金额", detail.budget ? `${detail.budget}元` : null],
  ]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
  <div class="vF_detail_header">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(publishAt)} 来源：四川政府采购网</p>
  </div>
  <div class="vF_detail_content">
    ${summary ? `<table class="sichuan-ccgp-summary"><tbody>${summary}</tbody></table>` : ""}
    ${detail.content}
    ${attachments ? `<div class="sichuan-ccgp-attachments"><h4>相关附件</h4>${attachments}</div>` : ""}
  </div>
</body>
</html>`;
}

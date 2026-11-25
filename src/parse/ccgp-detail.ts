import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { classifyNotice } from "../classify.js";
import { parseChinaDateTime } from "../time.js";
import type { DiscoveryCandidate, MoneyValue, ParsedNotice } from "../types.js";

type CheerioApi = ReturnType<typeof cheerio.load>;

function compact(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function multiline(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function elementTextWithBreaks($: CheerioApi, selector: string): string {
  const root = $(selector).first().clone();
  root.find("br").replaceWith("\n");
  root.find("p,div,tr,li,h1,h2,h3,h4,h5,h6").each((_, element) => {
    $(element).append("\n");
  });
  return multiline(root.text());
}

function tableValue($: CheerioApi, labels: string[]): string | null {
  let result: string | null = null;
  $("th,td").each((_, element) => {
    if (result) return;
    const label = compact($(element).text()).replace(/[：:]$/, "");
    if (!labels.some((candidate) => label === candidate || label.startsWith(candidate))) return;
    const next = $(element).next("td,th");
    if (next.length) {
      const value = compact(next.text());
      if (value) result = value;
    }
  });
  return result;
}

function matchValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return compact(match[1]);
  }
  return null;
}

function parseMoney(raw: string | null): MoneyValue {
  if (!raw || /(?:无|不适用|未提供|\/)$/.test(raw.trim())) {
    return { amount: null, unit: null, cny: null };
  }
  const match = raw.replace(/[￥¥（）()]/g, "").match(/([\d,.]+)\s*(亿元|万元|元)/);
  if (!match?.[1] || !match[2]) return { amount: null, unit: null, cny: null };
  const amount = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return { amount: null, unit: match[2], cny: null };
  const multiplier = match[2] === "亿元" ? 100_000_000 : match[2] === "万元" ? 10_000 : 1;
  return { amount, unit: match[2], cny: amount * multiplier };
}

function parseFieldMoney(
  raw: string | null,
  text: string,
  fieldName: string,
  fallback: string | null = null,
): MoneyValue {
  let parsed = parseMoney(raw);
  if (parsed.cny === null && raw) {
    const escaped = escapeRegExp(fieldName);
    const labelUnit = text.match(new RegExp(`${escaped}[（(]\\s*(亿元|万元|元)`))?.[1] ?? null;
    if (labelUnit) parsed = parseMoney(`${raw}${labelUnit}`);
  }
  return parsed.cny === null ? parseMoney(fallback) : parsed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionAfterLast(text: string, headings: string[]): string | null {
  let start = -1;
  let matchedLength = 0;
  for (const heading of headings) {
    const numbered = new RegExp(`[一二三四五六七八九十]+[、.．]\\s*${escapeRegExp(heading)}`, "g");
    for (const match of text.matchAll(numbered)) {
      if ((match.index ?? -1) > start) {
        start = match.index ?? -1;
        matchedLength = match[0].length;
      }
    }
    if (start < 0) {
      const index = text.indexOf(heading);
      if (index >= 0) {
        start = index;
        matchedLength = heading.length;
      }
    }
  }
  if (start < 0) return null;
  const remainder = text.slice(start + matchedLength);
  const nextHeading = remainder.search(/\n?[一二三四五六七八九十]+[、.．]\s*/);
  return compact(nextHeading > 0 ? remainder.slice(0, nextHeading) : remainder.slice(0, 1_200));
}

function dateTokens(text: string): string[] {
  const pattern = /20\d{2}(?:年|[-/.])\d{1,2}(?:月|[-/.])\d{1,2}日?(?:\s+\d{1,2}(?:[:时点]\d{1,2})?(?:[:分]\d{1,2})?(?:秒|分)?)?/g;
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function dailyClosingTime(section: string): string {
  const afternoon = section.match(
    /下午.{0,30}?(?:至|到|[-—~～])\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
  )?.[1];
  if (afternoon) return afternoon.length === 5 ? `${afternoon}:00` : afternoon;
  const allTimes = [...section.matchAll(/\b([0-2]?\d:\d{2}(?::\d{2})?)\b/g)].map(
    (match) => match[1],
  );
  const closing = allTimes.at(-1);
  if (!closing) return "23:59:59";
  return closing.length === 5 ? `${closing}:00` : closing;
}

function acquisitionTimes(text: string): { start: string | null; end: string | null } {
  const section = sectionAfterLast(text, [
    "获取招标文件",
    "获取采购文件",
    "获取磋商文件",
    "获取询价通知书",
    "获取谈判文件",
  ]);
  if (!section) return { start: null, end: null };
  const dates = dateTokens(section);
  if (dates.length === 0) return { start: null, end: null };
  const start = parseChinaDateTime(dates[0], "00:00:00");
  const endDate = dates[1] ?? dates[0];
  const end = parseChinaDateTime(endDate, dailyClosingTime(section));
  return { start, end };
}

function submissionTime(text: string): string | null {
  const explicit = matchValue(text, [
    /提交投标文件截止时间[：:\s]*([^\n。；]{8,40})/,
    /投标截止时间[：:\s]*([^\n。；]{8,40})/,
    /响应文件提交截止时间[：:\s]*([^\n。；]{8,40})/,
    /提交响应文件截止时间[：:\s]*([^\n。；]{8,40})/,
  ]);
  if (explicit) {
    const token = dateTokens(explicit)[0];
    if (token) return parseChinaDateTime(token);
  }

  const section = sectionAfterLast(text, [
    "提交投标文件截止时间、开标时间和地点",
    "提交投标文件截止时间、开标时间和地点。",
    "响应文件提交",
    "提交响应文件",
    "开启时间及地点",
  ]);
  const token = section ? dateTokens(section)[0] : undefined;
  return token ? parseChinaDateTime(token) : null;
}

function noticeType(title: string, breadcrumb: string): { type: string; stage: string } {
  const value = `${title} ${breadcrumb}`;
  if (/采购意向/.test(value)) return { type: "采购意向公告", stage: "采购意向" };
  if (/合同公告|采购合同/.test(value)) return { type: "政府采购合同公告", stage: "合同" };
  if (/更正|变更|延期/.test(value)) return { type: "更正/延期公告", stage: "更正/延期" };
  if (/终止|废标|流标/.test(value)) return { type: "终止/废标公告", stage: "终止/废标" };
  // 采购人官网常用“结果公示”“比选结果公示”，须在“询价”“比选”等方式词之前判定为结果。
  if (/中标|成交|中选|结果公告|结果公示|采购结果/.test(value)) return { type: "中标（成交）结果公告", stage: "结果" };
  if (/市场调研|调研公告/.test(value)) return { type: "市场调研公告", stage: "市场调研" };
  if (/竞争性磋商/.test(value)) return { type: "竞争性磋商公告", stage: "采购公告" };
  if (/竞争性谈判/.test(value)) return { type: "竞争性谈判公告", stage: "采购公告" };
  if (/询价/.test(value)) return { type: "询价公告", stage: "采购公告" };
  if (/单一来源/.test(value)) return { type: "单一来源公告", stage: "采购公告" };
  if (/直接采购公告/.test(value)) return { type: "直接采购公告", stage: "采购公告" };
  if (/直接采购公示/.test(value)) return { type: "直接采购公示", stage: "直接采购公示" };
  if (/公开招标|招标公告/.test(value)) return { type: "公开招标公告", stage: "采购公告" };
  if (/比选/.test(value)) return { type: "比选公告", stage: "采购公告" };
  if (/采购公告|采购邀请|招标邀请/.test(value)) return { type: "采购公告", stage: "采购公告" };
  return { type: "其他公告", stage: "其他" };
}

function procurementDemand(text: string): string | null {
  const patterns = [
    /采购需求[：:\s]*([\s\S]{1,900}?)(?=合同履行期限|本项目(?:是否)?接受|二[、.．])/, 
    /简要技术需求或服务要求[：:\s]*([\s\S]{1,600}?)(?=合同履行期限|本项目|二[、.．])/, 
    /(?:一[、.．]\s*)?采购内容[：:\s]*([\s\S]{1,900}?)(?=二[、.．]|采购数量|服务期限)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return compact(match[1]).slice(0, 800);
  }
  return null;
}

function extractDocumentId(url: string, hint: string | null): string {
  return hint ?? url.match(/\/t\d+_(\d+)\.htm/i)?.[1] ?? createHash("sha1").update(url).digest("hex");
}

function attachmentInfo($: CheerioApi, demand: string | null): { names: string[]; status: string } {
  const names = new Set<string>();
  $(".vF_detail_content a[href], .vF_detail_main a[href], #noticeArea a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const name = compact($(element).text());
    if (/\.(?:pdf|docx?|xlsx?|zip|rar)(?:\?|$)/i.test(href) || /附件|采购需求|招标文件/.test(name)) {
      if (name) names.add(name);
    }
  });
  const list = [...names];
  if (list.length === 0) return { names: [], status: "未发现附件" };
  if (/详见.*(?:附件|招标文件)|采购需求附件/.test(demand ?? "")) {
    return { names: list, status: "未读取（采购需求或相关要求在附件）" };
  }
  return { names: list, status: "未读取（已枚举附件）" };
}

function originSourceUrl($: CheerioApi, baseUrl: string): string | null {
  const href = $(".detail_url a[href]").first().attr("href");
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function relatedOriginal($: CheerioApi, baseUrl: string): string | null {
  let result: string | null = null;
  $("a[href]").each((_, element) => {
    if (result) return;
    const text = compact($(element).text());
    if (!/原公告|首次公告|招标公告/.test(text)) return;
    const href = $(element).attr("href");
    if (href && /ccgp\.gov\.cn|^\//.test(href)) result = new URL(href, baseUrl).href;
  });
  return result;
}

function lotsFromText(text: string): string[] {
  const lots = new Set([
    ...[...text.matchAll(/采购包\s*[（(]?([0-9一二三四五六七八九十]+)[）)]?/g)].map((m) => `采购包${m[1]}`),
    ...[...text.matchAll(/标包\s*[（(]?([0-9一二三四五六七八九十]+)[）)]?/g)].map((m) => `标包${m[1]}`),
  ]);
  return lots.size > 0 && lots.size <= 20 ? [...lots] : [""];
}

function inferSichuanRegion(text: string): string | null {
  const value = text.match(
    /(成都|自贡|攀枝花|泸州|德阳|绵阳|广元|遂宁|内江|乐山|南充|眉山|宜宾|广安|达州|雅安|巴中|资阳)(?:市)?|阿坝藏族羌族自治州|甘孜藏族自治州|凉山彝族自治州/,
  )?.[0] ?? null;
  if (!value) return null;
  return /自治州$/.test(value) || value.endsWith("市") ? value : `${value}市`;
}

const SICHUAN_REGION_PATTERN =
  /四川|成都|自贡|攀枝花|泸州|德阳|绵阳|广元|遂宁|内江|乐山|南充|眉山|宜宾|广安|达州|雅安|巴中|资阳|阿坝|甘孜|凉山/;

function provinceFromRegion(region: string | null, fallback: string | null): string | null {
  if (!region) return fallback;
  if (SICHUAN_REGION_PATTERN.test(region)) return "四川省";
  const explicit = region.match(
    /(北京市|天津市|上海市|重庆市|[^\s，,；;]{2,12}省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区)/,
  )?.[1];
  return explicit ?? fallback;
}

export function parseCcgpDetail(
  html: string,
  candidate: DiscoveryCandidate,
  fetchedAt = new Date().toISOString(),
): ParsedNotice[] {
  const $ = cheerio.load(html);
  const title = compact(
    $(".vF_detail_header h2").first().text()
      || $(".detail > .h4_o, .h4_o").first().text()
      || $("h1").first().text()
      || $("h2").first().text()
      || candidate.titleHint
      || $("title").text(),
  ).replace(/\s*[-—_]\s*中国政府采购网.*$/, "");
  if (!title) throw new Error("详情页未解析到项目标题");

  const headerText = compact($(".vF_detail_header, .detail > .p_o").first().text());
  const bodyText =
    elementTextWithBreaks($, ".vF_detail_content")
      || elementTextWithBreaks($, "#noticeArea")
      || elementTextWithBreaks($, "#mycontent .detail_content")
      || elementTextWithBreaks($, ".vF_detail_main")
      || multiline($.root().text());
  const fullText = compact(`${title}\n${bodyText}`);
  const breadcrumb = compact($(".vF_location, .location, .当前位置").text());
  const basicSection = sectionAfterLast(bodyText, ["项目基本情况"]) ?? bodyText;

  const publishRaw =
    headerText.match(/(20\d{2}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})/)?.[1] ??
    headerText.match(/(20\d{2}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/)?.[1] ??
    tableValue($, ["公告时间"]) ?? candidate.publishAtHint;
  const buyer = tableValue($, ["采购单位", "采购人"])
    ?? matchValue(bodyText, [
      /采购人信息.{0,120}?名称[：:\s]*([^\n，,；;。]{2,100}?)(?=\s*(?:地址|联系方式|2[.、．]|采购代理机构))/, 
      /(?:采购人|招标人)(?:为|[：:\s])+([^\n，,；;。]{2,80})/,
      /采购人信息.{0,80}?名称[：:\s]*([^\n，,；;。]{2,80})/,
    ]);
  const region = tableValue($, ["行政区域", "地区"])
    ?? candidate.metadata.cityText
    ?? candidate.metadata.regionName
    ?? (candidate.provinceHint === "四川省" ? inferSichuanRegion(`${title} ${bodyText}`) : null)
    ?? candidate.provinceHint;
  const rawProjectNumber = matchValue(basicSection, [
    /项目编号[：:\s]*([^\s，,；;。]+)/,
    /采购项目编号[：:\s]*([^\s，,；;。]+)/,
  ]);
  const projectNumber = rawProjectNumber?.replace(/[（(](?:招标文件编号|采购文件编号).*$/, "") ?? null;
  const method = matchValue(basicSection, [
    /采购方式[：:\s]*(公开招标|邀请招标|竞争性磋商|竞争性谈判|询价|单一来源|直接采购|框架协议采购)/,
  ]);
  const demand = procurementDemand(basicSection) ?? procurementDemand(bodyText);

  const budgetRaw = matchValue(basicSection, [
    /预算金额(?:（[^）]*）|\([^)]*\))?[：:\s]*([￥¥]?[\d,.]+\s*(?:亿元|万元|元)?)/,
  ]);
  const ceilingRaw = matchValue(basicSection, [
    /最高限价(?:（[^）]*）|\([^)]*\))?[：:\s]*([￥¥]?[\d,.]+\s*(?:亿元|万元|元)?)/,
  ]);
  const awardRaw = matchValue(bodyText, [
    /中标（成交）金额[：:\s]*([^\n；;。]+)/,
    /中标金额[：:\s]*([^\n；;。]+)/,
    /成交金额[：:\s]*([^\n；;。]+)/,
  ]);
  const acquisition = acquisitionTimes(bodyText);
  const type = noticeType(title, breadcrumb);
  const submission = type.stage === "采购公告" || type.stage === "更正/延期" ? submissionTime(bodyText) : null;
  const attachments = attachmentInfo($, demand);
  const classification = classifyNotice({ title, procurementContent: demand, fullText });
  const content = demand ?? classification.evidence;
  const contentHash = createHash("sha256").update(html).digest("hex");
  const lots = lotsFromText(basicSection);

  return lots.map((lotNumber) => ({
    sourceKey: candidate.sourceKey,
    sourcePlatform: candidate.sourcePlatform,
    sourceUrl: candidate.url,
    originUrl: originSourceUrl($, candidate.url),
    documentId: extractDocumentId(candidate.url, candidate.documentIdHint),
    title,
    buyer,
    region,
    province: provinceFromRegion(region, candidate.provinceHint),
    regionCode: candidate.regionCodeHint,
    projectNumber,
    lotNumber,
    procurementContent: content,
    contentCategory: classification.category,
    noticeType: type.type,
    stage: type.stage,
    procurementMethod: method,
    publishAt: parseChinaDateTime(publishRaw),
    budget: parseFieldMoney(budgetRaw, basicSection, "预算金额", tableValue($, ["预算金额"])),
    ceiling: parseFieldMoney(ceilingRaw, basicSection, "最高限价", tableValue($, ["最高限价"])),
    award: parseMoney(awardRaw),
    acquisitionStart: acquisition.start,
    acquisitionDeadline: type.stage === "采购公告" || type.stage === "更正/延期" ? acquisition.end : null,
    submissionDeadline: submission,
    relevance: classification.relevance,
    relevanceReason: classification.reason,
    evidenceQuote: classification.evidence,
    attachmentStatus: attachments.status,
    attachmentNames: attachments.names,
    relatedOriginalUrl: relatedOriginal($, candidate.url),
    discoveryMethod: candidate.discoveredBy,
    discoveryQuery: candidate.query,
    discoveryScope: candidate.scope,
    isKnownSample: candidate.isKnownSample,
    fetchedAt,
    contentHash,
  }));
}

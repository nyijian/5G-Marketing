import * as cheerio from "cheerio";
import { loadBuyerSites } from "../config.js";
import { delay, fetchText } from "../http.js";
import type {
  BuyerSite,
  BuyerSiteCollection,
  DiscoveryCandidate,
  ProviderOutcome,
} from "../types.js";

/**
 * 采购人官网栏目监测：按config/buyer-sites.json读取列表页，按标题筛选5G相关公告，
 * 详情页转换成统一结构后交给parseCcgpDetail解析。官网不计入招标发布平台覆盖。
 */

export interface ListItem {
  url: string;
  title: string;
  publishDate: string | null;
}

const TOPIC_PATTERN = /5G|专网|UPF|切片/;
const LIST_CONTEXT_LIMIT = 400;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function squash(value: string): string {
  return value.replace(/[   　]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function validDate(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/**
 * 识别官网列表常见日期写法：2026-03-16、2026.11.19、2026年1月13日、
 * 卡片式“2026-07 27”（年月与日分开）以及“25 2026-11”（日在前）。
 */
export function parseListDate(text: string): { date: string; token: string } | null {
  const value = squash(text.normalize("NFKC"));
  const full = /(20\d{2})(?:年(\d{1,2})月(\d{1,2})日?|([-./])(\d{1,2})\4(\d{1,2}))(?!\d)/.exec(value);
  if (full?.[1]) {
    const date = validDate(full[1], full[2] ?? full[5] ?? "", full[3] ?? full[6] ?? "");
    if (date) return { date, token: full[0] };
  }
  const monthThenDay = /(20\d{2})-(\d{1,2}) (\d{1,2})(?![\d-])/.exec(value);
  if (monthThenDay?.[1] && monthThenDay[2] && monthThenDay[3]) {
    const date = validDate(monthThenDay[1], monthThenDay[2], monthThenDay[3]);
    if (date) return { date, token: monthThenDay[0] };
  }
  const dayThenMonth = /(?:^| )(\d{1,2}) (20\d{2})-(\d{1,2})(?![\d-])/.exec(value);
  if (dayThenMonth?.[1] && dayThenMonth[2] && dayThenMonth[3]) {
    const date = validDate(dayThenMonth[2], dayThenMonth[3], dayThenMonth[1]);
    if (date) return { date, token: dayThenMonth[0].trim() };
  }
  return null;
}

export function matchesTopic(title: string, keywords: string[]): boolean {
  const normalized = normalizeForMatch(title);
  return TOPIC_PATTERN.test(normalized)
    || keywords.some((keyword) => normalized.includes(normalizeForMatch(keyword)));
}

const GENERIC_TITLE_WORDS =
  /院内|项目|采购|招标|比选|询价|磋商|谈判|遴选|中标|成交|中选|候选人|结果|公示|公告|通知|关于|的|[二三四五六七八九十\d]+次/g;

/** 去掉采购人名称和通用程序词后什么都不剩（如“项目结果公示”），无法凭标题判断主题，需要读详情。 */
export function isGenericTitle(title: string, siteName: string): boolean {
  const residual = title
    .replace(siteName, "")
    .replace(/[\s:：,，、()（）【】\[\]“”"']/g, "")
    .replace(GENERIC_TITLE_WORDS, "");
  return residual.length === 0;
}

function cleanTitle(value: string): string {
  return squash(value)
    .replace(/^[●•·▪◆■□\-–—>\s]+/, "")
    .replace(/(?:查看详情|详细信息|阅读全文|more|MORE|更多)\s*[>»]*$/, "")
    .trim();
}

/** 在元素边界补空格，避免“<h5>2026-03</h5><h6>16</h6>”粘成“2026-0316”；仅用于识别日期。 */
function spacedText($: ReturnType<typeof cheerio.load>, element: Parameters<typeof $>[0]): string {
  const clone = $(element).clone();
  clone.find("*").each((_, child) => {
    $(child).append(" ");
  });
  return squash(clone.text());
}

function sameSite(left: URL, right: URL): boolean {
  return left.hostname.replace(/^www\./i, "") === right.hostname.replace(/^www\./i, "");
}

export function extractListItems(
  html: string,
  pageUrl: string,
  collection: Pick<BuyerSiteCollection, "detailUrlPattern" | "titleSelector">,
): ListItem[] {
  const $ = cheerio.load(html);
  const pattern = new RegExp(collection.detailUrlPattern, "i");
  const base = new URL(pageUrl);
  const items = new Map<string, ListItem>();

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href")?.trim();
    if (!href || /^(?:javascript|mailto):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url, base)) return;
    url.hash = "";
    if (!pattern.test(url.href)) return;

    // 链接里若用多个元素拼出“日 年-月 标题”，需要按元素边界断开才能剥离日期。
    const text = spacedText($, element);
    const titleAttribute = squash(anchor.attr("title") ?? "");
    const selected = collection.titleSelector
      ? squash(anchor.find(collection.titleSelector).first().text())
      : "";
    const parent = anchor.parent();
    const contexts = [
      spacedText($, element),
      parent.length ? spacedText($, parent.get(0)) : "",
      parent.parent().length ? spacedText($, parent.parent().get(0)) : "",
    ].filter((context) => context.length > 0 && context.length <= LIST_CONTEXT_LIMIT);
    let dateInfo: { date: string; token: string } | null = null;
    for (const context of contexts) {
      dateInfo = parseListDate(context);
      if (dateInfo) break;
    }

    let title = selected || (titleAttribute.length > text.length ? titleAttribute : text);
    if (dateInfo && !selected) title = title.replace(dateInfo.token, " ");
    title = cleanTitle(title);
    if (title.length < 4) return;

    const existing = items.get(url.href);
    items.set(url.href, {
      url: url.href,
      title: existing && existing.title.length >= title.length ? existing.title : title,
      publishDate: existing?.publishDate ?? dateInfo?.date ?? null,
    });
  });
  return [...items.values()];
}

function listPageUrl(list: BuyerSiteCollection["lists"][number], page: number): string | null {
  if (page === 1) return list.url;
  return list.pageUrl ? list.pageUrl.replaceAll("{page}", String(page)) : null;
}

function toCandidate(input: {
  site: BuyerSite;
  listName: string;
  item: ListItem;
  generic: boolean;
  scope: string;
  province: string;
  regionCode: string;
}): DiscoveryCandidate {
  return {
    sourceKey: "buyersite",
    sourcePlatform: input.site.name,
    url: input.item.url,
    discoveredBy: "采购人官网栏目列表",
    query: input.generic ? `${input.listName}（标题过泛，读取详情判断）` : `${input.listName}（标题命中5G/专网关键词）`,
    scope: input.scope,
    isKnownSample: false,
    provinceHint: input.province,
    regionCodeHint: input.regionCode,
    referer: input.site.url,
    titleHint: input.item.title,
    publishAtHint: input.item.publishDate,
    documentIdHint: null,
    metadata: {
      siteId: input.site.id,
      regionName: input.site.region,
      listName: input.listName,
    },
  };
}

async function discoverFromSite(input: {
  site: BuyerSite & { collection: BuyerSiteCollection };
  keywords: string[];
  startDate: string;
  endDate: string;
  maxPages: number;
  province: string;
  regionCode: string;
}): Promise<{ candidates: DiscoveryCandidate[]; outcome: ProviderOutcome }> {
  const { site } = input;
  const startedAt = new Date().toISOString();
  const candidates = new Map<string, DiscoveryCandidate>();
  const errors: string[] = [];
  const truncated: string[] = [];
  let pagesAttempted = 0;
  let successfulPages = 0;
  const listNames = site.collection.lists.map((list) => list.name).join("、");
  const scope = `${site.region}；${site.name}官网栏目（${listNames}）；标题含5G/专网/UPF/切片或检索关键词，标题过泛的公告读取详情判断；${input.startDate}至${input.endDate}；每栏目最多${input.maxPages}页；不计入招标发布平台覆盖`;

  for (const list of site.collection.lists) {
    const seen = new Set<string>();
    for (let page = 1; page <= input.maxPages; page += 1) {
      const url = listPageUrl(list, page);
      if (!url) break;
      pagesAttempted += 1;
      let html: string;
      try {
        html = (await fetchText(url, {
          retries: 1,
          referer: site.url,
          ...(site.collection.headers ? { headers: site.collection.headers } : {}),
        })).text;
      } catch (error) {
        errors.push(`${list.name}/第${page}页：${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      successfulPages += 1;
      const fresh = extractListItems(html, url, site.collection).filter((item) => !seen.has(item.url));
      // 没有新链接说明已到末页，或站点对越界页码返回了重复内容。
      if (fresh.length === 0) break;
      let newest: string | null = null;
      let oldest: string | null = null;
      for (const item of fresh) {
        seen.add(item.url);
        if (item.publishDate) {
          if (!newest || item.publishDate > newest) newest = item.publishDate;
          if (!oldest || item.publishDate < oldest) oldest = item.publishDate;
          if (item.publishDate < input.startDate || item.publishDate > input.endDate) continue;
        }
        const topical = matchesTopic(item.title, input.keywords);
        const generic = !topical && isGenericTitle(item.title, site.name);
        if (!topical && !generic) continue;
        if (!candidates.has(item.url)) {
          candidates.set(item.url, toCandidate({
            site,
            listName: list.name,
            item,
            generic,
            scope,
            province: input.province,
            regionCode: input.regionCode,
          }));
        }
      }
      if (newest && newest < input.startDate) break;
      if (page === input.maxPages && list.pageUrl && (!oldest || oldest >= input.startDate)) {
        truncated.push(`${list.name}读到第${page}页仍未覆盖到${input.startDate}`);
      }
      if (page < input.maxPages) await delay(600 + Math.floor(Math.random() * 400));
    }
  }

  let status: ProviderOutcome["status"];
  if (successfulPages === 0) status = "failed";
  else if (errors.length > 0 || truncated.length > 0) status = "partial";
  else if (candidates.size === 0) status = "success_zero";
  else status = "success";
  const limitations = truncated.length
    ? `${truncated.join("；")}，可用--site-pages加大翻页`
    : "";

  return {
    candidates: [...candidates.values()],
    outcome: {
      provider: `采购人官网：${site.name}`,
      sourcePlatform: site.name,
      scope,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      queriesAttempted: site.collection.lists.length,
      pagesAttempted,
      candidatesFound: candidates.size,
      error: [...errors, ...(limitations ? [limitations] : [])].join(" | ") || null,
    },
  };
}

function isCollectable(site: BuyerSite): site is BuyerSite & { collection: BuyerSiteCollection } {
  return site.collectionStatus === "active" && site.collection?.method === "list_page";
}

export async function discoverFromBuyerSites(input: {
  keywords: string[];
  startDate: string;
  endDate: string;
  maxPages: number;
  province: string;
  regionCode: string;
}): Promise<{ candidates: DiscoveryCandidate[]; outcomes: ProviderOutcome[] }> {
  const sites = (await loadBuyerSites()).filter(isCollectable);
  const candidates: DiscoveryCandidate[] = [];
  const outcomes: ProviderOutcome[] = [];
  for (const site of sites) {
    const result = await discoverFromSite({ ...input, site });
    candidates.push(...result.candidates);
    outcomes.push(result.outcome);
  }
  return { candidates, outcomes };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 详情页明确标注的发布时间优先于列表日期；不使用开标、截止等其他时间。 */
export function detectDetailDate(text: string): string | null {
  const match = /(?:发布|发表|公告|更新)(?:时间|日期)\s*[：:]?\s*(20\d{2}[-./年]\d{1,2}[-./月]\d{1,2})/
    .exec(text.normalize("NFKC"));
  return match?.[1] ? parseListDate(match[1])?.date ?? null : null;
}

function refineTitle(hint: string, $: ReturnType<typeof cheerio.load>): string {
  const truncated = /(?:…|\.{3})$/.test(hint);
  if (!truncated) return hint;
  const prefix = hint.replace(/(?:…|\.{3})$/, "");
  let best = hint;
  $("h1,h2,h3,h4,.title,#title,[class*=tit]").each((_, element) => {
    const text = squash($(element).text());
    if (text.startsWith(prefix) && text.length > best.length && text.length <= 200) best = text;
  });
  return best;
}

export function buildBuyerSiteDetailHtml(
  html: string,
  candidate: Pick<DiscoveryCandidate, "titleHint" | "publishAtHint">,
  collection: Pick<BuyerSiteCollection, "contentSelector"> | undefined,
): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,iframe").remove();
  const pageText = squash($.root().text());
  let content = collection?.contentSelector ? $(collection.contentSelector).first() : null;
  if (!content || content.length === 0) {
    $("nav,header,footer,[class*=nav],[class*=menu],[class*=footer],[class*=header],[id*=nav],[id*=menu],[id*=footer],[id*=header]")
      .remove();
    content = $("body");
  }
  const title = refineTitle(candidate.titleHint ?? squash($("title").text()), $);
  const publishDate = detectDetailDate(pageText) ?? candidate.publishAtHint ?? "";
  return `<!doctype html><html><body>
    <div class="vF_detail_header"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(publishDate)}</span></div>
    <div class="vF_detail_content">${content.html() ?? ""}</div>
  </body></html>`;
}

let sitesById: Promise<Map<string, BuyerSite>> | null = null;

export async function fetchBuyerSiteDetailHtml(candidate: DiscoveryCandidate): Promise<string> {
  sitesById ??= loadBuyerSites().then((sites) => new Map(sites.map((site) => [site.id, site])));
  const site = (await sitesById).get(candidate.metadata.siteId ?? "");
  if (!site) throw new Error(`采购人官网候选缺少站点配置：${candidate.metadata.siteId ?? "无siteId"}`);
  const response = await fetchText(candidate.url, {
    retries: 2,
    referer: candidate.referer ?? site.url,
    ...(site.collection?.headers ? { headers: site.collection.headers } : {}),
  });
  return buildBuyerSiteDetailHtml(response.text, candidate, site.collection);
}

import * as cheerio from "cheerio";
import type { DiscoveryCandidate, SourceKey } from "../types.js";

const CCGP_DETAIL_PATTERN = /^https?:\/\/(?:www\.)?ccgp\.gov\.cn\/cggg\/[^?#]+\.htm(?:[?#].*)?$/i;

function decodeBingRedirect(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/bing\.com$/i.test(url.hostname) || !url.pathname.startsWith("/ck/")) return value;
    const encoded = url.searchParams.get("u");
    if (!encoded) return null;
    const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
    return Buffer.from(payload.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function normalizeCcgpUrl(value: string): string | null {
  const decoded = decodeBingRedirect(value) ?? value;
  try {
    const url = new URL(decoded);
    url.protocol = "https:";
    url.hostname = "www.ccgp.gov.cn";
    url.hash = "";
    url.search = "";
    const normalized = url.href;
    return CCGP_DETAIL_PATTERN.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeGenericOfficialUrl(value: string, sourceKey: SourceKey): string | null {
  try {
    const url = new URL(value);
    if (sourceKey === "buyersite") {
      // 官网域名已在buyer-sites.json中按站点限定；部分医院站只支持HTTP，保留原协议。
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.href;
    }
    const allowed =
      sourceKey === "ggzy"
        ? /(^|\.)ggzy\.gov\.cn$/i.test(url.hostname)
        : sourceKey === "sichuanggzy"
          ? /(^|\.)ggzyjy\.sc\.gov\.cn$/i.test(url.hostname)
        : sourceKey === "tianfu" || sourceKey === "scenergy"
          ? /(^|\.)tfygcgfw\.com$/i.test(url.hostname)
        : sourceKey === "sichuanccgp"
          ? /(^|\.)ccgp-sichuan\.gov\.cn$/i.test(url.hostname)
          : /(^|\.)caigou\.chinatelecom\.com\.cn$/i.test(url.hostname);
    if (!allowed) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeCandidateUrl(value: string, sourceKey: SourceKey): string | null {
  return sourceKey === "ccgp" ? normalizeCcgpUrl(value) : normalizeGenericOfficialUrl(value, sourceKey);
}

export function extractCcgpUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const normalized = normalizeCcgpUrl(href);
    if (normalized) urls.add(normalized);
  });
  for (const match of html.matchAll(/https?:\\?\/\\?\/(?:www\.)?ccgp\.gov\.cn\\?\/cggg\\?\/[^"'<>\s&]+?\.htm/gi)) {
    const normalized = normalizeCcgpUrl(match[0].replaceAll("\\/", "/"));
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

export function mergeCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const rank = (method: string): number => {
    if (method.includes("站内")) return 3;
    if (method.includes("公开搜索")) return 2;
    return 1;
  };
  const merged = new Map<string, DiscoveryCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCandidateUrl(candidate.url, candidate.sourceKey);
    if (!normalized) continue;
    const incoming = { ...candidate, url: normalized };
    const key = `${candidate.sourceKey}|${normalized}`;
    const current = merged.get(key);
    if (!current || rank(incoming.discoveredBy) > rank(current.discoveredBy)) {
      merged.set(key, {
        ...incoming,
        isKnownSample: incoming.isKnownSample || current?.isKnownSample === true,
      });
    } else if (incoming.discoveredBy === current.discoveredBy) {
      const queries = [...new Set([current.query, incoming.query].filter(Boolean))];
      merged.set(key, {
        ...current,
        query: queries.join("、"),
        metadata: {
          ...current.metadata,
          matchedKeywords: queries.join("、"),
        },
        isKnownSample: current.isKnownSample || incoming.isKnownSample,
      });
    } else if (incoming.isKnownSample && !current.isKnownSample) {
      merged.set(key, { ...current, isKnownSample: true });
    }
  }
  return [...merged.values()];
}

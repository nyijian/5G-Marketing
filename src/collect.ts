import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  databasePath,
  defaultOutputPath,
  latestOutputFile,
  latestRunPath,
  loadDiscoverySeeds,
  loadKeywords,
  loadKnownSamples,
  loadScope,
} from "./config.js";
import { MonitorDatabase } from "./db.js";
import { discoverFromPublicSearch, seedOutcome } from "./discovery/bing-search.js";
import { discoverFromBuyerSites, fetchBuyerSiteDetailHtml } from "./discovery/buyer-sites.js";
import { discoverFromCcgpSearch } from "./discovery/ccgp-search.js";
import { discoverFromChinaTelecom } from "./discovery/chinatelecom-search.js";
import { mergeCandidates } from "./discovery/common.js";
import { discoverFromGgzy } from "./discovery/ggzy-search.js";
import {
  discoverFromSichuanCcgp,
  fetchSichuanCcgpDetailHtml,
} from "./discovery/sichuan-ccgp-search.js";
import {
  discoverFromSichuanGgzy,
  fetchSichuanGgzyDetailHtml,
} from "./discovery/sichuan-ggzy-search.js";
import { discoverFromTianfu, fetchTianfuDetailHtml } from "./discovery/tianfu-search.js";
import { exportWorkbook } from "./export-excel.js";
import { delay, fetchText } from "./http.js";
import { parseCcgpDetail } from "./parse/ccgp-detail.js";
import { fetchAndParseChinaTelecom } from "./parse/chinatelecom-detail.js";
import {
  asChinaEndOfDay,
  asChinaStartOfDay,
  chinaDate,
  chinaIso,
  subtractDays,
} from "./time.js";
import type { ProviderOutcome, RunStatus, RunSummary } from "./types.js";

export interface CollectOptions {
  days: number;
  startDate?: string;
  maxPages: number;
  asOf?: string;
  output?: string;
  officialSearch: boolean;
  sichuanCcgpSearch: boolean;
  publicSearch: boolean;
  ggzySearch: boolean;
  sichuanGgzySearch: boolean;
  tianfuSearch: boolean;
  telecomSearch: boolean;
  buyerSites: boolean;
  /** 采购人官网每个栏目最多读取的列表页数。 */
  sitePages: number;
}

function asOfDate(value?: string): { instant: Date; chinaIsoValue: string; dateOnly: boolean } {
  if (!value) {
    const instant = new Date();
    return { instant, chinaIsoValue: chinaIso(instant), dateOnly: false };
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const instant = new Date(dateOnly ? `${value}T23:59:59+08:00` : value);
  if (Number.isNaN(instant.getTime())) throw new Error(`无法识别 --as-of 时间：${value}`);
  return { instant, chinaIsoValue: chinaIso(instant), dateOnly };
}

function calculateStatus(input: {
  providers: ProviderOutcome[];
  candidates: number;
  detailSucceeded: number;
  detailFailed: number;
  included: number;
}): RunStatus {
  if (input.candidates > 0 && input.detailSucceeded === 0) return "failed";
  const acquisitionProviders = input.providers.filter(
    (provider) => provider.provider !== "固定验证种子" && provider.status !== "skipped",
  );
  const hasFailure = acquisitionProviders.some(
    (provider) => provider.status === "failed" || provider.status === "partial",
  );
  if (hasFailure) {
    return input.detailSucceeded > 0 || input.candidates === 0 ? "partial" : "failed";
  }
  if (input.detailFailed > 0) return "partial";
  return input.included === 0 ? "success_zero" : "success";
}

export async function collect(options: CollectOptions): Promise<RunSummary> {
  if (!options.startDate && (!Number.isInteger(options.days) || options.days < 1 || options.days > 365)) {
    throw new Error("--days 必须是 1 到 365 的整数");
  }
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 50) {
    throw new Error("--max-pages 必须是 1 到 50 的整数");
  }
  if (!Number.isInteger(options.sitePages) || options.sitePages < 1 || options.sitePages > 200) {
    throw new Error("--site-pages 必须是 1 到 200 的整数");
  }

  const asOf = asOfDate(options.asOf);
  const scope = await loadScope();
  const endDate = chinaDate(asOf.instant);
  if (options.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(options.startDate)) {
    throw new Error("--start-date 必须是 YYYY-MM-DD 格式");
  }
  const startDate = options.startDate
    ?? chinaDate(subtractDays(new Date(`${endDate}T12:00:00+08:00`), options.days - 1));
  if (startDate > endDate) throw new Error("--start-date 不能晚于核验日期");
  const actualDays = Math.floor(
    (Date.parse(`${endDate}T00:00:00+08:00`) - Date.parse(`${startDate}T00:00:00+08:00`)) / 86_400_000,
  ) + 1;
  if (actualDays > 730) throw new Error("采集日期窗口不能超过730天");
  const windowStart = asChinaStartOfDay(startDate);
  const windowEnd = asOf.dateOnly ? asChinaEndOfDay(endDate) : asOf.chinaIsoValue;
  const startedAt = new Date().toISOString();
  const dbPath = databasePath();
  const db = new MonitorDatabase(dbPath);
  const runId = db.startRun({
    startedAt,
    asOf: asOf.chinaIsoValue,
    windowStart,
    windowEnd,
    days: actualDays,
    regionScope: scope.province,
  });

  const providers: ProviderOutcome[] = [];
  const errors: string[] = [];
  let detailFetchSucceeded = 0;
  let detailFetchFailed = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let outputPath: string | null = null;
  let candidatesDiscovered = 0;

  try {
    const [keywords, knownSamples] = await Promise.all([loadKeywords(), loadKnownSamples()]);
    const knownUrls = new Set(knownSamples.map((sample) => sample.url));
    const seedCandidates = await loadDiscoverySeeds(knownUrls, scope.province);
    const allCandidates = [...seedCandidates];

    if (options.officialSearch) {
      const result = await discoverFromCcgpSearch({
        keywords,
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
        zoneId: scope.ccgpZoneId,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    } else {
      const now = new Date().toISOString();
      providers.push({
        provider: "中国政府采购网站内检索",
        sourcePlatform: "中国政府采购网",
        scope: "本次由命令参数跳过",
        status: "skipped",
        startedAt: now,
        finishedAt: now,
        queriesAttempted: 0,
        pagesAttempted: 0,
        candidatesFound: 0,
        error: "本次未启用站内检索",
      });
    }

    if (options.publicSearch) {
      const result = await discoverFromPublicSearch({
        keywords,
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.sichuanCcgpSearch) {
      const result = await discoverFromSichuanCcgp({
        keywords,
        startDate,
        endDate,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.ggzySearch) {
      const result = await discoverFromGgzy({
        keywords,
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.sichuanGgzySearch) {
      const result = await discoverFromSichuanGgzy({
        keywords,
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.tianfuSearch) {
      const result = await discoverFromTianfu({
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.telecomSearch) {
      const result = await discoverFromChinaTelecom({
        startDate,
        endDate,
        maxPages: options.maxPages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(result.outcome);
    }

    if (options.buyerSites) {
      const result = await discoverFromBuyerSites({
        keywords,
        startDate,
        endDate,
        maxPages: options.sitePages,
        province: scope.province,
        regionCode: scope.regionCode,
      });
      allCandidates.push(...result.candidates);
      providers.push(...result.outcomes);
    }

    providers.push(seedOutcome(seedCandidates.length));
    for (const outcome of providers) {
      db.saveProviderOutcome(runId, outcome);
      if (outcome.error) errors.push(`${outcome.provider}：${outcome.error}`);
    }

    const candidates = mergeCandidates(allCandidates);
    candidatesDiscovered = candidates.length;
    for (const [index, candidate] of candidates.entries()) {
      try {
        const notices = candidate.sourceKey === "chinatelecom"
          ? await fetchAndParseChinaTelecom(candidate)
          : candidate.sourceKey === "sichuanccgp"
            ? parseCcgpDetail(await fetchSichuanCcgpDetailHtml(candidate), candidate)
            : candidate.sourceKey === "sichuanggzy"
              ? parseCcgpDetail(await fetchSichuanGgzyDetailHtml(candidate), candidate)
              : candidate.sourceKey === "tianfu" || candidate.sourceKey === "scenergy"
                ? parseCcgpDetail(await fetchTianfuDetailHtml(candidate), candidate)
                : candidate.sourceKey === "buyersite"
                  ? parseCcgpDetail(await fetchBuyerSiteDetailHtml(candidate), candidate)
            : parseCcgpDetail(
              (await fetchText(candidate.url, {
                retries: 2,
                ...(candidate.referer ? { referer: candidate.referer } : {}),
              })).text,
              candidate,
            );
        for (const notice of notices) {
          if (knownUrls.has(notice.sourceUrl)) notice.isKnownSample = true;
          const result = db.upsertNotice(runId, notice);
          if (result === "inserted") insertedCount += 1;
          if (result === "updated") updatedCount += 1;
        }
        detailFetchSucceeded += 1;
      } catch (error) {
        detailFetchFailed += 1;
        errors.push(`详情抓取失败 ${candidate.url}：${error instanceof Error ? error.message : String(error)}`);
      }
      if (index < candidates.length - 1) await delay(250);
    }

    const notices = db.listNotices(windowStart, windowEnd, scope.province);
    const includedCount = notices.filter((notice) => notice.relevance === "明确相关").length;
    const pendingCount = notices.filter((notice) => notice.relevance === "待核实").length;
    const excludedCount = notices.filter((notice) => notice.relevance === "排除").length;
    let status = calculateStatus({
      providers,
      candidates: candidates.length,
      detailSucceeded: detailFetchSucceeded,
      detailFailed: detailFetchFailed,
      included: includedCount + pendingCount,
    });
    try {
      outputPath = await exportWorkbook({
        filePath: path.resolve(options.output ?? defaultOutputPath(endDate, startDate)),
        notices,
        context: {
          runId,
          runStatus: status,
          asOf: asOf.chinaIsoValue,
          windowStart,
          windowEnd,
          regionScope: scope.province,
          providers,
          newSince: startedAt,
        },
      });
    } catch (error) {
      errors.push(`Excel导出失败：${error instanceof Error ? error.message : String(error)}`);
      outputPath = null;
      status = detailFetchSucceeded > 0 ? "partial" : "failed";
    }

    // 固定文件名的“最新”清单：不论本次窗口多长，都按配置开始日期导出全年数据，并标出本次新发现。
    let latestOutputPath: string | null = null;
    if (outputPath) {
      const yearStart = asChinaStartOfDay(scope.startDate);
      try {
        latestOutputPath = await exportWorkbook({
          filePath: latestOutputFile(),
          notices: windowStart === yearStart ? notices : db.listNotices(yearStart, windowEnd, scope.province),
          context: {
            runId,
            runStatus: `${status}（本次采集窗口${startDate}至${endDate}；本表为${scope.startDate}起全量）`,
            asOf: asOf.chinaIsoValue,
            windowStart: yearStart,
            windowEnd,
            regionScope: scope.province,
            providers,
            newSince: startedAt,
          },
        });
      } catch (error) {
        errors.push(`最新清单导出失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const finishedAt = new Date().toISOString();
    const summary: RunSummary = {
      runId,
      status,
      startedAt,
      finishedAt,
      asOf: asOf.chinaIsoValue,
      windowStart,
      windowEnd,
      days: actualDays,
      regionScope: scope.province,
      candidatesDiscovered,
      detailFetchSucceeded,
      detailFetchFailed,
      includedCount,
      pendingCount,
      excludedCount,
      insertedCount,
      updatedCount,
      outputPath,
      latestOutputPath,
      databasePath: dbPath,
      providers,
      errors,
    };
    db.finishRun({
      runId,
      finishedAt,
      status,
      candidatesDiscovered,
      detailFetchSucceeded,
      detailFetchFailed,
      includedCount,
      pendingCount,
      excludedCount,
      insertedCount,
      updatedCount,
      outputPath,
      errors,
    });
    await mkdir(path.dirname(latestRunPath()), { recursive: true });
    await writeFile(latestRunPath(), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    const finishedAt = new Date().toISOString();
    db.finishRun({
      runId,
      finishedAt,
      status: "failed",
      candidatesDiscovered,
      detailFetchSucceeded,
      detailFetchFailed,
      includedCount: 0,
      pendingCount: 0,
      excludedCount: 0,
      insertedCount,
      updatedCount,
      outputPath: null,
      errors,
    });
    throw error;
  } finally {
    db.close();
  }
}

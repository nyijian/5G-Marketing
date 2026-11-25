import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BuyerSite, CollectionScope, DiscoveryCandidate, KnownSample, SourceKey } from "./types.js";

async function readJson<T>(relativePath: string): Promise<T> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return JSON.parse(await readFile(absolutePath, "utf8")) as T;
}

export function loadKeywords(): Promise<string[]> {
  return readJson<string[]>("config/keywords.json");
}

export function loadKnownSamples(): Promise<KnownSample[]> {
  return readJson<KnownSample[]>("config/known-samples.json");
}

export function loadScope(): Promise<CollectionScope> {
  return readJson<CollectionScope>("config/scope.json");
}

export async function loadBuyerSites(): Promise<BuyerSite[]> {
  return (await readJson<{ sites: BuyerSite[] }>("config/buyer-sites.json")).sites;
}

export async function loadDiscoverySeeds(
  knownUrls: Set<string>,
  targetProvince: string,
): Promise<DiscoveryCandidate[]> {
  const seeds = await readJson<
    Array<{
      sourceKey: SourceKey;
      sourcePlatform: string;
      url: string;
      discoveredBy: string;
      query: string;
      scope: string;
      province: string;
      regionCode: string;
    }>
  >("config/discovery-seeds.json");
  return seeds
    .filter((seed) => seed.province === targetProvince)
    .map((seed) => ({
      sourceKey: seed.sourceKey,
      sourcePlatform: seed.sourcePlatform,
      url: seed.url,
      discoveredBy: seed.discoveredBy,
      query: seed.query,
      scope: seed.scope,
      isKnownSample: knownUrls.has(seed.url),
      provinceHint: seed.province,
      regionCodeHint: seed.regionCode,
      referer: "https://www.ccgp.gov.cn/",
      titleHint: null,
      publishAtHint: null,
      documentIdHint: null,
      metadata: {},
    }));
}

export function databasePath(): string {
  return path.resolve(process.cwd(), "data", "5g-tender-monitor.sqlite");
}

export function defaultOutputPath(asOfDate: string, startDate?: string): string {
  const range = startDate ? `${startDate}至${asOfDate}` : asOfDate;
  return path.resolve(process.cwd(), "output", `四川5G专网采购清单_${range}.xlsx`);
}

/** 每次采集后覆盖的固定文件名全量清单，日常只看这一份即可。 */
export function latestOutputFile(): string {
  return path.resolve(process.cwd(), "output", "四川5G专网采购清单_最新.xlsx");
}

export function latestRunPath(): string {
  return path.resolve(process.cwd(), "output", "latest-run.json");
}

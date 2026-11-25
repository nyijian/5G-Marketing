import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuyerSite } from "../src/types.js";

interface PlatformEntry {
  id: string;
  kind: string;
  role: string;
  collectionStatus: string;
  domains: string[];
  evidenceRows: number[];
}

interface ClueEntry {
  id: string;
  kind: string;
  role: string;
  collectionStatus: string;
  domains: string[];
  evidenceRows: number[];
}

const platforms = JSON.parse(readFileSync("config/source-catalog.json", "utf8")) as PlatformEntry[];
const buyerSites = (JSON.parse(readFileSync("config/buyer-sites.json", "utf8")) as { sites: BuyerSite[] }).sites;
const clueSites = (JSON.parse(readFileSync("config/clue-sites.json", "utf8")) as { sites: ClueEntry[] }).sites;

describe("来源台账分层", () => {
  it("招标信息源目录只包含发布或电子采购平台", () => {
    expect(platforms).toHaveLength(20);
    expect(platforms.every((entry) => entry.kind === "platform")).toBe(true);
    expect(platforms.every((entry) => entry.domains.length > 0)).toBe(true);
  });

  it("当前7个自动采集器都登记为固定平台源", () => {
    const activeIds = platforms
      .filter((entry) => entry.role === "fixed_source")
      .map((entry) => entry.id)
      .sort();
    expect(activeIds).toEqual([
      "ccgp",
      "chinatelecom",
      "ggzy",
      "scenergy-tianfu",
      "sichuan-ccgp",
      "sichuan-ggzy",
      "tianfu",
    ]);
    expect(platforms
      .filter((entry) => entry.role === "fixed_source")
      .every((entry) => ["active", "active_limited"].includes(entry.collectionStatus)))
      .toBe(true);
  });

  it("采购人官网是长尾来源，可以采集但不计入平台覆盖", () => {
    expect(buyerSites.length).toBeGreaterThanOrEqual(10);
    for (const site of buyerSites) {
      expect(site.kind).toBe("buyer_site");
      expect(site.role).toBe("long_tail_source");
      expect(site.countsAsPlatformCoverage).toBe(false);
      expect(["active", "needs_research", "blocked"]).toContain(site.collectionStatus);
    }
  });

  it("启用采集的官网都配置了可用的列表入口和详情链接规则", () => {
    const active = buyerSites.filter((site) => site.collectionStatus === "active");
    expect(active.length).toBeGreaterThanOrEqual(8);
    for (const site of active) {
      expect(site.collection?.method).toBe("list_page");
      expect(site.collection?.lists.length).toBeGreaterThan(0);
      for (const list of site.collection?.lists ?? []) {
        expect(() => new URL(list.url)).not.toThrow();
        if (list.pageUrl) expect(list.pageUrl).toContain("{page}");
      }
      expect(() => new RegExp(site.collection?.detailUrlPattern ?? "")).not.toThrow();
    }
  });

  it("第三方聚合站和新闻站只作人工线索，不自动采集", () => {
    for (const site of clueSites) {
      expect(["third_party_aggregator", "news_site"]).toContain(site.kind);
      expect(site.role).toBe("clue_only");
      expect(["manual_only", "excluded"]).toContain(site.collectionStatus);
    }
  });

  it("官网映射只能指向已登记平台", () => {
    const platformIds = new Set(platforms.map((entry) => entry.id));
    for (const site of buyerSites) {
      expect(["confirmed", "not_found", "needs_research"]).toContain(site.mappingStatus);
      expect(site.mappedPlatformIds.every((id) => platformIds.has(id))).toBe(true);
    }
  });

  it("平台、官网与线索站ID不重复", () => {
    const ids = [...platforms, ...buyerSites, ...clueSites].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("37条核验样本中凡有原文或线索链接的，都能在台账中找到来源", () => {
    const covered = new Set(
      [...platforms, ...buyerSites, ...clueSites].flatMap((entry) => entry.evidenceRows),
    );
    // 第19、20条原清单为“某单位”，官网原文和补充线索均为空。
    const withoutLinks = new Set([19, 20]);
    const expected = Array.from({ length: 37 }, (_, index) => index + 1).filter((row) => !withoutLinks.has(row));
    expect(expected.filter((row) => !covered.has(row))).toEqual([]);
    expect([...covered].every((row) => row >= 1 && row <= 37)).toBe(true);
  });
});

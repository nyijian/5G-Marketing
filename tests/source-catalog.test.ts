import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PlatformEntry {
  id: string;
  kind: string;
  role: string;
  collectionStatus: string;
}

interface VerificationEntry {
  id: string;
  kind: string;
  role: string;
  collectionStatus: string;
  mappedPlatformIds: string[];
  mappingStatus: string;
}

const platforms = JSON.parse(readFileSync("config/source-catalog.json", "utf8")) as PlatformEntry[];
const verification = JSON.parse(readFileSync("config/verification-sites.json", "utf8")) as {
  sites: VerificationEntry[];
};

describe("来源台账分层", () => {
  it("招标信息源目录只包含发布或电子采购平台", () => {
    expect(platforms).toHaveLength(20);
    expect(platforms.every((entry) => entry.kind === "platform")).toBe(true);
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

  it("采购人官网只能用于核验，不能计入平台覆盖", () => {
    expect(verification.sites).toHaveLength(10);
    expect(verification.sites.every((entry) =>
      entry.kind === "buyer_site"
      && entry.role === "verification_only"
      && entry.collectionStatus === "excluded"))
      .toBe(true);
  });

  it("官网映射只能指向已登记平台", () => {
    const platformIds = new Set(platforms.map((entry) => entry.id));
    for (const site of verification.sites) {
      expect(["confirmed", "not_found", "needs_research"]).toContain(site.mappingStatus);
      expect(site.mappedPlatformIds.every((id) => platformIds.has(id))).toBe(true);
    }
  });

  it("平台与采购人官网ID不重复", () => {
    const platformIds = new Set(platforms.map((entry) => entry.id));
    expect(verification.sites.some((entry) => platformIds.has(entry.id))).toBe(false);
  });
});

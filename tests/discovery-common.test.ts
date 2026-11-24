import { describe, expect, it } from "vitest";
import { mergeCandidates } from "../src/discovery/common.js";
import type { DiscoveryCandidate } from "../src/types.js";

function candidate(sourceKey: DiscoveryCandidate["sourceKey"], url: string): DiscoveryCandidate {
  return {
    sourceKey,
    sourcePlatform: "测试平台",
    url,
    discoveredBy: "测试",
    query: "5G",
    scope: "四川省",
    isKnownSample: false,
    provinceHint: "四川省",
    regionCodeHint: "510000",
    referer: null,
    titleHint: null,
    publishAtHint: null,
    documentIdHint: null,
    metadata: {},
  };
}

describe("多来源候选链接", () => {
  it("保留四川政府采购网公开详情并拒绝非官方域名", () => {
    const merged = mergeCandidates([
      candidate(
        "sichuanccgp",
        "https://www.ccgp-sichuan.gov.cn/maincms-web/article?type=notice&id=abc&planId=def#top",
      ),
      candidate("sichuanccgp", "https://example.com/article?id=abc"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toBe(
      "https://www.ccgp-sichuan.gov.cn/maincms-web/article?type=notice&id=abc&planId=def",
    );
  });

  it("合并同一来源同一公告命中的多个关键词", () => {
    const url = "https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202611/t20261104_1.htm";
    const first = candidate("ccgp", url);
    first.discoveredBy = "中国政府采购网站内全文索引检索（含标题与正文）";
    first.query = "5G专网";
    const second = candidate("ccgp", url);
    second.discoveredBy = first.discoveredBy;
    second.query = "双域专网";

    const [merged] = mergeCandidates([first, second]);
    expect(merged?.query).toBe("5G专网、双域专网");
    expect(merged?.metadata.matchedKeywords).toBe("5G专网、双域专网");
  });

  it("只接受四川省公共资源交易信息网官方详情域名", () => {
    const official = candidate(
      "sichuanggzy",
      "http://ggzyjy.sc.gov.cn/jyxx/002002/002002001/20261104/example.html#content",
    );
    const fake = candidate("sichuanggzy", "https://example.com/jyxx/example.html");
    const merged = mergeCandidates([official, fake]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.url).toBe(
      "https://ggzyjy.sc.gov.cn/jyxx/002002/002002001/20261104/example.html",
    );
  });
});

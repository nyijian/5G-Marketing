import { describe, expect, it } from "vitest";
import {
  buildBuyerSiteDetailHtml,
  detectDetailDate,
  extractListItems,
  isGenericTitle,
  matchesTopic,
  parseListDate,
} from "../src/discovery/buyer-sites.js";
import { parseCcgpDetail } from "../src/parse/ccgp-detail.js";
import type { DiscoveryCandidate } from "../src/types.js";

const KEYWORDS = ["5G专网", "医疗健康专线", "UPF下沉"];

describe("官网列表日期", () => {
  it("识别常见年月日写法", () => {
    expect(parseListDate("标题2026-11-19")?.date).toBe("2026-11-19");
    expect(parseListDate("酶标仪(JJ2026000400376)采购公告 2026.11.19")?.date).toBe("2026-11-19");
    expect(parseListDate("发布时间:2026/1/13")?.date).toBe("2026-01-13");
    expect(parseListDate("2026年3月5日发布")?.date).toBe("2026-03-05");
  });

  it("识别年月与日拆开的卡片日期", () => {
    expect(parseListDate("2026-07 27 自贡市妇幼保健院 项目结果公示")?.date).toBe("2026-07-27");
    expect(parseListDate("25 2026-11 泸州市老年康复医院电梯维修维保服务")?.date).toBe("2026-11-25");
  });

  it("不把项目编号或年度区间误当日期", () => {
    expect(parseListDate("2025-2026年度5G物联网流量服务")).toBeNull();
    expect(parseListDate("询价结果公示（SBXH2026L007）")).toBeNull();
    expect(parseListDate("2026年1-7月汇总")).toBeNull();
  });

  it("详情页只认发布时间，不用开标或截止时间", () => {
    expect(detectDetailDate("开标时间：2026-06-10 发布时间：2026-05-20 08:37")).toBe("2026-05-20");
    expect(detectDetailDate("投标截止时间：2026-06-10")).toBeNull();
  });
});

describe("官网标题筛选", () => {
  it("统一全半角和大小写后命中5G与关键词", () => {
    expect(matchesTopic("“5G+医疗健康”专线服务项目", KEYWORDS)).toBe(true);
    expect(matchesTopic("５Ｇ网络建设采购项目", KEYWORDS)).toBe(true);
    expect(matchesTopic("5g物联网卡采购", KEYWORDS)).toBe(true);
    expect(matchesTopic("远程医疗健康专线服务比选", KEYWORDS)).toBe(true);
    expect(matchesTopic("医保专线服务采购", KEYWORDS)).toBe(false);
    expect(matchesTopic("皮肤科耗材采购项目中标公示", KEYWORDS)).toBe(false);
  });

  it("只剩“项目结果公示”的标题视为过泛，需要读详情", () => {
    expect(isGenericTitle("自贡市妇幼保健院 项目结果公示", "自贡市妇幼保健院")).toBe(true);
    expect(isGenericTitle("结果公示", "自贡市妇幼保健院")).toBe(true);
    expect(isGenericTitle("泸州市人民医院院内采购项目结果公告", "泸州市人民医院")).toBe(true);
    expect(isGenericTitle("采购公告（二次）", "自贡市妇幼保健院")).toBe(true);
    expect(isGenericTitle("自贡市妇幼保健院皮肤科耗材采购项目中标公示", "自贡市妇幼保健院")).toBe(false);
    expect(isGenericTitle("翻墙治理服务", "四川省妇幼保健院")).toBe(false);
    expect(isGenericTitle("护士鞋采购公告", "自贡市妇幼保健院")).toBe(false);
  });
});

describe("官网列表解析", () => {
  it("卡片式列表：标题取h3，日期取年月+日", () => {
    const html = `
      <a href="/xwzx_tzgg_zbjg-View-45-58912.html"><div class="nbm"><h5>2026-03</h5><h6>16</h6></div>
        <div class="nws-r"><h3>自贡市妇幼保健院东部新城院区5G网络建设采购项目结果公示</h3><p>新闻中心 | 招标结果</p><span>查看详情</span></div></a>
      <a href="/xwzx_tzgg_zbjg-List-45-2.html">2</a>
      <a href="https://other.example.com/xwzx_tzgg_zbjg-View-45-1.html">外站同路径链接不能收</a>`;
    const items = extractListItems(html, "https://www.zgsfybjy.cn/xwzx_tzgg_zbjg-List-45.html", {
      detailUrlPattern: "/xwzx_tzgg_zb(?:gg|jg)-View-4[35]-\\d+\\.html$",
      titleSelector: "h3",
    });
    expect(items).toEqual([{
      url: "https://www.zgsfybjy.cn/xwzx_tzgg_zbjg-View-45-58912.html",
      title: "自贡市妇幼保健院东部新城院区5G网络建设采购项目结果公示",
      publishDate: "2026-03-16",
    }]);
  });

  it("li列表：日期在相邻span，标题末尾拼接日期时去掉日期", () => {
    const html = `<ul>
      <li><a href="https://www.scsfybjy.cn/tender_sub/2026/RdGwOJdD.html">5G医疗健康专线采购结果公告</a><span>2026-05-20</span></li>
      <li><a href="/go-a1465.htm">成都市新都区第二人民医院 2026年医院网络服务（医保专线、5G+医疗健康）院内比选结果公示2026-03-02</a></li>
      <li><a href="/go-c123.htm?1=1&pageIndex=2">下一页</a></li>
    </ul>`;
    const scs = extractListItems(html, "https://www.scsfybjy.cn/tender_sub/", {
      detailUrlPattern: "/tender_sub/\\d{4}/[A-Za-z0-9]+\\.html$",
    });
    expect(scs).toEqual([{
      url: "https://www.scsfybjy.cn/tender_sub/2026/RdGwOJdD.html",
      title: "5G医疗健康专线采购结果公告",
      publishDate: "2026-05-20",
    }]);
    const xindu = extractListItems(html, "https://www.xdqdermyy.com/go-c123.htm", {
      detailUrlPattern: "/go-a\\d+\\.htm$",
    });
    expect(xindu[0]?.title).toBe("成都市新都区第二人民医院 2026年医院网络服务（医保专线、5G+医疗健康）院内比选结果公示");
    expect(xindu[0]?.publishDate).toBe("2026-03-02");
  });

  it("同一详情链接出现多次时合并，保留较完整的标题", () => {
    const html = `
      <a href="go.htm?url=news_detail&id=7070"><img src="x.png"></a>
      <a href="go.htm?url=news_detail&id=7070" title="5G+医疗健康远程应用专线项目询价结果公示（SBXH2026L007）">5G+医疗健康远程应用专线项目...</a>`;
    const items = extractListItems(html, "http://www.scjn120.com/go.htm?url=news_wenlist&c=cai_gou_jie_guo_gong_shi_", {
      detailUrlPattern: "go\\.htm\\?url=news_detail&id=\\d+$",
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("http://www.scjn120.com/go.htm?url=news_detail&id=7070");
    expect(items[0]?.title).toBe("5G+医疗健康远程应用专线项目询价结果公示（SBXH2026L007）");
  });
});

describe("官网详情转换", () => {
  const candidate: DiscoveryCandidate = {
    sourceKey: "buyersite",
    sourcePlatform: "四川省妇幼保健院",
    url: "https://www.scsfybjy.cn/tender_sub/2026/RdGwOJdD.html",
    discoveredBy: "采购人官网栏目列表",
    query: "招标采购（标题命中5G/专网关键词）",
    scope: "测试",
    isKnownSample: false,
    provinceHint: "四川省",
    regionCodeHint: "510000",
    referer: "https://www.scsfybjy.cn/",
    titleHint: "5G医疗健康专线采购结果公告",
    publishAtHint: "2026-05-21",
    documentIdHint: null,
    metadata: { siteId: "sichuan-maternal-hospital", regionName: "成都市", listName: "招标采购" },
  };

  it("取配置的正文容器，详情发布时间优先，并能被统一解析器识别为四川明确相关", () => {
    const page = `<html><body>
      <div class="nav">首页 5G专网 新闻</div>
      <div class="news-info">发布时间：2026-05-20 08:37:10</div>
      <div class="news-content"><p>项目名称：5G医疗健康专线</p><p>采购内容：5G医疗健康专网接入服务，含5G专线及运维。</p>
      <p><a href="/upload/a.pdf">采购需求.pdf</a></p></div>
      <div class="footer">版权所有</div></body></html>`;
    const html = buildBuyerSiteDetailHtml(page, candidate, { contentSelector: ".news-content" });
    expect(html).toContain("<span>2026-05-20</span>");
    expect(html).not.toContain("版权所有");
    const [notice] = parseCcgpDetail(html, candidate);
    expect(notice?.title).toBe("5G医疗健康专线采购结果公告");
    expect(notice?.publishAt).toBe("2026-05-20T00:00:00+08:00");
    expect(notice?.region).toBe("成都市");
    expect(notice?.province).toBe("四川省");
    expect(notice?.relevance).toBe("明确相关");
    expect(notice?.attachmentNames).toEqual(["采购需求.pdf"]);
  });

  it("官网常见标题识别为正确的采购阶段", () => {
    const stageOf = (title: string) => {
      const html = buildBuyerSiteDetailHtml("<html><body><p>正文</p></body></html>", { ...candidate, titleHint: title }, undefined);
      return parseCcgpDetail(html, { ...candidate, titleHint: title })[0]?.stage;
    };
    expect(stageOf("5G+医疗健康远程应用专线项目询价结果公示 （SBXH2026L007）")).toBe("结果");
    expect(stageOf("2026年医院网络服务院内比选结果公示")).toBe("结果");
    expect(stageOf("自贡市妇幼保健院东部新城院区5G网络建设采购公告")).toBe("采购公告");
    expect(stageOf("“5G+医疗健康”远程医疗专网链路服务项目比选公告")).toBe("采购公告");
    expect(stageOf("化学试剂配送服务采购项目比选邀请书")).toBe("采购公告");
    expect(stageOf("5G+医疗健康远程应用专线项目询价采购公告")).toBe("采购公告");
    expect(stageOf("5G医疗健康专线市场调研公告")).toBe("市场调研");
    expect(stageOf("分诊叫号签到屏采购项目 询价延期公告")).toBe("更正/延期");
  });

  it("详情页没有发布时间时退回列表日期", () => {
    const html = buildBuyerSiteDetailHtml("<html><body><p>正文</p></body></html>", candidate, undefined);
    expect(html).toContain("<span>2026-05-21</span>");
  });
});

import { describe, expect, it } from "vitest";
import { parseCcgpDetail } from "../src/parse/ccgp-detail.js";

const HTML = `
<!doctype html><html><body>
  <div class="vF_detail_header">
    <h2>某单位5G专网接入服务项目公开招标公告</h2>
    <span>2026年11月04日 18:09 来源：</span>
  </div>
  <table>
    <tr><td>采购单位</td><td>某单位</td></tr>
    <tr><td>行政区域</td><td>四川省</td></tr>
    <tr><td>预算金额</td><td>￥330.000000万元（人民币）</td></tr>
  </table>
  <div class="vF_detail_content">
    <p>一、项目基本情况</p>
    <p>项目编号：TEST-001</p>
    <p>采购方式：公开招标</p>
    <p>预算金额：3,300,000.00元</p>
    <p>最高限价：3,000,000.00元</p>
    <p>采购需求：采购5G专网接入、安全及运维服务</p>
    <p>合同履行期限：一年</p>
    <p>三、获取招标文件</p>
    <p>时间：2026年11月05日至2026年11月12日，每天上午00:00至12:00，下午12:00至23:59:59</p>
    <p>途径：系统中选择本项目获取招标文件</p>
    <p>四、提交投标文件截止时间、开标时间和地点</p>
    <p>时间：2026年11月26日 13点30分</p>
  </div>
</body></html>`;

describe("中国政府采购网详情解析", () => {
  it("区分预算和最高限价并解析两个截止时间", () => {
    const [notice] = parseCcgpDetail(HTML, {
      sourceKey: "ccgp",
      sourcePlatform: "中国政府采购网",
      url: "https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202611/t20261104_1.htm",
      discoveredBy: "测试",
      query: "5G专网",
      scope: "测试",
      isKnownSample: false,
      provinceHint: "四川省",
      regionCodeHint: "510000",
      referer: "https://www.ccgp.gov.cn/",
      titleHint: null,
      publishAtHint: null,
      documentIdHint: null,
      metadata: {},
    });
    expect(notice).toBeDefined();
    expect(notice?.budget.cny).toBe(3_300_000);
    expect(notice?.ceiling.cny).toBe(3_000_000);
    expect(notice?.acquisitionDeadline).toBe("2026-11-12T23:59:59+08:00");
    expect(notice?.submissionDeadline).toBe("2026-11-26T13:30:00+08:00");
    expect(notice?.relevance).toBe("明确相关");
  });

  it("识别四川直接采购公示、城市和多个标包", () => {
    const html = `
      <div class="vF_detail_header">
        <h2>中国电信攀枝花分公司5G定制网自研UPF设备维保项目直接采购公示</h2>
        <span>2026-11-19 10:00:00</span>
      </div>
      <div class="vF_detail_content">
        <p>采购人为中国电信股份有限公司攀枝花分公司。</p>
        <p>标包1：H3C无线控制器维保；标包2：5G定制网自研UPF设备软硬件维保。</p>
      </div>`;
    const notices = parseCcgpDetail(html, {
      sourceKey: "chinatelecom",
      sourcePlatform: "中国电信阳光采购网",
      url: "https://caigou.chinatelecom.com.cn/DeclareDetails?id=1",
      discoveredBy: "测试",
      query: "5G",
      scope: "测试",
      isKnownSample: false,
      provinceHint: "四川省",
      regionCodeHint: "510000",
      referer: null,
      titleHint: null,
      publishAtHint: null,
      documentIdHint: "1",
      metadata: {},
    });
    expect(notices.map((notice) => notice.lotNumber)).toEqual(["标包1", "标包2"]);
    expect(notices[0]?.stage).toBe("直接采购公示");
    expect(notices[0]?.region).toBe("攀枝花市");
    expect(notices[0]?.buyer).toBe("中国电信股份有限公司攀枝花分公司");
    expect(notices[0]?.acquisitionDeadline).toBeNull();
    expect(notices[0]?.submissionDeadline).toBeNull();
  });

  it("把政府采购合同公告标为合同阶段且不生成投标截止时间", () => {
    const [notice] = parseCcgpDetail(`
      <div class="vF_detail_header">
        <h2>某医院5G移动医护专网项目政府采购合同公告</h2>
        <span>2026-11-06 10:50:01</span>
      </div>
      <div class="vF_detail_content">
        <p>采购单位：某医院</p>
        <p>预算金额：355130.00元</p>
        <p>合同金额：355130.00元</p>
      </div>`, {
      sourceKey: "sichuanccgp",
      sourcePlatform: "四川政府采购网",
      url: "https://www.ccgp-sichuan.gov.cn/maincms-web/article?type=notice&id=contract",
      discoveredBy: "测试",
      query: "移动医护专网",
      scope: "测试",
      isKnownSample: false,
      provinceHint: "四川省",
      regionCodeHint: "510000",
      referer: null,
      titleHint: null,
      publishAtHint: null,
      documentIdHint: "contract",
      metadata: {},
    });
    expect(notice?.noticeType).toBe("政府采购合同公告");
    expect(notice?.stage).toBe("合同");
    expect(notice?.submissionDeadline).toBeNull();
  });

  it("从无换行的公共资源正文中截取准确采购人名称", () => {
    const [notice] = parseCcgpDetail(`
      <div class="vF_detail_header"><h2>雅安市5G专网项目招标公告</h2><span>2026-11-04 18:09:58</span></div>
      <div class="vF_detail_content">采购人信息 名称：雅安市数据局 地址：雅安市雨城区正和路1号 联系方式：0835-5181817 2.采购代理机构信息 名称：某代理机构</div>`, {
      sourceKey: "sichuanggzy",
      sourcePlatform: "四川省公共资源交易信息网",
      url: "https://ggzyjy.sc.gov.cn/jyxx/example.html",
      discoveredBy: "测试",
      query: "5G专网",
      scope: "测试",
      isKnownSample: false,
      provinceHint: "四川省",
      regionCodeHint: "510000",
      referer: null,
      titleHint: null,
      publishAtHint: null,
      documentIdHint: "example",
      metadata: {},
    });
    expect(notice?.buyer).toBe("雅安市数据局");
  });

  it("区分直接采购公告和直接采购公示", () => {
    const baseCandidate = {
      sourceKey: "scenergy" as const,
      sourcePlatform: "四川能源天府阳光采购服务平台",
      url: "https://scny.tfygcgfw.com/transaction/bidding/example",
      discoveredBy: "测试",
      query: "5G",
      scope: "测试",
      isKnownSample: false,
      provinceHint: "四川省",
      regionCodeHint: "510000",
      referer: null,
      titleHint: null,
      publishAtHint: null,
      documentIdHint: "example",
      metadata: {},
    };
    const [announcement] = parseCcgpDetail(`
      <div class="vF_location">直接采购公告</div>
      <div class="vF_detail_header"><h2>煤矿5G+智能矿山建设指南技术咨询服务直接采购公告</h2></div>
      <div class="vF_detail_content"><p>提交响应文件截止时间：2026-11-04 09:00:00</p></div>`, baseCandidate);
    const [publicity] = parseCcgpDetail(`
      <div class="vF_detail_header"><h2>某5G专网维保项目直接采购公示</h2></div>
      <div class="vF_detail_content">公示内容</div>`, baseCandidate);
    expect(announcement?.noticeType).toBe("直接采购公告");
    expect(announcement?.stage).toBe("采购公告");
    expect(announcement?.submissionDeadline).toBe("2026-11-04T09:00:00+08:00");
    expect(publicity?.stage).toBe("直接采购公示");
    expect(publicity?.submissionDeadline).toBeNull();
  });
});

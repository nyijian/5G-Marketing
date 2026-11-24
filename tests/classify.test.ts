import { describe, expect, it } from "vitest";
import { classifyNotice } from "../src/classify.js";

describe("相关性分类", () => {
  it("把标题中隔有业务词的5G移动警务专网识别为明确相关", () => {
    const result = classifyNotice({
      title: "东城分局采购5G执法记录仪移动警务专网流量服务项目公开招标公告",
      procurementContent: "详见第五章采购需求",
      fullText: "详见第五章采购需求",
    });
    expect(result.relevance).toBe("明确相关");
    expect(result.category).toBe("客户专网建设/接入/运营");
  });

  it("排除只采购5G执法记录仪的项目", () => {
    const result = classifyNotice({
      title: "远安县公安局2026年5G执法记录仪采购项目",
      procurementContent: "采购86台5G执法记录仪、流量卡、采集器和服务器",
      fullText: "设备接入既有视频专网和公安网",
    });
    expect(result.relevance).toBe("排除");
  });

  it("排除5G仅出现在供应商业绩中的项目", () => {
    const result = classifyNotice({
      title: "政务服务自助终端运维项目",
      procurementContent: "采购自助终端运维服务",
      fullText: "供应商业绩要求：青岛市5G专网智慧城市建设项目案例一项",
    });
    expect(result.relevance).toBe("排除");
    expect(result.reason).toContain("业绩");
  });

  it("网络别名仅出现在供应商业绩中时仍然排除", () => {
    const result = classifyNotice({
      title: "园区办公网络维护项目",
      procurementContent: "采购现有办公网络维护服务",
      fullText: "供应商业绩要求：具有工业5G网络建设成功案例一项",
    });
    expect(result.relevance).toBe("排除");
    expect(result.reason).toContain("业绩");
  });

  it("正文服务范围明确包含5G专网时收录", () => {
    const result = classifyNotice({
      title: "第四代移动警务购买服务项目成交公告",
      procurementContent: null,
      fullText: "服务范围：包括移动执法终端服务、移动执法5G专网服务、网络安全服务。",
    });
    expect(result.relevance).toBe("明确相关");
  });

  it("5G核心网教学设备按配套类别收录", () => {
    const result = classifyNotice({
      title: "5G核心网实验教学设备公开招标公告",
      procurementContent: "采购5G核心网系统1套、教学型基站20套",
      fullText: "",
    });
    expect(result.relevance).toBe("明确相关");
    expect(result.category).toBe("核心网教学/实训配套");
  });

  it("统一全半角、大小写和连接符后识别医疗健康专网", () => {
    const result = classifyNotice({
      title: "医院５ｇ＋医疗健康专网建设服务项目",
      procurementContent: "建设院内网络并提供运维服务",
      fullText: "",
    });
    expect(result.relevance).toBe("明确相关");
    expect(result.evidence).toContain("5G+医疗健康专网");
  });

  it.each([
    "大竹天然气净化项目工业5G网络技术及UWB定位服务",
    "华虹双域专网二期项目",
    "电力5G软切片专网建设项目",
    "厂区5G无线生产网络传输服务项目",
    "煤矿井下5G通讯系统建设项目",
  ])("把网络别名识别为明确相关：%s", (title) => {
    const result = classifyNotice({ title, procurementContent: null, fullText: title });
    expect(result.relevance).toBe("明确相关");
  });

  it.each([
    "医院移动医护专网服务项目",
    "厂区无线生产网络改造项目",
    "某单位5G专线租用项目",
    "医疗健康汇聚专线采购项目",
  ])("缺少5G专网证据的网络别名标为待核实：%s", (title) => {
    const result = classifyNotice({ title, procurementContent: null, fullText: title });
    expect(result.relevance).toBe("待核实");
    expect(result.category).toBe("网络别名线索");
  });

  it("正文中的5G+医疗健康专网能够明确收录", () => {
    const result = classifyNotice({
      title: "医院通信服务项目",
      procurementContent: "采购5G+医疗健康专网建设和运维服务",
      fullText: "采购5G+医疗健康专网建设和运维服务",
    });
    expect(result.relevance).toBe("明确相关");
  });

  it("DNN安全汇聚仅出现在供应商业绩中时排除", () => {
    const result = classifyNotice({
      title: "普通网络维护项目",
      procurementContent: "维护办公网络",
      fullText: "供应商业绩要求：具备DNN安全汇聚项目案例一项",
    });
    expect(result.relevance).toBe("排除");
    expect(result.reason).toContain("业绩");
  });

  it.each([
    "5G智慧矿山无人矿卡调度平台项目",
    "煤矿5G+智能矿山建设指南技术咨询服务",
    "医院5G移动护理应用服务项目",
    "厂区AGV搬运系统升级项目",
    "资中县中医医院5G智慧医学影像服务",
    "某单位5G信号覆盖服务项目",
    "四川亿航实业有限公司5G+智慧办公服务项目",
    "布拖县统计局5G农普服务项目",
  ])("仅命中行业场景时标为待核实：%s", (title) => {
    const result = classifyNotice({ title, procurementContent: null, fullText: title });
    expect(result.relevance).toBe("待核实");
    expect(result.category).toBe("行业场景线索");
  });
});

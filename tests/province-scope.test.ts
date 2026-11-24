import { describe, expect, it } from "vitest";
import { isNoticeWithinProvinceScope, type ProvinceScopeNotice } from "../src/db.js";

function notice(overrides: Partial<ProvinceScopeNotice> = {}): ProvinceScopeNotice {
  return {
    sourceKey: "ccgp",
    region: null,
    title: "测试项目",
    buyer: "测试采购人",
    ...overrides,
  };
}

describe("四川范围复核", () => {
  it("保留四川专属来源的省本级公告", () => {
    expect(isNoticeWithinProvinceScope(notice({ sourceKey: "sichuanccgp", region: "省本级" }), "四川省"))
      .toBe(true);
  });

  it("保留国家站四川筛选返回的县级地区", () => {
    expect(isNoticeWithinProvinceScope(notice({ region: "三台县", buyer: "三台县人民医院" }), "四川省"))
      .toBe(true);
  });

  it.each(["沈阳市", "北京市", "广西壮族自治区", "辽宁省"])("排除明确外省地区：%s", (region) => {
    expect(isNoticeWithinProvinceScope(notice({ region }), "四川省")).toBe(false);
  });

  it("保留地区标为四川省的中央单位项目", () => {
    expect(isNoticeWithinProvinceScope(notice({ region: "四川省", buyer: "西南民族大学" }), "四川省"))
      .toBe(true);
  });

  it("地区缺失时要求标题或采购人提供四川证据", () => {
    expect(isNoticeWithinProvinceScope(notice({ region: null, buyer: "四川省某单位" }), "四川省"))
      .toBe(true);
    expect(isNoticeWithinProvinceScope(notice({ region: null, buyer: "外地某单位" }), "四川省"))
      .toBe(false);
  });
});

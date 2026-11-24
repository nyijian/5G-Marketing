import { describe, expect, it } from "vitest";
import { parseChinaDateTime } from "../src/time.js";

describe("中国采购公告时间解析", () => {
  it("解析“点/分”格式", () => {
    expect(parseChinaDateTime("2026年11月26日 13点30分")).toBe(
      "2026-11-26T13:30:00+08:00",
    );
  });

  it("把24:00规范到次日00:00", () => {
    expect(parseChinaDateTime("2026年11月09日 24:00", "23:59:59")).toBe(
      "2026-11-10T00:00:00+08:00",
    );
  });
});

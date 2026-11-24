import { loadKnownSamples } from "./config.js";
import { fetchText } from "./http.js";
import { parseCcgpDetail } from "./parse/ccgp-detail.js";
import type { SampleValidation } from "./types.js";

export async function validateKnownSamples(): Promise<SampleValidation[]> {
  const samples = await loadKnownSamples();
  const results: SampleValidation[] = [];
  for (const sample of samples) {
    try {
      const response = await fetchText(sample.url, {
        retries: 2,
        referer: "https://www.ccgp.gov.cn/",
      });
      const notice = parseCcgpDetail(response.text, {
        sourceKey: "ccgp",
        sourcePlatform: "中国政府采购网",
        url: sample.url,
        discoveredBy: "已知验证样本",
        query: "用户指定样本",
        scope: "单条历史/当前样本端到端字段回归",
        isKnownSample: true,
        provinceHint: "四川省",
        regionCodeHint: "510000",
        referer: "https://www.ccgp.gov.cn/",
        titleHint: sample.name,
        publishAtHint: null,
        documentIdHint: null,
        metadata: {},
      })[0] ?? null;
      if (!notice) throw new Error("解析结果为空");
      const checks: SampleValidation["checks"] = [
        {
          field: "projectNumber",
          expected: sample.expected.projectNumber,
          actual: notice.projectNumber,
          passed: notice.projectNumber === sample.expected.projectNumber,
        },
        {
          field: "buyer",
          expected: sample.expected.buyer,
          actual: notice.buyer,
          passed: notice.buyer === sample.expected.buyer,
        },
        {
          field: "budgetCny",
          expected: sample.expected.budgetCny,
          actual: notice.budget.cny,
          passed: notice.budget.cny === sample.expected.budgetCny,
        },
        {
          field: "acquisitionDeadline",
          expected: sample.expected.acquisitionDeadline,
          actual: notice.acquisitionDeadline,
          passed: notice.acquisitionDeadline === sample.expected.acquisitionDeadline,
        },
        {
          field: "submissionDeadline",
          expected: sample.expected.submissionDeadline,
          actual: notice.submissionDeadline,
          passed: notice.submissionDeadline === sample.expected.submissionDeadline,
        },
      ];
      results.push({ sample, notice, checks, passed: checks.every((check) => check.passed), error: null });
    } catch (error) {
      results.push({
        sample,
        notice: null,
        checks: [],
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

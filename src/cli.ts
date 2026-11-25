import path from "node:path";
import { collect, type CollectOptions } from "./collect.js";
import { databasePath, defaultOutputPath, loadScope } from "./config.js";
import { MonitorDatabase } from "./db.js";
import { exportWorkbook } from "./export-excel.js";
import { chinaDate, chinaIso, subtractDays, asChinaStartOfDay } from "./time.js";
import { validateKnownSamples } from "./validate-sample.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

function printHelp(): void {
  console.log(`
5G定制网招标信息监测工具

用法：
  pnpm collect [--start-date 2026-01-01 | --days 30] [--max-pages 2] [--site-pages 10] [--as-of 2026-11-23]
  pnpm validate:sample
  pnpm export [--days 30] [--output 文件.xlsx]

选项：
  --no-official-search   跳过中国政府采购网站内检索（通常不建议）
  --no-sichuan-ccgp      跳过四川政府采购分网独立检索
  --no-public-search     跳过公开搜索补充发现
  --no-ggzy              跳过全国公共资源交易平台
  --no-sichuan-ggzy      跳过四川省公共资源交易信息网独立检索
  --no-tianfu            跳过天府阳光和四川能源天府阳光采购平台
  --no-telecom           跳过中国电信阳光采购网
  --no-buyer-sites       跳过采购人官网栏目监测（config/buyer-sites.json）
  --site-pages N         采购人官网每个栏目最多读取的列表页数，默认10；回溯全年可加大
`);
}

async function runCollect(args: string[]): Promise<void> {
  const explicitDays = optionValue(args, "--days");
  const explicitStartDate = optionValue(args, "--start-date");
  const scope = await loadScope();
  const options: CollectOptions = {
    days: Number(explicitDays ?? "30"),
    maxPages: Number(optionValue(args, "--max-pages") ?? "2"),
    officialSearch: !has(args, "--no-official-search"),
    sichuanCcgpSearch: !has(args, "--no-sichuan-ccgp"),
    publicSearch: !has(args, "--no-public-search"),
    ggzySearch: !has(args, "--no-ggzy"),
    sichuanGgzySearch: !has(args, "--no-sichuan-ggzy"),
    tianfuSearch: !has(args, "--no-tianfu"),
    telecomSearch: !has(args, "--no-telecom"),
    buyerSites: !has(args, "--no-buyer-sites"),
    sitePages: Number(optionValue(args, "--site-pages") ?? "10"),
  };
  const startDate = explicitStartDate ?? (explicitDays ? undefined : scope.startDate);
  if (startDate) options.startDate = startDate;
  const asOf = optionValue(args, "--as-of");
  const output = optionValue(args, "--output");
  if (asOf) options.asOf = asOf;
  if (output) options.output = output;
  const summary = await collect(options);
  console.log(`运行状态：${summary.status}`);
  console.log(`日期范围：${summary.windowStart} 至 ${summary.windowEnd}`);
  console.log(`地区范围：${summary.regionScope}`);
  console.log(`候选URL：${summary.candidatesDiscovered}；详情成功：${summary.detailFetchSucceeded}；失败：${summary.detailFetchFailed}`);
  console.log(`纳入：${summary.includedCount}；待核实：${summary.pendingCount}；排除：${summary.excludedCount}`);
  console.log(`数据库：${summary.databasePath}`);
  console.log(`Excel（本次窗口）：${summary.outputPath ?? "导出失败"}`);
  console.log(`Excel（全年最新）：${summary.latestOutputPath ?? "未生成"}`);
  if (summary.errors.length) {
    console.log("限制/错误：");
    for (const error of summary.errors) console.log(`- ${error}`);
  }
  if (summary.status === "failed") process.exitCode = 1;
}

async function runValidation(): Promise<void> {
  const results = await validateKnownSamples();
  for (const result of results) {
    console.log(`${result.passed ? "通过" : "失败"}：${result.sample.name}`);
    if (result.error) console.log(`  错误：${result.error}`);
    for (const check of result.checks) {
      console.log(`  ${check.passed ? "✓" : "✗"} ${check.field}: 实际=${String(check.actual)}；预期=${String(check.expected)}`);
    }
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

async function runExport(args: string[]): Promise<void> {
  const explicitDays = optionValue(args, "--days");
  const explicitStartDate = optionValue(args, "--start-date");
  const days = Number(explicitDays ?? "30");
  const scope = await loadScope();
  const instant = new Date();
  const endDate = chinaDate(instant);
  const startDate = explicitStartDate
    ?? (explicitDays ? undefined : scope.startDate)
    ?? chinaDate(subtractDays(new Date(`${endDate}T12:00:00+08:00`), days - 1));
  const windowStart = asChinaStartOfDay(startDate);
  const windowEnd = chinaIso(instant);
  const filePath = path.resolve(optionValue(args, "--output") ?? defaultOutputPath(endDate, startDate));
  const db = new MonitorDatabase(databasePath());
  try {
    const notices = db.listNotices(windowStart, windowEnd, scope.province);
    const now = new Date().toISOString();
    const writtenPath = await exportWorkbook({
      filePath,
      notices,
      context: {
        runId: 0,
        runStatus: "仅从现有数据库重新导出",
        asOf: windowEnd,
        windowStart,
        windowEnd,
        regionScope: scope.province,
        providers: [{
          provider: "数据库重新导出",
          sourcePlatform: "本地SQLite",
          scope: "不执行网络采集，仅导出当前数据库中日期窗口内记录",
          status: "skipped",
          startedAt: now,
          finishedAt: now,
          queriesAttempted: 0,
          pagesAttempted: 0,
          candidatesFound: notices.length,
          error: null,
        }],
      },
    });
    console.log(`已导出：${writtenPath}`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "collect") await runCollect(args);
  else if (command === "validate-sample") await runValidation();
  else if (command === "export") await runExport(args);
  else printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

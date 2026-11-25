import { mkdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { chinaDateTimeDisplay, deadlineStatus } from "./time.js";
import type { ProviderOutcome, StoredNotice } from "./types.js";

export interface ExportContext {
  runId: number;
  runStatus: string;
  asOf: string;
  windowStart: string;
  windowEnd: string;
  regionScope: string;
  providers: ProviderOutcome[];
  /** 本次采集开始时间；首次发现时间不早于它的记录标为“本次新发现”。仅重新导出时不填。 */
  newSince?: string;
}

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } } as const;
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } } as const;

function money(value: number | null): number | "" {
  return value ?? "";
}

function configureSheet(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.getRow(1).height = 34;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
  sheet.columns.forEach((column) => {
    let maxLength = String(column.header ?? "").length;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const text = typeof cell.value === "object" && cell.value && "text" in cell.value
        ? String(cell.value.text)
        : String(cell.value ?? "");
      maxLength = Math.max(maxLength, Math.min(text.length, 60));
    });
    column.width = Math.max(10, Math.min(maxLength + 2, 42));
  });
}

function opportunityRank(notice: StoredNotice, asOf: string): number {
  const applicable = notice.stage === "采购公告" || notice.stage === "更正/延期";
  const submission = deadlineStatus(notice.effectiveSubmissionDeadline, asOf, applicable);
  if (submission === "未截止") return 0;
  if (submission === "未知" && applicable) return 1;
  if (!applicable) return 2;
  return 3;
}

function addNoticeSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  notices: StoredNotice[],
  asOf: string,
  newSince: string | undefined,
): void {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: name === "监测清单" ? "FF70AD47" : "FFA5A5A5" } } });
  sheet.columns = [
    { header: "项目名称", key: "title" },
    { header: "采购人", key: "buyer" },
    { header: "省份", key: "province" },
    { header: "地区", key: "region" },
    { header: "项目编号", key: "projectNumber" },
    { header: "标包", key: "lotNumber" },
    { header: "采购内容", key: "procurementContent" },
    { header: "采购内容分类", key: "contentCategory" },
    { header: "公告类型", key: "noticeType" },
    { header: "采购阶段", key: "stage" },
    { header: "采购方式", key: "procurementMethod" },
    { header: "发布日期", key: "publishAt" },
    { header: "预算金额", key: "budgetAmount" },
    { header: "预算单位", key: "budgetUnit" },
    { header: "预算折合元", key: "budgetCny" },
    { header: "最高限价金额", key: "ceilingAmount" },
    { header: "最高限价单位", key: "ceilingUnit" },
    { header: "最高限价折合元", key: "ceilingCny" },
    { header: "中标/成交金额", key: "awardAmount" },
    { header: "中标/成交单位", key: "awardUnit" },
    { header: "获取文件开始", key: "acquisitionStart" },
    { header: "获取文件截止（最新）", key: "acquisitionDeadline" },
    { header: "领文件状态", key: "acquisitionStatus" },
    { header: "投标/响应截止（最新）", key: "submissionDeadline" },
    { header: "递交状态", key: "submissionStatus" },
    { header: "相关性判断", key: "relevance" },
    { header: "判断依据", key: "relevanceReason" },
    { header: "支持判断的原文短句", key: "evidenceQuote" },
    { header: "附件读取情况", key: "attachmentStatus" },
    { header: "附件名称", key: "attachmentNames" },
    { header: "来源平台", key: "sourcePlatform" },
    { header: "线索发现方式", key: "discoveryMethod" },
    { header: "检索词/来源", key: "discoveryQuery" },
    { header: "覆盖范围说明", key: "discoveryScope" },
    { header: "已知验证样本", key: "isKnownSample" },
    { header: "关联原公告", key: "relatedOriginalUrl" },
    { header: "最新更正公告", key: "latestCorrectionUrl" },
    { header: "原文链接", key: "sourceUrl" },
    { header: "省级/原始平台链接", key: "originUrl" },
    { header: "其他来源链接", key: "alternateSourceUrls" },
    { header: "首次发现时间", key: "firstSeenAt" },
    { header: "本次新发现", key: "isNew" },
    { header: "最近抓取时间", key: "fetchedAt" },
  ];

  const ordered = [...notices].sort((a, b) => {
    const rank = opportunityRank(a, asOf) - opportunityRank(b, asOf);
    return rank || Date.parse(b.publishAt ?? "") - Date.parse(a.publishAt ?? "");
  });
  for (const notice of ordered) {
    const applicable = notice.stage === "采购公告" || notice.stage === "更正/延期";
    const acquisitionDeadline = notice.effectiveAcquisitionDeadline;
    const submissionDeadline = notice.effectiveSubmissionDeadline;
    const row = sheet.addRow({
      title: notice.title,
      buyer: notice.buyer ?? "",
      province: notice.province ?? "",
      region: notice.region ?? "",
      projectNumber: notice.projectNumber ?? "",
      lotNumber: notice.lotNumber,
      procurementContent: notice.procurementContent ?? "",
      contentCategory: notice.contentCategory,
      noticeType: notice.noticeType,
      stage: notice.stage,
      procurementMethod: notice.procurementMethod ?? "",
      publishAt: chinaDateTimeDisplay(notice.publishAt),
      budgetAmount: money(notice.budget.amount),
      budgetUnit: notice.budget.unit ?? "",
      budgetCny: money(notice.budget.cny),
      ceilingAmount: money(notice.ceiling.amount),
      ceilingUnit: notice.ceiling.unit ?? "",
      ceilingCny: money(notice.ceiling.cny),
      awardAmount: money(notice.award.amount),
      awardUnit: notice.award.unit ?? "",
      acquisitionStart: chinaDateTimeDisplay(notice.acquisitionStart),
      acquisitionDeadline: chinaDateTimeDisplay(acquisitionDeadline),
      acquisitionStatus: deadlineStatus(acquisitionDeadline, asOf, applicable),
      submissionDeadline: chinaDateTimeDisplay(submissionDeadline),
      submissionStatus: deadlineStatus(submissionDeadline, asOf, applicable),
      relevance: notice.relevance,
      relevanceReason: notice.relevanceReason,
      evidenceQuote: notice.evidenceQuote ?? "",
      attachmentStatus: notice.attachmentStatus,
      attachmentNames: notice.attachmentNames.join("；"),
      sourcePlatform: notice.sourcePlatform,
      discoveryMethod: notice.discoveryMethod,
      discoveryQuery: notice.discoveryQuery,
      discoveryScope: notice.discoveryScope,
      isKnownSample: notice.isKnownSample ? "是" : "否",
      relatedOriginalUrl: notice.relatedOriginalUrl ?? "",
      latestCorrectionUrl: notice.latestCorrectionUrl ?? "",
      sourceUrl: { text: "查看原文", hyperlink: notice.sourceUrl },
      originUrl: notice.originUrl ? { text: "查看原始平台", hyperlink: notice.originUrl } : "",
      alternateSourceUrls: notice.alternateSourceUrls.join("\n"),
      firstSeenAt: chinaDateTimeDisplay(notice.firstSeenAt || null),
      isNew: newSince ? (notice.firstSeenAt >= newSince ? "是" : "否") : "",
      fetchedAt: chinaDateTimeDisplay(notice.fetchedAt),
    });
    if (row.getCell("isNew").value === "是") {
      row.getCell("isNew").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
    }
    for (const key of ["budgetCny", "ceilingCny", "awardAmount"]) {
      row.getCell(key).numFmt = "#,##0.00";
    }
    for (const key of ["acquisitionStatus", "submissionStatus"]) {
      const cell = row.getCell(key);
      if (cell.value === "未截止") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
      if (cell.value === "已截止") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
    }
    if (notice.relevance === "待核实") {
      row.getCell("relevance").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
    }
  }
  configureSheet(sheet);
}

function addCoverageSheet(workbook: ExcelJS.Workbook, context: ExportContext): void {
  const sheet = workbook.addWorksheet("运行与覆盖", { properties: { tabColor: { argb: "FF5B9BD5" } } });
  sheet.addRows([
    ["本次运行编号", context.runId],
    ["本次运行状态", context.runStatus],
    ["地区范围", context.regionScope],
    ["核验时点", chinaDateTimeDisplay(context.asOf)],
    ["清单日期窗口", `${chinaDateTimeDisplay(context.windowStart)} 至 ${chinaDateTimeDisplay(context.windowEnd)}`],
    [],
  ]);
  sheet.addRow([
    "采集/发现通道",
    "目标平台",
    "实际覆盖范围",
    "本次状态",
    "开始时间",
    "结束时间",
    "检索数",
    "页数",
    "候选URL数",
    "错误或限制",
  ]);
  const headerRow = sheet.rowCount;
  for (const provider of context.providers) {
    sheet.addRow([
      provider.provider,
      provider.sourcePlatform,
      provider.scope,
      provider.status,
      chinaDateTimeDisplay(provider.startedAt),
      chinaDateTimeDisplay(provider.finishedAt),
      provider.queriesAttempted,
      provider.pagesAttempted,
      provider.candidatesFound,
      provider.error ?? "",
    ]);
  }
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
  sheet.columns = [
    { width: 28 }, { width: 25 }, { width: 55 }, { width: 16 }, { width: 22 },
    { width: 22 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 65 },
  ];
}

function addDefinitionsSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("字段说明");
  sheet.columns = [{ header: "字段/规则", key: "field", width: 28 }, { header: "说明", key: "description", width: 95 }];
  sheet.addRows([
    { field: "日期窗口", description: "默认从config/scope.json配置的开始日期至运行时点；也可用--start-date或--days覆盖，最终以公告详情页发布日期再次过滤。" },
    { field: "明确相关", description: "标题或本次采购需求明确出现5G专网/定制网，或出现UPF下沉、本地分流等强技术证据；5G核心网作为配套单列。" },
    { field: "待核实", description: "正文命中但无法确认是否属于本次采购需求，或关键要求可能只在未读取附件中。" },
    { field: "排除", description: "仅采购5G终端/应用，或5G只出现在供应商业绩、案例、项目背景中。" },
    { field: "预算/最高限价", description: "分别记录，不用预算自动填充最高限价；金额另折合成人民币元便于排序。" },
    { field: "截止状态", description: "获取文件与递交响应分别判断；结果、意向、终止等非采购公告显示“不适用”。" },
    { field: "公开搜索", description: "搜索引擎索引不实时且分页/总量不透明，只作为新来源与详情URL发现补充，不能代表平台全量。" },
    { field: "固定验证种子", description: "用户指定样本和首轮已核验URL，仅用于端到端回归与站内检索受限时兜底。" },
    { field: "跨来源合并", description: "同一项目编号、公告阶段和标包在多个平台出现时，清单合并为一行，并保留其他来源链接；数据库仍分别保存各平台记录。" },
    { field: "首次发现时间", description: "该公告第一次被采集入库的时间（北京时间），不是发布日期；发布较早但今天才找到的公告属于“补录/迟到发现”。" },
    { field: "本次新发现", description: "首次发现时间不早于本次采集开始时间即为“是”，用于每日查看新增；仅从数据库重新导出（pnpm export）时留空。" },
    { field: "采购人官网", description: "来源平台为医院、卫健委等名称的记录来自采购人官网栏目监测（config/buyer-sites.json），不计入招标发布平台覆盖。" },
  ]);
  configureSheet(sheet);
}

/** Windows下目标文件正被Excel打开时另存为带时间戳的新文件，不覆盖、不报错退出。 */
async function writeWorkbookSafely(workbook: ExcelJS.Workbook, filePath: string): Promise<string> {
  try {
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EBUSY") throw error;
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const fallback = filePath.replace(/\.xlsx$/i, `_更新_${timestamp}.xlsx`);
    await workbook.xlsx.writeFile(fallback);
    console.warn(`目标Excel正在被占用，已改存为：${fallback}`);
    return fallback;
  }
}

/** 返回实际写入的文件路径。 */
export async function exportWorkbook(input: {
  filePath: string;
  notices: StoredNotice[];
  context: ExportContext;
}): Promise<string> {
  await mkdir(path.dirname(input.filePath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "5G定制网招标信息监测工具";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = `${input.context.regionScope}5G专网相关公告（${input.context.windowStart.slice(0, 10)}至${input.context.windowEnd.slice(0, 10)}）`;
  workbook.properties.date1904 = false;

  const included = input.notices.filter((notice) => notice.relevance !== "排除");
  const excluded = input.notices.filter((notice) => notice.relevance === "排除");
  addNoticeSheet(workbook, "监测清单", included, input.context.asOf, input.context.newSince);
  addNoticeSheet(workbook, "未纳入候选", excluded, input.context.asOf, input.context.newSince);
  addCoverageSheet(workbook, input.context);
  addDefinitionsSheet(workbook);
  return writeWorkbookSafely(workbook, input.filePath);
}

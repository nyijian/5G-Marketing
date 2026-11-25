import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import { databasePath, loadBuyerSites } from "./config.js";

interface DbNotice {
  title: string;
  publish_at: string | null;
  buyer: string | null;
  project_number: string | null;
  award_cny: number | null;
  source_platform: string;
  source_url: string;
  relevance: string;
}

interface ManualVerification {
  match: string;
  exact?: boolean;
  status: string;
  sourcePlatform: string;
  projectNumber?: string;
  officialUrl?: string;
  clueUrl?: string;
  verifiedAmount?: number;
  verifiedWinner?: string;
  note: string;
}

interface TargetRow {
  province: string;
  city: string;
  date: string;
  type: string;
  title: string;
  buyer: string;
  winner: string;
  amount: number | null;
}

interface PlatformCatalogEntry {
  id: string;
  name: string;
  url: string;
  platformType: string;
  role: string;
  collectionStatus: string;
  authoritative: boolean;
  scope: string;
  domains: string[];
  evidenceRows: number[];
  notes: string;
}

interface ClueSiteEntry {
  id: string;
  name: string;
  domains: string[];
  kind: string;
  collectionStatus: string;
  access: string;
  evidenceRows: number[];
  notes: string;
}

function textValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return String(value.text);
  if ("result" in value) return textValue(value.result as ExcelJS.CellValue);
  return String(value);
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[“”‘’'"()（）\[\]【】\s,，。:：;；+＋\-—_]/g, "")
    .replace(/(?:政府采购合同公告|中标成交结果公告|成交结果公告|中标公告|中选公告|结果公告|结果公示|招标结果公告|合同公告|采购结果公告)$/g, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function similarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.25;
  const aa = bigrams(a);
  const bb = bigrams(b);
  const common = [...aa].filter((part) => bb.has(part)).length;
  return aa.size + bb.size === 0 ? 0 : (2 * common) / (aa.size + bb.size);
}

function dayDistance(left: string, right: string | null): number {
  if (!right) return Number.POSITIVE_INFINITY;
  const leftDate = left.slice(0, 10);
  const rightDate = right.slice(0, 10);
  return Math.abs(
    Date.parse(`${leftDate}T00:00:00+08:00`) - Date.parse(`${rightDate}T00:00:00+08:00`),
  ) / 86_400_000;
}

function sourceScore(source: string): number {
  if (source === "四川政府采购网") return 5;
  if (source === "中国政府采购网") return 4;
  if (source === "四川省公共资源交易信息网") return 3;
  if (source === "全国公共资源交易平台") return 2;
  return 1;
}

function findAutomaticMatch(target: TargetRow, notices: DbNotice[]): { notice: DbNotice; score: number } | null {
  const candidates = notices
    .filter((notice) => dayDistance(target.date, notice.publish_at) <= 3)
    .map((notice) => ({ notice, score: similarity(target.title, notice.title) }))
    .filter((item) => item.score >= 0.58)
    .sort((a, b) => b.score - a.score
      || dayDistance(target.date, a.notice.publish_at) - dayDistance(target.date, b.notice.publish_at)
      || sourceScore(b.notice.source_platform) - sourceScore(a.notice.source_platform));
  return candidates[0] ?? null;
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const inputPath = path.resolve(option("--input", "26年1-7月5G项目公开市场汇总（运营商中标）.xlsx"));
  const outputPath = path.resolve(option("--output", "output/2026历史项目核验_平台分层.xlsx"));
  await access(inputPath);

  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(inputPath);
  const sheet = source.getWorksheet("Sheet1") ?? source.worksheets[0];
  if (!sheet) throw new Error("输入Excel没有工作表");

  const targets: TargetRow[] = [];
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const province = textValue(row.getCell(1).value);
    const date = textValue(row.getCell(3).value).slice(0, 10);
    if (province !== "四川" || !date.startsWith("2026-")) continue;
    const rawAmount = row.getCell(8).value;
    targets.push({
      province,
      city: textValue(row.getCell(2).value),
      date,
      type: textValue(row.getCell(4).value),
      title: textValue(row.getCell(5).value),
      buyer: textValue(row.getCell(6).value),
      winner: textValue(row.getCell(7).value),
      amount: typeof rawAmount === "number" ? rawAmount : null,
    });
  }

  const db = new DatabaseSync(databasePath(), { readOnly: true });
  const notices = db.prepare(
    `SELECT title, publish_at, buyer, project_number, award_cny, source_platform, source_url, relevance
     FROM notices WHERE province = '四川省' AND publish_at >= '2026-01-01T00:00:00+08:00'`,
  ).all() as unknown as DbNotice[];
  db.close();

  const manual = JSON.parse(await readFile("config/historical-verifications.json", "utf8")) as ManualVerification[];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "5G定制网招标信息监测工具";
  const output = workbook.addWorksheet("37条历史样本核验");
  output.views = [{ state: "frozen", ySplit: 1 }];
  output.columns = [
    { header: "省份", key: "province", width: 8 },
    { header: "市州", key: "city", width: 14 },
    { header: "原清单日期", key: "date", width: 13 },
    { header: "原清单类型", key: "type", width: 12 },
    { header: "原清单项目名称", key: "title", width: 52 },
    { header: "原清单招标单位", key: "buyer", width: 32 },
    { header: "原清单中标单位", key: "winner", width: 16 },
    { header: "原清单金额", key: "amount", width: 14 },
    { header: "核验状态", key: "status", width: 22 },
    { header: "官网标题", key: "verifiedTitle", width: 52 },
    { header: "官网发布日期", key: "verifiedDate", width: 15 },
    { header: "项目编号", key: "projectNumber", width: 25 },
    { header: "官网金额", key: "verifiedAmount", width: 14 },
    { header: "官网中标/候选人", key: "verifiedWinner", width: 34 },
    { header: "核验证据网站/平台", key: "sourcePlatform", width: 28 },
    { header: "官网原文", key: "officialUrl", width: 16 },
    { header: "补充线索", key: "clueUrl", width: 16 },
    { header: "核验说明", key: "note", width: 70 },
  ];

  let officialCount = 0;
  let partialCount = 0;
  for (const target of targets) {
    const normalized = normalizeTitle(target.title);
    const override = manual.find((item) => {
      const match = normalizeTitle(item.match);
      return item.exact ? normalized === match : normalized.includes(match);
    });
    const automatic = findAutomaticMatch(target, notices);
    const status = override?.status ?? (automatic ? "官网原文已定位（自动）" : "未定位");
    if (/官网已核实|官网原文已定位/.test(status)) officialCount += 1;
    else if (status !== "未定位") partialCount += 1;
    const notice = automatic?.notice;
    const officialUrl = override?.officialUrl ?? notice?.source_url ?? "";
    const row = output.addRow({
      ...target,
      amount: target.amount ?? "",
      status,
      verifiedTitle: notice?.title ?? "",
      verifiedDate: notice?.publish_at?.slice(0, 10) ?? "",
      projectNumber: override?.projectNumber ?? notice?.project_number ?? "",
      verifiedAmount: override?.verifiedAmount ?? notice?.award_cny ?? "",
      verifiedWinner: override?.verifiedWinner ?? "",
      sourcePlatform: override?.sourcePlatform ?? notice?.source_platform ?? "",
      officialUrl: officialUrl ? { text: "查看官网", hyperlink: officialUrl } : "",
      clueUrl: override?.clueUrl ? { text: "查看线索", hyperlink: override.clueUrl } : "",
      note: override?.note ?? (automatic
        ? `按发布日期（±3天）和标题相似度自动匹配，得分${automatic.score.toFixed(2)}；仍建议人工打开原文复核中标单位。`
        : "当前已接入来源和公开检索未定位到可信原文。"),
    });
    row.getCell("amount").numFmt = "#,##0.00";
    row.getCell("verifiedAmount").numFmt = "#,##0.00";
    const statusCell = row.getCell("status");
    statusCell.fill = /官网已核实|官网原文已定位/.test(status)
      ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } }
      : status === "未定位"
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } }
        : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
  }
  output.autoFilter = { from: "A1", to: "R1" };
  output.getRow(1).height = 34;
  output.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  output.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const summary = workbook.addWorksheet("核验说明");
  summary.addRows([
    ["目标样本总数", targets.length],
    ["官网原文已定位/核实", officialCount],
    ["部分核实、第三方线索或疑似错误", partialCount],
    ["未定位", targets.length - officialCount - partialCount],
    [],
    ["状态说明", "“官网原文已定位（自动）”是按日期和标题匹配到已采集的官方页面；“官网已核实”是人工核对；第三方线索不能等同官网确认。"],
    ["金额说明", "原清单金额与官网金额分别保留；0通常表示原清单未填金额，不表示零元成交。"],
    ["日期说明", "原清单日期可能是候选公示日期而非最终结果日期，差异写在核验说明中。"],
    ["来源口径", "招标发布平台、采购人官网和第三方线索站分三张表记录；采购人官网作为长尾来源自动监测但不计入平台覆盖；第三方线索站只供人工回溯原文。各表“核验样本序号”对应本表37条样本。"],
  ]);
  summary.columns = [{ width: 36 }, { width: 110 }];
  summary.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

  const platformCatalog = JSON.parse(
    await readFile("config/source-catalog.json", "utf8"),
  ) as PlatformCatalogEntry[];
  const platformSheet = workbook.addWorksheet("招标发布平台台账");
  platformSheet.columns = [
    { header: "平台ID", key: "id", width: 25 },
    { header: "平台名称", key: "name", width: 32 },
    { header: "平台类型", key: "platformType", width: 28 },
    { header: "采集角色", key: "role", width: 20 },
    { header: "采集状态", key: "collectionStatus", width: 20 },
    { header: "是否权威原始平台", key: "authoritative", width: 18 },
    { header: "覆盖范围", key: "scope", width: 42 },
    { header: "域名", key: "domains", width: 28 },
    { header: "核验样本序号", key: "evidenceRows", width: 18 },
    { header: "平台入口", key: "url", width: 16 },
    { header: "说明", key: "notes", width: 65 },
  ];
  for (const entry of platformCatalog) {
    platformSheet.addRow({
      ...entry,
      authoritative: entry.authoritative ? "是" : "否/市场化平台",
      domains: entry.domains.join("\n"),
      evidenceRows: entry.evidenceRows.join("、"),
      url: { text: "打开平台", hyperlink: entry.url },
    });
  }

  const buyerSites = await loadBuyerSites();
  const buyerSheet = workbook.addWorksheet("采购人官网采集与反查");
  buyerSheet.columns = [
    { header: "站点ID", key: "id", width: 28 },
    { header: "采购人/栏目", key: "name", width: 32 },
    { header: "地区", key: "region", width: 12 },
    { header: "采集状态", key: "collectionStatus", width: 16 },
    { header: "监测栏目", key: "lists", width: 60 },
    { header: "已核验项目", key: "verifiedProject", width: 44 },
    { header: "核验样本序号", key: "evidenceRows", width: 14 },
    { header: "平台反查状态", key: "mappingStatus", width: 18 },
    { header: "已确认对应平台ID", key: "mappedPlatformIds", width: 20 },
    { header: "采购人官网", key: "url", width: 16 },
    { header: "说明", key: "notes", width: 80 },
  ];
  for (const entry of buyerSites) {
    buyerSheet.addRow({
      ...entry,
      lists: entry.collection?.lists.map((list) => `${list.name}：${list.url}`).join("\n") ?? "",
      evidenceRows: entry.evidenceRows.join("、"),
      mappedPlatformIds: entry.mappedPlatformIds.join("、"),
      url: { text: "打开官网", hyperlink: entry.url },
    });
  }

  const clueCatalog = JSON.parse(await readFile("config/clue-sites.json", "utf8")) as { sites: ClueSiteEntry[] };
  const clueSheet = workbook.addWorksheet("第三方线索站");
  clueSheet.columns = [
    { header: "站点ID", key: "id", width: 16 },
    { header: "名称", key: "name", width: 28 },
    { header: "类型", key: "kind", width: 22 },
    { header: "采集状态", key: "collectionStatus", width: 14 },
    { header: "域名", key: "domains", width: 26 },
    { header: "程序访问情况", key: "access", width: 40 },
    { header: "核验样本序号", key: "evidenceRows", width: 14 },
    { header: "说明", key: "notes", width: 80 },
  ];
  for (const entry of clueCatalog.sites) {
    clueSheet.addRow({ ...entry, domains: entry.domains.join("\n"), evidenceRows: entry.evidenceRows.join("、") });
  }

  for (const sheetToStyle of [platformSheet, buyerSheet, clueSheet]) {
    sheetToStyle.views = [{ state: "frozen", ySplit: 1 }];
    sheetToStyle.autoFilter = { from: "A1", to: sheetToStyle.getRow(1).getCell(sheetToStyle.columnCount).address };
    sheetToStyle.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    sheetToStyle.eachRow((row, index) => {
      if (index > 1) row.alignment = { vertical: "top", wrapText: true };
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  let finalOutputPath = outputPath;
  try {
    await workbook.xlsx.writeFile(finalOutputPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EBUSY") throw error;
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    finalOutputPath = outputPath.replace(/\.xlsx$/i, `_更新_${timestamp}.xlsx`);
    await workbook.xlsx.writeFile(finalOutputPath);
    console.warn(`目标Excel正在被占用，已改存为：${finalOutputPath}`);
  }
  const jsonPath = finalOutputPath.replace(/\.xlsx$/i, ".summary.json");
  await writeFile(jsonPath, JSON.stringify({ total: targets.length, official: officialCount, partial: partialCount,
    unresolved: targets.length - officialCount - partialCount, outputPath: finalOutputPath }, null, 2), "utf8");
  console.log(`历史样本：${targets.length}；官网已定位/核实：${officialCount}；部分核实：${partialCount}；未定位：${targets.length - officialCount - partialCount}`);
  console.log(`核验表：${finalOutputPath}`);
}

await main();

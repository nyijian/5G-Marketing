import ExcelJS from "exceljs";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const ROOT = process.cwd();
const COLLECTED_PATH = path.join(
  ROOT,
  "output",
  "四川5G专网采购清单_2026-01-01至2026-11-23_本次采集.xlsx",
);
const AUDIT_PATH = path.join(ROOT, "output", "2026历史项目核验_平台分层.xlsx");
const OUTPUT_XLSX = path.join(
  ROOT,
  "output",
  "四川电信5G定制网竞争与机会管理分析底表_2026-11-24.xlsx",
);
const OUTPUT_JSON = path.join(
  ROOT,
  "output",
  "四川电信5G定制网竞争与机会管理分析摘要_2026-11-24.json",
);

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value.text !== undefined) return String(value.text);
  if (value.result !== undefined) return String(value.result ?? "");
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return cell.text || "";
}

function cellNumber(cell) {
  const value = cell.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof value.result === "number") return value.result;
  const parsed = Number(cell.text.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellLink(cell) {
  const value = cell.value;
  return value && typeof value === "object" && typeof value.hyperlink === "string"
    ? value.hyperlink
    : "";
}

function normalizeTitle(value) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[“”‘’'"()（）\[\]【】\s,，。:：;；+＋\-—_]/g, "")
    .replace(
      /(?:政府采购合同公告|中标成交结果公告|成交结果公告|中标公告|中选公告|结果公告|结果公示|招标结果公告|合同公告|采购结果公告)$/g,
      "",
    );
}

function rowsFromSheet(sheet) {
  const headers = {};
  sheet.getRow(1).eachCell((cell, column) => {
    headers[cellText(cell)] = column;
  });
  const rows = [];
  for (let rowIndex = 2; rowIndex <= sheet.actualRowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const record = { _row: rowIndex };
    for (const [header, column] of Object.entries(headers)) {
      record[header] = cellText(row.getCell(column));
      record[`__number__${header}`] = cellNumber(row.getCell(column));
      record[`__link__${header}`] = cellLink(row.getCell(column));
    }
    rows.push(record);
  }
  return rows;
}

function classifyIndustry(row) {
  const text = `${row["原清单项目名称"]} ${row["原清单招标单位"]} ${row["核验证据网站/平台"]}`;
  if (/某单位/.test(text)) return "匿名待核";
  if (/物理实验|实验设施/.test(text)) return "科研设施";
  if (/医院|妇幼|医疗|卫生|医护|医学影像|骨科|健康数字/.test(text)) return "医疗卫生";
  if (/大学|校园|学校/.test(text)) return "教育";
  if (/水电|电站|油气|天然气|锅炉|半导体|炼铁|钢铁|东方电气|工业5G/.test(text)) {
    return "工业能源";
  }
  return "政企其他";
}

function classifySource(row) {
  const source = row["核验证据网站/平台"];
  if (/四川政府采购网|中国政府采购网|四川省公共资源交易信息网|全国公共资源交易平台/.test(source)) {
    return "已接入固定平台";
  }
  if (/四川招投标网/.test(source)) return "市场化发布平台";
  if (/大唐智慧寻源|国家电网ECP|港航投资集团交易|鞍钢智慧招投标|国投集团电子采购|东方电气供应链|文化旅游康养发展集团招采/.test(source)) {
    return "集团/企业采购平台";
  }
  if (/原始平台未识别|未识别原始采购平台|公开网络及运营商采购平台|原始PDF发布平台未识别/.test(source)) {
    return "原始平台未识别";
  }
  if (/中国石油新闻中心/.test(source)) return "原始平台未识别";
  return "采购人官网长尾";
}

function projectNumberRoot(value) {
  if (!value) return "";
  if (value.includes("CRFQ-2025-S00028")) return "CRFQ-2025-S00028";
  return value.split("/")[0].trim();
}

function effectiveAmount(row) {
  const original = row["__number__原清单金额"];
  if (original !== null && original > 0) return original;
  const verified = row["__number__官网金额"];
  return verified !== null && verified > 0 ? verified : null;
}

function awardKey(row) {
  const projectNumber = projectNumberRoot(row["项目编号"]);
  const operator = row["原清单中标单位"] || "未知";
  const amount = effectiveAmount(row);
  if (projectNumber === "CRFQ-2025-S00028") return `${projectNumber}|${operator}|2451128`;
  if (projectNumber === "N5110252026000005" && operator === "移动") {
    return `${projectNumber}|${operator}|398000`;
  }
  return `row-${row._row}|${operator}|${amount ?? "未知"}`;
}

function representativeScore(row) {
  let score = 0;
  if ((row["__number__原清单金额"] ?? 0) > 0) score += 4;
  if (!/重复记录/.test(row["核验状态"])) score += 3;
  if (/中标通知/.test(row["原清单类型"])) score += 2;
  if (row["官网标题"]) score += 1;
  return score;
}

function dedupeAwards(historyRows) {
  const grouped = new Map();
  for (const row of historyRows) {
    const key = awardKey(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => representativeScore(b) - representativeScore(a));
    const representative = sorted[0];
    return {
      ...representative,
      _awardKey: key,
      _sourceRows: rows.map((row) => row._row),
      _duplicateCount: rows.length,
      _industry: classifyIndustry(representative),
      _sourceCategory: classifySource(representative),
      _knownAmount:
        representative["__number__原清单金额"] !== null &&
        representative["__number__原清单金额"] > 0
          ? representative["__number__原清单金额"]
          : null,
      _automaticallyMatched: rows.some(
        (row) => row["核验状态"] === "官网原文已定位（自动）",
      ),
      _strictOfficial: rows.some((row) => /官网已核实|官网原文已定位/.test(row["核验状态"])),
      _traceableOfficial: rows.some(
        (row) => row["核验状态"].startsWith("官网") && row["核验状态"] !== "官网来源已识别/结果未核实",
      ),
    };
  });
}

function projectKey(row) {
  const projectNumber = projectNumberRoot(row["项目编号"]);
  if (projectNumber) return projectNumber;
  return normalizeTitle(row["原清单项目名称"]);
}

function aggregateOperators(rows) {
  const result = {};
  for (const row of rows) {
    const operator = row["原清单中标单位"] || "未知";
    const item = (result[operator] ??= { records: 0, knownAmountRecords: 0, knownAmount: 0 });
    item.records += 1;
    if (row._knownAmount !== null) {
      item.knownAmountRecords += 1;
      item.knownAmount += row._knownAmount;
    }
  }
  const totalRecords = rows.length;
  const totalKnownAmount = Object.values(result).reduce((sum, item) => sum + item.knownAmount, 0);
  for (const item of Object.values(result)) {
    item.recordShare = totalRecords ? item.records / totalRecords : null;
    item.knownAmountShare = totalKnownAmount ? item.knownAmount / totalKnownAmount : null;
  }
  return { totalRecords, totalKnownAmount, operators: result };
}

function groupBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = typeof field === "function" ? field(row) : row[field] || "未知";
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return groups;
}

function aggregateSegments(rows, segment) {
  return [...groupBy(rows, segment).entries()]
    .map(([name, values]) => ({ name, ...aggregateOperators(values) }))
    .sort((a, b) => b.totalRecords - a.totalRecords || String(a.name).localeCompare(String(b.name), "zh-CN"));
}

function canonicalCollectedProgram(row) {
  const projectNumber = row["项目编号"];
  if (projectNumber) return projectNumber;
  const text = `${row["项目名称"]} ${row["采购人"]}`;
  const mappings = [
    [/攀枝花分公司2026-2027年H3C无线控制器及5G定制网自研UPF设备/, "CT-PZH-UPF-MAINT-2026"],
    [/四川省[“\"]?5G\+医疗健康[”\"]?远程应用体系服务/, "N5100012026000764"],
    [/骨科医院|5G\+医疗健康.*专线服务项目合同/, "N5100012024000138"],
    [/内江市第二人民医院|5G智慧医院影像项目/, "N5110012026000041"],
    [/内江市中医医院|5G智慧医学影像服务采购项目/, "N5110012026000021"],
    [/资中县中医医院|^5G智慧医学影像服务$/, "N5110252026000005"],
    [/甘孜州5G卫生专网建设项目/, "N5133112026000008"],
  ];
  for (const [pattern, id] of mappings) if (pattern.test(text)) return id;
  return `TITLE:${normalizeTitle(row["项目名称"])}`;
}

function collectedBusinessKey(program) {
  if (["N5100012026000673", "N5100012026000764"].includes(program)) {
    return "四川省5G+医疗健康远程应用体系服务（终止重招）";
  }
  return program;
}

function countNonEmpty(rows, field) {
  return rows.filter((row) => row[field] !== "").length;
}

function countsBy(rows, field, split = false) {
  const result = {};
  for (const row of rows) {
    const values = split ? row[field].split("；").filter(Boolean) : [row[field] || "(空)"];
    for (const value of values) result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function styleHeader(row) {
  row.height = 32;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

function finishSheet(sheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  styleHeader(sheet.getRow(1));
  sheet.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  if (sheet.actualColumnCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.actualColumnCount } };
  }
}

async function main() {
  const collectedBook = new ExcelJS.Workbook();
  const auditBook = new ExcelJS.Workbook();
  await Promise.all([collectedBook.xlsx.readFile(COLLECTED_PATH), auditBook.xlsx.readFile(AUDIT_PATH)]);

  const collectedSheet = collectedBook.getWorksheet("监测清单");
  const auditSheet = auditBook.getWorksheet("37条历史样本核验");
  if (!collectedSheet || !auditSheet) throw new Error("输入工作簿缺少预期工作表");

  const collectedRows = rowsFromSheet(collectedSheet);
  const historyRows = rowsFromSheet(auditSheet);
  const awards = dedupeAwards(historyRows);
  const projectCount = new Set(awards.map(projectKey)).size;
  const strictOfficialAwards = awards.filter((row) => row._strictOfficial);
  const traceableOfficialAwards = awards.filter((row) => row._traceableOfficial);
  const automaticAwards = awards.filter((row) => row._automaticallyMatched);
  const automaticProjects = new Set(automaticAwards.map(projectKey)).size;

  const collectedPrograms = new Set(collectedRows.map(canonicalCollectedProgram));
  const collectedBusinessOpportunities = new Set(
    [...collectedPrograms].map(collectedBusinessKey),
  );

  const primary = aggregateOperators(awards);
  const strictOfficial = aggregateOperators(strictOfficialAwards);
  const traceableOfficial = aggregateOperators(traceableOfficialAwards);
  const city = aggregateSegments(awards, "市州");
  const industry = aggregateSegments(awards, (row) => row._industry);
  const sources = aggregateSegments(awards, (row) => row._sourceCategory);
  const projectSourceRows = [...groupBy(awards, projectKey).values()].map((rows) => ({
    ...rows[0],
    _automaticallyMatched: rows.some((row) => row._automaticallyMatched),
  }));
  const projectSources = [...groupBy(projectSourceRows, (row) => row._sourceCategory).entries()]
    .map(([name, rows]) => ({
      name,
      projects: rows.length,
      automaticallyMatchedProjects: rows.filter((row) => row._automaticallyMatched).length,
    }))
    .sort((a, b) => b.projects - a.projects || a.name.localeCompare(b.name, "zh-CN"));

  const dates = collectedRows.map((row) => row["发布日期"].slice(0, 10)).filter(Boolean).sort();
  const purchaseRows = collectedRows.filter((row) => row["采购阶段"] === "采购公告");
  const resultRows = collectedRows.filter((row) => row["采购阶段"] === "结果");
  const contractRows = collectedRows.filter((row) => row["采购阶段"] === "合同");
  const collectedSummary = {
    announcementRows: collectedRows.length,
    programs: collectedPrograms.size,
    businessOpportunities: collectedBusinessOpportunities.size,
    dateMin: dates.at(0) ?? null,
    dateMax: dates.at(-1) ?? null,
    relevance: countsBy(collectedRows, "相关性判断"),
    stages: countsBy(collectedRows, "采购阶段"),
    sources: countsBy(collectedRows, "来源平台", true),
    fieldCompleteness: {
      buyer: countNonEmpty(collectedRows, "采购人"),
      projectNumber: countNonEmpty(collectedRows, "项目编号"),
      budgetCny: countNonEmpty(collectedRows, "预算折合元"),
      documentDeadline: countNonEmpty(collectedRows, "获取文件截止（最新）"),
      responseDeadline: countNonEmpty(collectedRows, "投标/响应截止（最新）"),
      awardAmount: countNonEmpty(collectedRows, "中标/成交金额"),
      awardAmountUnitMislabelledAsSupplier: countNonEmpty(collectedRows, "中标/成交单位"),
      awardSupplierField: 0,
    },
    stageFieldCompleteness: {
      purchaseAnnouncements: {
        rows: purchaseRows.length,
        budgetCny: countNonEmpty(purchaseRows, "预算折合元"),
        ceilingCny: countNonEmpty(purchaseRows, "最高限价折合元"),
        documentDeadline: countNonEmpty(purchaseRows, "获取文件截止（最新）"),
        responseDeadline: countNonEmpty(purchaseRows, "投标/响应截止（最新）"),
      },
      results: {
        rows: resultRows.length,
        awardAmount: countNonEmpty(resultRows, "中标/成交金额"),
        budgetCny: countNonEmpty(resultRows, "预算折合元"),
      },
      contracts: {
        rows: contractRows.length,
        awardAmount: countNonEmpty(contractRows, "中标/成交金额"),
        budgetCny: countNonEmpty(contractRows, "预算折合元"),
      },
    },
  };

  const summary = {
    preparedAt: "2026-11-24",
    inputs: {
      collected: path.relative(ROOT, COLLECTED_PATH),
      audit: path.relative(ROOT, AUDIT_PATH),
    },
    history: {
      rawRecords: historyRows.length,
      dedupedAwardRecords: awards.length,
      distinctProjects: projectCount,
      duplicatesRemoved: historyRows.length - awards.length,
      primary,
      strictOfficial: {
        records: strictOfficialAwards.length,
        projects: new Set(strictOfficialAwards.map(projectKey)).size,
        ...strictOfficial,
      },
      traceableOfficial: {
        records: traceableOfficialAwards.length,
        projects: new Set(traceableOfficialAwards.map(projectKey)).size,
        ...traceableOfficial,
      },
      automaticallyMatched: {
        rawRecords: historyRows.filter((row) => row["核验状态"] === "官网原文已定位（自动）").length,
        awardRecords: automaticAwards.length,
        projects: automaticProjects,
        awardCoverage: automaticAwards.length / awards.length,
        projectCoverage: automaticProjects / projectCount,
        strictOfficialAwardCoverage:
          automaticAwards.filter((row) => row._strictOfficial).length / strictOfficialAwards.length,
      },
      city,
      industry,
      sourceCategories: sources,
      projectSourceCategories: projectSources,
    },
    collected: collectedSummary,
    interpretationLimits: [
      "集团清单只记录中标/合同结果，不含四川电信是否发现、参投或弃标，不能据此计算参投率、弃标率或投标中标率。",
      "集团清单的0金额按未披露处理，不进入金额份额分母。",
      "自采表是公告粒度，包含多阶段和镜像；市场分析需先合并为项目和标包。",
      "自采表的“中标/成交单位”实际存放金额单位（元/万元），不是中标供应商；当前不存在供应商字段。",
    ],
  };

  await writeFile(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const output = new ExcelJS.Workbook();
  output.creator = "5G定制网招标信息监测工具";
  output.created = new Date("2026-11-24T00:00:00+08:00");

  const key = output.addWorksheet("关键指标");
  key.columns = [
    { header: "主题", key: "topic", width: 20 },
    { header: "指标", key: "metric", width: 36 },
    { header: "值", key: "value", width: 18 },
    { header: "分母/口径", key: "definition", width: 72 },
  ];
  const mobile = primary.operators["移动"];
  const telecom = primary.operators["电信"];
  const unicom = primary.operators["联通"];
  const keyRows = [
    ["集团清单", "原始记录", historyRows.length, "集团提供的四川2026年结果/合同行"],
    ["集团清单", "去重后授标/标包记录", awards.length, "去除港投重复记录、资中结果/合同阶段重复；甘孜两个标包分别保留"],
    ["集团清单", "采购项目数", projectCount, "同一项目不同中标标包合并到项目层"],
    ["竞争结果", "移动记录份额", mobile.recordShare, `${mobile.records}/${primary.totalRecords}`],
    ["竞争结果", "电信记录份额", telecom.recordShare, `${telecom.records}/${primary.totalRecords}`],
    ["竞争结果", "联通记录份额", unicom.recordShare, `${unicom.records}/${primary.totalRecords}`],
    ["竞争结果", "已披露金额合计（元）", primary.totalKnownAmount, `${Object.values(primary.operators).reduce((s, x) => s + x.knownAmountRecords, 0)}/${primary.totalRecords}条有正金额；0按未披露`],
    ["竞争结果", "电信已披露金额份额", telecom.knownAmountShare, `${telecom.knownAmount.toFixed(0)}/${primary.totalKnownAmount.toFixed(0)}元`],
    ["发现覆盖", "集团去重授标自动匹配率", automaticAwards.length / awards.length, `${automaticAwards.length}/${awards.length}；按日期±3天和标题相似度自动匹配现有数据库`],
    ["发现覆盖", "集团项目自动匹配率", automaticProjects / projectCount, `${automaticProjects}/${projectCount}`],
    ["自采清单", "公告记录", collectedRows.length, "公告粒度，不等于项目数"],
    ["自采清单", "采购程序", collectedPrograms.size, "按项目编号和语义归并镜像/阶段"],
    ["自采清单", "业务机会", collectedBusinessOpportunities.size, "进一步合并一次终止重招"],
    ["自采清单", "明确相关", collectedSummary.relevance["明确相关"] ?? 0, "公告记录口径"],
    ["自采清单", "待核实", collectedSummary.relevance["待核实"] ?? 0, "公告记录口径"],
    ["自采清单", "有响应截止时间", collectedSummary.fieldCompleteness.responseDeadline, `${collectedSummary.fieldCompleteness.responseDeadline}/${collectedRows.length}`],
    ["自采清单", "有中标供应商字段", 0, "当前字段缺失；“中标/成交单位”实际是金额单位"],
  ];
  for (const [topic, metric, value, definition] of keyRows) key.addRow({ topic, metric, value, definition });
  for (let row = 2; row <= key.actualRowCount; row += 1) {
    const metric = key.getCell(row, 2).text;
    if (/份额|匹配率/.test(metric)) key.getCell(row, 3).numFmt = "0.0%";
    if (/金额/.test(metric) && !/份额/.test(metric)) key.getCell(row, 3).numFmt = "#,##0";
  }
  finishSheet(key);

  const awardSheet = output.addWorksheet("集团35条去重授标");
  awardSheet.columns = [
    { header: "原表行", key: "sourceRows", width: 12 },
    { header: "市州", key: "city", width: 16 },
    { header: "日期", key: "date", width: 12 },
    { header: "项目名称", key: "title", width: 58 },
    { header: "招标单位", key: "buyer", width: 34 },
    { header: "中标运营商", key: "operator", width: 12 },
    { header: "原清单金额（元）", key: "amount", width: 18 },
    { header: "金额是否披露", key: "amountKnown", width: 14 },
    { header: "行业（分析分类）", key: "industry", width: 16 },
    { header: "项目编号", key: "projectNumber", width: 28 },
    { header: "核验状态", key: "status", width: 26 },
    { header: "证据网站/平台", key: "source", width: 30 },
    { header: "来源层级（分析分类）", key: "sourceCategory", width: 26 },
    { header: "现有采集自动匹配", key: "auto", width: 18 },
    { header: "去重说明", key: "dedupe", width: 28 },
  ];
  for (const row of awards.sort((a, b) => a._row - b._row)) {
    awardSheet.addRow({
      sourceRows: row._sourceRows.join("/"),
      city: row["市州"],
      date: row["原清单日期"],
      title: row["原清单项目名称"],
      buyer: row["原清单招标单位"],
      operator: row["原清单中标单位"],
      amount: row._knownAmount ?? "未披露",
      amountKnown: row._knownAmount === null ? "否" : "是",
      industry: row._industry,
      projectNumber: row["项目编号"],
      status: row["核验状态"],
      source: row["核验证据网站/平台"],
      sourceCategory: row._sourceCategory,
      auto: row._automaticallyMatched ? "是" : "否",
      dedupe: row._duplicateCount > 1 ? `合并原表${row._duplicateCount}行` : "无",
    });
  }
  for (let row = 2; row <= awardSheet.actualRowCount; row += 1) {
    if (typeof awardSheet.getCell(row, 7).value === "number") awardSheet.getCell(row, 7).numFmt = "#,##0";
  }
  finishSheet(awardSheet);

  for (const [sheetName, data, segmentLabel] of [
    ["地市与运营商", city, "地市"],
    ["行业与运营商", industry, "行业（分析分类）"],
  ]) {
    const sheet = output.addWorksheet(sheetName);
    sheet.columns = [
      { header: segmentLabel, key: "segment", width: 22 },
      { header: "总记录", key: "total", width: 12 },
      { header: "移动", key: "mobile", width: 12 },
      { header: "电信", key: "telecom", width: 12 },
      { header: "联通", key: "unicom", width: 12 },
      { header: "电信记录份额", key: "telecomShare", width: 16 },
      { header: "已披露金额合计（元）", key: "knownAmount", width: 22 },
      { header: "电信已披露金额（元）", key: "telecomAmount", width: 22 },
    ];
    for (const item of data) {
      const op = item.operators;
      sheet.addRow({
        segment: item.name,
        total: item.totalRecords,
        mobile: op["移动"]?.records ?? 0,
        telecom: op["电信"]?.records ?? 0,
        unicom: op["联通"]?.records ?? 0,
        telecomShare: (op["电信"]?.records ?? 0) / item.totalRecords,
        knownAmount: item.totalKnownAmount,
        telecomAmount: op["电信"]?.knownAmount ?? 0,
      });
    }
    for (let row = 2; row <= sheet.actualRowCount; row += 1) {
      sheet.getCell(row, 6).numFmt = "0.0%";
      sheet.getCell(row, 7).numFmt = "#,##0";
      sheet.getCell(row, 8).numFmt = "#,##0";
    }
    finishSheet(sheet);
  }

  const sourceSheet = output.addWorksheet("信息源缺口");
  sourceSheet.columns = [
    { header: "来源层级", key: "category", width: 30 },
    { header: "去重授标记录", key: "records", width: 18 },
    { header: "记录占比", key: "share", width: 14 },
    { header: "采购项目", key: "projects", width: 14 },
    { header: "现有采集命中项目", key: "matchedProjects", width: 20 },
    { header: "已披露金额记录", key: "knownRecords", width: 18 },
    { header: "已披露金额（元）", key: "amount", width: 20 },
    { header: "建议", key: "action", width: 68 },
  ];
  const sourceActions = {
    "已接入固定平台": "继续稳定运行，补罗江智慧园区等关键词/检索漏项，并提升详情与附件解析。",
    "集团/企业采购平台": "按金额与频次优先接入港投、国投、鞍钢、东方电气、大唐、国网等平台。",
    "市场化发布平台": "补充四川招投标网等发布渠道，并继续反查是否存在更权威的原始采购平台。",
    "采购人官网长尾": "不计入正式平台覆盖；对重点客户建立官网订阅和客户经理人工回填，覆盖院内小额/邀请比选。",
    "原始平台未识别": "48小时内反查发布链路；无法确认时保留线索但不纳入正式平台成功率。",
  };
  for (const item of sources) {
    const projectItem = projectSources.find((candidate) => candidate.name === item.name);
    sourceSheet.addRow({
      category: item.name,
      records: item.totalRecords,
      share: item.totalRecords / awards.length,
      projects: projectItem?.projects ?? 0,
      matchedProjects: projectItem?.automaticallyMatchedProjects ?? 0,
      knownRecords: Object.values(item.operators).reduce((sum, op) => sum + op.knownAmountRecords, 0),
      amount: item.totalKnownAmount,
      action: sourceActions[item.name],
    });
  }
  for (let row = 2; row <= sourceSheet.actualRowCount; row += 1) {
    sourceSheet.getCell(row, 3).numFmt = "0.0%";
    sourceSheet.getCell(row, 7).numFmt = "#,##0";
  }
  finishSheet(sourceSheet);

  const collectedOverview = output.addWorksheet("自采数据概况");
  collectedOverview.columns = [
    { header: "类别", key: "category", width: 24 },
    { header: "项目", key: "item", width: 36 },
    { header: "数量", key: "count", width: 12 },
    { header: "说明", key: "note", width: 74 },
  ];
  collectedOverview.addRows([
    { category: "粒度", item: "公告记录", count: collectedRows.length, note: "混合采购公告、结果、合同、验收和镜像" },
    { category: "粒度", item: "采购程序", count: collectedPrograms.size, note: "按项目编号和标题语义合并" },
    { category: "粒度", item: "业务机会", count: collectedBusinessOpportunities.size, note: "将一次终止重招进一步合并" },
    { category: "字段完整性", item: "项目编号", count: collectedSummary.fieldCompleteness.projectNumber, note: `占${(collectedSummary.fieldCompleteness.projectNumber / collectedRows.length * 100).toFixed(1)}%` },
    { category: "字段完整性", item: "预算折合元", count: collectedSummary.fieldCompleteness.budgetCny, note: `占${(collectedSummary.fieldCompleteness.budgetCny / collectedRows.length * 100).toFixed(1)}%` },
    { category: "字段完整性", item: "获取文件截止", count: collectedSummary.fieldCompleteness.documentDeadline, note: `占${(collectedSummary.fieldCompleteness.documentDeadline / collectedRows.length * 100).toFixed(1)}%` },
    { category: "字段完整性", item: "投标/响应截止", count: collectedSummary.fieldCompleteness.responseDeadline, note: `占${(collectedSummary.fieldCompleteness.responseDeadline / collectedRows.length * 100).toFixed(1)}%` },
    { category: "字段完整性", item: "中标/成交金额", count: collectedSummary.fieldCompleteness.awardAmount, note: "仅两条，且当前主表没有中标供应商字段" },
  ]);
  for (const [name, count] of Object.entries(collectedSummary.relevance)) {
    collectedOverview.addRow({ category: "相关性", item: name, count, note: "公告记录口径" });
  }
  for (const [name, count] of Object.entries(collectedSummary.stages)) {
    collectedOverview.addRow({ category: "采购阶段", item: name, count, note: "公告记录口径" });
  }
  for (const [name, count] of Object.entries(collectedSummary.sources)) {
    collectedOverview.addRow({ category: "来源平台", item: name, count, note: "一条公告可有多个平台，故不可相加为总数" });
  }
  finishSheet(collectedOverview);

  const mechanism = output.addWorksheet("指标与机制");
  mechanism.columns = [
    { header: "类型", key: "type", width: 16 },
    { header: "名称/代码", key: "name", width: 26 },
    { header: "定义/公式", key: "definition", width: 66 },
    { header: "考核建议", key: "advice", width: 54 },
  ];
  const mechanismRows = [
    ["过程指标", "截止前发现率", "截止前发现的可核实公开项目÷事后核实的可核实公开项目", "省公司监测团队负责；按月与集团清单回溯"],
    ["过程指标", "首次发现时延", "首次发现时间－公告发布时间，报告中位数和P90", "避免只看平均数掩盖严重迟报"],
    ["过程指标", "按时研判率", "SLA内形成参投建议的明确相关机会÷明确相关机会", "地市与省行业团队共同负责"],
    ["参投指标", "有效参投率", "实际递交标包÷经批准参投标包", "不以全部公开公告为分母"],
    ["弃标指标", "可避免弃标率", "晚发现、无人认领、内审超时、材料失败等未参投÷可参投标包", "只考核可控原因；合理不参投单列"],
    ["结果指标", "投标中标率", "中标标包÷已有结果的实际递交标包", "必须有内部参投数据后再启用"],
    ["结果指标", "金额中标份额", "电信已披露中标额÷三家已披露中标额", "同时报告金额披露覆盖率；0视为未知"],
    ["对账指标", "集团清单提前捕获率", "本地在截止前已发现的集团项目÷可追溯采购公告的集团项目", "集团结果清单用于回溯，不直接当弃标分母"],
    ["原因码", "N02 监测漏项", "首次发现时已截止", "归监测侧，不计地市弃标"],
    ["原因码", "N03 不可参投", "直接采购或无公开参投入口", "从可参投分母剔除"],
    ["原因码", "N04 资格不符", "强制资格不满足且无合法合作方案", "证据齐全后从可参投分母剔除"],
    ["原因码", "R01-R04 合理不参投", "利润、合同、交付或战略资源原因，经审批", "单列，不与可避免弃标混合"],
    ["原因码", "A01-A04 可避免弃标", "无人认领、审批慢、标书失败、客户前置覆盖不足", "纳入改进与责任复盘"],
    ["原因码", "U01 原因不明", "应决策项目未形成原因和证据", "限时补齐并单列数据质量"],
  ];
  for (const [type, name, definition, advice] of mechanismRows) mechanism.addRow({ type, name, definition, advice });
  finishSheet(mechanism);

  await output.xlsx.writeFile(OUTPUT_XLSX);
  console.log(JSON.stringify({ outputXlsx: OUTPUT_XLSX, outputJson: OUTPUT_JSON, summary }, null, 2));
}

await main();

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ParsedNotice,
  ProviderOutcome,
  RunStatus,
  SourceKey,
  StoredNotice,
} from "./types.js";

type Row = Record<string, string | number | null>;

const SICHUAN_DEDICATED_SOURCES = new Set<SourceKey>([
  "sichuanccgp",
  "sichuanggzy",
  "chinatelecom",
  "tianfu",
  "scenergy",
  // buyer-sites.json只登记四川采购人官网。
  "buyersite",
]);

const SICHUAN_PLACE_PATTERN =
  /四川|成都|自贡|攀枝花|泸州|德阳|绵阳|广元|遂宁|内江|乐山|南充|眉山|宜宾|广安|达州|雅安|巴中|资阳|阿坝|甘孜|凉山/;
const EXPLICIT_PROVINCE_PATTERN =
  /北京市|天津市|上海市|重庆市|[\u4e00-\u9fff]{2,12}省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区/;
const PREFECTURE_PATTERN = /[\u4e00-\u9fff]{2,16}(?:市|自治州|地区|盟)/;

export interface ProvinceScopeNotice {
  sourceKey: SourceKey;
  region: string | null;
  title: string;
  buyer: string | null;
}

export function isNoticeWithinProvinceScope(notice: ProvinceScopeNotice, province: string): boolean {
  if (province !== "四川省") return true;
  if (SICHUAN_DEDICATED_SOURCES.has(notice.sourceKey)) return true;

  const region = notice.region?.normalize("NFKC").trim() ?? "";
  if (SICHUAN_PLACE_PATTERN.test(region) || region === "省本级") return true;
  if (EXPLICIT_PROVINCE_PATTERN.test(region) || PREFECTURE_PATTERN.test(region)) return false;

  // 国家站按四川地区检索时常只返回“某县/某区”，这类结果没有外省证据，予以保留。
  if (region) return true;

  // 地区完全缺失时不再无条件相信国家站的四川提示，要求标题或采购人提供四川证据。
  return SICHUAN_PLACE_PATTERN.test(`${notice.title} ${notice.buyer ?? ""}`);
}

export class MonitorDatabase {
  readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        as_of TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        days INTEGER NOT NULL,
        region_scope TEXT NOT NULL DEFAULT '全国',
        candidates_discovered INTEGER NOT NULL DEFAULT 0,
        detail_fetch_succeeded INTEGER NOT NULL DEFAULT 0,
        detail_fetch_failed INTEGER NOT NULL DEFAULT 0,
        included_count INTEGER NOT NULL DEFAULT 0,
        pending_count INTEGER NOT NULL DEFAULT 0,
        excluded_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        output_path TEXT,
        error_text TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        provider TEXT NOT NULL,
        source_platform TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        queries_attempted INTEGER NOT NULL,
        pages_attempted INTEGER NOT NULL,
        candidates_found INTEGER NOT NULL,
        error_text TEXT
      );

      CREATE TABLE IF NOT EXISTS source_status (
        provider TEXT PRIMARY KEY,
        source_platform TEXT NOT NULL,
        scope TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT,
        last_status TEXT NOT NULL,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL DEFAULT 'ccgp',
        source_platform TEXT NOT NULL,
        source_url TEXT NOT NULL,
        origin_url TEXT,
        document_id TEXT NOT NULL,
        title TEXT NOT NULL,
        buyer TEXT,
        region TEXT,
        province TEXT,
        region_code TEXT,
        project_number TEXT,
        lot_number TEXT NOT NULL DEFAULT '',
        procurement_content TEXT,
        content_category TEXT NOT NULL,
        notice_type TEXT NOT NULL,
        stage TEXT NOT NULL,
        procurement_method TEXT,
        publish_at TEXT,
        budget_amount REAL,
        budget_unit TEXT,
        budget_cny REAL,
        ceiling_amount REAL,
        ceiling_unit TEXT,
        ceiling_cny REAL,
        award_amount REAL,
        award_unit TEXT,
        award_cny REAL,
        acquisition_start TEXT,
        acquisition_deadline TEXT,
        submission_deadline TEXT,
        relevance TEXT NOT NULL,
        relevance_reason TEXT NOT NULL,
        evidence_quote TEXT,
        attachment_status TEXT NOT NULL,
        attachment_names_json TEXT NOT NULL,
        related_original_url TEXT,
        discovery_method TEXT NOT NULL,
        discovery_query TEXT NOT NULL,
        discovery_scope TEXT NOT NULL,
        is_known_sample INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_seen_run_id INTEGER NOT NULL REFERENCES runs(id),
        UNIQUE(source_url, lot_number)
      );

      CREATE INDEX IF NOT EXISTS idx_notices_publish_at ON notices(publish_at);
      CREATE INDEX IF NOT EXISTS idx_notices_project_number ON notices(project_number);
      CREATE INDEX IF NOT EXISTS idx_notices_relevance ON notices(relevance);
    `);
    this.ensureColumn("runs", "region_scope", "TEXT NOT NULL DEFAULT '全国'");
    this.ensureColumn("notices", "source_key", "TEXT NOT NULL DEFAULT 'ccgp'");
    this.ensureColumn("notices", "origin_url", "TEXT");
    this.ensureColumn("notices", "province", "TEXT");
    this.ensureColumn("notices", "region_code", "TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_notices_province ON notices(province)");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  startRun(input: {
    startedAt: string;
    asOf: string;
    windowStart: string;
    windowEnd: string;
    days: number;
    regionScope: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO runs (started_at, status, as_of, window_start, window_end, days, region_scope)
         VALUES (?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(input.startedAt, input.asOf, input.windowStart, input.windowEnd, input.days, input.regionScope);
    return Number(result.lastInsertRowid);
  }

  saveProviderOutcome(runId: number, outcome: ProviderOutcome): void {
    this.db
      .prepare(
        `INSERT INTO provider_runs (
          run_id, provider, source_platform, scope, status, started_at, finished_at,
          queries_attempted, pages_attempted, candidates_found, error_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        outcome.provider,
        outcome.sourcePlatform,
        outcome.scope,
        outcome.status,
        outcome.startedAt,
        outcome.finishedAt,
        outcome.queriesAttempted,
        outcome.pagesAttempted,
        outcome.candidatesFound,
        outcome.error,
      );

    const successful = outcome.status === "success" || outcome.status === "success_zero";
    this.db
      .prepare(
        `INSERT INTO source_status (
          provider, source_platform, scope, last_attempt_at, last_success_at, last_status, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          source_platform = excluded.source_platform,
          scope = excluded.scope,
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = CASE
            WHEN excluded.last_success_at IS NOT NULL THEN excluded.last_success_at
            ELSE source_status.last_success_at
          END,
          last_status = excluded.last_status,
          last_error = excluded.last_error`,
      )
      .run(
        outcome.provider,
        outcome.sourcePlatform,
        outcome.scope,
        outcome.finishedAt,
        successful ? outcome.finishedAt : null,
        outcome.status,
        outcome.error,
      );
  }

  upsertNotice(runId: number, notice: ParsedNotice): "inserted" | "updated" | "unchanged" {
    const existing = this.db
      .prepare("SELECT id, content_hash FROM notices WHERE source_url = ? AND lot_number = ?")
      .get(notice.sourceUrl, notice.lotNumber) as Row | undefined;
    const now = notice.fetchedAt;

    this.db
      .prepare(
        `INSERT INTO notices (
          source_key, source_platform, source_url, origin_url, document_id, title, buyer, region,
          province, region_code, project_number,
          lot_number, procurement_content, content_category, notice_type, stage,
          procurement_method, publish_at, budget_amount, budget_unit, budget_cny,
          ceiling_amount, ceiling_unit, ceiling_cny, award_amount, award_unit, award_cny,
          acquisition_start, acquisition_deadline, submission_deadline, relevance,
          relevance_reason, evidence_quote, attachment_status, attachment_names_json,
          related_original_url, discovery_method, discovery_query, discovery_scope,
          is_known_sample, fetched_at, content_hash, first_seen_at, last_seen_at, last_seen_run_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(source_url, lot_number) DO UPDATE SET
          source_key = excluded.source_key,
          source_platform = excluded.source_platform,
          origin_url = excluded.origin_url,
          document_id = excluded.document_id,
          title = excluded.title,
          buyer = excluded.buyer,
          region = excluded.region,
          province = excluded.province,
          region_code = excluded.region_code,
          project_number = excluded.project_number,
          procurement_content = excluded.procurement_content,
          content_category = excluded.content_category,
          notice_type = excluded.notice_type,
          stage = excluded.stage,
          procurement_method = excluded.procurement_method,
          publish_at = excluded.publish_at,
          budget_amount = excluded.budget_amount,
          budget_unit = excluded.budget_unit,
          budget_cny = excluded.budget_cny,
          ceiling_amount = excluded.ceiling_amount,
          ceiling_unit = excluded.ceiling_unit,
          ceiling_cny = excluded.ceiling_cny,
          award_amount = excluded.award_amount,
          award_unit = excluded.award_unit,
          award_cny = excluded.award_cny,
          acquisition_start = excluded.acquisition_start,
          acquisition_deadline = excluded.acquisition_deadline,
          submission_deadline = excluded.submission_deadline,
          relevance = excluded.relevance,
          relevance_reason = excluded.relevance_reason,
          evidence_quote = excluded.evidence_quote,
          attachment_status = excluded.attachment_status,
          attachment_names_json = excluded.attachment_names_json,
          related_original_url = COALESCE(excluded.related_original_url, notices.related_original_url),
          discovery_method = excluded.discovery_method,
          discovery_query = excluded.discovery_query,
          discovery_scope = excluded.discovery_scope,
          is_known_sample = MAX(notices.is_known_sample, excluded.is_known_sample),
          fetched_at = excluded.fetched_at,
          content_hash = excluded.content_hash,
          last_seen_at = excluded.last_seen_at,
          last_seen_run_id = excluded.last_seen_run_id`,
      )
      .run(
        notice.sourceKey,
        notice.sourcePlatform,
        notice.sourceUrl,
        notice.originUrl,
        notice.documentId,
        notice.title,
        notice.buyer,
        notice.region,
        notice.province,
        notice.regionCode,
        notice.projectNumber,
        notice.lotNumber,
        notice.procurementContent,
        notice.contentCategory,
        notice.noticeType,
        notice.stage,
        notice.procurementMethod,
        notice.publishAt,
        notice.budget.amount,
        notice.budget.unit,
        notice.budget.cny,
        notice.ceiling.amount,
        notice.ceiling.unit,
        notice.ceiling.cny,
        notice.award.amount,
        notice.award.unit,
        notice.award.cny,
        notice.acquisitionStart,
        notice.acquisitionDeadline,
        notice.submissionDeadline,
        notice.relevance,
        notice.relevanceReason,
        notice.evidenceQuote,
        notice.attachmentStatus,
        JSON.stringify(notice.attachmentNames),
        notice.relatedOriginalUrl,
        notice.discoveryMethod,
        notice.discoveryQuery,
        notice.discoveryScope,
        notice.isKnownSample ? 1 : 0,
        notice.fetchedAt,
        notice.contentHash,
        now,
        now,
        runId,
      );

    if (!existing) return "inserted";
    return existing.content_hash === notice.contentHash ? "unchanged" : "updated";
  }

  listNotices(windowStart: string, windowEnd: string, province: string): StoredNotice[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notices
         WHERE publish_at IS NOT NULL AND publish_at >= ? AND publish_at <= ? AND province = ?
         ORDER BY publish_at DESC, title, lot_number`,
      )
      .all(windowStart, windowEnd, province) as Row[];
    const notices = rows
      .map((row) => this.rowToNotice(row))
      .filter((notice) => isNoticeWithinProvinceScope(notice, province));
    this.applyCorrections(notices);
    return this.consolidateMirrors(notices);
  }

  private applyCorrections(notices: StoredNotice[]): void {
    const groups = new Map<string, StoredNotice[]>();
    for (const notice of notices) {
      if (!notice.projectNumber) continue;
      const key = `${notice.sourceKey}|${notice.projectNumber}`;
      const group = groups.get(key) ?? [];
      group.push(notice);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const corrections = group
        .filter((notice) => notice.stage === "更正/延期")
        .sort((a, b) => Date.parse(a.publishAt ?? "") - Date.parse(b.publishAt ?? ""));
      if (corrections.length === 0) continue;
      const latest = corrections.at(-1);
      if (!latest) continue;
      for (const notice of group) {
        notice.effectiveAcquisitionDeadline = latest.acquisitionDeadline ?? notice.acquisitionDeadline;
        notice.effectiveSubmissionDeadline = latest.submissionDeadline ?? notice.submissionDeadline;
        notice.latestCorrectionUrl = latest.sourceUrl;
        if (notice.stage === "更正/延期" && !notice.relatedOriginalUrl) {
          notice.relatedOriginalUrl =
            group.find((candidate) => candidate.stage !== "更正/延期")?.sourceUrl ?? null;
        }
      }
    }
  }

  private consolidateMirrors(notices: StoredNotice[]): StoredNotice[] {
    const groups = new Map<string, StoredNotice[]>();
    for (const notice of notices) {
      const normalizedTitle = notice.title.replace(/[\s“”"'（）()]/g, "").replace(/(?:招标|采购|结果|成交|中标)公告.*$/, "");
      const key = notice.projectNumber
        ? `project|${notice.projectNumber}|${notice.stage}|${notice.lotNumber}`
        : `title|${normalizedTitle}|${notice.publishAt?.slice(0, 10) ?? ""}|${notice.lotNumber}`;
      const group = groups.get(key) ?? [];
      group.push(notice);
      groups.set(key, group);
    }

    const score = (notice: StoredNotice): number => {
      const sourceScore = notice.sourceKey === "sichuanccgp"
        ? 40
        : notice.sourceKey === "ccgp"
          ? 30
          : notice.sourceKey === "sichuanggzy"
            ? 25
          : notice.sourceKey === "ggzy"
            ? 20
            : notice.sourceKey === "tianfu" || notice.sourceKey === "scenergy"
              ? 15
              : 10;
      const fieldScore = [notice.buyer, notice.projectNumber, notice.procurementContent, notice.budget.cny,
        notice.acquisitionDeadline, notice.submissionDeadline].filter((value) => value !== null && value !== "").length;
      return sourceScore + fieldScore;
    };

    return [...groups.values()].map((group) => {
      const ordered = [...group].sort((a, b) => score(b) - score(a));
      const primary = ordered[0];
      if (!primary) throw new Error("跨来源合并出现空分组");
      const platforms = [...new Set(group.map((item) => item.sourcePlatform))];
      const methods = [...new Set(group.map((item) => item.discoveryMethod))];
      const scopes = [...new Set(group.map((item) => item.discoveryScope))];
      const links = [...new Set(group.flatMap((item) => [item.sourceUrl, item.originUrl].filter((url): url is string => Boolean(url))))]
        .filter((url) => url !== primary.sourceUrl && url !== primary.originUrl);
      primary.sourcePlatform = platforms.join("；");
      primary.discoveryMethod = methods.join("；");
      primary.discoveryScope = scopes.join("；");
      primary.alternateSourceUrls = links;
      primary.firstSeenAt = group
        .map((item) => item.firstSeenAt)
        .filter(Boolean)
        .sort()[0] ?? primary.firstSeenAt;
      return primary;
    }).sort((a, b) => Date.parse(b.publishAt ?? "") - Date.parse(a.publishAt ?? ""));
  }

  private rowToNotice(row: Row): StoredNotice {
    const text = (key: string): string | null => (typeof row[key] === "string" ? row[key] : null);
    const number = (key: string): number | null => (typeof row[key] === "number" ? row[key] : null);
    return {
      id: Number(row.id),
      sourceKey: (text("source_key") ?? "ccgp") as StoredNotice["sourceKey"],
      sourcePlatform: text("source_platform") ?? "",
      sourceUrl: text("source_url") ?? "",
      originUrl: text("origin_url"),
      documentId: text("document_id") ?? "",
      title: text("title") ?? "",
      buyer: text("buyer"),
      region: text("region"),
      province: text("province"),
      regionCode: text("region_code"),
      projectNumber: text("project_number"),
      lotNumber: text("lot_number") ?? "",
      procurementContent: text("procurement_content"),
      contentCategory: text("content_category") ?? "",
      noticeType: text("notice_type") ?? "",
      stage: text("stage") ?? "",
      procurementMethod: text("procurement_method"),
      publishAt: text("publish_at"),
      budget: { amount: number("budget_amount"), unit: text("budget_unit"), cny: number("budget_cny") },
      ceiling: { amount: number("ceiling_amount"), unit: text("ceiling_unit"), cny: number("ceiling_cny") },
      award: { amount: number("award_amount"), unit: text("award_unit"), cny: number("award_cny") },
      acquisitionStart: text("acquisition_start"),
      acquisitionDeadline: text("acquisition_deadline"),
      submissionDeadline: text("submission_deadline"),
      relevance: (text("relevance") ?? "待核实") as StoredNotice["relevance"],
      relevanceReason: text("relevance_reason") ?? "",
      evidenceQuote: text("evidence_quote"),
      attachmentStatus: text("attachment_status") ?? "",
      attachmentNames: JSON.parse(text("attachment_names_json") ?? "[]") as string[],
      relatedOriginalUrl: text("related_original_url"),
      discoveryMethod: text("discovery_method") ?? "",
      discoveryQuery: text("discovery_query") ?? "",
      discoveryScope: text("discovery_scope") ?? "",
      isKnownSample: number("is_known_sample") === 1,
      fetchedAt: text("fetched_at") ?? "",
      contentHash: text("content_hash") ?? "",
      effectiveAcquisitionDeadline: text("acquisition_deadline"),
      effectiveSubmissionDeadline: text("submission_deadline"),
      latestCorrectionUrl: null,
      alternateSourceUrls: [],
      firstSeenAt: text("first_seen_at") ?? "",
    };
  }

  finishRun(input: {
    runId: number;
    finishedAt: string;
    status: RunStatus;
    candidatesDiscovered: number;
    detailFetchSucceeded: number;
    detailFetchFailed: number;
    includedCount: number;
    pendingCount: number;
    excludedCount: number;
    insertedCount: number;
    updatedCount: number;
    outputPath: string | null;
    errors: string[];
  }): void {
    this.db
      .prepare(
        `UPDATE runs SET
          finished_at = ?, status = ?, candidates_discovered = ?, detail_fetch_succeeded = ?,
          detail_fetch_failed = ?, included_count = ?, pending_count = ?, excluded_count = ?,
          inserted_count = ?, updated_count = ?, output_path = ?, error_text = ?
         WHERE id = ?`,
      )
      .run(
        input.finishedAt,
        input.status,
        input.candidatesDiscovered,
        input.detailFetchSucceeded,
        input.detailFetchFailed,
        input.includedCount,
        input.pendingCount,
        input.excludedCount,
        input.insertedCount,
        input.updatedCount,
        input.outputPath,
        input.errors.length ? input.errors.join("\n") : null,
        input.runId,
      );
  }
}

export type RunStatus = "success" | "success_zero" | "partial" | "failed";

export type ProviderStatus = "success" | "success_zero" | "partial" | "failed" | "skipped";

export type Relevance = "明确相关" | "待核实" | "排除";

export type SourceKey =
  | "ccgp"
  | "sichuanccgp"
  | "ggzy"
  | "sichuanggzy"
  | "chinatelecom"
  | "tianfu"
  | "scenergy";

export interface CollectionScope {
  province: string;
  regionCode: string;
  ccgpZoneId: string;
  startDate: string;
}

export interface DiscoveryCandidate {
  sourceKey: SourceKey;
  sourcePlatform: string;
  url: string;
  discoveredBy: string;
  query: string;
  scope: string;
  isKnownSample: boolean;
  provinceHint: string | null;
  regionCodeHint: string | null;
  referer: string | null;
  titleHint: string | null;
  publishAtHint: string | null;
  documentIdHint: string | null;
  metadata: Record<string, string | null>;
}

export interface ProviderOutcome {
  provider: string;
  sourcePlatform: string;
  scope: string;
  status: ProviderStatus;
  startedAt: string;
  finishedAt: string;
  queriesAttempted: number;
  pagesAttempted: number;
  candidatesFound: number;
  error: string | null;
}

export interface MoneyValue {
  amount: number | null;
  unit: string | null;
  cny: number | null;
}

export interface ParsedNotice {
  sourceKey: SourceKey;
  sourcePlatform: string;
  sourceUrl: string;
  originUrl: string | null;
  documentId: string;
  title: string;
  buyer: string | null;
  region: string | null;
  province: string | null;
  regionCode: string | null;
  projectNumber: string | null;
  lotNumber: string;
  procurementContent: string | null;
  contentCategory: string;
  noticeType: string;
  stage: string;
  procurementMethod: string | null;
  publishAt: string | null;
  budget: MoneyValue;
  ceiling: MoneyValue;
  award: MoneyValue;
  acquisitionStart: string | null;
  acquisitionDeadline: string | null;
  submissionDeadline: string | null;
  relevance: Relevance;
  relevanceReason: string;
  evidenceQuote: string | null;
  attachmentStatus: string;
  attachmentNames: string[];
  relatedOriginalUrl: string | null;
  discoveryMethod: string;
  discoveryQuery: string;
  discoveryScope: string;
  isKnownSample: boolean;
  fetchedAt: string;
  contentHash: string;
}

export interface StoredNotice extends ParsedNotice {
  id: number;
  effectiveAcquisitionDeadline: string | null;
  effectiveSubmissionDeadline: string | null;
  latestCorrectionUrl: string | null;
  alternateSourceUrls: string[];
}

export interface RunSummary {
  runId: number;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  asOf: string;
  windowStart: string;
  windowEnd: string;
  days: number;
  regionScope: string;
  candidatesDiscovered: number;
  detailFetchSucceeded: number;
  detailFetchFailed: number;
  includedCount: number;
  pendingCount: number;
  excludedCount: number;
  insertedCount: number;
  updatedCount: number;
  outputPath: string | null;
  databasePath: string;
  providers: ProviderOutcome[];
  errors: string[];
}

export interface KnownSample {
  name: string;
  url: string;
  expected: {
    projectNumber: string;
    buyer: string;
    budgetCny: number;
    acquisitionDeadline: string;
    submissionDeadline: string;
  };
}

export interface SampleValidation {
  sample: KnownSample;
  passed: boolean;
  checks: Array<{
    field: string;
    expected: string | number;
    actual: string | number | null;
    passed: boolean;
  }>;
  notice: ParsedNotice | null;
  error: string | null;
}

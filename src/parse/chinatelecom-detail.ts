import { postJson } from "../http.js";
import { parseCcgpDetail } from "./ccgp-detail.js";
import type { DiscoveryCandidate, ParsedNotice } from "../types.js";

interface TelecomDetailResponse {
  code: number;
  msg?: string;
  data?: {
    announceCode?: string | null;
    announceName?: string | null;
    provinceCode?: string | null;
    announceStartTime?: string | null;
    announceEndTime?: string | null;
    announceContext?: string | null;
    createTime?: string | null;
    business_type?: string | null;
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function fetchAndParseChinaTelecom(candidate: DiscoveryCandidate): Promise<ParsedNotice[]> {
  const docTypeCode = candidate.metadata.docTypeCode;
  const securityViewCode = candidate.metadata.securityViewCode;
  const docId = candidate.documentIdHint;
  if (!docTypeCode || !securityViewCode || !docId) {
    throw new Error("阳光采购网候选缺少详情请求参数");
  }
  const response = await postJson<TelecomDetailResponse>(
    "https://caigou.chinatelecom.com.cn/portal/base/purchaseannounce/view",
    { type: docTypeCode, id: docId, securityViewCode },
    { retries: 2, referer: candidate.url },
  );
  if (response.code !== 200 || !response.data) {
    throw new Error(`阳光采购网详情接口失败：${response.msg ?? `code=${response.code}`}`);
  }
  const data = response.data;
  const title = data.announceName ?? candidate.titleHint ?? "";
  const publishAt = data.createTime ?? candidate.publishAtHint ?? "";
  const context = data.announceContext ?? "";
  const syntheticHtml = `<!doctype html><html><body>
    <div class="vF_detail_header"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(publishAt)}</span></div>
    <div class="vF_detail_content">${context}</div>
  </body></html>`;
  const notices = parseCcgpDetail(syntheticHtml, candidate);
  for (const notice of notices) {
    const rawMethod = data.business_type ?? candidate.metadata.docType;
    notice.procurementMethod = rawMethod && !/Basic$/i.test(rawMethod)
      ? rawMethod.replace(/公告|公示/g, "")
      : "直接采购";
    if (notice.attachmentNames.length === 0 && /详见.*(?:技术规范书|采购文件|附件)/.test(context)) {
      notice.attachmentStatus = "未读取（相关要求在技术规范书或采购文件）";
    }
  }
  return notices;
}

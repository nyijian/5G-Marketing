import type { Relevance } from "./types.js";

export interface Classification {
  relevance: Relevance;
  reason: string;
  category: string;
  evidence: string | null;
}

const PRIVATE_NETWORK_PATTERN =
  /5\s*G\s*(?:定制网|工控专网|无线生产网络|工厂专网|企业专网|商企专网|无线专网|双域专网|行业专网|数字专网|移动警务专网|可信专网|加密专网|软切片专网|融合双域专网|融合专网|卫生专网|物联专网|定制专用网络|专用网络|专网)/i;
const FLEXIBLE_PRIVATE_PATTERN =
  /5\s*G.{0,28}(?:定制网|双域专网|行业专网|数字专网|移动警务专网|专用网络|专网)/i;
const NETWORK_ALIAS_PATTERN =
  /(?:工业\s*5\s*G\s*网络|专有\s*5\s*G\s*网络|5\s*G\s*(?:无线)?生产网络(?:传输)?|双域专网|软切片专网|定制网切片专线|院内\s*5\s*G\s*内网|井下\s*5\s*G\s*(?:通信|通讯|网络|系统)|(?:地下)?矿山.{0,12}5\s*G\s*(?:通信|通讯|网络|系统))/i;
const WEAK_NETWORK_CLUE_PATTERN =
  /(?:无线生产网络|工控专网|移动医护专网|医疗健康专网|远程医疗专网链路|医疗健康汇聚专线|APN专线|5\s*G.{0,16}(?:无线专线|网络专线|专线))/i;
const CORE_NETWORK_PATTERN = /5\s*G\s*核心(?:网|网络)/i;
const TECHNICAL_PRIVATE_PATTERN =
  /(?:UPF.{0,24}(?:下沉|本地部署|本地分流)|DNN.{0,20}安全汇聚|5\s*G.{0,20}UPF|UPF.{0,20}5\s*G|(?:本地分流|数据不出园区).{0,30}5\s*G|5\s*G.{0,30}(?:本地分流|数据不出园区))/i;
const PERFORMANCE_CONTEXT_PATTERN =
  /(?:供应商|投标人|申请人).{0,90}(?:业绩|案例)|(?:类似项目|成功案例|项目经验|人员业绩)/i;
const TERMINAL_ONLY_PATTERN =
  /(?:5\s*G\s*(?:执法记录仪|联网心电图机|手机|终端|流量卡|布控球|摄像机)|5\s*G\s*新媒体平台)/i;
const INDUSTRY_SCENE_PATTERN =
  /(?:5\s*G\s*)?(?:智慧矿山|智能矿山|无人矿卡|无人驾驶|AGV|移动护士站|移动护理|智慧护理|智慧医学影像|智慧校园|智慧水利|智慧光伏)/i;
const TARGET_DISCOVERY_CLUE_PATTERN =
  /5\s*G.{0,20}(?:智慧医院影像|医疗健康|智慧园区|物联网|智慧办公|信号覆盖|网络建设|网络传输|网络服务|项目运维|农普|网络布局)/i;

function compact(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—―−﹣－]/g, "-")
    .replace(/[／]/g, "/")
    .replace(/\s*([+\-/_])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function privateEvidencePattern(text: string): RegExp {
  if (NETWORK_ALIAS_PATTERN.test(text)) return NETWORK_ALIAS_PATTERN;
  if (PRIVATE_NETWORK_PATTERN.test(text)) return PRIVATE_NETWORK_PATTERN;
  return FLEXIBLE_PRIVATE_PATTERN;
}

function evidenceAround(text: string, pattern: RegExp, radius = 80): string | null {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${compact(text.slice(start, end))}${suffix}`;
}

function isOnlyPerformanceHit(text: string, pattern: RegExp): boolean {
  const hit = pattern.exec(text);
  if (!hit || hit.index === undefined) return false;
  const context = text.slice(Math.max(0, hit.index - 140), Math.min(text.length, hit.index + 180));
  return PERFORMANCE_CONTEXT_PATTERN.test(context);
}

function hitContext(text: string, pattern: RegExp, radius = 170): string {
  const hit = pattern.exec(text);
  if (!hit || hit.index === undefined) return "";
  return text.slice(Math.max(0, hit.index - radius), Math.min(text.length, hit.index + hit[0].length + radius));
}

export function classifyNotice(input: {
  title: string;
  procurementContent: string | null;
  fullText: string;
}): Classification {
  const title = compact(input.title);
  const demand = compact(input.procurementContent ?? "");
  const fullText = compact(input.fullText);
  const titleHasPrivate =
    PRIVATE_NETWORK_PATTERN.test(title)
    || NETWORK_ALIAS_PATTERN.test(title)
    || FLEXIBLE_PRIVATE_PATTERN.test(title);
  const demandHasPrivate =
    PRIVATE_NETWORK_PATTERN.test(demand)
    || NETWORK_ALIAS_PATTERN.test(demand)
    || FLEXIBLE_PRIVATE_PATTERN.test(demand);
  const titleHasCore = CORE_NETWORK_PATTERN.test(title);
  const demandHasCore = CORE_NETWORK_PATTERN.test(demand);
  const hasTechnicalSignal = TECHNICAL_PRIVATE_PATTERN.test(`${demand} ${fullText}`);
  const fullHasPrivate =
    PRIVATE_NETWORK_PATTERN.test(fullText)
    || NETWORK_ALIAS_PATTERN.test(fullText)
    || FLEXIBLE_PRIVATE_PATTERN.test(fullText);
  const fullHasCore = CORE_NETWORK_PATTERN.test(fullText);

  if (titleHasPrivate || demandHasPrivate) {
    const pattern = privateEvidencePattern(titleHasPrivate ? title : demand);
    const evidence = titleHasPrivate
      ? title
      : evidenceAround(demand, pattern) ?? evidenceAround(fullText, pattern);
    const serviceWords = /建设|接入|组网|运营|服务|网络覆盖|专线|安全|运维/.test(`${title} ${demand}`);
    return {
      relevance: "明确相关",
      reason: serviceWords
        ? "标题或采购需求明确采购5G专网、生产网络或相关建设、接入、运营服务"
        : "标题或采购需求明确出现5G专网、生产网络或行业专网名称",
      category: serviceWords ? "客户专网建设/接入/运营" : "5G专网相关采购",
      evidence,
    };
  }

  if (titleHasCore || demandHasCore) {
    const teaching = /教学|实训|实验|科研/.test(`${title} ${demand}`);
    return {
      relevance: "明确相关",
      reason: teaching
        ? "采购5G核心网教学/实训设备，按专网配套口径收录"
        : "采购5G核心网或核心网络平台，按专网配套口径收录",
      category: teaching ? "核心网教学/实训配套" : "核心网/专网配套",
      evidence: titleHasCore
        ? title
        : evidenceAround(demand, CORE_NETWORK_PATTERN) ?? evidenceAround(fullText, CORE_NETWORK_PATTERN),
    };
  }

  if (hasTechnicalSignal) {
    if (!TECHNICAL_PRIVATE_PATTERN.test(demand) && isOnlyPerformanceHit(fullText, TECHNICAL_PRIVATE_PATTERN)) {
      return {
        relevance: "排除",
        reason: "专网技术词仅出现在供应商业绩、案例或项目经验要求中，不代表本次采购内容",
        category: "非专网采购",
        evidence: evidenceAround(fullText, TECHNICAL_PRIVATE_PATTERN),
      };
    }
    return {
      relevance: "明确相关",
      reason: "正文出现UPF下沉、本地分流或数据不出园区等专网技术要求",
      category: "正文技术要求命中",
      evidence: evidenceAround(fullText, TECHNICAL_PRIVATE_PATTERN),
    };
  }

  if (fullHasPrivate || fullHasCore) {
    const pattern = fullHasPrivate ? privateEvidencePattern(fullText) : CORE_NETWORK_PATTERN;
    if (isOnlyPerformanceHit(fullText, pattern)) {
      return {
        relevance: "排除",
        reason: "5G专网仅出现在供应商业绩、案例或项目经验要求中，不代表本次采购内容",
        category: "非专网采购",
        evidence: evidenceAround(fullText, pattern),
      };
    }
    const context = hitContext(fullText, pattern);
    if (/采购需求|采购内容|服务范围|主要标的信息|货物名称|标的名称|包括.{0,120}(?:5\s*G|专网)/i.test(context)) {
      const core = fullHasCore;
      return {
        relevance: "明确相关",
        reason: core
          ? "主要标的信息或货物清单明确包含5G核心网，按专网配套口径收录"
          : "正文的采购内容、服务范围或主要标的信息明确包含5G专网服务",
        category: core ? "核心网/专网配套" : "客户专网建设/接入/运营",
        evidence: evidenceAround(fullText, pattern),
      };
    }
    return {
      relevance: "待核实",
      reason: "正文命中5G专网/核心网，但未能确认位于本次采购需求；需核对正文结构或附件",
      category: "正文弱命中",
      evidence: evidenceAround(fullText, pattern),
    };
  }

  if (TERMINAL_ONLY_PATTERN.test(`${title} ${demand}`)) {
    return {
      relevance: "排除",
      reason: "本次采购仅涉及5G终端、流量卡或应用设备，未发现专网建设/接入/运营要求",
      category: "5G终端/应用（非专网）",
      evidence: evidenceAround(`${title} ${demand}`, TERMINAL_ONLY_PATTERN),
    };
  }

  const weakNetworkText = `${title} ${demand}`;
  const weakNetworkInDemand = WEAK_NETWORK_CLUE_PATTERN.test(weakNetworkText);
  const weakNetworkInFullText = WEAK_NETWORK_CLUE_PATTERN.test(fullText);
  if (weakNetworkInDemand || weakNetworkInFullText) {
    if (!weakNetworkInDemand && isOnlyPerformanceHit(fullText, WEAK_NETWORK_CLUE_PATTERN)) {
      return {
        relevance: "排除",
        reason: "网络别名仅出现在供应商业绩、案例或项目经验要求中，不代表本次采购内容",
        category: "非专网采购",
        evidence: evidenceAround(fullText, WEAK_NETWORK_CLUE_PATTERN),
      };
    }
    return {
      relevance: "待核实",
      reason: "命中专线、医护专网或生产网络别名，但尚缺少5G、切片、UPF等专网证据",
      category: "网络别名线索",
      evidence: evidenceAround(weakNetworkInDemand ? weakNetworkText : fullText, WEAK_NETWORK_CLUE_PATTERN),
    };
  }

  const sceneText = `${title} ${demand}`;
  const scenePattern = INDUSTRY_SCENE_PATTERN.test(sceneText)
    ? INDUSTRY_SCENE_PATTERN
    : TARGET_DISCOVERY_CLUE_PATTERN;
  if (scenePattern.test(sceneText)) {
    return {
      relevance: "待核实",
      reason: "仅命中5G应用或行业场景词，尚未发现专网建设、接入、网络切片或专网运维证据",
      category: "行业场景线索",
      evidence: evidenceAround(sceneText, scenePattern),
    };
  }

  return {
    relevance: "排除",
    reason: "未发现5G定制网、5G专网、核心网或本地分流等本次采购证据",
    category: "非专网采购",
    evidence: null,
  };
}

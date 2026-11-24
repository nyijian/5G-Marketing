# Daily bulletin contract

Read this reference when preparing the Quantum Secure Message “5G市场” bot payload.

## 1. Schedule and cutoff

- Publish at 08:10 Beijing time.
- Recommended collection start: 07:30.
- Freeze reviewed data at 08:05.
- Normal window: `[last_successful_cutoff, current 08:05)`.
- After a failed collection or send, resume from the last successful cutoff; do not switch silently to a 24-hour window.

Use `first_seen_at` for a newly discovered record. An older publication first found in the current run is `补录/迟到发现` and displays both publication and discovery time.

Do not repeat an already sent notice unless a material change occurred. Keep `last_successful_cutoff`, `current_cutoff`, `sent_notice_ids`, `content_hash`, `last_material_change_at`, `last_sent_at` and source status.

## 2. Default sections

1. **今日新增可参机会** — still-open procurement with an open participation route.
2. **结果、合同与重要变更** — candidates, awards, contracts, corrections, extensions, terminations and re-tenders.
3. **未来7天待办节点** — D-1, D-3 and D-7 acquisition or submission deadlines.
4. **政策与市场线索（可选）** — policy, intention and market signals kept separate from tenders.
5. **电信关注与建议动作** — evidence-based suggested action, not an invented internal commitment.
6. **采集状态** — source health and completeness.

## 3. What belongs in “可参机会”

Include only when all are true:

- a procurement announcement such as tender, consultation, inquiry or comparison;
- an open public participation route;
- response deadline has not passed;
- clearly relevant, or strong network evidence was confirmed in the body;
- within Sichuan or the configured region.

Do not put results, contracts, acceptances, terminated notices, designated-supplier direct purchase or scene-only clues into this section.

A direct-purchase notice may appear under market dynamics, explicitly labeled `无公开参投入口`.

## 4. Results and changes

Include award/candidate notices, contracts, corrections, extensions, terminations, failed tenders, new lots and re-tenders.

Use the latest verified correction deadline and retain the original relationship. Never describe a candidate as a final winner.

## 5. Seven-day node list

- Calculate acquisition and submission deadlines separately.
- Sort urgent items by D-1, D-3 and D-7, then exact Beijing timestamp.
- A result, contract or closed direct purchase has no actionable deadline node.
- Display the accurate time alongside the countdown.

## 6. Optional policy and market intelligence

Keep this separate from procurement facts. Include only signals with a plausible Sichuan customer, funding or solution action, such as:

- Sichuan smart-manufacturing or digital-transformation policy;
- procurement intention or early customer signal;
- industrial 5G, private network, RedCap, edge, industrial platform, AI-agent or security developments with a concrete business implication.

Ordinary terminal news, 6G commentary or an out-of-province case needs a clear Sichuan action to appear. Label facts and recommendations separately, and link the original source. A policy or media item is not a procurement opportunity.

## 7. Priority and ordering

- **A / ★:** explicit private network, UPF, local breakout, slicing, dual-domain or industrial private network; still actionable; deadline within seven days or strategically important.
- **B:** clearly relevant with a later deadline or missing budget/qualification details.
- **C / 待核实:** scenario or alias clue without enough network evidence.

Order A deadlines first, then other clear procurement announcements, material corrections, results/contracts and optional policy signals. Reserve `★` for evidence-backed action items.

## 8. Required fields per project

Keep, when applicable:

- project and buyer;
- city;
- method and stage;
- procurement content;
- budget, ceiling, award or contract amount, with `未披露` for missing;
- acquisition and response deadlines with status;
- relevance and evidence quote;
- source platform and official link;
- evidence or attachment caveat.

## 9. “电信关注” guardrails

Every recommendation must point to a project or policy in the bulletin.

Use this pattern:

> **事实：** 项目在11月26日10:00截止。  
> **建议：** 建议属地团队今日完成参投状态、资格和合作伙伴核实。  
> **依据：** 官方平台原文链接。

You may suggest a responsible city or collaboration function from the location and subject. Without internal data, do not claim a team already owns, saw, bid or abandoned the opportunity.

## 10. Source-status wording

- `success`: “本次采集完整完成，共发现×条新增机会。”
- `success_zero`: “本次采集完整完成，今日新增相关机会0条。”
- `partial`: “⚠ 本次采集部分完成：已取得×条有效结果，但×个平台受限、×条详情失败，今日结果可能不完整。”
- `failed`: “❌ 本次采集失败，未形成可靠增量结论；上一次成功截止为××，恢复后补采。”

If the run is not complete at 08:05, send a status warning rather than a false complete bulletin. Existing near-deadline reminders may be retained if clearly identified as stored records.

## 11. Length and overflow

Aim for 1,200–1,800 Chinese characters:

- up to 6 new opportunities;
- up to 5 results or changes;
- up to 6 deadline nodes;
- up to 3 policy or market signals;
- up to 5 suggested actions.

When more exist, say `另有×条普通项目，详见完整清单` and link the full list. Preserve title, money, deadline, judgment and link before background prose.

## 12. Empty day

An empty day is valid only after all required sources completed. Still show stored D-7/D-3/D-1 reminders and source status. A partial day is not an empty day.

## 13. Fixed bot disclosure

Use a compact footer when useful:

> “5G市场”监测四川公开发布的5G定制网、行业专网及配套采购信息。正式招标平台为主要来源，公开搜索和采购人官网用于补充发现和核验。受限来源、附件未读取和证据不足项目会单独标注，日报不代表全网绝对完整。

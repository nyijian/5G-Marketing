---
name: 5g-market-monitor
description: Monitor public 5G private-network procurement and market signals, classify relevance, track source health and lifecycle changes, and produce evidence-backed Sichuan daily digests. Use for tender collection, historical gap audits, source onboarding, or a “5G市场” bot message; do not use external result lists to infer internal bid or abandonment decisions without internal process data.
---

# 5G Market Monitor

## Outcome

Produce a traceable list or daily bulletin of public 5G private-network opportunities. A reader must be able to tell:

- who is buying, where, what is being bought, and at which procurement stage;
- budget, ceiling or award amount without mixing their meanings;
- whether document acquisition and response submission are still open;
- why the item is relevant to a 5G private network;
- which official page supports the record;
- which sources ran successfully, returned zero, were partial, or failed.

Default to Sichuan and Beijing time. Honor another explicit region, period, cutoff or output format.

## Select the operating mode

- **Daily collection or historical audit:** apply the workflow below and read [business rules](references/business-rules.md).
- **Add or evaluate sources:** also read [sources and coverage](references/sources-and-coverage.md).
- **Prepare the 08:10 “5G市场” message:** also read [daily bulletin](references/daily-bulletin.md) and use [the message template](assets/daily-template.md).
- **Extended policy/industry intelligence:** keep policy, technology and media signals separate from confirmed procurement opportunities. Never turn a news item into a procurement project without procurement evidence.

## Core workflow

1. **Set the scope.** Record province, time window, current cutoff and timezone. For a daily run, continue from the last successful cutoff rather than blindly using the last 24 hours.
2. **Read prior state.** Load the sent ledger, source status and stored notices. In this repository, read `README.md`, `config/scope.json`, `config/keywords.json`, `config/source-catalog.json` and `output/latest-run.json` before changing behavior.
3. **Collect formal platforms first.** Search fixed government, public-resource and enterprise procurement platforms. Use public search to discover official pages or new platforms, not as proof of complete platform coverage.
4. **Open the detail page.** Parse the body and enumerate attachments. Search results and titles are candidate discovery only.
5. **Normalize and classify.** Apply the three-way result `明确相关 / 待核实 / 排除`. Keep a short evidence quote and attachment-read status.
6. **Confirm the region.** Do not retain an out-of-scope project merely because a search engine returned it.
7. **Store raw notices and consolidate views.** Preserve separate stages and lots. Merge mirrors only at the reporting layer and retain alternate official links.
8. **Apply corrections.** Associate corrections by project number and use the latest verified acquisition and response deadlines while preserving the original and correction URLs.
9. **Compute the increment.** New items use `first_seen_at`; old notices found late are “补录/迟到发现”. Republish an item only for a material change.
10. **Report source health before declaring zero.** A complete zero is `success_zero`; a restricted or truncated run is `partial`, never “今日无项目”.
11. **Persist the run.** Save cutoff, source outcomes, content hashes and sent IDs so the next run does not duplicate or leave a gap.

## Non-negotiable rules

- Search keywords discover candidates; they do not prove relevance.
- A 5G mention only in supplier performance, project history or background is not current procurement evidence.
- Terminal-only purchases such as phones, traffic cards or cameras are excluded unless the same procurement clearly contains private-network service.
- Scenario-only items such as smart medical imaging, smart parks or IoT are `待核实` until network construction, access, slicing, UPF or operations evidence is found.
- Missing and zero amounts mean `未披露` unless the source explicitly states a genuine zero.
- Keep budget, ceiling, award and contract amounts separate. Store original value, unit and CNY conversion.
- Keep acquisition and response deadlines separate and calculate their statuses separately in Asia/Shanghai.
- Candidate or first-place notices are not final awards. Contracts, results, corrections and terminations retain their own stage.
- Different lots remain separate. Different lifecycle stages remain separate in the notice table.
- Buyer websites (`config/buyer-sites.json`) are monitored as long-tail sources, and public search is a discovery channel; neither counts as formal tender-platform coverage. Third-party aggregators (`config/clue-sites.json`) are manual clue sources only.
- If attachments were not read, say so. Do not claim their requirements as facts.
- Every included or pending item needs a source link, evidence label and collection scope.
- Do not infer that Sichuan Telecom saw, bid, abandoned or lost an opportunity unless internal process data proves it.

## Repository execution

When working in this project, use the existing implementation rather than recreating its parsers:

```bash
pnpm collect
pnpm collect --start-date YYYY-MM-DD --max-pages 5
pnpm export
pnpm validate:sample
pnpm check
```

The collector writes SQLite, Excel and `output/latest-run.json`. Treat `partial` and `failed` as operational findings, not as empty markets. Do not overwrite an open Excel workbook; use the project’s timestamped fallback behavior where supported.

## Minimum data contract

Keep these fields when the source provides them:

`notice_id, project_id, lot_id, opportunity_id, title, buyer, province, city, project_number, lot_number, procurement_content, content_category, notice_type, stage, procurement_method, publish_at, budget, ceiling, award, contract_amount, award_supplier, acquisition_start, acquisition_deadline, submission_deadline, relevance, relevance_reason, evidence_quote, attachment_status, attachment_names, source_platform, source_url, alternate_urls, first_seen_at, last_seen_at, content_hash, source_status`.

For an operational bid loop, add internal fields only from authorized internal data: owner city, account manager, assigned time, acknowledged time, bid decision, reason code, approver, submission time and outcome.

## Completion check

Before delivery, verify:

- totals reconcile after deduplication;
- all dates and countdowns use Beijing time;
- every link opens the claimed source type;
- no missing value is displayed as zero;
- no `partial` or `failed` source is presented as complete coverage;
- no old item is presented as today’s new publication merely because it was first discovered today;
- the full list and the short bulletin use the same reviewed records.

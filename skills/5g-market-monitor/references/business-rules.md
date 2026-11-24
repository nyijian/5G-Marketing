# Business rules and data contract

Read this reference when collecting, classifying, deduplicating or auditing 5G private-network procurement records.

## 1. Default scope

- Province: 四川省
- Region code: `510000`
- China Government Procurement zone: `51`
- Project configuration start date: `2026-01-01`
- Timezone: `Asia/Shanghai`

The runtime date window overrides the configuration when the user requests another period. Keywords discover candidates; classification requires detail-page evidence.

## 2. Current discovery vocabulary

### Strong network names and technical terms

`5G专网`、`5G定制网`、`5G双域专网`、`5G行业专网`、`5G数字专网`、`5G移动警务专网`、`UPF下沉`、`5G本地分流`、`5G核心网`、`5G工控专网`、`5G无线生产网络`、`工业5G网络`、`专有5G网络`、`双域专网`、`软切片专网`、`5G卫生专网`、`移动医护专网`、`井下5G`、`5G生产网络传输`

### Expanded discovery and industry-scene terms

`5G网络传输`、`5G智慧医学影像`、`5G智慧医院影像`、`5G医疗健康`、`5G+医疗健康`、`医疗健康专线`、`5G智慧园区`、`5G网络建设`、`5G物联网`、`5G智慧办公`、`5G信号覆盖`、`5G网络服务`、`5G专网安全`、`5G项目运维`、`5G农普`、`5G网络布局`

Most terms in the second group only create a candidate. A lone hit normally remains `待核实`.

## 3. Text normalization

Before matching:

1. Apply Unicode NFKC to unify full-width and half-width text.
2. Convert Latin text to uppercase.
3. Convert dash variants to `-` and full-width slash to `/`.
4. Remove extra spaces around `+ - / _`.
5. Collapse repeated whitespace.
6. Treat `通信` and `通讯` as variants.
7. Allow business words between `5G` and `专网` when the semantic span remains short; the current implementation allows roughly 28 characters.

Stable fragments such as `双域专网`, `工控专网`, `卫生专网`, `软切片专网` and `无线生产网络` are important on platforms that only support literal title matching.

## 4. Classification order

The result is exactly one of `明确相关`, `待核实`, or `排除`. Apply higher-confidence rules first.

### 4.1 明确相关

Use when any of the following is supported by title, procurement demand or a clearly identified procurement-content section:

- 5G定制网、5G专网、双域专网、行业专网、工控专网、卫生专网、生产网络;
- construction, access, networking, operation, dedicated line, security, coverage or maintenance of such a network;
- 5G core-network or core-network platform procurement, including teaching or training equipment as a separate supporting category;
- UPF下沉、本地部署、本地分流、DNN安全汇聚、数据不出园区;
- a generic project title whose service scope, main item table or goods list explicitly contains 5G private-network service.

Examples include industrial 5G plus UWB, dual-domain private network, power soft-slice private network, underground 5G communications, 5G production-network transport and 5G core-network teaching equipment.

### 4.2 待核实

Use when:

- the full text hits a private-network or core-network term but its location in the current procurement demand is unclear;
- only aliases such as mobile medical private network, medical-health line, APN line or wireless production network appear without 5G, slicing or UPF evidence;
- only scenario words such as smart mine, AGV, mobile nursing, smart medical imaging, smart campus, smart water or smart photovoltaic appear;
- only broad discovery terms such as 5G medical health, smart park, IoT, smart office, signal coverage, network construction, operations, census or network layout appear;
- the decisive requirement may be inside an unread PDF, Word file, image or tender document.

Keep the evidence sentence and state whether body structure or attachments still need review.

### 4.3 排除

Use when:

- private-network or 5G technical terms appear only in supplier performance, success cases, similar-project experience or personnel requirements;
- the purchase is limited to phones, terminals, traffic cards, cameras, body cameras, monitoring balls, ECG devices or media platforms, with no private-network service;
- 5G appears only in background or historic context;
- the full record contains no current procurement evidence for private network, core network, UPF or local breakout.

A strong private-network procurement signal outranks a terminal word. For example, a tender containing both 5G devices and an explicit mobile-policing private-network service is not terminal-only.

## 5. Evidence and attachments

Every included or pending record keeps:

- relevance and reason;
- content category;
- a short supporting quote around the matched phrase;
- attachment names;
- attachment-read status.

Use labels such as:

- `已读取正文，附件未读取`
- `未读取（已枚举附件）`
- `未读取（关键要求可能在采购需求附件）`

Never state an attachment requirement as fact unless the attachment was actually read.

## 6. Sichuan scope check

- Sichuan-specific platforms and China Telecom Sichuan scopes can supply a strong province hint.
- Exclude a national-platform item that explicitly belongs to another province.
- A county or district without an out-of-province signal may remain pending when returned by a Sichuan-filtered official query.
- If region is missing, require Sichuan or a Sichuan city/prefecture in the title or buyer.

Recognized Sichuan areas include 成都、自贡、攀枝花、泸州、德阳、绵阳、广元、遂宁、内江、乐山、南充、眉山、宜宾、广安、达州、雅安、巴中、资阳、阿坝、甘孜、凉山.

## 7. Notice stages

Record stages separately:

- procurement intention;
- procurement announcement: open tender, competitive consultation, negotiation, inquiry, single source or direct-purchase announcement;
- direct-purchase notice;
- correction or extension;
- candidate or result;
- contract;
- termination, failed tender or cancellation;
- other.

A candidate or first-place notice is not a final award. Link corrections to the original project by project number and use the latest verified deadlines without deleting the old notice.

## 8. Money and deadlines

### Money

Keep these concepts separate:

- budget;
- ceiling or maximum price;
- award or transaction amount;
- contract amount;
- award supplier.

For each amount retain original numeric value, original unit and converted CNY. Do not use one concept to fill another. A zero or blank from a summary sheet normally becomes `未披露`.

The legacy Excel column named `中标/成交单位` is an amount-unit field. New outputs should call it `中标/成交金额单位` and create a distinct supplier field.

### Deadlines

Keep acquisition start, acquisition deadline and response/submission deadline separately. Display each applicable status as `未截止`, `已截止`, `未知`, or `不适用`.

Only procurement announcements and applicable corrections normally have acquisition or submission status. Parse Chinese dates, slashes, dots and `24:00` in Beijing time.

## 9. Deduplication and lifecycle

### Raw storage

Use `source detail URL + lot number` as the raw unique key. Repeated collection updates content hash and last-seen time instead of inserting a duplicate.

### Cross-platform reporting view

- With project number: merge by `project number + stage + lot`.
- Without project number: merge by normalized title + publication date + lot.
- Never merge different stages or different lots.
- Retain every platform name and alternate official link.
- Prefer a complete authoritative record as primary. The current order is Sichuan Government Procurement, China Government Procurement, Sichuan public resources, national public resources, Tianfu/Sichuan Energy, then other sources, with completeness as a tiebreaker.

Above the notice layer, maintain project, lot and opportunity IDs for business management. A procurement announcement, result and contract may belong to one lifecycle but remain separate notices.

## 10. Material change and daily increment

Use `first_seen_at`, not publication date, to decide whether the bot has newly discovered a record. Label an old publication found today as `补录/迟到发现`.

Republish only for a material change:

- deadline;
- budget, ceiling, award or contract amount;
- method, qualification or lot structure;
- candidate, winner or lifecycle stage;
- correction, extension, termination or re-tender.

Minor title or page-format changes do not justify a repeat message.

## 11. Source and run status

- `success`: complete execution with usable results.
- `success_zero`: complete execution with zero relevant candidates.
- `partial`: usable results exist, but a source is restricted, truncated or has detail failures.
- `failed`: no reliable result was produced, or a critical database/export step failed.
- source-only `skipped`: intentionally not run.

Record query count, page count, candidate count, detail success/failure, actual scope, start/finish time and error. Never convert `partial` or `failed` into a zero-opportunity claim.

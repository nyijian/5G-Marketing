# Sources and coverage

Read this reference when describing coverage, adding a connector, investigating a missed project or reporting source health.

## 1. Coverage taxonomy

Count only these as formal tender sources:

1. government procurement platforms;
2. public-resource trading platforms;
3. formal enterprise, operator or institutional e-procurement platforms.

Do not count buyer websites, hospital pages, group news, search engines, third-party aggregators or fixed validation URLs as formal platform coverage.

Public search is a discovery channel. It may find an official detail page or a new source, but its returned results do not prove complete coverage of the underlying platform.

Buyer sites are `buyer_site / long_tail_source` in `config/buyer-sites.json`. Active ones are monitored automatically through their procurement list pages to fill long-tail gaps (small internal tenders), and are still used to verify notices and look for a formal platform. They never count toward platform coverage. If no corresponding platform is found, say so; do not invent one.

Third-party aggregators and news sites are `clue_only` in `config/clue-sites.json`. Use them by hand to find leads, then trace each lead to an official platform or buyer page. Never collect them automatically or cite them as evidence.

## 2. Current platform catalog

### Active fixed sources

| Platform | Type | Status | Scope and constraint |
|---|---|---|---|
| 中国政府采购网 | government procurement | `active` | Sichuan-filtered national and local notices; full-text index includes title and body |
| 四川政府采购网 | government procurement | `active` | Sichuan announcements, results and contracts; list API is title-oriented and limited |
| 全国公共资源交易平台 | public resource | `active` | National public-resource records filtered to Sichuan |
| 四川省公共资源交易信息网 | public resource | `active` | Provincial designated medium for applicable Sichuan tenders |
| 中国电信阳光采购网 | operator procurement | `active` | China Telecom group Sichuan, terminal Sichuan and integration Sichuan scopes |

### Implemented but access-limited

| Platform | Status | Constraint |
|---|---|---|
| 天府阳光采购服务平台 | `active_limited` | IP restriction or slider may block the current environment |
| 四川能源天府阳光采购服务平台 | `active_limited` | shares the collector and access limitation with Tianfu Sunshine |

These connectors support announcements, candidates, results, changes and terminations. A blocked run is `partial`, not `success_zero`.

### Verified and high-priority for onboarding

| Platform | Status | Evidence and note |
|---|---|---|
| 四川省港航投资集团交易管理服务平台 | `verified_pending` | public list/detail interfaces verified; matched a 5G private-network security project |
| 国投集团电子采购平台 | `verified_pending` | public search and detail available; verified an underground-facility 5G coverage project |
| 鞍钢智慧招投标平台 | `verified_pending` | candidate/result pages verified; matched a Panzhihua 5G wireless-network service |
| 东方电气采购管理平台 | `verified_pending` | official interface verified a 5G network-layout optimization result |
| 四川招投标网／川招电子交易平台 | `verified_pending` | market publishing/trading site, not a government-designated medium; some body text is member-only |

`verified_pending` means the platform path was verified, not that daily automated collection is active.

### Restricted or awaiting evaluation

| Platform | Status | Constraint or next check |
|---|---|---|
| 中国大唐智慧寻源 | `restricted` | anonymous search returns 401 |
| 国家电网ECP2.0 | `candidate` | relevant lot detail often sits in attachments |
| 西南联合产权交易所阳光采购平台 | `candidate` | validate a stable list and detail path |
| 中国联通采购与招标网 | `restricted` | direct access may trigger WAF |
| 中国铁塔电子采购平台 | `candidate` | public pages accessible; validate stable search |
| 中国移动采购与招标网 | `restricted` | official public-search access is limited |
| 成都高投电子招采平台 | `candidate` | validate search and detail interfaces |
| 四川大学招投标与采购中心 | `candidate` | formal institutional procurement site; validate stable search |

The catalog contains 20 formal platforms in total. Except for Sichuan Tender, entries are treated as authoritative original platforms. Sichuan Tender is useful for market discovery and should be followed by an original-source check when possible.

## 3. Buyer-site long tail

| Buyer site | Status | Note |
|---|---|---|
| 自贡市妇幼保健院 | `active` | card list; date split into year-month and day |
| 内江市卫生健康委员会 | `active` | page 2 file suffix is `_2` |
| 泸州市人民医院 | `active` | HTTP only; 6 items per page |
| 四川省妇幼保健院 | `active` | requires `Cookie: visited=1`; high volume |
| 成都市金牛区人民医院 | `active` | three columns; HTTP only |
| 成都市新都区第二人民医院 | `active` | date appended to title |
| 成都市新都区第三人民医院 | `active` | two columns |
| 四川大学华西医院 | `active` | first page only; some notices link out to `ecp.vhepro.com` |
| 乐山市人民医院 | `needs_research` | detail pages readable; list entry not located |
| 广元市文化旅游康养发展集团招采栏目 | `blocked` | WAF |

A live run on 2026-11-25 recovered all eight buyer-site projects among the 37 audited records. These sites are excluded from formal platform counts. Many known hospital projects were small internal tenders with no synchronized government or public-resource page. Title-based filtering can miss a notice whose title omits 5G; generic titles such as “项目结果公示” are opened and classified from the body.

The project currently uses the Sichuan 2024 procurement-threshold context as a verification aid: province-level and Chengdu municipal goods/services 500,000 CNY; other municipal and county levels 300,000 CNY. Keep the applicable year and recheck after a policy update. A threshold explains why a buyer site may be the only page; it does not make that site a formal platform.

## 4. Search and evidence priority

Use this evidence order:

1. official government, public-resource or enterprise procurement page;
2. official buyer page;
3. official search result or authoritative public document;
4. third-party clue.

Recommended evidence labels:

- `官方平台原文`
- `采购人官网原文`
- `官方入口受限，仅有公开线索`
- `第三方线索，待核实`
- `附件未读取`
- `原始平台未识别`

Prefer the authoritative original URL in the message. Preserve mirror and discovery URLs as alternates.

## 5. Onboarding a new platform

Before marking a platform as active, verify:

1. it is a genuine publishing or procurement platform rather than a buyer news page;
2. list/search and detail routes work without using an unauthorized account;
3. region, date, stage and pagination behavior are known;
4. one relevant positive sample and one irrelevant sample can be reproduced;
5. detail text, attachments and original URLs can be stored;
6. rate limits, CAPTCHA, WAF and truncation are surfaced as source status;
7. a completed zero can be distinguished from an access failure;
8. duplicate records merge correctly with existing sources.

Use source states consistently:

- `active`: automated and stable;
- `active_limited`: automated but predictably restricted;
- `verified_pending`: access path verified, connector not yet active;
- `candidate`: still evaluating a stable path;
- `restricted`: known access barrier.

## 6. Missed-project diagnosis

When the user supplies a missing link, assign exactly one primary failure layer before changing rules:

1. **source not covered** — the publishing platform was not in the active set;
2. **search missed** — source was active but query/pagination/date scope did not return it;
3. **detail or attachment unread** — candidate existed, decisive evidence was unavailable;
4. **classification missed** — evidence existed but the rule rejected or left it pending;
5. **deduplication or lifecycle error** — record was merged into the wrong project, lot or stage;
6. **late discovery** — it was found only after the response deadline.

Fix the responsible layer and verify the new positive against existing negative examples.

## 7. Source-health report

For every run retain:

- platform and connector name;
- region and date window;
- queries and pages attempted;
- candidates found;
- detail successes and failures;
- status;
- error or access limitation;
- last successful run.

Status meanings:

| Status | Meaning |
|---|---|
| `success` | enabled source, detail reads and output completed |
| `success_zero` | complete execution, zero candidates in the window |
| `partial` | usable results plus access restriction, truncation or detail failures |
| `failed` | no reliable result or critical storage/export failure |

Never write “today has zero opportunities” when any required source is `partial` or `failed`. Say the run is incomplete and name the affected coverage.

## 8. Reference operating baseline

The 2026-11-23 run was `partial`:

- Sichuan, 2026-01-01 through 2026-11-23;
- 88 consolidated candidate details;
- 82 detail successes, 6 failures;
- 21 clearly relevant, 23 pending, 13 excluded;
- Tianfu and Sichuan Energy blocked by IP/slider;
- six Sichuan Government Procurement details temporarily failed.

This is a historical baseline, not a permanent target or current status. A future run must report its own actual coverage.

# More Company Job Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Personio, softgarden, Recruitee, SmartRecruiters and Workable with the same reach as Ashby, behind one module per platform, and let companies be added by URL.

**Architecture:** `web/src/lib/scraper/ats/` holds one module per platform (8), a dependency-free `urls.ts` (URL recognition + provider metadata, safe for client components) and `registry.ts` (resolution, scraping, single-job import). Greenhouse, Lever and Ashby move in first, guarded by a fixture-based parity test against the current code's output.

**Tech Stack:** TypeScript, Next.js 16 route handlers, `cheerio` (HTML and `xmlMode` XML), `node:assert` scripts run with `tsx`, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-17-more-ats-platforms-design.md`

## Global Constraints

- No new npm dependencies.
- Existing `job_id` prefixes stay exactly `gh_`, `lever_`, `ashby_`; new ones are `personio_`, `softgarden_`, `recruitee_`, `smartrecruiters_`, `workable_`; format `{prefix}_{slug}_{id}`.
- Provider ids: `greenhouse`, `lever`, `ashby`, `personio`, `softgarden`, `recruitee`, `smartrecruiters`, `workable`.
- `dream_job_profile.target_ats_companies` stays a `string[]`; each entry is a URL or a bare slug. No settings migration.
- Fetch failures log one warning and return empty, 20 s timeout per request, one company's failure never stops the others.
- Bare slugs keep today's order: Greenhouse, then Lever, then Ashby.
- New platforms use the company name from the feed when present, else the capitalised slug. Greenhouse, Lever and Ashby keep the capitalised slug.
- Repo rules (`AGENTS.md`): update `memory/context.md` and add one row to `memory/progress_latest.md` at the end.
- Commits follow the repo's Conventional Commits style (`feat(scraper): …`).
- Run all commands from `web/` unless stated.

## Review Focus

1. URL variants for the same board (trailing slash, `?query`, `/en/` path, `www.`, mixed case, a job-ad URL instead of the board URL) must resolve to the same provider and slug. Pinned in Task 2.
2. A board that does not exist (404), an empty board, and a non-JSON/HTML error page must give "not found" vs "0 open jobs" in the Add check and never throw. Pinned in Tasks 3 and 7.
3. SmartRecruiters company ids are case-sensitive (`BoschGroup`); lowercasing breaks the API. Pinned in Task 2.
4. The same company entered twice (slug and URL) must be scraped once. Pinned in Task 2.
5. Personio feeds live on `.de` or `.com`; a company on `.com` must not be reported as not found. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/lib/scraper/ats/types.ts` | `AtsProviderId`, `AtsPosting`, `ListJobsOptions`, `AtsProvider`, `SingleAtsJobDetails` |
| `web/src/lib/scraper/ats/urls.ts` | No imports. `ATS_PROVIDER_META`, `ATS_PROVIDER_IDS`, `parseAtsUrl`, `describeCompanyEntry` |
| `web/src/lib/scraper/ats/shared.ts` | `matchesKeywords`, workplace-type detection, `capitalizeSlug`, `atsFetch` (timeout + warning) moved from `ats-boards.ts` unchanged |
| `web/src/lib/scraper/ats/{greenhouse,lever,ashby,personio,recruitee,smartrecruiters,workable,softgarden}.ts` | One `AtsProvider` each |
| `web/src/lib/scraper/ats/registry.ts` | `ATS_PROVIDERS`, `resolveCompanyEntry`, `scrapeTargetCompanies`, `fetchAtsJobFromUrl` |
| `web/src/lib/scraper/ats-boards.ts` | Becomes `export * from "./ats/registry"` plus the types, so existing imports keep working |
| `web/scripts/test-ats.ts` | All checks for this feature (`npm run test:ats`) |
| `web/scripts/fixtures/ats/` | Saved raw responses + `fixture-fetch.ts` + `golden/` parity output |
| `web/src/app/api/ats/check/route.ts` | Add check |
| `web/src/app/api/jobs/import/route.ts`, `web/src/components/settings/JobSearchSettings.tsx`, `web/src/components/jobs/FilterButton.tsx`, `web/src/lib/supabase/queries.ts`, `web/scripts/scrape-jobs.ts`, `web/scripts/job-manager.ts`, `web/src/lib/setup/migrations.ts` | Callers switched to the registry |

---

### Task 1: Freeze current behaviour and move Greenhouse, Lever, Ashby into modules

**Files:**
- Create: `web/scripts/fixtures/ats/fixture-fetch.ts`, `web/scripts/fixtures/ats/capture-golden.ts`, fixtures under `web/scripts/fixtures/ats/{greenhouse,lever,ashby}/`, `web/scripts/fixtures/ats/golden/*.json`, `web/src/lib/scraper/ats/{types,shared,greenhouse,lever,ashby}.ts`, `web/scripts/test-ats.ts`
- Modify: `web/src/lib/scraper/ats-boards.ts`, `web/package.json` (add `"test:ats": "tsx scripts/test-ats.ts"`)

**Interfaces:**
- Produces:
```ts
export type AtsProviderId = "greenhouse" | "lever" | "ashby" | "personio" | "softgarden" | "recruitee" | "smartrecruiters" | "workable";
export interface AtsPosting { id: string; title: string; department?: string; url: string; companyName?: string }
export interface ListJobsOptions { limit?: number; skipJobIds?: Set<string> }
export interface AtsProvider {
  id: AtsProviderId; label: string; jobIdPrefix: string;
  listPostings(slug: string): Promise<AtsPosting[] | null>; // null = board not found / request failed
  listJobs(slug: string, keywords: string[], opts?: ListJobsOptions): Promise<ScrapedJob[]>;
  getJob(slug: string, jobId: string): Promise<SingleAtsJobDetails | null>;
}
// SingleAtsJobDetails moves here unchanged except provider: AtsProviderId
export function installFixtureFetch(routes: Record<string, string>): () => void; // URL prefix -> fixture file; unmatched URL throws; returns restore fn
export const greenhouse: AtsProvider; export const lever: AtsProvider; export const ashby: AtsProvider;
```

- [ ] **Step 1: Save raw fixtures from the live APIs** with `curl` (one Greenhouse board `bitpanda`, Ashby `n8n` and `wayflyer`, one Lever company with open jobs, plus one single-job response per platform for `getJob`). Store under `web/scripts/fixtures/ats/<provider>/`.
- [ ] **Step 2: Write `installFixtureFetch`** (replaces `globalThis.fetch`, serves the file whose route prefix matches, returns 404 for routes mapped to `"404"`).
- [ ] **Step 3: Write `capture-golden.ts`** that runs the *current* `fetch*CompanyJobs` (keywords `["Product Designer","UX Designer","UX Lead","Head of UX"]` and `[]`) and `fetch*JobDetails` on the fixtures and writes `golden/<provider>-<case>.json`. Run `npx tsx scripts/fixtures/ats/capture-golden.ts`; expect one JSON file per case. Where the source item has no date, write `posted_at` as `"<now>"` so the comparison can skip it.
- [ ] **Step 4: Write the failing parity test** in `scripts/test-ats.ts`:
```ts
for (const c of goldenCases) {
  const restore = installFixtureFetch(c.routes);
  const got = c.kind === "list" ? await c.provider.listJobs(c.slug, c.keywords) : await c.provider.getJob(c.slug, c.jobId);
  restore();
  assert.deepStrictEqual(normalizeNow(got), c.golden, `${c.name} differs from pre-move output`);
}
```
- [ ] **Step 5: Run `npm run test:ats`.** Expected: FAIL, modules missing.
- [ ] **Step 6: Implement `types.ts`, `shared.ts`, `greenhouse.ts`, `lever.ts`, `ashby.ts`** by moving code from `ats-boards.ts` without behaviour change; `listPostings` returns the board's postings from the same single call (null on non-2xx or throw); `listJobs` honours `limit` and `skipJobIds` (skip before building, stop at `limit`). Reduce `ats-boards.ts` to re-exports so `scrape-jobs.ts`, `test-scraper.ts` and the import route still compile.
- [ ] **Step 7: Run `npm run test:ats` and `npx tsc --noEmit`.** Expected: PASS, no type errors.
- [ ] **Step 8: Commit** `refactor(scraper): move Greenhouse, Lever and Ashby into per-platform modules`.

### Task 2: URL recognition, entry resolution and the registry scrape

**Files:**
- Create: `web/src/lib/scraper/ats/urls.ts`, `web/src/lib/scraper/ats/registry.ts`
- Modify: `web/scripts/scrape-jobs.ts:319-375` (pass `skipJobIds`, cap count uses `ATS_PROVIDER_IDS`), `web/src/lib/scraper/ats-boards.ts`, `web/scripts/test-ats.ts`

**Interfaces:**
- Consumes: Task 1 `AtsProvider`, `greenhouse`, `lever`, `ashby`.
- Produces:
```ts
export const ATS_PROVIDER_META: { id: AtsProviderId; label: string }[]; // order: greenhouse, lever, ashby, personio, softgarden, recruitee, smartrecruiters, workable
export const ATS_PROVIDER_IDS: AtsProviderId[];
export function parseAtsUrl(input: string): { providerId: AtsProviderId; slug: string; jobId?: string } | null;
export function describeCompanyEntry(entry: string): { kind: "url"; providerId: AtsProviderId; label: string; slug: string } | { kind: "slug"; slug: string } | { kind: "unsupported" };
export const ATS_PROVIDERS: Record<AtsProviderId, AtsProvider>; // Task 2 registers the three existing ones; Tasks 4-6 add theirs
export function resolveCompanyEntry(entry: string): { providers: AtsProvider[]; slug: string } | null; // url -> [one provider]; slug -> [greenhouse, lever, ashby]; unsupported -> null
export function scrapeTargetCompanies(entries: string[], keywords: string[], opts?: ListJobsOptions): Promise<ScrapedJob[]>;
export function fetchAtsJobFromUrl(url: string): Promise<SingleAtsJobDetails | null>;
```

URL patterns (host match is case-insensitive; slug lowercased except SmartRecruiters):

| Provider | Board / job URL |
|---|---|
| greenhouse | `(boards\|job-boards)(.eu)?.greenhouse.io/{slug}[/jobs/{id}]`, `boards.greenhouse.io/embed/job_app?for={slug}&token={id}` |
| lever | `jobs(.eu)?.lever.co/{slug}[/{uuid}]` |
| ashby | `jobs.ashbyhq.com/{slug}[/{uuid}]` |
| personio | `{slug}.jobs.personio.(de\|com)[/job/{id}]` |
| softgarden | `{slug}.softgarden.io[/<lang>]/job/{id}/…` or any other path on that host |
| recruitee | `{slug}.recruitee.com[/o/{offerSlug}]` (jobId = offer slug) |
| smartrecruiters | `(jobs\|careers).smartrecruiters.com/{CompanyId}[/{postingId}[-title]]` (CompanyId case kept) |
| workable | `apply.workable.com/{slug}[/j/{shortcode}]` |

- [ ] **Step 1: Write failing tests** in `test-ats.ts`:
```ts
assert.deepStrictEqual(parseAtsUrl("https://jobs.ashbyhq.com/n8n/fe05c209-8069-4a88-aeba-8da23488cd30"), { providerId: "ashby", slug: "n8n", jobId: "fe05c209-8069-4a88-aeba-8da23488cd30" });
for (const u of ["kiska.softgarden.io", "https://KISKA.softgarden.io/en/vacancies?x=1", "https://kiska.softgarden.io/job/68673563/Senior-UX-Lead?l=en"])
  assert.equal(parseAtsUrl(u)?.slug, "kiska");
assert.equal(parseAtsUrl("https://kiska.softgarden.io/job/68673563/Senior-UX-Lead?l=en")?.jobId, "68673563");
assert.deepStrictEqual(parseAtsUrl("https://job-boards.eu.greenhouse.io/bitpanda/jobs/5009825101"), { providerId: "greenhouse", slug: "bitpanda", jobId: "5009825101" });
assert.equal(parseAtsUrl("https://jobs.smartrecruiters.com/BoschGroup/744000162069649-x")?.slug, "BoschGroup");
assert.equal(parseAtsUrl("https://fronius.jobs.personio.com/")?.providerId, "personio");
assert.equal(parseAtsUrl("https://careers.globallogic.com/x"), null);
assert.deepStrictEqual(describeCompanyEntry("bitpanda"), { kind: "slug", slug: "bitpanda" });
assert.equal(describeCompanyEntry("https://careers.globallogic.com").kind, "unsupported");
// dedupe + limit + skip, with fixture fetch from Task 1
const jobs = await scrapeTargetCompanies(["n8n", "https://jobs.ashbyhq.com/n8n"], ["Product Designer"], { limit: 1, skipJobIds: new Set() });
assert.equal(jobs.length, 1);
const skipped = await scrapeTargetCompanies(["https://jobs.ashbyhq.com/n8n"], ["Product Designer"], { skipJobIds: new Set(["ashby_n8n_fe05c209-8069-4a88-aeba-8da23488cd30"]) });
assert.ok(!skipped.some(j => j.job_id === "ashby_n8n_fe05c209-8069-4a88-aeba-8da23488cd30"));
```
- [ ] **Step 2: Run `npm run test:ats`.** Expected: FAIL, `parseAtsUrl` not defined.
- [ ] **Step 3: Implement `urls.ts` and `registry.ts`.** `urls.ts` imports nothing. `scrapeTargetCompanies` resolves each entry, dedupes by `providerId:slug` (lowercased), runs companies one after another, passes the remaining limit and `skipJobIds` down, and logs one line for unsupported entries. For bare slugs it tries the three providers in order and stops at the first that returns jobs (today's behaviour).
- [ ] **Step 4: Switch `scrape-jobs.ts`** to `scrapeTargetCompanies(targetCompanies, queries, { limit: remainingDailyTarget, skipJobIds: (await getExistingJobsCache(supabase)).existingIds })` and the cap count to `.in("provider", ATS_PROVIDER_IDS)`.
- [ ] **Step 5: Run `npm run test:ats` and `npx tsc --noEmit`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(scraper): resolve company entries by URL and skip already-saved jobs`.

### Task 3: Personio and Recruitee

**Files:**
- Create: `web/src/lib/scraper/ats/personio.ts`, `web/src/lib/scraper/ats/recruitee.ts`, fixtures `web/scripts/fixtures/ats/{personio,recruitee}/`
- Modify: `registry.ts` (register both), `test-ats.ts`

**Interfaces:**
- Consumes: Task 1 types and shared helpers, Task 2 registry.
- Produces: `export const personio: AtsProvider; export const recruitee: AtsProvider;`

Sources: Personio `https://{slug}.jobs.personio.de/xml`, falling back to `.com` when `.de` is not found; parse with `cheerio.load(xml, { xmlMode: true })`; description = the `jobDescriptions` sections joined as HTML then converted to Markdown; application URL `https://{slug}.jobs.personio.{tld}/job/{id}`. Recruitee `https://{slug}.recruitee.com/api/offers/`; description from `description` + `requirements`; application URL from `careers_url`; company from `company_name`.

- [ ] **Step 1: Save fixtures** (Personio `personio` board and one company served only on `.com`, or a `.de` route mapped to `"404"`; Recruitee `bunq`; a 404 board for each).
- [ ] **Step 2: Write failing tests** for each provider:
```ts
const jobs = await personio.listJobs("personio", []);
assert.ok(jobs.length > 0);
for (const j of jobs) { assert.match(j.job_id, /^personio_personio_\w+/); assert.ok(j.job_title && j.description && j.application_url); assert.equal(j.provider, "personio"); }
assert.equal(await personio.listPostings("no-such-company"), null);           // 404 board
assert.ok((await personio.listPostings("dotcom-only"))!.length >= 0);         // .de 404 -> .com
// same four assertions for recruitee with "bunq", prefix /^recruitee_bunq_/, company === fixture company_name
assert.ok(await personio.getJob("personio", jobs[0].job_id.split("_").pop()!));
```
- [ ] **Step 3: Run `npm run test:ats`.** Expected: FAIL.
- [ ] **Step 4: Implement both modules**, keyword filter via shared `matchesKeywords`, `limit`/`skipJobIds` as in Task 1. A non-JSON or non-XML body counts as not found.
- [ ] **Step 5: Run `npm run test:ats`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(scraper): add Personio and Recruitee job boards`.

### Task 4: SmartRecruiters and Workable

**Files:**
- Create: `web/src/lib/scraper/ats/smartrecruiters.ts`, `web/src/lib/scraper/ats/workable.ts`, fixtures
- Modify: `registry.ts`, `test-ats.ts`

**Interfaces:**
- Produces: `export const smartrecruiters: AtsProvider; export const workable: AtsProvider;`

Sources: SmartRecruiters list `https://api.smartrecruiters.com/v1/companies/{CompanyId}/postings?limit=100&offset=N` (paginate until `offset >= totalFound`), detail `…/postings/{postingId}` for description sections and `postingUrl`. Workable list `POST https://apply.workable.com/api/v3/accounts/{slug}/jobs` body `{"query":"","token":<next>}` (paginate on `nextPage`), detail `https://apply.workable.com/api/v2/accounts/{slug}/jobs/{shortcode}` if the list lacks descriptions; application URL `https://apply.workable.com/{slug}/j/{shortcode}`. Detail calls happen only for postings that pass keywords, `skipJobIds` and `limit`, with 300–800 ms between them.

- [ ] **Step 1: Save fixtures** (SmartRecruiters `BoschGroup` first page + a second page + 2 details; Workable: find an account with open jobs, list + 2 details).
- [ ] **Step 2: Write failing tests**: the same four assertions as Task 3 with prefixes `/^smartrecruiters_boschgroup_/` and `/^workable_/`; plus
```ts
let detailCalls = 0; /* wrap fixture fetch: increment for each `/postings/{id}` URL */
await smartrecruiters.listJobs("BoschGroup", [], { limit: 2 });
assert.equal(detailCalls, 2); // no detail fetch beyond the limit
assert.equal((await smartrecruiters.listPostings("BoschGroup"))!.length, totalFoundInFixtures); // pagination
```
- [ ] **Step 3: Run `npm run test:ats`.** Expected: FAIL.
- [ ] **Step 4: Implement both modules.** Keep the SmartRecruiters company id's case in URLs; lowercase it only inside `job_id`.
- [ ] **Step 5: Run `npm run test:ats`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(scraper): add SmartRecruiters and Workable job boards`.

### Task 5: softgarden

**Files:**
- Create: `web/src/lib/scraper/ats/softgarden.ts`, fixtures `web/scripts/fixtures/ats/softgarden/` (vacancies page + 2 job pages for `kiska`)
- Modify: `registry.ts`, `test-ats.ts`

**Interfaces:**
- Produces: `export const softgarden: AtsProvider;`

Sources: listing `https://{slug}.softgarden.io/en/vacancies` (postings = unique `/job/{id}/…` links with their link text as title); detail = the job page's `application/ld+json` `JobPosting` (title, `hiringOrganization.name`, `jobLocation`, `description` HTML, `datePosted`, `employmentType`). Same throttling and limit rules as Task 4.

- [ ] **Step 1: Save fixtures.**
- [ ] **Step 2: Write failing tests**: the four assertions from Task 3 with prefix `/^softgarden_kiska_68673563$/` for the Senior UX Lead page, company `"KISKA"` or the JSON-LD organisation name, location from `jobLocation`; a job page without JSON-LD returns `null` from `getJob` and is left out of `listJobs`.
- [ ] **Step 3: Run `npm run test:ats`.** Expected: FAIL.
- [ ] **Step 4: Implement** with `cheerio`.
- [ ] **Step 5: Run `npm run test:ats`.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(scraper): add softgarden job boards`.

### Task 6: Import Job via the registry

**Files:**
- Modify: `web/src/app/api/jobs/import/route.ts:68-122` (replace cases C–E), `web/src/lib/scraper/ats-boards.ts` exports, `test-ats.ts`

**Interfaces:**
- Consumes: `fetchAtsJobFromUrl(url)` from Task 2 (`parseAtsUrl` → `ATS_PROVIDERS[id].getJob(slug, jobId)`; null when the URL has no `jobId`).

- [ ] **Step 1: Write failing tests**: for one job URL per provider (all 8, fixture fetch), `fetchAtsJobFromUrl(url)` returns details whose `provider` matches and whose `job_id` equals the id `listJobs` produces for the same job; a board URL without a job id returns `null`.
- [ ] **Step 2: Run `npm run test:ats`.** Expected: FAIL for the five new providers.
- [ ] **Step 3: Replace import cases C–E** with one block: `if (!finalDescription) { const d = await fetchAtsJobFromUrl(cleanUrl); if (d) { …same field mapping as today…; provider = d.provider; } }`. Keep cases A, B and F.
- [ ] **Step 4: Run `npm run test:ats` and `npx tsc --noEmit`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(jobs): import single jobs from all supported job boards`.

### Task 7: Add check, settings UI, filter, counts and expiry

**Files:**
- Create: `web/src/app/api/ats/check/route.ts`
- Modify: `web/src/components/settings/JobSearchSettings.tsx:25-70,307-370`, `web/src/components/jobs/FilterButton.tsx:12-21`, `web/src/lib/supabase/queries.ts:1210`, `web/scripts/job-manager.ts:96`, `web/src/lib/setup/migrations.ts` (append migration), `test-ats.ts`

**Interfaces:**
- Consumes: `describeCompanyEntry`, `ATS_PROVIDER_META`, `ATS_PROVIDER_IDS` (client-safe, from `urls.ts`); `resolveCompanyEntry`, `ATS_PROVIDERS` (server only).
- Produces: `POST /api/ats/check` body `{ entry: string }` → `{ supported: true, providerId, label, slug, companyName, openJobs: number } | { supported: true, found: false, providerId, label, slug } | { supported: false }`. `companyName` = first posting's `companyName` or capitalised slug. Bare slugs try Greenhouse, Lever, Ashby in order and report the first board found.
- Migration id `20261117_01_dashboard_stats_all_ats_providers`: copy the stats function from `20261110_05_dashboard_stats_ats_remoteok` and change only the `atsJobsCount` line to `provider IN ('greenhouse','lever','ashby','personio','softgarden','recruitee','smartrecruiters','workable')`.

- [ ] **Step 1: Write failing tests**: the check handler (import the route's `POST`, call with a `Request`) on fixtures returns `openJobs > 0` for `https://jobs.ashbyhq.com/n8n`, `found: false` for a 404 board, `supported: false` for `https://careers.globallogic.com`; and
```ts
const sql = ALL_MIGRATIONS.find(m => m.id === "20261117_01_dashboard_stats_all_ats_providers")!.sql;
for (const id of ATS_PROVIDER_IDS) assert.ok(sql.includes(`'${id}'`), `migration misses ${id}`);
```
- [ ] **Step 2: Run `npm run test:ats`.** Expected: FAIL.
- [ ] **Step 3: Implement the check route and the migration.**
- [ ] **Step 4: Update the settings UI.** Input placeholder `Paste a careers page or job URL, or a slug`; on Add store the trimmed entry (lowercase only bare slugs), skip it if `describeCompanyEntry` resolves to a `providerId:slug` already in the list, call the check route and show its result under the input for the last added entry (`Personio · 12 open jobs`, `Board not found`, `Not supported – use Import Job`). Each chip shows `describeCompanyEntry(entry)`: the platform label, `auto (slug)`, or a warning tag. Section title becomes `Company job boards` and the help text lists the labels from `ATS_PROVIDER_META`.
- [ ] **Step 5: Switch the remaining provider lists** to `ATS_PROVIDER_META` / `ATS_PROVIDER_IDS`: `FilterButton.tsx` options (inserted after Careers Future, same order), `queries.ts` ATS count, `job-manager.ts` "verified during fetch" branch.
- [ ] **Step 6: Run `npm run test:ats`, `npx tsc --noEmit`, `npm run build`.** Expected: PASS, build succeeds.
- [ ] **Step 7: Verify in the browser** (`npm run dev`, `http://localhost:3000/settings`, Job Search): add `https://kiska.softgarden.io/en/vacancies` → chip `softgarden` and a job count; add `n8n` again as `https://jobs.ashbyhq.com/n8n` → not added twice; add `https://careers.globallogic.com` → warning tag. On `/jobs`, the source filter lists all eight platforms.
- [ ] **Step 8: Commit** `feat(settings): add company job boards by URL with a live check`.

### Task 8: Live run and project memory

**Files:**
- Modify: `memory/context.md` (scraper section: platform modules, registry, URL entries, new route, new migration), `memory/progress_latest.md` (one row)

- [ ] **Step 1: Live dry run** from the repo root with the owner's settings plus one real company per new platform added in the UI: `npm run scrape -- --source ats --dry-run --force`. Expected: each platform logs extracted jobs or a clear "not found"; KISKA's Senior UX Lead appears if still open; no unhandled error.
- [ ] **Step 2: Run `npm run test:ats` and `npm run test:scraper`.** Expected: both pass.
- [ ] **Step 3: Update `memory/context.md`** and append `| 2026-11-17 | More company job boards | Done | Personio, softgarden, Recruitee, SmartRecruiters and Workable behind per-platform modules; companies added by URL | web/src/lib/scraper/ats/, web/src/app/api/ats/check/route.ts |` to `memory/progress_latest.md`.
- [ ] **Step 4: Commit** `docs(memory): record per-platform job board modules`.

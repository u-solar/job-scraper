# More company job boards: Personio, softgarden, Recruitee, SmartRecruiters, Workable

Date: 2026-11-17. Status: approved.

## Intent

The owner is a senior product designer looking for jobs in Austria and the
EU. Many of the companies they want to follow (KISKA, Fronius and other
Austrian employers) do not post on Greenhouse, Lever or Ashby, the only
company job boards the app supports today, so their jobs never reach the
tracker unless pasted by hand. This change adds five more job-board
platforms that are common in the DACH region, each supported as fully as
Ashby is today, and changes how companies are added: you paste a careers
page or job URL, and the app works out the platform from the address.

The fork (`u-solar/job-scraper`) is the owner's own and will get more
features over time, so the structure should make the next platform cheap
to add.

## Goals

1. Five new platforms, each with the same reach Ashby has today:
   - the daily scrape lists a company's open jobs, matched against the
     LinkedIn search queries (same `matchesKeywords` filter as today);
   - **Import Job** accepts a single job URL from the platform and saves it;
   - the platform appears in the Jobs source filter;
   - its jobs count toward the Direct ATS daily cap and the dashboard's
     "Direct ATS" count.
2. Companies are added by pasting a URL (careers page or a single job ad)
   or, as today, a bare slug. On **Add**, the app shows the detected
   platform and a live check ("Personio · 12 open jobs") or a clear
   "not supported" tag.
3. One call per company per scrape for URL entries: no platform guessing.
4. Greenhouse, Lever and Ashby behave exactly as before.

## Non-goals

- Detecting closed jobs on company boards (today they are never expired;
  this stays as is).
- Fixing company display names for Greenhouse, Lever and Ashby (they keep
  the capitalised slug, e.g. "N8n").
- Recognising a platform behind a company's own domain
  (`careers.fronius.com`). The owner pastes a job-ad link instead, which
  usually points to the real board.
- An AI reader for arbitrary careers pages.
- Changing daily caps or LinkedIn behaviour.

## Anti-goals (would make this a failure even if it works)

- Changing the `job_id` format of existing Greenhouse, Lever or Ashby jobs:
  de-duplication keys on `job_id`, so every saved job would come back as a
  duplicate.
- Breaking slug entries already saved in `target_ats_companies`
  (`n8n`, `bitpanda`, `wayflyer`, …).
- Adding an npm dependency. `cheerio` (already installed, supports XML
  mode) covers XML and HTML parsing.
- A company's jobs being saved under the wrong company because a slug
  happened to exist on another platform.

## Constraints

- Repository rules in `AGENTS.md`: TypeScript only, scraper code under
  `web/src/lib/scraper/`, settings live in Supabase `app_settings`.
  After the change, update `memory/context.md` and add one row to
  `memory/progress_latest.md`.
- Settings storage stays as it is: `dream_job_profile.target_ats_companies`
  is a `string[]`. Each entry is now either a URL or a bare slug. No
  settings migration.
- The dashboard count is computed partly in SQL
  (`web/src/lib/setup/migrations.ts`, migration
  `20261110_05_dashboard_stats_ats_remoteok`, which hard-codes
  `provider IN ('greenhouse','lever','ashby')`). Migrations are frozen
  history, so this needs a new migration that redefines that function with
  all eight providers.
- The app auto-applies migrations on start and before cloud runs.
- The owner pulls upstream changes by rebasing. Moving
  `web/src/lib/scraper/ats-boards.ts` means any upstream edit to that file
  will conflict on rebase and has to be carried over by hand.

## What each platform offers (checked live on 2026-11-17)

| Platform | Public source | Notes |
|---|---|---|
| Personio | `https://{slug}.jobs.personio.de/xml` (also `.com`) | XML with title, office, department and HTML description sections. One call per company. |
| Recruitee | `https://{slug}.recruitee.com/api/offers/` | JSON with full descriptions. One call per company. |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{id}/postings` | JSON list without full description; one extra call per matched posting for details. Paginated. |
| Workable | `https://apply.workable.com/api/v3/accounts/{slug}/jobs` (POST) and `/api/v1/widget/accounts/{slug}` | Both answered (`hotjar`, 0 jobs). Description likely needs a per-job call. |
| softgarden | No feed. Listing page `https://{slug}.softgarden.io/en/vacancies` links to `/job/{id}/…`; each job page has one `application/ld+json` JobPosting block. | One request for the list plus one per matched job. HTML-dependent, so the most fragile of the five. |

## Approaches considered

1. **Add the five platforms into `ats-boards.ts`** next to the existing
   three, and add a branch per platform wherever platforms are listed
   (scrape dispatch, import route, job manager, filter, counts). Least
   restructuring, but about six edit sites per platform and copy-pasted
   parsing, which is how the hard-coded dashboard count happened.
2. **One small module per platform plus a registry (chosen).** Every
   platform implements the same three abilities: recognise its URL, list
   a company's jobs, fetch one job. One registry drives the Add check, the
   scrape, Import Job, the source filter and the provider lists used for
   counts. Greenhouse, Lever and Ashby move into the same shape. About
   twice the up-front work, and it moves working code, which the parity
   test below guards.
3. **AI reading of any careers page.** Dropped: a different feature with
   per-run cost, kept as a separate idea.

The owner chose approach 2 and URL-based adding (over slug guessing).

## Design

### Platform modules

`web/src/lib/scraper/ats/` holds one file per platform (eight in total)
and a `registry.ts`. Each module exports an object with:

- `id`: the `provider` value saved on jobs. Existing: `greenhouse`,
  `lever`, `ashby`. New: `personio`, `softgarden`, `recruitee`,
  `smartrecruiters`, `workable`.
- `label`: display name for the filter and the Add tag.
- `parseUrl(url)`: returns `{ slug, jobId? }` when the URL belongs to the
  platform, otherwise `null`.
- `listPostings(slug)`: one cheap call (or one paginated listing) that
  returns every open posting's id, title, department and URL, without
  descriptions. Used by the Add check and as the first step of `listJobs`.
- `listJobs(slug, keywords, { limit, skipJobIds })`: returns
  `ScrapedJob[]`, same shape and same failure behaviour as today (log a
  warning, return `[]`, 20 s timeout). It filters `listPostings` by
  keywords, drops postings whose `job_id` is in `skipJobIds`, stops once
  `limit` jobs are built, and only then makes per-job detail calls on
  platforms that need them (softgarden, SmartRecruiters, Workable if its
  list lacks descriptions). *Builder-check call:* without this, a company
  with 40 matching jobs costs 40 detail requests every day to keep 10.
- `getJob(slug, jobId)`: returns `SingleAtsJobDetails | null` for Import
  Job.

`job_id` format is `{prefix}_{slug}_{id}`. Existing prefixes stay exactly
as they are (`gh_`, `lever_`, `ashby_`). New prefixes: `personio_`,
`softgarden_`, `recruitee_`, `smartrecruiters_`, `workable_`.

The keyword matcher, workplace-type detection and HTML-to-Markdown
conversion are shared helpers used by every module, moved from
`ats-boards.ts` unchanged.

### Company entries

- On scrape, each entry in `target_ats_companies` is resolved through
  the registry: a URL goes to the one platform whose `parseUrl` accepts it;
  a bare slug keeps today's behaviour (try Greenhouse, then Lever, then
  Ashby). Entries no platform accepts are skipped with one log line.
- The scrape passes the remaining Direct ATS cap as `limit` and the
  `job_id`s already saved in Supabase as `skipJobIds` (the LinkedIn path
  already loads existing IDs the same way). For Greenhouse, Lever and Ashby
  this changes nothing a user sees, because they make one call per company
  either way; the final trim to the cap stays as it is.
- New platforms use the company name from the feed when the feed has one,
  falling back to the capitalised slug.
- Settings UI (`web/src/components/settings/JobSearchSettings.tsx`):
  the input accepts a URL or slug. On **Add**, it calls a new route
  `POST /api/ats/check` with the entry. The route resolves it and calls
  `listPostings` once (no detail calls, so it stays fast on every
  platform), returning platform, slug, company name and the count of
  **all** open postings, or "not supported". *Builder-check call:* the
  count is all open jobs, not jobs matching the search queries, so it
  confirms the board is right without loading settings. The entry is saved either way; the chip shows
  the platform tag or a warning tag. The check result is display-only and
  is not stored. Existing chips show "auto (slug)" for bare slugs.
- Copy in that section changes from "Greenhouse / Lever / Ashby" to the
  registry's labels.

### Everything else that lists platforms

- `web/src/app/api/jobs/import/route.ts`: replace the three per-platform
  URL branches with one registry lookup (`parseUrl` then `getJob`).
- `web/src/components/jobs/FilterButton.tsx`: platform options come from
  the registry.
- `web/scripts/scrape-jobs.ts` (daily-cap count) and
  `web/src/lib/supabase/queries.ts` (dashboard count): use the registry's
  provider list.
- `web/scripts/job-manager.ts`: treat every registry provider as "verified
  during fetch", as it does for the three today.
- New migration redefining the dashboard stats function with all eight
  providers.

### Verification

1. Before moving Greenhouse, Lever and Ashby, save their raw API responses
   for `bitpanda` (Greenhouse), `n8n` and `wayflyer` (Ashby) and one Lever
   company as fixtures, plus the jobs the current code produces from them.
   After the move, the new modules must produce identical output from the
   same fixtures.
2. Each new platform gets a saved fixture and a check that it parses into
   the expected jobs (title, company, location, description present,
   `application_url`, `job_id` prefix).
3. One live smoke run: `npm run scrape -- --source ats --dry-run` with one
   real company per platform, including KISKA on softgarden.
4. `npx tsc --noEmit` and `npm run build` pass.
5. Applying the new migration on the owner's Supabase updates the
   dashboard count.

## Left to the builder

- Where fixtures live and whether checks extend `scripts/test-scraper.ts`
  or go in a new script. The repo has no test framework; plain
  `node:assert` scripts run with `tsx` fit what exists.
- Exact field mapping per platform, pagination handling for
  SmartRecruiters, and Personio `.de` vs `.com` host handling.
- Small delays between softgarden and SmartRecruiters per-job calls.
- Whether `ats-boards.ts` is removed or left as a thin re-export.
- Real test companies for Lever, Personio, Recruitee, SmartRecruiters and
  Workable (find ones with open jobs).

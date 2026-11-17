import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GOLDEN_DIR, goldenCases, installFixtureFetch, normalizeNow } from "./fixtures/ats/fixture-fetch";
import { ashby } from "../src/lib/scraper/ats/ashby";
import { greenhouse } from "../src/lib/scraper/ats/greenhouse";
import { lever } from "../src/lib/scraper/ats/lever";
import { personio } from "../src/lib/scraper/ats/personio";
import { recruitee } from "../src/lib/scraper/ats/recruitee";
import { describeCompanyEntry, parseAtsUrl } from "../src/lib/scraper/ats/urls";
import { scrapeTargetCompanies } from "../src/lib/scraper/ats/registry";
import type { AtsProvider } from "../src/lib/scraper/ats/types";

const providers: Record<string, AtsProvider> = { greenhouse, lever, ashby };

async function withFixtures<T>(routes: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const restore = installFixtureFetch(routes);
  try {
    return await fn();
  } finally {
    restore();
  }
}

async function main() {
  // Parity: modules must reproduce the pre-move output exactly.
  for (const c of goldenCases) {
    const p = providers[c.provider];
    const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${c.name}.json`), "utf8"));
    const got = await withFixtures<unknown>(c.routes, () =>
      c.kind === "list" ? p.listJobs(c.slug, c.keywords) : p.getJob(c.slug, c.jobId)
    );
    assert.deepStrictEqual(normalizeNow(got), golden, `${c.name} differs from pre-move output`);
    console.log(`ok  ${c.name}`);
  }

  // New behaviour: listPostings, limit, skipJobIds.
  const gh = goldenCases.find((c) => c.name === "greenhouse-bitpanda-all")!;
  const postings = await withFixtures(gh.routes, () => greenhouse.listPostings("bitpanda"));
  assert.equal(postings?.length, 6);
  assert.ok(postings![0].id && postings![0].title && postings![0].url);

  const missing = goldenCases.find((c) => c.name === "greenhouse-missing-board")!;
  assert.equal(await withFixtures(missing.routes, () => greenhouse.listPostings("nope")), null);

  const limited = await withFixtures(gh.routes, () => greenhouse.listJobs("bitpanda", [], { limit: 2 }));
  assert.equal(limited.length, 2);

  const skipId = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, "greenhouse-bitpanda-all.json"), "utf8"))[0].job_id;
  const skipped = await withFixtures(gh.routes, () =>
    greenhouse.listJobs("bitpanda", [], { skipJobIds: new Set([skipId]) })
  );
  assert.equal(skipped.length, 5);
  assert.ok(!skipped.some((j) => j.job_id === skipId));
  console.log("ok  listPostings / limit / skipJobIds");

  // URL recognition
  assert.deepStrictEqual(parseAtsUrl("https://jobs.ashbyhq.com/n8n/fe05c209-8069-4a88-aeba-8da23488cd30"), { providerId: "ashby", slug: "n8n", jobId: "fe05c209-8069-4a88-aeba-8da23488cd30" });
  for (const u of ["kiska.softgarden.io", "https://KISKA.softgarden.io/en/vacancies?x=1", "https://kiska.softgarden.io/job/68673563/Senior-UX-Lead?l=en"])
    assert.equal(parseAtsUrl(u)?.slug, "kiska");
  assert.equal(parseAtsUrl("https://kiska.softgarden.io/job/68673563/Senior-UX-Lead?l=en")?.jobId, "68673563");
  assert.deepStrictEqual(parseAtsUrl("https://job-boards.eu.greenhouse.io/bitpanda/jobs/5009825101"), { providerId: "greenhouse", slug: "bitpanda", jobId: "5009825101" });
  assert.deepStrictEqual(parseAtsUrl("https://boards.greenhouse.io/embed/job_app?for=Bitpanda&token=5009825101"), { providerId: "greenhouse", slug: "bitpanda", jobId: "5009825101" });
  assert.equal(parseAtsUrl("https://jobs.smartrecruiters.com/BoschGroup/744000162069649-x")?.slug, "BoschGroup");
  assert.equal(parseAtsUrl("https://jobs.smartrecruiters.com/BoschGroup/744000162069649-x")?.jobId, "744000162069649");
  assert.equal(parseAtsUrl("https://fronius.jobs.personio.com/")?.providerId, "personio");
  assert.deepStrictEqual(parseAtsUrl("https://acme.recruitee.com/o/product-designer"), { providerId: "recruitee", slug: "acme", jobId: "product-designer" });
  assert.deepStrictEqual(parseAtsUrl("https://apply.workable.com/acme/j/ABC123/"), { providerId: "workable", slug: "acme", jobId: "ABC123" });
  assert.equal(parseAtsUrl("https://careers.globallogic.com/x"), null);
  assert.deepStrictEqual(describeCompanyEntry("bitpanda"), { kind: "slug", slug: "bitpanda" });
  assert.equal(describeCompanyEntry("https://careers.globallogic.com").kind, "unsupported");
  console.log("ok  URL recognition");

  // Registry: dedupe + limit + skip, with fixture fetch
  const n8nRoutes = {
    "https://boards-api.greenhouse.io/v1/boards/n8n": "404",
    "https://api.lever.co/v0/postings/n8n": "404",
    "https://api.ashbyhq.com/posting-api/job-board/n8n": "ashby/n8n.json",
  };
  const n8nId = "ashby_n8n_fe05c209-8069-4a88-aeba-8da23488cd30";
  const jobs = await withFixtures(n8nRoutes, () =>
    scrapeTargetCompanies(["n8n", "https://jobs.ashbyhq.com/n8n"], ["Product Designer"], { limit: 1, skipJobIds: new Set() })
  );
  assert.equal(jobs.length, 1);
  const unfiltered = await withFixtures(n8nRoutes, () =>
    scrapeTargetCompanies(["https://jobs.ashbyhq.com/n8n", "JOBS.ashbyhq.com/N8N"], ["Product Designer"])
  );
  assert.equal(new Set(unfiltered.map((j) => j.job_id)).size, unfiltered.length); // second entry deduped
  const skippedJobs = await withFixtures(n8nRoutes, () =>
    scrapeTargetCompanies(["https://jobs.ashbyhq.com/n8n"], ["Product Designer"], { skipJobIds: new Set([n8nId]) })
  );
  assert.ok(unfiltered.some((j) => j.job_id === n8nId));
  assert.ok(!skippedJobs.some((j) => j.job_id === n8nId));
  const unsup = await withFixtures({}, () => scrapeTargetCompanies(["https://careers.globallogic.com", "https://acme.recruitee.com"], []));
  assert.equal(unsup.length, 0);
  const urlOnly = await withFixtures(n8nRoutes, () =>
    scrapeTargetCompanies(["https://jobs.ashbyhq.com/n8n"], ["Product Designer"])
  );
  for (const entries of [["n8n", "https://jobs.ashbyhq.com/n8n"], ["https://jobs.ashbyhq.com/n8n", "n8n"]]) {
    const got = await withFixtures(n8nRoutes, () => scrapeTargetCompanies(entries, ["Product Designer"]));
    const ids = got.map((j) => j.job_id);
    assert.equal(new Set(ids).size, ids.length, `duplicate job_ids for ${entries.join(" + ")}`);
    assert.deepStrictEqual(ids, urlOnly.map((j) => j.job_id), `slug+URL differs from URL alone for ${entries.join(" + ")}`);
  }
  // Counts fetch calls per URL substring while fixtures are installed.
  async function countCalls<T>(routes: Record<string, string>, fn: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
    const urls: string[] = [];
    const result = await withFixtures(routes, async () => {
      const inner = globalThis.fetch;
      globalThis.fetch = ((input: any, init?: any) => {
        urls.push(typeof input === "string" ? input : input.url ?? String(input));
        return inner(input, init);
      }) as typeof fetch;
      try {
        return await fn();
      } finally {
        globalThis.fetch = inner;
      }
    });
    return { result, urls };
  }
  const ASHBY_BOARD = "https://api.ashbyhq.com/posting-api/job-board/n8n";
  for (const entries of [
    ["n8n", "https://jobs.ashbyhq.com/n8n"],
    ["https://jobs.ashbyhq.com/n8n", "n8n"],
    ["https://jobs.ashbyhq.com/n8n", "https://jobs.ashbyhq.com/n8n/"],
  ]) {
    const { urls } = await countCalls(n8nRoutes, () => scrapeTargetCompanies(entries, ["Product Designer"]));
    assert.equal(urls.filter((u) => u.startsWith(ASHBY_BOARD)).length, 1, `ashby board fetched once for ${entries.join(" + ")}`);
  }

  // Bare slug: a fully-saved Greenhouse board still ends the probe (no Lever/Ashby calls).
  const bpRoutes = goldenCases.find((c) => c.name === "greenhouse-bitpanda-all")!.routes;
  const bpIds: string[] = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, "greenhouse-bitpanda-all.json"), "utf8")).map((j: any) => j.job_id);
  assert.ok(bpIds.length > 1);
  const { result: bpSkipped, urls: bpUrls } = await countCalls(bpRoutes, () =>
    scrapeTargetCompanies(["bitpanda"], [], { skipJobIds: new Set(bpIds) })
  );
  assert.equal(bpSkipped.length, 0);
  assert.equal(bpUrls.filter((u) => /lever\.co|ashbyhq\.com/.test(u)).length, 0);
  const bpLimited = await withFixtures(bpRoutes, () => scrapeTargetCompanies(["bitpanda"], [], { skipJobIds: new Set([bpIds[0]]), limit: 1 }));
  assert.deepStrictEqual(bpLimited.map((j) => j.job_id), [bpIds[1]]);

  // www. and language-prefixed paths
  assert.deepStrictEqual(parseAtsUrl("https://www.kiska.softgarden.io/en/job/68673563/x"), { providerId: "softgarden", slug: "kiska", jobId: "68673563" });
  assert.deepStrictEqual(parseAtsUrl("https://www.jobs.ashbyhq.com/n8n"), { providerId: "ashby", slug: "n8n" });
  assert.deepStrictEqual(parseAtsUrl("https://fronius.jobs.personio.de/en/job/123"), { providerId: "personio", slug: "fronius", jobId: "123" });
  assert.deepStrictEqual(parseAtsUrl("https://fronius.jobs.personio.de/job/123"), { providerId: "personio", slug: "fronius", jobId: "123" });
  assert.deepStrictEqual(parseAtsUrl("https://acme.recruitee.com/de-at/o/product-designer"), { providerId: "recruitee", slug: "acme", jobId: "product-designer" });
  assert.deepStrictEqual(parseAtsUrl("https://apply.workable.com/en/acme/j/ABC123/"), { providerId: "workable", slug: "acme", jobId: "ABC123" });
  assert.deepStrictEqual(parseAtsUrl("https://apply.workable.com/ab/j/ABC123/"), { providerId: "workable", slug: "ab", jobId: "ABC123" });
  console.log("ok  registry scrape");

  await testPersonioRecruitee();
}

async function testPersonioRecruitee() {
  const PDE = "https://helpling.jobs.personio.de/xml";
  const PCOM = "https://helpling.jobs.personio.com/xml";
  // .de answers 404, .com serves the board
  const comOnly = { [PDE]: "404", [PCOM]: "personio/helpling.xml" };
  const pj = await withFixtures(comOnly, () => personio.listJobs("helpling", []));
  assert.equal(pj.length, 1);
  for (const j of pj) {
    assert.match(j.job_id, /^personio_helpling_\w+/);
    assert.ok(j.job_title && j.description && j.application_url);
    assert.equal(j.provider, "personio");
    assert.equal(j.company, "Helpling");
    assert.ok(j.application_url.startsWith("https://helpling.jobs.personio.com/job/"), j.application_url);
    assert.ok(!j.description.includes("<div"), "description is Markdown");
  }
  assert.equal((await withFixtures(comOnly, () => personio.listJobs("helpling", ["Product Designer"]))).length, 0);
  assert.equal((await withFixtures(comOnly, () => personio.listJobs("helpling", [], { skipJobIds: new Set([pj[0].job_id]) }))).length, 0);
  assert.equal((await withFixtures(comOnly, () => personio.listPostings("helpling")))!.length, 1);
  // .de board with jobs that have no description: listed as postings, skipped as jobs
  const deRoutes = { "https://personio.jobs.personio.de/xml": "personio/personio.xml" };
  assert.equal((await withFixtures(deRoutes, () => personio.listPostings("personio")))!.length, 2);
  assert.equal((await withFixtures(deRoutes, () => personio.listJobs("personio", []))).length, 0);
  const missing = { "https://no-such-company.jobs.personio.de/xml": "404", "https://no-such-company.jobs.personio.com/xml": "404" };
  assert.equal(await withFixtures(missing, () => personio.listPostings("no-such-company")), null);
  assert.deepStrictEqual(await withFixtures(missing, () => personio.listJobs("no-such-company", [])), []);
  const pd = await withFixtures(comOnly, () => personio.getJob("helpling", pj[0].job_id.split("_").pop()!));
  assert.equal(pd?.job_id, pj[0].job_id);
  assert.equal(pd?.provider, "personio");
  assert.equal(await withFixtures(comOnly, () => personio.getJob("helpling", "0")), null);

  const RB = "https://bunq.recruitee.com/api/offers/";
  const rbRoutes = { [RB]: "recruitee/bunq.json" };
  const rj = await withFixtures(rbRoutes, () => recruitee.listJobs("bunq", []));
  assert.equal(rj.length, 5);
  for (const j of rj) {
    assert.match(j.job_id, /^recruitee_bunq_\d+$/);
    assert.ok(j.job_title && j.description && j.application_url);
    assert.equal(j.provider, "recruitee");
    assert.equal(j.company, "bunq");
  }
  const rkw = await withFixtures(rbRoutes, () => recruitee.listJobs("bunq", ["Security Engineer"]));
  assert.deepStrictEqual(rkw.map((j) => j.job_title), ["Security Engineer"]);
  assert.equal((await withFixtures(rbRoutes, () => recruitee.listJobs("bunq", [], { limit: 2 }))).length, 2);
  const rskip = await withFixtures(rbRoutes, () => recruitee.listJobs("bunq", [], { skipJobIds: new Set([rj[0].job_id]) }));
  assert.deepStrictEqual(rskip.map((j) => j.job_id), rj.slice(1).map((j) => j.job_id));
  assert.equal((await withFixtures(rbRoutes, () => recruitee.listPostings("bunq")))!.length, 5);
  const rmissing = { "https://no-such-company.recruitee.com/api/offers/": "404" };
  assert.equal(await withFixtures(rmissing, () => recruitee.listPostings("no-such-company")), null);
  // R3: URL gives the offer slug; job_id must equal the one listJobs produced. Numeric id works too.
  const sec = rj.find((j) => j.job_title === "Security Engineer")!;
  const bySlug = await withFixtures(rbRoutes, () => recruitee.getJob("bunq", "security-engineer-3"));
  assert.equal(bySlug?.job_id, sec.job_id);
  assert.equal(bySlug?.company, "bunq");
  assert.equal((await withFixtures(rbRoutes, () => recruitee.getJob("bunq", sec.job_id.split("_").pop()!)))?.job_id, sec.job_id);
  assert.equal(await withFixtures(rbRoutes, () => recruitee.getJob("bunq", "nope")), null);
  console.log("ok  personio + recruitee");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

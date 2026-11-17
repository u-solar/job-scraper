import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GOLDEN_DIR, goldenCases, installFixtureFetch, normalizeNow } from "./fixtures/ats/fixture-fetch";
import { ashby } from "../src/lib/scraper/ats/ashby";
import { greenhouse } from "../src/lib/scraper/ats/greenhouse";
import { lever } from "../src/lib/scraper/ats/lever";
import { personio } from "../src/lib/scraper/ats/personio";
import { recruitee } from "../src/lib/scraper/ats/recruitee";
import { pacing } from "../src/lib/scraper/ats/shared";
import { softgarden } from "../src/lib/scraper/ats/softgarden";
import { smartrecruiters } from "../src/lib/scraper/ats/smartrecruiters";
import { workable } from "../src/lib/scraper/ats/workable";
import { describeCompanyEntry, parseAtsUrl } from "../src/lib/scraper/ats/urls";
import { fetchAtsJobFromUrl, scrapeTargetCompanies } from "../src/lib/scraper/ats/registry";
import type { AtsProvider } from "../src/lib/scraper/ats/types";

const providers: Record<string, AtsProvider> = { greenhouse, lever, ashby };

async function withFixtures<T>(routes: Record<string, string | string[]>, fn: () => Promise<T>): Promise<T> {
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
  await testSmartRecruitersWorkable();
  await testSoftgarden();
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
  // keyword-positive path and limit (helpling-two: two described positions)
  const two = { [PDE]: "404", [PCOM]: "personio/helpling-two.xml" };
  const kw = await withFixtures(two, () => personio.listJobs("helpling", ["Product Designer"]));
  assert.deepStrictEqual(kw.map((j) => j.job_title), ["Product Designer (m/w/d)"]);
  assert.equal((await withFixtures(two, () => personio.listJobs("helpling", []))).length, 2);
  assert.equal((await withFixtures(two, () => personio.listJobs("helpling", [], { limit: 1 }))).length, 1);

  // HTML error pages and empty boards
  const html = "personio/html.html";
  const deHtml = { [PDE]: html, [PCOM]: "personio/helpling.xml" };
  assert.equal((await withFixtures(deHtml, () => personio.listPostings("helpling")))!.length, 1);
  assert.equal(await withFixtures({ [PDE]: html, [PCOM]: html }, () => personio.listPostings("helpling")), null);
  assert.deepStrictEqual(await withFixtures({ [PDE]: html, [PCOM]: html }, () => personio.listJobs("helpling", [])), []);
  assert.deepStrictEqual(await withFixtures({ [PDE]: "personio/empty.xml" }, () => personio.listPostings("helpling")), []);
  assert.equal(await withFixtures({ [RB]: "recruitee/html.html" }, () => recruitee.listPostings("bunq")), null);
  assert.deepStrictEqual(await withFixtures({ [RB]: "recruitee/html.html" }, () => recruitee.listJobs("bunq", [])), []);
  assert.deepStrictEqual(await withFixtures({ [RB]: "recruitee/empty.json" }, () => recruitee.listPostings("bunq")), []);

  // Recruitee: garbage dates do not abort the board; an offer with no slug and no careers_url is skipped
  const edge = { [RB]: "recruitee/bunq-edge.json" };
  const ej = await withFixtures(edge, () => recruitee.listJobs("bunq", []));
  assert.equal(ej.length, 1);
  assert.ok(!isNaN(Date.parse(ej[0].posted_at!)) && new Date(ej[0].posted_at!).toISOString() === ej[0].posted_at);
  assert.equal((await withFixtures(edge, () => recruitee.listPostings("bunq")))!.length, 1);
  console.log("ok  personio + recruitee");
}

/** Runs fn with fixtures installed and returns every URL requested. */
async function recordUrls(routes: Record<string, string | string[]>, fn: () => Promise<unknown>): Promise<string[]> {
  const urls: string[] = [];
  await withFixtures(routes, async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => {
      urls.push(typeof input === "string" ? input : input.url ?? String(input));
      return inner(input, init);
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = inner;
    }
  });
  return urls;
}

async function testSmartRecruitersWorkable() {
  pacing.wait = async () => {}; // no real sleeping between detail calls

  const SR = "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings";
  const srRoutes = {
    [`${SR}?limit=100&offset=0`]: "smartrecruiters/boschgroup-p1.json",
    [`${SR}?limit=100&offset=3`]: "smartrecruiters/boschgroup-p2.json",
    [`${SR}/744000162078719`]: "smartrecruiters/boschgroup-d1.json",
    [`${SR}/744000162077116`]: "smartrecruiters/boschgroup-d2.json",
  };
  const sj = await withFixtures(srRoutes, () => smartrecruiters.listJobs("BoschGroup", [], { limit: 2 }));
  assert.equal(sj.length, 2);
  for (const j of sj) {
    assert.match(j.job_id, /^smartrecruiters_boschgroup_\d+$/);
    assert.ok(j.job_title && j.description && j.application_url);
    assert.ok(j.application_url!.startsWith("https://jobs.smartrecruiters.com/BoschGroup/"), j.application_url);
    assert.equal(j.provider, "smartrecruiters");
    assert.equal(j.company, "Bosch Group");
    assert.ok(!isNaN(Date.parse(j.posted_at!)));
  }
  // detail calls only for postings that pass limit / keywords / skip
  const detailUrls = (urls: string[]) => urls.filter((u) => /\/postings\/\d+/.test(u));
  assert.equal(detailUrls(await recordUrls(srRoutes, () => smartrecruiters.listJobs("BoschGroup", [], { limit: 2 }))).length, 2);
  const skipFirst = new Set([sj[0].job_id]);
  assert.equal(detailUrls(await recordUrls(srRoutes, () => smartrecruiters.listJobs("BoschGroup", [], { limit: 1, skipJobIds: skipFirst }))).length, 1);
  const skipped = await withFixtures(srRoutes, () => smartrecruiters.listJobs("BoschGroup", ["Customer Quality Management"], { skipJobIds: new Set([sj[1].job_id]) }));
  assert.equal(skipped.length, 0);
  const kw = await withFixtures(srRoutes, () => smartrecruiters.listJobs("BoschGroup", ["Customer Quality Management"]));
  assert.deepStrictEqual(kw.map((j) => j.job_id), [sj[1].job_id]);
  // pagination: both pages are read, 3 + 2 postings
  const sp = await withFixtures(srRoutes, () => smartrecruiters.listPostings("BoschGroup"));
  assert.equal(sp!.length, 5);
  assert.equal(sp![4].id, "744000162075409");
  assert.equal(sp![0].companyName, "Bosch Group");
  // getJob accepts a bare id or the id-title URL segment
  const sg = await withFixtures(srRoutes, () => smartrecruiters.getJob("BoschGroup", "744000162078719-mfq-technikai-asszisztens-gyakornok"));
  assert.equal(sg?.job_id, sj[0].job_id);
  assert.equal(sg?.provider, "smartrecruiters");
  // 404 / HTML / empty
  const srMissing = { [`${SR}?limit=100&offset=0`]: "404" };
  assert.equal(await withFixtures(srMissing, () => smartrecruiters.listPostings("BoschGroup")), null);
  assert.deepStrictEqual(await withFixtures(srMissing, () => smartrecruiters.listJobs("BoschGroup", [])), []);
  assert.equal(await withFixtures({ [SR]: "smartrecruiters/html.html" }, () => smartrecruiters.listPostings("BoschGroup")), null);
  assert.deepStrictEqual(await withFixtures({ [SR]: "smartrecruiters/html.html" }, () => smartrecruiters.listJobs("BoschGroup", [])), []);
  assert.deepStrictEqual(await withFixtures({ [SR]: "smartrecruiters/empty.json" }, () => smartrecruiters.listPostings("BoschGroup")), []);
  assert.equal(await withFixtures({ [`${SR}/1`]: "404" }, () => smartrecruiters.getJob("BoschGroup", "1")), null);

  const WL = "https://apply.workable.com/api";
  const wlRoutes = {
    [`${WL}/v3/accounts/huggingface/jobs`]: ["workable/huggingface-p1.json", "workable/huggingface-p2.json"],
    [`${WL}/v2/accounts/huggingface/jobs/DB4D7C0EC8`]: "workable/huggingface-d1.json",
    [`${WL}/v2/accounts/huggingface/jobs/F88446C814`]: "workable/huggingface-d2.json",
  };
  const wj = await withFixtures(wlRoutes, () => workable.listJobs("huggingface", ["Python"]));
  assert.equal(wj.length, 2);
  for (const j of wj) {
    assert.match(j.job_id, /^workable_huggingface_[0-9A-F]{10}$/);
    assert.ok(j.job_title && j.description && j.application_url);
    assert.match(j.application_url!, /^https:\/\/apply\.workable\.com\/huggingface\/j\/[0-9A-F]{10}$/);
    assert.equal(j.provider, "workable");
    assert.equal(j.company, "Huggingface");
    assert.equal(j.workplace_type, "remote");
  }
  const wUrls = await recordUrls(wlRoutes, () => workable.listJobs("huggingface", [], { limit: 2 }));
  assert.equal(wUrls.filter((u) => u.includes("/v2/")).length, 2);
  assert.equal(wUrls.filter((u) => u.includes("/v3/")).length, 2, "list pages are both requested");
  assert.equal((await withFixtures(wlRoutes, () => workable.listJobs("huggingface", ["Python"], { skipJobIds: new Set([wj[0].job_id]) }))).length, 1);
  // pagination: page 2 is reached through nextPage (the POST body carries the token)
  const bodies: string[] = [];
  await withFixtures(wlRoutes, async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => { bodies.push(String(init?.body)); return inner(input, init); }) as typeof fetch;
    try { await workable.listPostings("huggingface"); } finally { globalThis.fetch = inner; }
  });
  assert.deepStrictEqual(bodies.map((b) => JSON.parse(b).token), ["", "tok2"]);
  const wp = await withFixtures(wlRoutes, () => workable.listPostings("huggingface"));
  assert.equal(wp!.length, 6);
  assert.equal(wp![0].companyName, "Huggingface");
  const wg = await withFixtures(wlRoutes, () => workable.getJob("huggingface", "DB4D7C0EC8"));
  assert.equal(wg?.job_id, wj[0].job_id);
  assert.equal(wg?.provider, "workable");
  // 404 / HTML / empty
  const wlList = `${WL}/v3/accounts/nope/jobs`;
  assert.equal(await withFixtures({ [wlList]: "404" }, () => workable.listPostings("nope")), null);
  assert.deepStrictEqual(await withFixtures({ [wlList]: "404" }, () => workable.listJobs("nope", [])), []);
  assert.equal(await withFixtures({ [wlList]: "workable/html.html" }, () => workable.listPostings("nope")), null);
  assert.deepStrictEqual(await withFixtures({ [wlList]: "workable/html.html" }, () => workable.listJobs("nope", [])), []);
  assert.deepStrictEqual(await withFixtures({ [wlList]: "workable/empty.json" }, () => workable.listPostings("nope")), []);
  assert.equal(await withFixtures({ [`${WL}/v2/accounts/nope/jobs/X`]: "404" }, () => workable.getJob("nope", "X")), null);
  console.log("ok  smartrecruiters + workable");
}

async function testSoftgarden() {
  pacing.wait = async () => {};
  const B = "https://kiska.softgarden.io";
  const routes = {
    [`${B}/en/vacancies`]: "softgarden/vacancies.html",
    [`${B}/job/68673563`]: "softgarden/job-68673563.html",
    [`${B}/job/67774182`]: "softgarden/job-67774182.html",
    [`${B}/job/67247665`]: "softgarden/job-nold.html", // a page without JSON-LD
  };
  const detailUrls = (urls: string[]) => urls.filter((u) => u.includes("/job/"));
  const all = await withFixtures(routes, () => softgarden.listJobs("kiska", []));
  assert.equal(all.length, 2, "the posting without JSON-LD is left out");
  const ux = all.find((j) => j.job_id === "softgarden_kiska_68673563")!;
  assert.ok(ux, "job_id format");
  assert.equal(ux.job_title, "Senior UX Lead");
  assert.equal(ux.company, "KISKA GmbH");
  assert.equal(ux.location, "Anif, Salzburg, Austria");
  assert.equal(ux.provider, "softgarden");
  assert.equal(ux.application_url, `${B}/job/68673563/Senior-UX-Lead?l=en`);
  assert.ok(ux.description && ux.description.includes("Senior UX Lead"));
  assert.equal(ux.posted_at, "2026-11-11T08:53:58.680Z");

  // keyword matches on the listing title: only the matching detail call is made
  assert.deepStrictEqual(detailUrls(await recordUrls(routes, () => softgarden.listJobs("kiska", ["UX Lead"]))), [`${B}/job/68673563?l=en`]);
  // limit / skip stop detail calls early
  assert.equal(detailUrls(await recordUrls(routes, () => softgarden.listJobs("kiska", [], { limit: 1 }))).length, 1);
  const skipped = await recordUrls(routes, () => softgarden.listJobs("kiska", [], { limit: 1, skipJobIds: new Set(["softgarden_kiska_68673563"]) }));
  assert.ok(!detailUrls(skipped).some((u) => u.includes("68673563")));
  // pacing: first detail call is not delayed, N calls wait N-1 times
  let waits = 0;
  pacing.wait = async () => { waits++; };
  await withFixtures(routes, () => softgarden.listJobs("kiska", []));
  assert.equal(waits, 2, "3 detail calls, 2 waits");
  pacing.wait = async () => {};

  const sp = await withFixtures(routes, () => softgarden.listPostings("kiska"));
  assert.deepStrictEqual(sp!.map((p) => [p.id, p.title]), [["68673563", "Senior UX Lead"], ["67774182", "Junior Alias Modeller"], ["67247665", "U.S. Growth Lead"]]);
  assert.equal(sp![0].url, `${B}/job/68673563/Senior-UX-Lead?l=en`);
  assert.equal(sp![0].companyName, "Kiska");
  const sg = await withFixtures(routes, () => softgarden.getJob("kiska", "68673563"));
  assert.equal(sg?.job_id, "softgarden_kiska_68673563");
  assert.equal(sg?.provider, "softgarden");
  assert.equal(await withFixtures(routes, () => softgarden.getJob("kiska", "67247665")), null);

  // 404 / not a listing / empty board
  const list = `${B}/en/vacancies`;
  assert.equal(await withFixtures({ [list]: "404" }, () => softgarden.listPostings("kiska")), null);
  assert.deepStrictEqual(await withFixtures({ [list]: "404" }, () => softgarden.listJobs("kiska", [])), []);
  assert.equal(await withFixtures({ [list]: "softgarden/html.html" }, () => softgarden.listPostings("kiska")), null);
  assert.deepStrictEqual(await withFixtures({ [list]: "softgarden/html.html" }, () => softgarden.listJobs("kiska", [])), []);
  assert.deepStrictEqual(await withFixtures({ [list]: "softgarden/empty.html" }, () => softgarden.listPostings("kiska")), []);
  assert.equal(await withFixtures({ [`${B}/job/1`]: "404" }, () => softgarden.getJob("kiska", "1")), null);
  assert.deepStrictEqual(
    await withFixtures({ [`${B}/job/68673563`]: "softgarden/job-68673563.html" }, () => fetchAtsJobFromUrl(`${B}/en/job/68673563/Senior-UX-Lead`)).then((j) => j?.job_id),
    "softgarden_kiska_68673563"
  );
  console.log("ok  softgarden");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

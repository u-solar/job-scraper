import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GOLDEN_DIR, goldenCases, installFixtureFetch, normalizeNow } from "./fixtures/ats/fixture-fetch";
import { ashby } from "../src/lib/scraper/ats/ashby";
import { greenhouse } from "../src/lib/scraper/ats/greenhouse";
import { lever } from "../src/lib/scraper/ats/lever";
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

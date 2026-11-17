// Captures pre-refactor output from the original fetch* functions in ats-boards.ts.
// Run once: npx tsx scripts/fixtures/ats/capture-golden.ts
import fs from "fs";
import path from "path";
import {
  fetchAshbyCompanyJobs, fetchAshbyJobDetails,
  fetchGreenhouseCompanyJobs, fetchGreenhouseJobDetails,
  fetchLeverCompanyJobs, fetchLeverJobDetails,
} from "../../../src/lib/scraper/ats-boards";
import { GOLDEN_DIR, goldenCases, installFixtureFetch, normalizeNow } from "./fixture-fetch";

const list = { greenhouse: fetchGreenhouseCompanyJobs, lever: fetchLeverCompanyJobs, ashby: fetchAshbyCompanyJobs };
const job = { greenhouse: fetchGreenhouseJobDetails, lever: fetchLeverJobDetails, ashby: fetchAshbyJobDetails };

async function main() {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const c of goldenCases) {
    const restore = installFixtureFetch(c.routes);
    try {
      const got = c.kind === "list" ? await list[c.provider](c.slug, c.keywords) : await job[c.provider](c.slug, c.jobId);
      fs.writeFileSync(path.join(GOLDEN_DIR, `${c.name}.json`), JSON.stringify(normalizeNow(got), null, 2) + "\n");
      console.log(`${c.name}: ${Array.isArray(got) ? got.length + " jobs" : got ? "ok" : "null"}`);
    } finally {
      restore();
    }
  }
}
main();

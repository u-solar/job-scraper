// Thin compatibility layer over the per-platform modules in ./ats.
// Callers (scrape-jobs.ts, the import route) move to the modules in later tasks.
import { ScrapedJob } from "./types";
import { ashby } from "./ats/ashby";
import { greenhouse } from "./ats/greenhouse";
import { lever } from "./ats/lever";

export type { SingleAtsJobDetails } from "./ats/types";

export const fetchGreenhouseCompanyJobs = (slug: string, keywords: string[] = []) => greenhouse.listJobs(slug, keywords);
export const fetchLeverCompanyJobs = (slug: string, keywords: string[] = []) => lever.listJobs(slug, keywords);
export const fetchAshbyCompanyJobs = (slug: string, keywords: string[] = []) => ashby.listJobs(slug, keywords);

export const fetchGreenhouseJobDetails = (slug: string, jobId: string) => greenhouse.getJob(slug, jobId);
export const fetchLeverJobDetails = (slug: string, jobId: string) => lever.getJob(slug, jobId);
export const fetchAshbyJobDetails = (slug: string, jobId: string) => ashby.getJob(slug, jobId);

/**
 * Dispatches company ATS searches across Greenhouse, Lever, and Ashby.
 */
export async function scrapeTargetCompanies(
  companies: string[],
  filterKeywords: string[] = [],
  limit?: number
): Promise<ScrapedJob[]> {
  const allJobs: ScrapedJob[] = [];
  const maxLimit = typeof limit === "number" && limit > 0 ? limit : Infinity;

  for (const company of companies) {
    if (allJobs.length >= maxLimit) break;
    const clean = company.trim().toLowerCase();
    if (!clean) continue;

    let found: ScrapedJob[] = [];
    for (const provider of [greenhouse, lever, ashby]) {
      found = await provider.listJobs(clean, filterKeywords);
      if (found.length > 0) break;
    }
    allJobs.push(...found);
  }
  return allJobs.slice(0, maxLimit);
}

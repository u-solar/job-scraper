// Thin compatibility layer over the per-platform modules in ./ats.
// Callers (scrape-jobs.ts, the import route) move to the modules in later tasks.
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

export { scrapeTargetCompanies } from "./ats/registry";

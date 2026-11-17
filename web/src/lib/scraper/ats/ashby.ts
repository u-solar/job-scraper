import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface AshbyJobItem {
  id: string;
  title?: string;
  location?: string;
  department?: string;
  employmentType?: string;
  jobUrl?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  publishedAt?: string;
}

const cleanSlug = (s: string) => s.trim().toLowerCase();

async function fetchBoard(slug: string, query = "", timeoutMs = LIST_TIMEOUT_MS): Promise<AshbyJobItem[] | null> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}${query}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (err: any) {
    console.warn(`[Ashby] Error fetching jobs for '${slug}':`, err.message);
    return null;
  }
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return null;
  return raw.map((item) => ({
    id: item.id,
    title: item.title?.trim() || "",
    department: item.department || undefined,
    url: item.jobUrl || `https://jobs.ashbyhq.com/${slug}/${item.id}`,
    companyName: companyFromSlug(slug),
  }));
}

async function listJobs(companySlug: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return [];

  const jobs: ScrapedJob[] = [];
  for (const item of raw) {
    if (opts.limit && jobs.length >= opts.limit) break;
    const jobId = `ashby_${slug}_${item.id}`;
    if (opts.skipJobIds?.has(jobId)) continue;

    const title = item.title?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, item.department || "")) continue;

    const markdown = convertHtmlToMarkdown(item.descriptionHtml || "") || `${title} at ${slug}`;
    jobs.push({
      job_id: jobId,
      company: companyFromSlug(slug),
      job_title: title,
      location: item.location?.trim() || (item.isRemote ? "Remote" : "Not specified"),
      level: item.employmentType || "Full-time",
      provider: "ashby",
      description: markdown,
      posted_at: item.publishedAt || new Date().toISOString(),
      workplace_type: item.isRemote ? "remote" : "onsite",
      application_url: item.jobUrl || `https://jobs.ashbyhq.com/${slug}/${item.id}`,
    });
  }

  console.log(`[Ashby] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

/**
 * Fetch a single job directly from Ashby's public job board API.
 * E.g. https://jobs.ashbyhq.com/supabase/62945518-2468-4cf5-9f36-904b60f75183
 */
async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  try {
    const raw = await fetchBoard(slug, "?includeCompensation=true", DETAIL_TIMEOUT_MS);
    const item = raw?.find((j) => j.id === jobId || String(j.id).toLowerCase() === jobId.toLowerCase());
    if (!item) return null;

    const title = item.title?.trim() || "";
    const markdown = convertHtmlToMarkdown(item.descriptionHtml || "") || `${title} at ${slug}`;
    const loc = item.location?.trim() || (item.isRemote ? "Remote" : "Not specified");

    const descLower = (title + " " + loc + " " + markdown.slice(0, 1000)).toLowerCase();
    let workplaceType: "remote" | "hybrid" | "onsite" = "onsite";
    if (item.isRemote === true || descLower.includes("remote")) {
      workplaceType = "remote";
    } else if (descLower.includes("hybrid")) {
      workplaceType = "hybrid";
    }

    return {
      job_id: `ashby_${slug}_${item.id}`,
      title,
      company: companyFromSlug(slug),
      location: loc,
      description: markdown,
      workplace_type: workplaceType,
      application_url: item.jobUrl || `https://jobs.ashbyhq.com/${slug}/${item.id}`,
      provider: "ashby",
    };
  } catch (err: any) {
    console.warn(`[Ashby] Failed to fetch single job '${jobId}' for '${slug}':`, err.message);
    return null;
  }
}

export const ashby: AtsProvider = {
  id: "ashby",
  label: "Ashby",
  jobIdPrefix: "ashby",
  listPostings,
  listJobs,
  getJob,
};

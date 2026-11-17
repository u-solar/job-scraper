import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface LeverJobItem {
  id: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
    department?: string;
  };
  description?: string;
  descriptionPlain?: string;
  createdAt?: number;
}

const cleanSlug = (s: string) => s.trim().toLowerCase();
const deptOf = (item: LeverJobItem) => item.categories?.team || item.categories?.department || "";

async function fetchBoard(slug: string): Promise<LeverJobItem[] | null> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[Lever] Fetch failed for '${slug}': HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (err: any) {
    console.warn(`[Lever] Error fetching jobs for '${slug}':`, err.message);
    return null;
  }
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return null;
  return raw.map((item) => ({
    id: item.id,
    title: item.text?.trim() || "",
    department: deptOf(item) || undefined,
    url: item.hostedUrl || item.applyUrl || `https://jobs.lever.co/${slug}/${item.id}`,
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
    const jobId = `lever_${slug}_${item.id}`;
    if (opts.skipJobIds?.has(jobId)) continue;

    const title = item.text?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, deptOf(item))) continue;

    const markdown = convertHtmlToMarkdown(item.description || "");
    if (!markdown || !markdown.trim()) continue;

    const loc = item.categories?.location?.trim() || "Remote";
    jobs.push({
      job_id: jobId,
      company: companyFromSlug(slug),
      job_title: title,
      location: loc,
      level: item.categories?.commitment || "Full-time",
      provider: "lever",
      description: markdown,
      posted_at: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
      workplace_type: workplaceFromText(title, loc, markdown),
      application_url: item.hostedUrl || item.applyUrl || `https://jobs.lever.co/${slug}/${item.id}`,
    });
  }

  console.log(`[Lever] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

/**
 * Fetch a single job directly from Lever's public postings API.
 * E.g. https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd
 */
async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const url = `https://api.lever.co/v0/postings/${slug}/${jobId}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const item = await res.json();
    const title = item.text?.trim() || "";
    if (!title) return null;

    let fullHtml = item.description || "";
    if (Array.isArray(item.lists)) {
      for (const list of item.lists) {
        if (list.text) fullHtml += `<h3>${list.text}</h3>`;
        if (list.content) fullHtml += `<ul>${list.content}</ul>`;
      }
    }
    if (item.additional) {
      fullHtml += item.additional;
    }

    const markdown = convertHtmlToMarkdown(fullHtml) || `${title} at ${slug}`;
    const loc = item.categories?.location?.trim() || "Not specified";

    const descLower = (title + " " + loc + " " + markdown.slice(0, 1000)).toLowerCase();
    let workplaceType: "remote" | "hybrid" | "onsite" = "onsite";
    if (item.workplaceType === "remote" || descLower.includes("remote")) {
      workplaceType = "remote";
    } else if (item.workplaceType === "hybrid" || descLower.includes("hybrid")) {
      workplaceType = "hybrid";
    }

    return {
      job_id: `lever_${slug}_${item.id}`,
      title,
      company: companyFromSlug(slug),
      location: loc,
      description: markdown,
      workplace_type: workplaceType,
      application_url: item.hostedUrl || item.applyUrl || `https://jobs.lever.co/${slug}/${item.id}`,
      provider: "lever",
    };
  } catch (err: any) {
    console.warn(`[Lever] Failed to fetch single job '${jobId}' for '${slug}':`, err.message);
    return null;
  }
}

export const lever: AtsProvider = {
  id: "lever",
  label: "Lever",
  jobIdPrefix: "lever",
  listPostings,
  listJobs,
  getJob,
};

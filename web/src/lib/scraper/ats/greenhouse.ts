import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface GreenhouseJobItem {
  id: number | string;
  title?: string;
  location?: { name?: string };
  absolute_url?: string;
  content?: string;
  updated_at?: string;
  departments?: Array<{ name?: string }>;
}

const cleanSlug = (s: string) => s.trim().toLowerCase();
const deptOf = (item: GreenhouseJobItem) => item.departments?.map((d) => d.name).join(" ") || "";

async function fetchBoard(slug: string): Promise<GreenhouseJobItem[] | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status === 404) {
        console.warn(`[Greenhouse] Company slug '${slug}' not found (404).`);
      } else {
        console.warn(`[Greenhouse] Fetch failed for '${slug}': HTTP ${res.status}`);
      }
      return null;
    }
    const data = await res.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (err: any) {
    console.warn(`[Greenhouse] Error fetching jobs for '${slug}':`, err.message);
    return null;
  }
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return null;
  return raw.map((item) => ({
    id: String(item.id),
    title: item.title?.trim() || "",
    department: deptOf(item) || undefined,
    url: item.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${item.id}`,
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
    const jobId = `gh_${slug}_${item.id}`;
    if (opts.skipJobIds?.has(jobId)) continue;

    const title = item.title?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, deptOf(item))) continue;

    const markdown = convertHtmlToMarkdown(item.content || "");
    if (!markdown || !markdown.trim()) continue;

    const loc = item.location?.name?.trim() || "Remote";
    jobs.push({
      job_id: jobId,
      company: companyFromSlug(slug),
      job_title: title,
      location: loc,
      level: "Not specified",
      provider: "greenhouse",
      description: markdown,
      posted_at: item.updated_at || new Date().toISOString(),
      workplace_type: workplaceFromText(title, loc, markdown),
      application_url: item.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${item.id}`,
    });
  }

  console.log(`[Greenhouse] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

/**
 * Fetch a single job directly from Greenhouse's public board API.
 * E.g. https://boards.greenhouse.io/stripe/jobs/8172487
 */
async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const item = await res.json();
    const title = item.title?.trim() || "";
    if (!title) return null;

    let rawHtml = item.content || "";
    if (rawHtml.includes("&lt;") && rawHtml.includes("&gt;")) {
      rawHtml = rawHtml
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
    }
    const markdown = convertHtmlToMarkdown(rawHtml) || `${title} at ${slug}`;
    const loc = item.location?.name?.trim() || "Not specified";

    return {
      job_id: `gh_${slug}_${item.id}`,
      title,
      company: companyFromSlug(slug),
      location: loc,
      description: markdown,
      workplace_type: workplaceFromText(title, loc, markdown),
      application_url: item.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${item.id}`,
      provider: "greenhouse",
    };
  } catch (err: any) {
    console.warn(`[Greenhouse] Failed to fetch single job '${jobId}' for '${slug}':`, err.message);
    return null;
  }
}

export const greenhouse: AtsProvider = {
  id: "greenhouse",
  label: "Greenhouse",
  jobIdPrefix: "gh",
  listPostings,
  listJobs,
  getJob,
};

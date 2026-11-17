import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface RecruiteeOffer {
  id: number;
  slug?: string;
  title?: string;
  department?: string | null;
  location?: string;
  description?: string;
  requirements?: string;
  careers_url?: string;
  company_name?: string;
  remote?: boolean;
  hybrid?: boolean;
  published_at?: string;
  created_at?: string;
}

const cleanSlug = (s: string) => s.trim().toLowerCase();
const companyOf = (slug: string, o: RecruiteeOffer) => o.company_name?.trim() || companyFromSlug(slug);
const urlOf = (slug: string, o: RecruiteeOffer) => o.careers_url || (o.slug ? `https://${slug}.recruitee.com/o/${o.slug}` : null);
const validIso = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

async function fetchBoard(slug: string, timeout = LIST_TIMEOUT_MS): Promise<RecruiteeOffer[] | null> {
  try {
    const res = await fetch(`https://${slug}.recruitee.com/api/offers/`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      console.warn(`[Recruitee] Fetch failed for '${slug}': HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data?.offers) ? data.offers : null;
  } catch (err: any) {
    console.warn(`[Recruitee] Error fetching jobs for '${slug}':`, err.message);
    return null;
  }
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return null;
  return raw.filter((o) => urlOf(slug, o)).map((o) => ({
    id: String(o.id),
    title: o.title?.trim() || "",
    department: o.department || undefined,
    url: urlOf(slug, o)!,
    companyName: companyOf(slug, o),
  }));
}

function toJob(slug: string, o: RecruiteeOffer): ScrapedJob | null {
  const title = o.title?.trim() || "";
  const markdown = convertHtmlToMarkdown(`${o.description || ""}${o.requirements || ""}`);
  const url = urlOf(slug, o);
  if (!title || !url || !markdown?.trim()) return null;
  const loc = o.location?.trim() || "Not specified";
  return {
    job_id: `recruitee_${slug}_${o.id}`,
    company: companyOf(slug, o),
    job_title: title,
    location: loc,
    level: "Full-time",
    provider: "recruitee",
    description: markdown,
    posted_at: validIso(o.published_at) || validIso(o.created_at) || new Date().toISOString(),
    workplace_type: o.remote ? "remote" : o.hybrid ? "hybrid" : workplaceFromText(title, loc, markdown),
    application_url: url,
  };
}

async function listJobs(companySlug: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return [];

  const jobs: ScrapedJob[] = [];
  for (const o of raw) {
    if (opts.limit && jobs.length >= opts.limit) break;
    if (opts.skipJobIds?.has(`recruitee_${slug}_${o.id}`)) continue;
    const title = o.title?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, o.department || undefined)) continue;
    const job = toJob(slug, o);
    if (job) jobs.push(job);
  }
  console.log(`[Recruitee] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

/** URLs carry the offer slug (/o/senior-designer); a numeric id works too. job_id uses the numeric id, as listJobs does. */
async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const offer = (await fetchBoard(slug, DETAIL_TIMEOUT_MS))?.find((o) => o.slug === jobId || String(o.id) === jobId);
  const job = offer ? toJob(slug, offer) : null;
  if (!job) return null;
  return {
    job_id: job.job_id,
    title: job.job_title!,
    company: job.company!,
    location: job.location!,
    description: job.description!,
    workplace_type: job.workplace_type ?? null,
    application_url: job.application_url!,
    provider: "recruitee",
  };
}

export const recruitee: AtsProvider = {
  id: "recruitee",
  label: "Recruitee",
  jobIdPrefix: "recruitee",
  listPostings,
  listJobs,
  getJob,
};

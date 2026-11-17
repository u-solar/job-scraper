import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, pacing, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface WorkableJob {
  shortcode: string;
  title?: string;
  department?: string[];
  location?: { city?: string; country?: string };
  remote?: boolean;
  workplace?: string;
  published?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
}

const API = "https://apply.workable.com/api";
const MAX_PAGES = 100;

const cleanSlug = (s: string) => s.trim().toLowerCase();
const jobIdOf = (slug: string, code: string) => `workable_${slug}_${code}`;
const urlOf = (slug: string, code: string) => `https://apply.workable.com/${slug}/j/${code}`;
const deptOf = (j: WorkableJob) => j.department?.[0] || undefined;
const validIso = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

async function request(url: string, label: string, timeout: number, body?: unknown): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      console.warn(`[Workable] Fetch failed for '${label}': HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[Workable] Error fetching jobs for '${label}':`, err.message);
    return null;
  }
}

/** All listed jobs, or null if the first page fails. A later failed page keeps what was read. */
async function fetchAllJobs(slug: string): Promise<WorkableJob[] | null> {
  const all: WorkableJob[] = [];
  let token = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request(`${API}/v3/accounts/${slug}/jobs`, slug, LIST_TIMEOUT_MS, { query: "", token });
    if (!data || !Array.isArray(data.results)) return page === 0 ? null : all;
    all.push(...data.results.filter((j: WorkableJob) => j?.shortcode));
    if (!data.nextPage) break;
    token = data.nextPage;
  }
  return all;
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchAllJobs(slug);
  if (!raw) return null;
  return raw.map((j) => ({
    id: j.shortcode,
    title: j.title?.trim() || "",
    department: deptOf(j),
    url: urlOf(slug, j.shortcode),
    companyName: companyFromSlug(slug),
  }));
}

/** `job` carries title, location and date; `detail` supplies the description. */
function toJob(slug: string, job: WorkableJob, detail: WorkableJob): ScrapedJob | null {
  const title = job.title?.trim() || "";
  const markdown = convertHtmlToMarkdown(`${detail.description || ""}${detail.requirements || ""}${detail.benefits || ""}`);
  if (!title || !markdown?.trim()) return null;
  const loc = [job.location?.city, job.location?.country].filter(Boolean).join(", ") || "Not specified";
  const workplace =
    job.remote || job.workplace === "remote" ? "remote" : job.workplace === "hybrid" ? "hybrid" : job.workplace === "on_site" ? "onsite" : workplaceFromText(title, loc, markdown);
  return {
    job_id: jobIdOf(slug, job.shortcode),
    company: companyFromSlug(slug),
    job_title: title,
    location: loc,
    level: "Full-time",
    provider: "workable",
    description: markdown,
    posted_at: validIso(job.published) || new Date().toISOString(),
    workplace_type: workplace,
    application_url: urlOf(slug, job.shortcode),
  };
}

const fetchDetail = (slug: string, code: string, timeout: number): Promise<WorkableJob | null> =>
  request(`${API}/v2/accounts/${slug}/jobs/${encodeURIComponent(code)}`, `${slug}/${code}`, timeout);

async function listJobs(companySlug: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchAllJobs(slug);
  if (!raw) return [];

  const jobs: ScrapedJob[] = [];
  let calls = 0;
  for (const j of raw) {
    if (opts.limit && jobs.length >= opts.limit) break;
    if (opts.skipJobIds?.has(jobIdOf(slug, j.shortcode))) continue;
    const title = j.title?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, deptOf(j))) continue;
    if (calls++ > 0) await pacing.wait();
    const detail = await fetchDetail(slug, j.shortcode, DETAIL_TIMEOUT_MS);
    const job = detail ? toJob(slug, j, detail) : null;
    if (job) jobs.push(job);
  }
  console.log(`[Workable] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const detail = await fetchDetail(slug, jobId, DETAIL_TIMEOUT_MS);
  const job = detail?.shortcode ? toJob(slug, detail, detail) : null;
  if (!job) return null;
  return {
    job_id: job.job_id,
    title: job.job_title!,
    company: job.company!,
    location: job.location!,
    description: job.description!,
    workplace_type: job.workplace_type ?? null,
    application_url: job.application_url!,
    provider: "workable",
  };
}

export const workable: AtsProvider = {
  id: "workable",
  label: "Workable",
  jobIdPrefix: "workable",
  listPostings,
  listJobs,
  getJob,
};

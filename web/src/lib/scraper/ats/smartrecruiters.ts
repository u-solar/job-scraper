import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, pacing, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface SrPosting {
  id: string;
  name?: string;
  company?: { name?: string };
  department?: { label?: string };
  function?: { label?: string };
  location?: { fullLocation?: string; city?: string; country?: string; remote?: boolean; hybrid?: boolean };
  releasedDate?: string;
  postingUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const SECTION_ORDER = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];

// The company id is case-sensitive in URLs; only job_id lowercases it.
const cleanId = (s: string) => s.trim();
const jobIdOf = (company: string, id: string) => `smartrecruiters_${company.toLowerCase()}_${id}`;
const urlOf = (company: string, p: SrPosting) => p.postingUrl || `https://jobs.smartrecruiters.com/${company}/${p.id}`;
const deptOf = (p: SrPosting) => p.department?.label || p.function?.label || undefined;
const validIso = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

async function fetchJson(url: string, label: string, timeout: number): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      console.warn(`[SmartRecruiters] Fetch failed for '${label}': HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[SmartRecruiters] Error fetching jobs for '${label}':`, err.message);
    return null;
  }
}

/** All postings of a company, or null if the first page fails. A later failed page keeps what was read. */
async function fetchAllPostings(company: string): Promise<SrPosting[] | null> {
  const all: SrPosting[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchJson(`${API}/${encodeURIComponent(company)}/postings?limit=${PAGE_SIZE}&offset=${offset}`, company, LIST_TIMEOUT_MS);
    if (!data || !Array.isArray(data.content)) return page === 0 ? null : all;
    all.push(...data.content.filter((p: SrPosting) => p?.id));
    offset += data.content.length;
    if (data.content.length === 0 || offset >= (Number(data.totalFound) || 0)) break;
  }
  return all;
}

async function listPostings(companyId: string): Promise<AtsPosting[] | null> {
  const company = cleanId(companyId);
  const raw = await fetchAllPostings(company);
  if (!raw) return null;
  return raw.map((p) => ({
    id: String(p.id),
    title: p.name?.trim() || "",
    department: deptOf(p),
    url: urlOf(company, p),
    companyName: p.company?.name?.trim() || companyFromSlug(company),
  }));
}

function toJob(company: string, p: SrPosting): ScrapedJob | null {
  const title = p.name?.trim() || "";
  const sections = p.jobAd?.sections || {};
  const html = SECTION_ORDER.map((k) => sections[k]).filter((s) => s?.text)
    .map((s) => `${s!.title ? `<h3>${s!.title}</h3>` : ""}${s!.text}`).join("");
  const markdown = convertHtmlToMarkdown(html);
  if (!title || !markdown?.trim()) return null;
  const l = p.location;
  const loc = l?.fullLocation?.replace(/(, )+/g, ", ").trim() || [l?.city, l?.country].filter(Boolean).join(", ") || "Not specified";
  return {
    job_id: jobIdOf(company, p.id),
    company: p.company?.name?.trim() || companyFromSlug(company),
    job_title: title,
    location: loc,
    level: "Full-time",
    provider: "smartrecruiters",
    description: markdown,
    posted_at: validIso(p.releasedDate) || new Date().toISOString(),
    workplace_type: l?.remote ? "remote" : l?.hybrid ? "hybrid" : workplaceFromText(title, loc, markdown),
    application_url: urlOf(company, p),
  };
}

const fetchDetail = (company: string, id: string, timeout: number): Promise<SrPosting | null> =>
  fetchJson(`${API}/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`, `${company}/${id}`, timeout);

async function listJobs(companyId: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const company = cleanId(companyId);
  const raw = await fetchAllPostings(company);
  if (!raw) return [];

  const jobs: ScrapedJob[] = [];
  let calls = 0;
  for (const p of raw) {
    if (opts.limit && jobs.length >= opts.limit) break;
    if (opts.skipJobIds?.has(jobIdOf(company, p.id))) continue;
    const title = p.name?.trim() || "";
    if (!title || !matchesKeywords(title, filterKeywords, deptOf(p))) continue;
    if (calls++ > 0) await pacing.wait();
    const detail = await fetchDetail(company, p.id, DETAIL_TIMEOUT_MS);
    const job = detail ? toJob(company, detail) : null;
    if (job) jobs.push(job);
  }
  console.log(`[SmartRecruiters] Extracted ${jobs.length} matching jobs for company '${company}'.`);
  return jobs;
}

/** Posting URLs look like /{id}-{title-slug}; the id is the leading digits. */
async function getJob(companyId: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const company = cleanId(companyId);
  const detail = await fetchDetail(company, jobId.split("-")[0], DETAIL_TIMEOUT_MS);
  const job = detail ? toJob(company, detail) : null;
  if (!job) return null;
  return {
    job_id: job.job_id,
    title: job.job_title!,
    company: job.company!,
    location: job.location!,
    description: job.description!,
    workplace_type: job.workplace_type ?? null,
    application_url: job.application_url!,
    provider: "smartrecruiters",
  };
}

export const smartrecruiters: AtsProvider = {
  id: "smartrecruiters",
  label: "SmartRecruiters",
  jobIdPrefix: "smartrecruiters",
  listPostings,
  listJobs,
  getJob,
};

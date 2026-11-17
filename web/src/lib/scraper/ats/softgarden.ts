import * as cheerio from "cheerio";
import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, pacing, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

const cleanSlug = (s: string) => s.trim().toLowerCase();
const base = (slug: string) => `https://${slug}.softgarden.io`;
const jobIdOf = (slug: string, id: string) => `softgarden_${slug}_${id}`;
const validIso = (v?: string) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

async function fetchHtml(url: string, label: string, timeout: number): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      console.warn(`[softgarden] Fetch failed for '${label}': HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn(`[softgarden] Error fetching jobs for '${label}':`, err.message);
    return null;
  }
}

/** Unique /job/{id}/ links with their text as title (the listing gives no department); null if the page is not a listing. */
async function fetchListing(slug: string): Promise<AtsPosting[] | null> {
  const html = await fetchHtml(`${base(slug)}/en/vacancies`, slug, LIST_TIMEOUT_MS);
  if (!html) return null;
  const $ = cheerio.load(html);
  // an empty board still renders the results container; an error or foreign page does not
  if (!$(".outputContainer, #job-search-pagination").length) {
    console.warn(`[softgarden] '${slug}' did not return a vacancies listing.`);
    return null;
  }
  const seen = new Set<string>();
  const postings: AtsPosting[] = [];
  $("a[href]").each((_, a) => {
    const m = ($(a).attr("href") || "").match(/\/job\/(\d+)(\/[^?#]*)?/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    postings.push({
      id: m[1],
      title: $(a).text().trim(),
      url: `${base(slug)}/job/${m[1]}${m[2] || ""}?l=en`,
      companyName: companyFromSlug(slug),
    });
  });
  return postings;
}

interface Address { addressLocality?: string; addressRegion?: string; addressCountry?: string }
interface JobLd {
  title?: string;
  description?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: Address } | Array<{ address?: Address }>;
}

async function fetchDetail(slug: string, id: string): Promise<JobLd | null> {
  const html = await fetchHtml(`${base(slug)}/job/${encodeURIComponent(id)}?l=en`, `${slug}/${id}`, DETAIL_TIMEOUT_MS);
  if (!html) return null;
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const found = (Array.isArray(data) ? data : [data]).find((d) => d?.["@type"] === "JobPosting");
      if (found) return found;
    } catch {
      // not valid JSON: try the next block
    }
  }
  console.warn(`[softgarden] No JobPosting data on '${slug}/${id}'.`);
  return null;
}

function toJob(slug: string, posting: AtsPosting, ld: JobLd): ScrapedJob | null {
  const title = ld.title?.trim() || posting.title;
  const markdown = convertHtmlToMarkdown(ld.description || "");
  if (!title || !markdown?.trim()) return null;
  const a = (Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation)?.address;
  const loc = [a?.addressLocality, a?.addressRegion, a?.addressCountry].filter(Boolean).join(", ") || "Not specified";
  return {
    job_id: jobIdOf(slug, posting.id),
    company: ld.hiringOrganization?.name?.trim() || companyFromSlug(slug),
    job_title: title,
    location: loc,
    level: "Full-time",
    provider: "softgarden",
    description: markdown,
    posted_at: validIso(ld.datePosted) || new Date().toISOString(),
    workplace_type: workplaceFromText(title, loc, markdown),
    application_url: posting.url,
  };
}

const listPostings = (companySlug: string) => fetchListing(cleanSlug(companySlug));

async function listJobs(companySlug: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const slug = cleanSlug(companySlug);
  const postings = await fetchListing(slug);
  if (!postings) return [];

  const jobs: ScrapedJob[] = [];
  let calls = 0;
  for (const p of postings) {
    if (opts.limit && jobs.length >= opts.limit) break;
    if (opts.skipJobIds?.has(jobIdOf(slug, p.id))) continue;
    if (!p.title || !matchesKeywords(p.title, filterKeywords)) continue;
    if (calls++ > 0) await pacing.wait();
    const ld = await fetchDetail(slug, p.id);
    const job = ld ? toJob(slug, p, ld) : null;
    if (job) jobs.push(job);
  }
  console.log(`[softgarden] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const ld = await fetchDetail(slug, jobId);
  const job = ld ? toJob(slug, { id: jobId, title: "", url: `${base(slug)}/job/${jobId}?l=en` }, ld) : null;
  if (!job) return null;
  return {
    job_id: job.job_id,
    title: job.job_title!,
    company: job.company!,
    location: job.location!,
    description: job.description!,
    workplace_type: job.workplace_type ?? null,
    application_url: job.application_url!,
    provider: "softgarden",
  };
}

export const softgarden: AtsProvider = {
  id: "softgarden",
  label: "softgarden",
  jobIdPrefix: "softgarden",
  listPostings,
  listJobs,
  getJob,
};

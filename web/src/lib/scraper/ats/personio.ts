import * as cheerio from "cheerio";
import type { ScrapedJob } from "../types";
import { convertHtmlToMarkdown } from "../html-to-markdown";
import { DETAIL_TIMEOUT_MS, LIST_TIMEOUT_MS, companyFromSlug, matchesKeywords, workplaceFromText } from "./shared";
import type { AtsPosting, AtsProvider, ListJobsOptions, SingleAtsJobDetails } from "./types";

interface PersonioPosition {
  id: string;
  title: string;
  department: string;
  office: string;
  descriptionHtml: string;
  createdAt: string;
  url: string;
}

const cleanSlug = (s: string) => s.trim().toLowerCase();

/** Fetches the XML feed on .de, falling back to .com when .de has no such board. */
async function fetchBoard(slug: string, timeout = LIST_TIMEOUT_MS): Promise<PersonioPosition[] | null> {
  for (const tld of ["de", "com"]) {
    const base = `https://${slug}.jobs.personio.${tld}`;
    try {
      const res = await fetch(`${base}/xml`, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) {
        if (res.status === 404 && tld === "de") continue;
        console.warn(`[Personio] Fetch failed for '${slug}': HTTP ${res.status}`);
        return null;
      }
      const $ = cheerio.load(await res.text(), { xmlMode: true });
      if ($("workzag-jobs").length === 0) {
        if (tld === "de") continue;
        console.warn(`[Personio] Unexpected response for '${slug}'`);
        return null;
      }
      return $("position")
        .toArray()
        .map((el) => {
          const p = $(el);
          const text = (sel: string) => p.children(sel).first().text().trim();
          const id = text("id");
          const descriptionHtml = p
            .find("jobDescription")
            .toArray()
            .map((d) => {
              const name = $(d).children("name").text().trim();
              const value = $(d).children("value").text().trim();
              return value ? `${name ? `<h3>${name}</h3>` : ""}${value}` : "";
            })
            .join("");
          return {
            id,
            title: text("name"),
            department: text("department"),
            office: text("office"),
            descriptionHtml,
            createdAt: text("createdAt"),
            url: `${base}/job/${id}`,
          };
        })
        .filter((p) => p.id);
    } catch (err: any) {
      if (tld === "de") continue;
      console.warn(`[Personio] Error fetching jobs for '${slug}':`, err.message);
      return null;
    }
  }
  console.warn(`[Personio] Board '${slug}' not found`);
  return null;
}

async function listPostings(companySlug: string): Promise<AtsPosting[] | null> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return null;
  return raw.map((p) => ({
    id: p.id,
    title: p.title,
    department: p.department || undefined,
    url: p.url,
    companyName: companyFromSlug(slug),
  }));
}

function toJob(slug: string, p: PersonioPosition): ScrapedJob | null {
  const markdown = convertHtmlToMarkdown(p.descriptionHtml);
  if (!p.title || !markdown?.trim()) return null;
  const loc = p.office || "Not specified";
  const created = p.createdAt ? new Date(p.createdAt) : null;
  return {
    job_id: `personio_${slug}_${p.id}`,
    company: companyFromSlug(slug),
    job_title: p.title,
    location: loc,
    level: "Full-time",
    provider: "personio",
    description: markdown,
    posted_at: created && !isNaN(created.getTime()) ? created.toISOString() : new Date().toISOString(),
    workplace_type: workplaceFromText(p.title, loc, markdown),
    application_url: p.url,
  };
}

async function listJobs(companySlug: string, filterKeywords: string[] = [], opts: ListJobsOptions = {}): Promise<ScrapedJob[]> {
  const slug = cleanSlug(companySlug);
  const raw = await fetchBoard(slug);
  if (!raw) return [];

  const jobs: ScrapedJob[] = [];
  for (const p of raw) {
    if (opts.limit && jobs.length >= opts.limit) break;
    if (opts.skipJobIds?.has(`personio_${slug}_${p.id}`)) continue;
    if (!p.title || !matchesKeywords(p.title, filterKeywords, p.department)) continue;
    const job = toJob(slug, p);
    if (job) jobs.push(job);
  }
  console.log(`[Personio] Extracted ${jobs.length} matching jobs for company '${slug}'.`);
  return jobs;
}

async function getJob(companySlug: string, jobId: string): Promise<SingleAtsJobDetails | null> {
  const slug = cleanSlug(companySlug);
  const p = (await fetchBoard(slug, DETAIL_TIMEOUT_MS))?.find((x) => x.id === jobId);
  const job = p ? toJob(slug, p) : null;
  if (!job) return null;
  return {
    job_id: job.job_id,
    title: job.job_title!,
    company: job.company!,
    location: job.location!,
    description: job.description!,
    workplace_type: job.workplace_type ?? null,
    application_url: job.application_url!,
    provider: "personio",
  };
}

export const personio: AtsProvider = {
  id: "personio",
  label: "Personio",
  jobIdPrefix: "personio",
  listPostings,
  listJobs,
  getJob,
};

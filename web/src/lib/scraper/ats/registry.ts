import type { ScrapedJob } from "../types";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { personio } from "./personio";
import { recruitee } from "./recruitee";
import type { AtsProvider, AtsProviderId, ListJobsOptions, SingleAtsJobDetails } from "./types";
import { describeCompanyEntry, parseAtsUrl } from "./urls";

export { ATS_PROVIDER_IDS, ATS_PROVIDER_META, describeCompanyEntry, parseAtsUrl } from "./urls";

// Partial until every platform module exists; resolveCompanyEntry treats a missing one as unsupported.
export const ATS_PROVIDERS: Partial<Record<AtsProviderId, AtsProvider>> = { greenhouse, lever, ashby, personio, recruitee };

const BARE_SLUG_ORDER = [greenhouse, lever, ashby];

export function resolveCompanyEntry(entry: string): { providers: AtsProvider[]; slug: string } | null {
  const d = describeCompanyEntry(entry);
  if (d.kind === "slug") return { providers: BARE_SLUG_ORDER, slug: d.slug };
  if (d.kind === "url") {
    const p = ATS_PROVIDERS[d.providerId];
    return p ? { providers: [p], slug: d.slug } : null;
  }
  return null;
}

export async function scrapeTargetCompanies(
  entries: string[],
  keywords: string[] = [],
  opts: ListJobsOptions = {}
): Promise<ScrapedJob[]> {
  const all: ScrapedJob[] = [];
  const max = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : Infinity;
  const scraped = new Set<string>(); // providerId:slug boards already done in this run
  const seenJobIds = new Set<string>();

  for (const entry of entries) {
    if (all.length >= max) break;
    const resolved = resolveCompanyEntry(entry);
    if (!resolved) {
      console.log(`[ATS] Skipping unsupported company entry '${entry.trim()}'.`);
      continue;
    }
    const isUrl = resolved.providers.length === 1;

    for (const provider of resolved.providers) {
      const key = `${provider.id}:${resolved.slug.toLowerCase()}`;
      if (scraped.has(key)) {
        if (isUrl) break;
        continue;
      }
      if (isUrl) scraped.add(key);
      const room = max - all.length;
      // URL entries push skip/limit down. Bare slugs probe unfiltered so a fully-saved board still
      // stops the fall-through (no cross-company slug collisions), then skip/limit are applied here.
      const listed = await provider.listJobs(
        resolved.slug,
        keywords,
        isUrl ? { limit: room === Infinity ? undefined : room, skipJobIds: opts.skipJobIds } : undefined
      );
      if (listed.length === 0) continue;
      scraped.add(key);
      const fresh = listed
        .filter((j) => !opts.skipJobIds?.has(j.job_id) && !seenJobIds.has(j.job_id))
        .slice(0, room);
      fresh.forEach((j) => seenJobIds.add(j.job_id));
      all.push(...fresh);
      break;
    }
  }
  return all.slice(0, max);
}

export async function fetchAtsJobFromUrl(url: string): Promise<SingleAtsJobDetails | null> {
  const parsed = parseAtsUrl(url);
  const provider = parsed && ATS_PROVIDERS[parsed.providerId];
  if (!parsed || !provider || !parsed.jobId) return null;
  return provider.getJob(parsed.slug, parsed.jobId);
}

import type { ScrapedJob } from "../types";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import type { AtsProvider, AtsProviderId, ListJobsOptions, SingleAtsJobDetails } from "./types";
import { describeCompanyEntry, parseAtsUrl } from "./urls";

export { ATS_PROVIDER_IDS, ATS_PROVIDER_META, describeCompanyEntry, parseAtsUrl } from "./urls";

// Partial until every platform module exists; resolveCompanyEntry treats a missing one as unsupported.
export const ATS_PROVIDERS: Partial<Record<AtsProviderId, AtsProvider>> = { greenhouse, lever, ashby };

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
  const seen = new Set<string>();

  for (const entry of entries) {
    if (all.length >= max) break;
    const resolved = resolveCompanyEntry(entry);
    if (!resolved) {
      console.log(`[ATS] Skipping unsupported company entry '${entry.trim()}'.`);
      continue;
    }
    const key = `${resolved.providers.map((p) => p.id).join("|")}:${resolved.slug.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    for (const provider of resolved.providers) {
      const found = await provider.listJobs(resolved.slug, keywords, {
        limit: max === Infinity ? undefined : max - all.length,
        skipJobIds: opts.skipJobIds,
      });
      if (found.length > 0) {
        all.push(...found);
        break;
      }
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

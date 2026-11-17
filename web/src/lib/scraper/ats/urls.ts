// Pure URL recognition. Must stay import-free: client components import it.
export type AtsProviderId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "personio"
  | "softgarden"
  | "recruitee"
  | "smartrecruiters"
  | "workable";

export const ATS_PROVIDER_META: { id: AtsProviderId; label: string }[] = [
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
  { id: "ashby", label: "Ashby" },
  { id: "personio", label: "Personio" },
  { id: "softgarden", label: "softgarden" },
  { id: "recruitee", label: "Recruitee" },
  { id: "smartrecruiters", label: "SmartRecruiters" },
  { id: "workable", label: "Workable" },
];

export const ATS_PROVIDER_IDS: AtsProviderId[] = ATS_PROVIDER_META.map((m) => m.id);

export interface ParsedAtsUrl {
  providerId: AtsProviderId;
  slug: string;
  jobId?: string;
}

const SLUG_RE = /^[a-z0-9_-]+$/i;
const LANG_RE = /^[a-z]{2}(-[a-z]{2})?$/i;
const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function toUrl(input: string): URL | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

export function parseAtsUrl(input: string): ParsedAtsUrl | null {
  const u = toUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  // Language-prefixed paths (/en/job/…, /de-at/o/…) for hosts where the slug is in the hostname.
  const noLang = LANG_RE.test(seg[0] ?? "") ? seg.slice(1) : seg;
  const make = (providerId: AtsProviderId, slug: string | undefined, jobId?: string): ParsedAtsUrl | null =>
    slug
      ? { providerId, slug: providerId === "smartrecruiters" ? slug : slug.toLowerCase(), ...(jobId ? { jobId } : {}) }
      : null;

  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    if (seg[0] === "embed" && seg[1] === "job_app") {
      return make("greenhouse", u.searchParams.get("for") ?? undefined, u.searchParams.get("token") ?? undefined);
    }
    return make("greenhouse", seg[0], seg[1] === "jobs" ? seg[2] : undefined);
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) return make("lever", seg[0], seg[1]);
  if (host === "jobs.ashbyhq.com") return make("ashby", seg[0], seg[1] && UUID_RE.test(seg[1]) ? seg[1] : undefined);

  let m = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(de|com)$/);
  if (m) return make("personio", m[1], noLang[0] === "job" ? noLang[1] : undefined);

  m = host.match(/^([a-z0-9-]+)\.softgarden\.io$/);
  if (m) {
    return make("softgarden", m[1], noLang[0] === "job" ? noLang[1] : undefined);
  }

  m = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (m) return make("recruitee", m[1], noLang[0] === "o" ? noLang[1] : undefined);

  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host)) {
    return make("smartrecruiters", seg[0], seg[1]?.match(/^\d+/)?.[0] ?? seg[1]);
  }
  if (host === "apply.workable.com") {
    // /en/{slug}/j/{code}: only a language prefix when "j" follows the next segment, so 2-letter slugs still work
    const w = LANG_RE.test(seg[0] ?? "") && seg[2] === "j" ? seg.slice(1) : seg;
    return make("workable", w[0], w[1] === "j" ? w[2] : undefined);
  }
  return null;
}

export function describeCompanyEntry(
  entry: string
):
  | { kind: "url"; providerId: AtsProviderId; label: string; slug: string }
  | { kind: "slug"; slug: string }
  | { kind: "unsupported" } {
  const e = entry.trim();
  if (SLUG_RE.test(e)) return { kind: "slug", slug: e.toLowerCase() };
  const p = parseAtsUrl(e);
  if (!p) return { kind: "unsupported" };
  return {
    kind: "url",
    providerId: p.providerId,
    label: ATS_PROVIDER_META.find((m) => m.id === p.providerId)!.label,
    slug: p.slug,
  };
}

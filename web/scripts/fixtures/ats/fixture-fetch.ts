import fs from "fs";
import path from "path";

export const FIXTURE_DIR = __dirname;
export const GOLDEN_DIR = path.join(FIXTURE_DIR, "golden");

/**
 * Replaces globalThis.fetch with a stub that serves fixture files by URL prefix
 * (longest prefix wins). A route mapped to "404" answers 404; an unmatched URL throws.
 * Fixture paths are relative to this directory. Returns a restore function.
 */
export function installFixtureFetch(routes: Record<string, string>): () => void {
  const original = globalThis.fetch;
  const prefixes = Object.keys(routes).sort((a, b) => b.length - a.length);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const prefix = prefixes.find((p) => url.startsWith(p));
    if (!prefix) throw new Error(`installFixtureFetch: no fixture route for ${url}`);
    const target = routes[prefix];
    if (target === "404") return new Response("not found", { status: 404 });
    const body = fs.readFileSync(path.join(FIXTURE_DIR, target), "utf8");
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

export const KEYWORDS = ["Product Designer", "UX Designer", "UX Lead", "Head of UX"];

export interface GoldenCase {
  name: string;
  provider: "greenhouse" | "lever" | "ashby";
  kind: "list" | "job";
  slug: string;
  keywords: string[];
  jobId: string;
  routes: Record<string, string>;
}

const GH = "https://boards-api.greenhouse.io/v1/boards/";
const LEVER = "https://api.lever.co/v0/postings/";
const ASHBY = "https://api.ashbyhq.com/posting-api/job-board/";

const lists: Array<Pick<GoldenCase, "provider" | "slug" | "routes">> = [
  { provider: "greenhouse", slug: "bitpanda", routes: { [`${GH}bitpanda/jobs?content=true`]: "greenhouse/bitpanda-list.json" } },
  { provider: "lever", slug: "spotify", routes: { [`${LEVER}spotify?mode=json`]: "lever/spotify-list.json" } },
  { provider: "ashby", slug: "n8n", routes: { [`${ASHBY}n8n`]: "ashby/n8n.json" } },
  { provider: "ashby", slug: "wayflyer", routes: { [`${ASHBY}wayflyer`]: "ashby/wayflyer.json" } },
];

export const goldenCases: GoldenCase[] = [
  ...lists.flatMap((l): GoldenCase[] => [
    { ...l, kind: "list", name: `${l.provider}-${l.slug}-keywords`, keywords: KEYWORDS, jobId: "" },
    { ...l, kind: "list", name: `${l.provider}-${l.slug}-all`, keywords: [], jobId: "" },
  ]),
  {
    name: "greenhouse-bitpanda-job", provider: "greenhouse", kind: "job", slug: "bitpanda", keywords: [], jobId: "5009825101",
    routes: { [`${GH}bitpanda/jobs/5009825101`]: "greenhouse/bitpanda-job.json" },
  },
  {
    name: "lever-spotify-job", provider: "lever", kind: "job", slug: "spotify", keywords: [], jobId: "a9d581f9-1361-4227-b230-94a0d6ffdef4",
    routes: { [`${LEVER}spotify/a9d581f9-1361-4227-b230-94a0d6ffdef4`]: "lever/spotify-job.json" },
  },
  {
    name: "ashby-n8n-job", provider: "ashby", kind: "job", slug: "n8n", keywords: [], jobId: "fe05c209-8069-4a88-aeba-8da23488cd30",
    routes: { [`${ASHBY}n8n?includeCompensation=true`]: "ashby/n8n.json" },
  },
  {
    name: "ashby-n8n-job-missing", provider: "ashby", kind: "job", slug: "n8n", keywords: [], jobId: "does-not-exist",
    routes: { [`${ASHBY}n8n?includeCompensation=true`]: "ashby/n8n.json" },
  },
  {
    name: "greenhouse-missing-board", provider: "greenhouse", kind: "list", slug: "nope", keywords: [], jobId: "",
    routes: { [`${GH}nope/`]: "404" },
  },
];

/** Replaces posted_at values that fell back to "now" so runs compare equal. */
export function normalizeNow<T>(value: T): T {
  const now = Date.now();
  return JSON.parse(JSON.stringify(value), (k, v) =>
    k === "posted_at" && typeof v === "string" && Math.abs(Date.parse(v) - now) < 120_000 ? "<now>" : v
  );
}

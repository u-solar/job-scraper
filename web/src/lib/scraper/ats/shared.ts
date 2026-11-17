const KNOWN_CONCEPTS: Array<{ name: string; keywords: string[] }> = [
  { name: "full stack", keywords: ["full stack", "fullstack"] },
  { name: "solutions", keywords: ["solutions", "solution", "solutions architect", "solution architect", "solutions engineer", "solution engineer"] },
  { name: "product support", keywords: ["product support", "support engineer", "technical support", "application support", "customer engineer", "database support", "support specialist"] },
  { name: "integration", keywords: ["integration", "integrations", "integration engineer"] },
  { name: "internal tools", keywords: ["internal tools", "tools engineer", "tooling"] },
  { name: "backend", keywords: ["backend", "back end"] },
  { name: "frontend", keywords: ["frontend", "front end"] },
  { name: "devops", keywords: ["devops", "platform", "infrastructure", "sre", "cloud", "site reliability"] },
  { name: "ai / ml", keywords: ["ai", "machine learning", "ml", "nlp", "llm"] },
  { name: "data", keywords: ["data engineer", "data analyst", "data scientist"] },
];

const STOP_WORDS = new Set(["and", "or", "the", "in", "of", "for", "with", "&", "a", "an", "at"]);
const ROLE_WORDS = new Set(["engineer", "developer", "dev", "architect", "programmer", "specialist", "consultant", "lead", "manager", "analyst", "staff", "senior", "junior", "head", "vp", "director"]);
const NON_TECH_REGEX = /\b(nurse|registered nurse|medical|dental|doctor|accountant|accounting|wedding|property manager|real estate|teacher|tutor|flight attendant|human resources|recruiter|recruiting|talent acquisition|business development|sales executive|account executive|general practitioner|compliance administrator|contracts manager|procurement|executive assistant|video producer|marketing manager|operations|growth manager)\b/i;

function normalizeTitle(s: string): string {
  return s.toLowerCase()
    .replace(/\bdeveloper\b/g, "engineer")
    .replace(/\bdev\b/g, "engineer")
    .replace(/\bfullstack\b/g, "full stack")
    .replace(/\bfront[- ]end\b/g, "frontend")
    .replace(/\bback[- ]end\b/g, "backend");
}

/**
 * Normalizes query matching against job title and optional department.
 */
export function matchesKeywords(title: string, keywords: string[], department?: string): boolean {
  if (!keywords || keywords.length === 0) return true;
  if (NON_TECH_REGEX.test(title)) return false;

  const rawTitle = title.toLowerCase();
  const normTitle = normalizeTitle(rawTitle);
  const rawDept = (department || "").toLowerCase();
  const normDept = normalizeTitle(rawDept);
  const combined = rawDept ? `${normTitle} ${normDept}` : normTitle;

  for (const q of keywords) {
    const rawQ = q.trim().toLowerCase();
    if (!rawQ) continue;
    const normQ = normalizeTitle(rawQ);

    // 1. Direct or normalized substring either way
    if (rawTitle.includes(rawQ) || normTitle.includes(normQ) || combined.includes(normQ)) return true;
    if (normQ.includes(normTitle)) return true;

    // 2. Token overlap: all non-stop, non-role domain tokens in query exist in title/department
    const queryTokens = rawQ.split(/\s+/).filter((w) => !STOP_WORDS.has(w));
    const domainTokens = queryTokens.filter((w) => !ROLE_WORDS.has(w));
    if (domainTokens.length > 0 && domainTokens.every((t) => combined.includes(t))) {
      return true;
    }

    // 3. Concept matching
    for (const concept of KNOWN_CONCEPTS) {
      const queryMatchesConcept = concept.keywords.some((k) => rawQ.includes(k));
      if (queryMatchesConcept) {
        if (concept.keywords.some((k) => combined.includes(k))) return true;
      }
    }
  }

  return false;
}

/** Capitalised slug, used as the company name for boards that expose none. */
export function companyFromSlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Workplace type guess from title, location and the start of the description. */
export function workplaceFromText(title: string, loc: string, markdown: string): "remote" | "hybrid" | "onsite" {
  const t = (title + " " + loc + " " + markdown.slice(0, 1000)).toLowerCase();
  return t.includes("remote") ? "remote" : t.includes("hybrid") ? "hybrid" : "onsite";
}

export const LIST_TIMEOUT_MS = 20000;
export const DETAIL_TIMEOUT_MS = 15000;

/** Pause between per-job detail calls (300-800 ms). Tests replace `wait` so the suite does not sleep. */
export const pacing = { wait: (): Promise<void> => new Promise((r) => setTimeout(r, 300 + Math.random() * 500)) };

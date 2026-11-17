import { resolveCompanyEntry } from "../../../../lib/scraper/ats/registry";
import { describeCompanyEntry } from "../../../../lib/scraper/ats/urls";

// Live check for a Settings entry: which board does it resolve to and how many jobs are open.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const entry = typeof body?.entry === "string" ? body.entry : "";
  const resolved = resolveCompanyEntry(entry);
  if (!resolved) return Response.json({ supported: false });

  const { slug } = resolved;
  // Bare slugs try providers in order and report the first board found.
  for (const provider of resolved.providers) {
    const postings = await provider.listPostings(slug);
    if (postings) {
      return Response.json({
        supported: true,
        providerId: provider.id,
        label: provider.label,
        slug,
        companyName: postings.find((p) => p.companyName)?.companyName ?? slug.charAt(0).toUpperCase() + slug.slice(1),
        openJobs: postings.length,
      });
    }
  }
  const d = describeCompanyEntry(entry);
  return Response.json({
    supported: true,
    found: false,
    providerId: resolved.providers[0].id,
    label: d.kind === "url" ? d.label : "Greenhouse / Lever / Ashby",
    slug,
  });
}

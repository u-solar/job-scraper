import type { ScrapedJob } from "../types";

import type { AtsProviderId } from "./urls";

export type { AtsProviderId };

export interface AtsPosting {
  id: string;
  title: string;
  department?: string;
  url: string;
  companyName?: string;
}

export interface ListJobsOptions {
  limit?: number;
  skipJobIds?: Set<string>;
}

export interface SingleAtsJobDetails {
  job_id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  workplace_type: "remote" | "hybrid" | "onsite" | null;
  application_url: string;
  provider: AtsProviderId;
}

export interface AtsProvider {
  id: AtsProviderId;
  label: string;
  jobIdPrefix: string;
  /** null = board not found / request failed */
  listPostings(slug: string): Promise<AtsPosting[] | null>;
  listJobs(slug: string, keywords: string[], opts?: ListJobsOptions): Promise<ScrapedJob[]>;
  getJob(slug: string, jobId: string): Promise<SingleAtsJobDetails | null>;
}

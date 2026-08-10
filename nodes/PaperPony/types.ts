/**
 * The wire shapes this node reads, restated.
 *
 * PaperPony declares these shapes once, in the package its API is built from,
 * and importing them would be the obvious thing to do. It is not allowed: n8n's
 * verification guidelines refuse a community node with external runtime
 * dependencies, so anything imported would either become one or leave a
 * dangling reference in the published tarball. The official `paperpony` SDK on
 * npm restates them for a related reason.
 *
 * So this file is duplication, on purpose, and the way it is kept honest is
 * `test/contract.test.ts`, which checks every field named here against
 * `integration-surface.json`, generated from the API's openapi document and
 * vendored beside this file. Test code never ships, so the check costs nothing
 * at runtime and fails the build when the API changes shape.
 *
 * Only the fields the node actually uses appear here. A field the node ignores
 * is a field that cannot drift.
 */

export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

export interface JobView {
  id: string;
  status: JobStatus;
  product: string;
  mode: 'sync' | 'async';
  template_id: string | null;
  /** Signed, and re-signed on every read of the job. Never store it. */
  output_url: string | null;
  output_bytes: number | null;
  output_expires_at: string | null;
  page_count: number | null;
  credits_charged: number;
  credits_remaining: number;
  /** True on the free plan, where the PDF carries a stamp. */
  watermarked: boolean;
  error: { code: string; message: string } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TemplateView {
  id: string;
  name: string;
  slug: string;
  archived_at: string | null;
}

export interface PaginatedList<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** Spec §6. Every error in the API has this shape, with no exceptions. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    doc_url?: string;
    request_id?: string;
    /** Present when a job row exists for the failure, so its detail is readable. */
    job_id?: string;
  };
}

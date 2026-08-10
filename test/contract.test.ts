import { describe, expect, it } from 'vitest';
// Imported rather than read with `node:fs`, and not for tidiness: the community
// node lint refuses any `node:` import anywhere in the package, tests included,
// because on n8n Cloud a node has no filesystem to reach for. Vitest inlines
// these at transform time, so the check still runs against the real documents.
import manifest from '../package.json';
import surface from '../integration-surface.json';
import { NODE_VERSION } from '../nodes/PaperPony/constants';
import { TRANSLATED_CODES } from '../nodes/PaperPony/errors';
import type { JobView, TemplateView } from '../nodes/PaperPony/types';

/**
 * `nodes/PaperPony/types.ts` restates the API's wire shapes, because a verified
 * community node may carry no runtime dependencies and so cannot import the
 * API's contracts package. Duplication that nothing checks is duplication that
 * drifts, and the way it would show up is a node silently reading `undefined`
 * from a field the API renamed.
 *
 * So the copy is checked against `integration-surface.json`, which is generated from
 * the API's openapi document in the PaperPony repository and vendored here. It
 * has already earned its keep: the node was written believing a running job is
 * `running`, and the API calls it `processing`.
 *
 * **Why a vendored file rather than fetching the document.** These used to live
 * in one repository, where one commit changed both and one run proved it. They
 * are two repositories now, because npm will not attest provenance for a package
 * whose source is private and n8n will not verify a node published without it.
 * The obvious replacement, fetching the API's openapi document over the network,
 * is worse than the problem it solves: a check that reaches the internet goes
 * red when somebody else has a bad afternoon, and a check that goes red for
 * unrelated reasons is a check people learn to skip. A vendored copy is instead
 * always in agreement, because it changes in the same commit as the node.
 *
 * What that costs is honest and worth stating: this file cannot tell you the
 * vendored copy is out of date. The PaperPony repository fails its own build the
 * moment the API surface moves, and updating this file is the next step in that
 * procedure rather than something discovered here.
 *
 * The two `Record<keyof T, true>` maps are the other half. TypeScript refuses
 * to compile them if a field is added to the type and not to the list, so the
 * runtime check cannot fall behind the types it is checking.
 */

const JOB_FIELDS: Record<keyof JobView, true> = {
  id: true,
  status: true,
  product: true,
  mode: true,
  template_id: true,
  output_url: true,
  output_bytes: true,
  output_expires_at: true,
  page_count: true,
  credits_charged: true,
  credits_remaining: true,
  watermarked: true,
  error: true,
  created_at: true,
  started_at: true,
  finished_at: true,
};

const TEMPLATE_FIELDS: Record<keyof TemplateView, true> = {
  id: true,
  name: true,
  slug: true,
  archived_at: true,
};

describe('the vendored surface', () => {
  /**
   * A surface that arrived empty would make every check below vacuously true,
   * which is the failure a copied file is most likely to have.
   */
  it('is a document with something in it', () => {
    expect(surface.job.fields.length).toBeGreaterThan(10);
    expect(surface.template.fields.length).toBeGreaterThan(3);
    expect(surface.error.codes.length).toBeGreaterThan(10);
  });

  it('says where it came from, for whoever opens it next', () => {
    expect(surface.$comment).toMatch(/generated/i);
  });
});

describe('the job shape this node reads', () => {
  it.each(Object.keys(JOB_FIELDS))('is still called %s in the API', (field) => {
    expect(surface.job.fields).toContain(field);
  });

  it('still has the four statuses the node branches on', () => {
    expect([...surface.job.statuses].sort()).toEqual([
      'failed',
      'processing',
      'queued',
      'succeeded',
    ]);
  });
});

describe('the template shape this node reads', () => {
  it.each(Object.keys(TEMPLATE_FIELDS))('is still called %s in the API', (field) => {
    expect(surface.template.fields).toContain(field);
  });
});

describe('the error envelope', () => {
  it.each(['code', 'message'])('still carries %s, which the translation keys on', (field) => {
    expect(surface.error.envelopeFields).toContain(field);
  });

  /**
   * The check that keeps the translation honest in both directions. A code the
   * API gains and this node has not translated shows the reader a fallback that
   * explains nothing; a sentence for a code the API no longer answers with is
   * text nobody will ever see and nobody will think to delete.
   */
  it('is translated code for code, with nothing left over on either side', () => {
    expect([...TRANSLATED_CODES].sort()).toEqual([...surface.error.codes].sort());
  });
});

describe('the version the node reports', () => {
  it('matches package.json, because it is written out rather than read', () => {
    expect(NODE_VERSION).toBe(manifest.version);
  });

  /**
   * The rule that decides the whole design of this package: n8n refuses to
   * verify a community node with runtime dependencies. One `npm install` in the
   * wrong directory would break it quietly, so it is asserted rather than
   * remembered.
   */
  it('ships with no runtime dependencies, which verification requires', () => {
    const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies;
    expect(dependencies ?? {}).toEqual({});
  });
});

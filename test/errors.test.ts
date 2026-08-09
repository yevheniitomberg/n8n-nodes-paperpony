import { describe, expect, it } from 'vitest';
import {
  TRANSLATED_CODES,
  plainMessageFor,
  plainMessageForFailedJob,
  toNodeApiError,
} from '../nodes/PaperPony/errors';
import type { ApiFailure } from '../nodes/PaperPony/errors';
import type { INode } from 'n8n-workflow';

const NODE: INode = {
  id: 'stub',
  name: 'PaperPony',
  type: 'n8n-nodes-paperpony.paperPony',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/**
 * The codes this node translates. That the list is the same one the API can
 * answer with is `contract.test.ts`, checked against the OpenAPI enum. Here it
 * is only the subject: what each sentence has to be like.
 */
const DOCUMENTED_CODES = [...TRANSLATED_CODES];

describe('plainMessageFor', () => {
  it.each(DOCUMENTED_CODES)('has a sentence for %s', (code) => {
    const message = plainMessageFor(code);
    expect(message).not.toBe('PaperPony refused the request.');
    expect(message.length).toBeGreaterThan(20);
  });

  /**
   * The audience is somebody automating their own work. These are the words
   * they would have to look up, and the whole reason this table exists.
   */
  it.each(DOCUMENTED_CODES)('says nothing developer-shaped for %s', (code) => {
    const message = plainMessageFor(code);
    expect(message).not.toMatch(/\b(?:HTTP|JSON|payload|endpoint|null|4\d{2}|5\d{2})\b/);
    expect(message).not.toContain(code);
  });

  it.each(DOCUMENTED_CODES)('keeps %s free of the punctuation the house style bans', (code) => {
    // The writing skill bans em dashes and exclamation marks in every string a
    // person reads, and these strings are read by more people than the docs.
    expect(plainMessageFor(code)).not.toMatch(/[—–!]/);
  });

  it('falls back rather than showing an empty error', () => {
    expect(plainMessageFor('something_new')).toBe('PaperPony refused the request.');
  });
});

describe('toNodeApiError', () => {
  const failure: ApiFailure = {
    statusCode: 402,
    envelope: {
      error: {
        code: 'insufficient_credits',
        message: 'Account has 0 credits remaining. Current period resets 2026-09-01T00:00:00.000Z.',
        doc_url: 'https://paperpony.dev/docs/errors#insufficient_credits',
        request_id: 'req_01JZ3M8Q0000000000000000AB',
      },
    },
    retryAfterSeconds: null,
  };

  it('leads with the sentence a person can act on', () => {
    const error = toNodeApiError(NODE, failure, 0);
    expect(error.message).toBe(plainMessageFor('insufficient_credits'));
  });

  it('keeps the API message underneath, because it carries the figures', () => {
    const error = toNodeApiError(NODE, failure, 0);
    expect(error.description).toContain('Current period resets 2026-09-01');
    expect(error.description).toContain('req_01JZ3M8Q0000000000000000AB');
  });

  it('shows the job id when the failure has one, so the render stays inspectable', () => {
    const withJob: ApiFailure = {
      ...failure,
      statusCode: 504,
      envelope: {
        error: {
          code: 'render_timeout',
          message: 'The render exceeded options.timeout_ms (15000 ms).',
          job_id: 'job_01JZ3M8Q0000000000000000CD',
        },
      },
    };

    expect(toNodeApiError(NODE, withJob, 0).description).toContain(
      'job_01JZ3M8Q0000000000000000CD',
    );
  });

  it('survives a response with no envelope at all', () => {
    const bare: ApiFailure = { statusCode: 502, envelope: null, retryAfterSeconds: null };
    expect(toNodeApiError(NODE, bare, 0).description).toContain('502');
  });
});

describe('a code that arrived on a job rather than on a response', () => {
  /**
   * Found by reading a real failed job back through Job: Get in a running n8n.
   * The step said "PaperPony refused the request because one of the fields is
   * wrong" and the request had been fine: a template had called formatDate on
   * something that was not a date, at render time, a week earlier. The reader
   * was sent to look at their own request, which was the one thing that was not
   * the problem.
   */
  it('does not tell the reader their request was refused', () => {
    expect(plainMessageForFailedJob('invalid_request')).not.toMatch(/refused the request/);
    expect(plainMessageForFailedJob('invalid_request')).toBe(plainMessageFor('render_failed'));
  });

  it.each(['rate_limited', 'payload_too_large', 'unauthorized', 'invalid_api_key'])(
    'does not carry the transport sentence for %s',
    (code) => {
      // Each of these says something about a request that was just made. None
      // of them is true of a row somebody is reading afterwards.
      expect(plainMessageForFailedJob(code)).not.toBe(plainMessageFor(code));
    },
  );

  it.each(['render_failed', 'render_timeout', 'page_weight_exceeded'])(
    'keeps the sentence for %s, which is about the drawing and stays true',
    (code) => {
      expect(plainMessageForFailedJob(code)).toBe(plainMessageFor(code));
    },
  );

  it('falls back rather than inventing a sentence for a code it has never seen', () => {
    expect(plainMessageForFailedJob('some_future_code')).toBe(plainMessageFor('render_failed'));
  });
});

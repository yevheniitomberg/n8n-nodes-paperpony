import { describe, expect, it } from 'vitest';
import { NodeApiError } from 'n8n-workflow';
import {
  FALLBACK_RETRY_SECONDS,
  MAX_RETRY_WAIT_SECONDS,
  RATE_LIMIT_RETRIES,
  USER_AGENT,
} from '../nodes/PaperPony/constants';
import { paperPonyRequest, parseRetryAfter, retryWaitSeconds } from '../nodes/PaperPony/transport';
import { errorResponse, stubContext, succeededJob } from './helpers';

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP-date and rounds up to whole seconds', () => {
    const now = Date.parse('2026-08-07T10:00:00.000Z');
    expect(parseRetryAfter('Fri, 07 Aug 2026 10:00:12 GMT', now)).toBe(12);
  });

  it('never returns a negative wait for a date that has passed', () => {
    const now = Date.parse('2026-08-07T10:00:00.000Z');
    expect(parseRetryAfter('Fri, 07 Aug 2026 09:59:00 GMT', now)).toBe(0);
  });

  it('answers null for a header that is missing or meaningless', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });

  it('takes the first value when the header arrives more than once', () => {
    expect(parseRetryAfter(['7', '99'])).toBe(7);
  });
});

describe('retryWaitSeconds', () => {
  it('falls back when the API named no moment', () => {
    expect(retryWaitSeconds(null)).toBe(FALLBACK_RETRY_SECONDS);
  });

  it('clamps a header that would hang the workflow', () => {
    expect(retryWaitSeconds(3_600)).toBe(MAX_RETRY_WAIT_SECONDS);
  });

  it('takes the API at its word inside the ceiling', () => {
    expect(retryWaitSeconds(12)).toBe(12);
  });
});

describe('paperPonyRequest', () => {
  it('sends the bearer path and identifies itself', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    await paperPonyRequest(context, { method: 'POST', path: '/v1/pdf/render', itemIndex: 0 });

    expect(calls[0]?.baseURL).toBe('https://api.example.test');
    expect(calls[0]?.url).toBe('/v1/pdf/render');
    expect(calls[0]?.headers?.['User-Agent']).toBe(USER_AGENT);
  });

  it('strips a trailing slash off the base URL so paths do not double up', async () => {
    const { context, calls } = stubContext({
      baseUrl: 'https://api.example.test/',
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    await paperPonyRequest(context, { method: 'GET', path: '/v1/account', itemIndex: 0 });

    expect(calls[0]?.baseURL).toBe('https://api.example.test');
  });

  it('treats 202 as an answer rather than an error', async () => {
    const queued = succeededJob({ status: 'queued', output_url: null });
    const { context } = stubContext({ responses: [{ statusCode: 202, body: queued }] });

    const job = await paperPonyRequest<{ status: string }>(context, {
      method: 'POST',
      path: '/v1/pdf/render',
      itemIndex: 0,
    });

    expect(job.status).toBe('queued');
  });

  it('waits and asks again when the account is rate limited', async () => {
    const { context, calls } = stubContext({
      responses: [
        { ...errorResponse(429, 'rate_limited', 'Rate limit of 60 requests per minute exceeded.'), headers: { 'retry-after': '0' } },
        { statusCode: 200, body: succeededJob() },
      ],
    });

    const job = await paperPonyRequest<{ status: string }>(context, {
      method: 'POST',
      path: '/v1/pdf/render',
      itemIndex: 0,
    });

    expect(job.status).toBe('succeeded');
    expect(calls).toHaveLength(2);
  });

  it('gives up on 429 once the retries are spent, and says so in words', async () => {
    const throttled = {
      ...errorResponse(429, 'rate_limited', 'Rate limit of 60 requests per minute exceeded.'),
      headers: { 'retry-after': '0' },
    };
    const { context, calls } = stubContext({
      responses: Array.from({ length: RATE_LIMIT_RETRIES + 1 }, () => throttled),
    });

    await expect(
      paperPonyRequest(context, { method: 'POST', path: '/v1/pdf/render', itemIndex: 0 }),
    ).rejects.toBeInstanceOf(NodeApiError);

    expect(calls).toHaveLength(RATE_LIMIT_RETRIES + 1);
  });

  /**
   * The one that matters most for a scheduled workflow. Credits do not come
   * back because the step asked twice, and a retry loop on a spending limit is
   * how a nightly run makes a hundred pointless calls.
   */
  it('never retries a request that ran out of credits', async () => {
    const { context, calls } = stubContext({
      responses: [errorResponse(402, 'insufficient_credits', 'Account has 0 credits remaining.')],
    });

    await expect(
      paperPonyRequest(context, { method: 'POST', path: '/v1/pdf/render', itemIndex: 0 }),
    ).rejects.toBeInstanceOf(NodeApiError);

    expect(calls).toHaveLength(1);
  });

  it('does not choke on an error body that is not the envelope', async () => {
    const { context } = stubContext({
      responses: [{ statusCode: 502, body: '<html>bad gateway</html>' }],
    });

    await expect(
      paperPonyRequest(context, { method: 'GET', path: '/v1/account', itemIndex: 0 }),
    ).rejects.toBeInstanceOf(NodeApiError);
  });
});

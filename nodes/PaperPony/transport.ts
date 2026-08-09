// n8n's own sleep rather than a `setTimeout` wrapper of our own. The community
// node lint forbids the timer globals outright, because a node that schedules
// work on n8n Cloud outside the platform's control is a node the platform
// cannot account for. This comes from the peer dependency, so it adds nothing
// to the published package.
import { sleep } from 'n8n-workflow';
import {
  CREDENTIALS_NAME,
  FALLBACK_RETRY_SECONDS,
  MAX_RETRY_WAIT_SECONDS,
  RATE_LIMIT_RETRIES,
  USER_AGENT,
} from './constants';
import { toNodeApiError, type ApiFailure } from './errors';
import type { ErrorEnvelope } from './types';
import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  ILoadOptionsFunctions,
} from 'n8n-workflow';

/** Both the execute path and the dropdown loader make requests. */
export type ApiContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface RequestSpec {
  method: IHttpRequestMethods;
  path: string;
  body?: IDataObject;
  qs?: IDataObject;
  /** Which input item this belongs to, so an error points at the right row. */
  itemIndex: number;
}

/**
 * What n8n hands back with `returnFullResponse`. The helper is typed `any` by
 * n8n, so the shape is asserted once, here, rather than at every call site.
 */
interface FullResponse {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
}

/**
 * `Retry-After` in either documented form: delta-seconds, or an HTTP-date.
 * Returns null for anything else, including a date in the past, which would
 * otherwise become a negative wait.
 */
export function parseRetryAfter(raw: string | string[] | undefined, now = Date.now()): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === '') return null;

  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 0) return seconds;

  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;

  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * What one 429 makes the step wait. Clamped, because a header naming an hour
 * would otherwise hang a workflow for an hour with nothing on screen to say why.
 */
export function retryWaitSeconds(retryAfterSeconds: number | null): number {
  return Math.min(retryAfterSeconds ?? FALLBACK_RETRY_SECONDS, MAX_RETRY_WAIT_SECONDS);
}

function readEnvelope(body: unknown): ErrorEnvelope | null {
  if (typeof body !== 'object' || body === null) return null;

  const candidate = (body as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return null;

  const { code, message } = candidate as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') return null;

  return body as ErrorEnvelope;
}

async function baseUrlFor(context: ApiContext): Promise<string> {
  const credentials = await context.getCredentials(CREDENTIALS_NAME);
  const raw = credentials['baseUrl'];
  const url = typeof raw === 'string' && raw.trim() !== '' ? raw : 'https://api.paperpony.dev';
  // A trailing slash would produce `//v1/...`, which answers 404 and reads as
  // the node's fault.
  return url.replace(/\/+$/, '');
}

/**
 * One request, with the two behaviours that matter for an audience that cannot
 * read a stack trace.
 *
 * A 429 is not an error here. The API sends `retry-after` naming the moment it
 * will answer, so the step waits and asks again rather than turning a busy
 * minute into a failed workflow. Nobody should have to learn what a rate limit
 * is to send an invoice.
 *
 * A 402 is the opposite and must never be retried: credits do not appear
 * because you asked twice, and a retry loop on a spending limit is how a
 * scheduled workflow makes a hundred pointless calls overnight.
 */
export async function paperPonyRequest<T>(context: ApiContext, spec: RequestSpec): Promise<T> {
  const baseUrl = await baseUrlFor(context);
  const node = context.getNode();

  for (let attempt = 0; ; attempt += 1) {
    // n8n types this helper as `any`; asserted to the documented full-response
    // shape once here so no call site has to.
    const response = (await context.helpers.httpRequestWithAuthentication.call(
      context,
      CREDENTIALS_NAME,
      {
        method: spec.method,
        baseURL: baseUrl,
        url: spec.path,
        body: spec.body,
        qs: spec.qs,
        headers: { 'User-Agent': USER_AGENT },
        json: true,
        returnFullResponse: true,
        // Status handling is ours: n8n's own would throw before the envelope
        // could be read, and the envelope is the whole point.
        ignoreHttpStatusErrors: true,
      },
    )) as FullResponse;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body as T;
    }

    const failure: ApiFailure = {
      statusCode: response.statusCode,
      envelope: readEnvelope(response.body),
      // Optional chaining rather than an assumption. A response with no headers
      // object should produce the API's error, and it used to produce a
      // TypeError from inside the error handler instead, which is the worst
      // place to fail: the reader loses the message that explains everything.
      retryAfterSeconds: parseRetryAfter(response.headers?.['retry-after']),
    };

    const isRateLimited = response.statusCode === 429;
    if (!isRateLimited || attempt >= RATE_LIMIT_RETRIES) {
      throw toNodeApiError(node, failure, spec.itemIndex);
    }

    await sleep(retryWaitSeconds(failure.retryAfterSeconds) * 1000);
  }
}

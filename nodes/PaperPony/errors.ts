import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { INode, JsonObject } from 'n8n-workflow';
import type { ErrorEnvelope } from './types';

/**
 * PaperPony's error messages are written for a developer, and they stay that
 * way. `insufficient_credits` and `rate_limited` are the right words in a
 * terminal and the wrong ones in front of somebody who is automating their
 * invoicing and has never called an API.
 *
 * So the translation lives here, on this side of the boundary, keyed on `code`
 * and never on `message`. The codes are stable and documented; the messages are
 * not promised to be.
 *
 * The API's own message is not thrown away. It goes into the error's
 * description, underneath, because it carries the figures: which field failed
 * validation, how many credits are left, when the period resets. A person who
 * cannot act on the first sentence can forward the second.
 */
const PLAIN_MESSAGES: Record<string, string> = {
  unauthorized:
    'PaperPony did not accept that API key. Open the credential and paste it again from app.paperpony.dev/keys.',
  invalid_api_key:
    'PaperPony did not accept that API key. It may have been revoked. Create a new one at app.paperpony.dev/keys and paste it into the credential.',
  account_suspended:
    'PaperPony has stopped serving this account because a payment failed. Add a working card at app.paperpony.dev/billing and it starts working again as soon as one succeeds. Nothing has been deleted.',
  insufficient_credits:
    'This PaperPony account has no credits left, so no PDF was made. On the free plan credits come back at the start of the next period. On a paid plan this is a safety limit rather than the allowance: write to hello@paperpony.dev and it is raised.',
  rate_limited:
    'PaperPony is receiving more requests than this plan allows. The step waited and tried again, and it still did not get through. Spread the work out, or move to a larger plan.',
  invalid_request: 'PaperPony refused the request because one of the fields is wrong.',
  not_found: 'PaperPony has no such address. This is a fault in the node rather than in your setup.',
  template_not_found:
    'That template is not on this account any more. Open the field and pick one from the list.',
  job_not_found:
    'PaperPony has no job with that ID on this account. Check the ID, or take it from the step that made the PDF.',
  payload_too_large:
    'The HTML you sent is larger than PaperPony accepts, which is 5 MB. Save the document as a template instead, and point at images by URL rather than pasting them in.',
  page_weight_exceeded:
    'While drawing the document PaperPony pulled in more than 20 MB of images, fonts and stylesheets. Use smaller images, or fewer of them.',
  render_failed: 'PaperPony could not make the PDF from what it was given.',
  render_timeout:
    'PaperPony ran out of time drawing the document. Make it simpler, or raise Timeout in Options, up to 60000 ms.',
  internal_error:
    'PaperPony had a failure on its side. Try the step again. If it keeps happening, write to hello@paperpony.dev and quote the request ID below.',
};

/** Shown when the API answers something this node has never heard of. */
const UNKNOWN_MESSAGE = 'PaperPony refused the request.';

/**
 * Which codes have a sentence. Checked against the enum in
 * `openapi/openapi.json`, so a code the API gains and this table does not is a
 * failing test rather than a reader staring at the fallback.
 */
export const TRANSLATED_CODES: readonly string[] = Object.keys(PLAIN_MESSAGES);

export interface ApiFailure {
  statusCode: number;
  envelope: ErrorEnvelope | null;
  /** From `retry-after`, in seconds, when the response carried a usable one. */
  retryAfterSeconds: number | null;
}

export function plainMessageFor(code: string): string {
  return PLAIN_MESSAGES[code] ?? UNKNOWN_MESSAGE;
}

/**
 * The codes whose sentence is still true when it arrives on a job rather than
 * on a response.
 *
 * The table above is written for a request that was refused: "refused the
 * request", "the step waited and tried again", "the HTML you sent". A code on a
 * finished job is a different statement. It describes what happened while the
 * document was being drawn, possibly a week ago, possibly to somebody else's
 * request, and the reader is holding an ID rather than a request they just made.
 *
 * Found by running it. Reading back a real failed job through Job: Get answered
 * "PaperPony refused the request because one of the fields is wrong", and the
 * request had been fine: a template had called `formatDate` on something that
 * was not a date, at render time. The reader is sent to look at the wrong thing,
 * which is the same defect class as an error message naming the value it was
 * given rather than the one it used.
 */
const TRUE_OF_A_JOB = new Set(['render_failed', 'render_timeout', 'page_weight_exceeded']);

/**
 * What to say about a job that came back failed.
 *
 * Falls back to the render_failed sentence rather than inventing a second table.
 * Nothing is lost by it: the API's own message travels in the description, and
 * n8n prints the code beside it, so a reader who wants the specifics has both.
 */
export function plainMessageForFailedJob(code: string): string {
  return TRUE_OF_A_JOB.has(code)
    ? plainMessageFor(code)
    : (PLAIN_MESSAGES['render_failed'] as string);
}

/**
 * Everything a reader needs, under the sentence they can act on: the API's own
 * message, the request id to quote, and the job id when a job row exists, which
 * is how a failed synchronous render stays inspectable.
 */
function describe(failure: ApiFailure): string {
  const error = failure.envelope?.error;
  if (error === undefined) {
    return `PaperPony answered ${String(failure.statusCode)} with no error body.`;
  }

  const parts = [error.message];
  if (error.job_id !== undefined) parts.push(`Job: ${error.job_id}`);
  if (error.request_id !== undefined) parts.push(`Request: ${error.request_id}`);
  if (error.doc_url !== undefined) parts.push(error.doc_url);

  return parts.join('\n');
}

/**
 * Anything that escaped the operation, as an error n8n can present.
 *
 * Errors raised deliberately are already one of n8n's types, carrying the
 * translated sentence and the request id, and they come back untouched.
 * Anything else is a surprise, and a surprise still has to arrive knowing which
 * item produced it: without that, a workflow rendering fifty invoices reports a
 * failure and no way to tell which row caused it.
 */
export function asNodeError(
  node: INode,
  error: unknown,
  itemIndex: number,
): NodeApiError | NodeOperationError {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
  return new NodeOperationError(node, error as Error, { itemIndex });
}

export function toNodeApiError(node: INode, failure: ApiFailure, itemIndex: number): NodeApiError {
  const code = failure.envelope?.error.code ?? '';

  return new NodeApiError(
    node,
    // The envelope, as the API sent it, so n8n's own error view can show the
    // raw response. Cast because NodeApiError takes a JsonObject and our
    // envelope is a narrower shape of exactly that.
    (failure.envelope ?? {}) as unknown as JsonObject,
    {
      message: plainMessageFor(code),
      description: describe(failure),
      httpCode: String(failure.statusCode),
      itemIndex,
    },
  );
}

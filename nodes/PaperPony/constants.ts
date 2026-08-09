/**
 * The published version, written out rather than read from package.json.
 *
 * Reading it would mean reading a file at runtime, and n8n's verification
 * guidelines say a node must not do that. `test/version.test.ts` compares this
 * constant against package.json, so the copy cannot go stale without a red
 * test.
 */
export const NODE_VERSION = '0.2.0';

/**
 * Sent on every request, and the only way anything on our side can tell that a
 * render came from n8n rather than from somebody's own code. `jobs.client`
 * records it. It carries no account, no key and nothing about the document.
 */
export const USER_AGENT = `n8n-nodes-paperpony/${NODE_VERSION}`;

export const CREDENTIALS_NAME = 'paperPonyApi';

/**
 * How long to keep asking about a job that did not finish inside the API's own
 * synchronous budget.
 *
 * The API waits 20 seconds and then answers 202 with a queued job, so anything
 * that reaches the polling path is already a slow render. Five minutes is well
 * past the 60 second ceiling on `timeout_ms`, which means a job that has not
 * settled by then has stopped for a reason polling will not fix.
 */
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;
export const POLL_INTERVAL_MS = 2_000;

/** Attempts after the first when the API answers 429. */
export const RATE_LIMIT_RETRIES = 3;

/**
 * What to wait when a 429 arrives without a usable `retry-after`. The API
 * always sends one, so this is the belt to that braces.
 */
export const FALLBACK_RETRY_SECONDS = 5;

/**
 * A ceiling on what a single `retry-after` can make the step wait. Without it a
 * header saying 3600 would hang a workflow for an hour with nothing on screen.
 */
export const MAX_RETRY_WAIT_SECONDS = 60;

import { describe, expect, it, vi } from 'vitest';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';
import { PaperPony } from '../nodes/PaperPony/PaperPony.node';
import { errorResponse, stubContext, succeededJob } from './helpers';

/**
 * `execute`, which nothing tested until now.
 *
 * The package had 108 tests and not one of them imported this class. Every
 * request, every error sentence and every expression was covered, and the thing
 * that decides which of them runs was not, so a whole operation could behave
 * differently from the other two and no suite would say a word. It did: the
 * refusal to hand back a job with nothing in it lived inside `renderPdf`, so it
 * applied to the two PDF operations and Job: Get returned a failed job as an
 * ordinary green item.
 *
 * These drive the node the way n8n drives it: parameters in, items out.
 */

const PDF = Buffer.from('%PDF-1.7 stub');

const run = (context: IExecuteFunctions) =>
  PaperPony.prototype.execute.call(context) as Promise<
    Array<Array<{ json: Record<string, unknown>; binary?: Record<string, unknown> }>>
  >;

const forJobGet = (job: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  stubContext({
    parameters: { resource: 'job', operation: 'get', jobId: String(job['id']), ...extra },
    responses: [{ statusCode: 200, body: job }],
    downloads: [PDF],
  });

const forRender = (responses: Array<{ statusCode: number; body: unknown }>) =>
  stubContext({
    parameters: { resource: 'pdf', operation: 'fromHtml', html: '<h1>Invoice</h1>' },
    responses,
    downloads: [PDF],
  });

describe('the happy path', () => {
  it('returns the job and attaches the file', async () => {
    const { context } = forRender([{ statusCode: 200, body: succeededJob() }]);

    const [items] = await run(context);

    expect(items).toHaveLength(1);
    expect(items?.[0]?.json['id']).toBe('job_01JZ3M8Q0000000000000000CD');
    expect(items?.[0]?.binary).toBeDefined();
  });

  it('returns the job without a file when the download is switched off', async () => {
    const { context, downloadCalls } = stubContext({
      parameters: {
        resource: 'pdf',
        operation: 'fromHtml',
        html: '<h1>Invoice</h1>',
        download: false,
      },
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    const [items] = await run(context);

    expect(items?.[0]?.binary).toBeUndefined();
    expect(downloadCalls).toHaveLength(0);
  });
});

describe('a job with nothing to give ends the step, whichever operation asked', () => {
  /**
   * The rule the Make app already followed and this node did not. All three
   * operations, all three shapes of nothing: a render that failed, a file that
   * has been deleted since, and a render still going when the wait ran out.
   */
  const FAILED = succeededJob({
    status: 'failed',
    output_url: null,
    output_bytes: null,
    page_count: null,
    error: { code: 'render_failed', message: 'The document referenced a font that could not load.' },
  });

  const SWEPT = succeededJob({ output_url: null, output_expires_at: null, output_bytes: 7754 });

  it('Job: Get refuses a failed job rather than returning the row', async () => {
    // This is the operation that used to return it. The whole point of the
    // change, and the case the brief said was already true and was not.
    const { context } = forJobGet(FAILED);

    await expect(run(context)).rejects.toBeInstanceOf(NodeApiError);
  });

  it.each([
    ['fromHtml', { resource: 'pdf', operation: 'fromHtml', html: '<h1>x</h1>' }],
    ['fromTemplate', { resource: 'pdf', operation: 'fromTemplate', templateId: 'tpl_01J' }],
  ])('%s refuses a failed job', async (_label, parameters) => {
    const { context } = stubContext({
      parameters,
      responses: [{ statusCode: 200, body: FAILED }],
    });

    await expect(run(context)).rejects.toBeInstanceOf(NodeApiError);
  });

  it('refuses a succeeded job whose file has been deleted, and says which', async () => {
    const { context } = forJobGet(SWEPT);

    await expect(run(context)).rejects.toThrow(/file has since been deleted/);
  });

  it('does not fetch the file for a job that no longer has one', async () => {
    // Without the refusal this was the actual defect: the download gate passes
    // on status alone, `downloadOutput` returns null on a missing URL, and the
    // item goes out green with no binary and no complaint.
    const { context, downloadCalls } = forJobGet(SWEPT);

    await expect(run(context)).rejects.toThrow();
    expect(downloadCalls).toHaveLength(0);
  });

  it('refuses a render still going when the wait ran out', async () => {
    // On fake timers, because the budget is five minutes at two second
    // intervals and this test waited all of it once. A suite nobody will run is
    // a suite that stops catching things, and five minutes is past the point
    // where somebody starts passing a filter to vitest.
    vi.useFakeTimers();
    try {
      const queued = succeededJob({ status: 'queued', output_url: null, output_bytes: null });
      const { context } = stubContext({
        parameters: { resource: 'pdf', operation: 'fromHtml', html: '<h1>x</h1>' },
        // Enough for the first request and every poll the budget allows. The
        // stub throws when it runs out, which would be a different failure.
        responses: Array.from({ length: 400 }, () => ({ statusCode: 202, body: queued })),
      });

      const running = run(context);
      const settled = expect(running).rejects.toBeInstanceOf(NodeOperationError);

      // Past POLL_TIMEOUT_MS, so the loop runs out of budget rather than out of
      // responses. Advancing asynchronously lets each awaited poll resolve
      // between ticks.
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('On Error set to Continue', () => {
  /**
   * The documented way to get a failed job's own fields, which did not work.
   * The branch pushed `{ error: <sentence> }` and dropped the job, so the id,
   * the status and the error code were all unreachable from the branch that
   * exists to reach them.
   */
  const FAILED = succeededJob({
    status: 'failed',
    output_url: null,
    output_bytes: null,
    error: { code: 'render_failed', message: 'A font could not load.' },
  });

  it('hands back the job row and the sentence, not the sentence alone', async () => {
    const { context } = stubContext({
      parameters: { resource: 'job', operation: 'get', jobId: String(FAILED['id']) },
      responses: [{ statusCode: 200, body: FAILED }],
      continueOnFail: true,
    });

    const [items] = await run(context);

    expect(items).toHaveLength(1);
    expect(items?.[0]?.json['id']).toBe(FAILED['id']);
    expect(items?.[0]?.json['status']).toBe('failed');
    expect((items?.[0]?.json['error'] as unknown) !== undefined).toBe(true);
  });

  it('hands back the sentence alone when the failure happened before a job existed', async () => {
    // A bad key never produces a row, so there is nothing to carry. The item
    // still arrives, because losing it would defeat the switch.
    const { context } = stubContext({
      parameters: { resource: 'job', operation: 'get', jobId: 'job_01J' },
      responses: [errorResponse(401, 'invalid_api_key', 'The key is unknown or revoked.')],
      continueOnFail: true,
    });

    const [items] = await run(context);

    expect(items).toHaveLength(1);
    expect(items?.[0]?.json['id']).toBeUndefined();
    expect(String(items?.[0]?.json['error'])).toMatch(/key/i);
  });

  it('carries on past a bad item rather than losing the good ones', async () => {
    const { context } = stubContext({
      parameters: { resource: 'job', operation: 'get', jobId: 'job_01J' },
      items: [{ json: {} }, { json: {} }, { json: {} }],
      responses: [
        { statusCode: 200, body: succeededJob() },
        errorResponse(404, 'job_not_found', 'No job with that id.'),
        { statusCode: 200, body: succeededJob() },
      ],
      downloads: [PDF, PDF],
      continueOnFail: true,
    });

    const [items] = await run(context);

    expect(items).toHaveLength(3);
    expect(items?.[0]?.binary).toBeDefined();
    expect(items?.[1]?.json['error']).toBeDefined();
    expect(items?.[2]?.binary).toBeDefined();
  });

  it('pairs every item with the input it came from', async () => {
    // n8n uses pairedItem to trace an output row back to its input. Losing it
    // on the error branch would break that for exactly the rows somebody is
    // trying to trace.
    const { context } = stubContext({
      parameters: { resource: 'job', operation: 'get', jobId: 'job_01J' },
      items: [{ json: {} }, { json: {} }],
      responses: [
        errorResponse(404, 'job_not_found', 'No job with that id.'),
        errorResponse(404, 'job_not_found', 'No job with that id.'),
      ],
      continueOnFail: true,
    });

    const [items] = (await run(context)) as unknown as Array<
      Array<{ pairedItem: { item: number } }>
    >;

    expect(items?.[0]?.pairedItem).toEqual({ item: 0 });
    expect(items?.[1]?.pairedItem).toEqual({ item: 1 });
  });
});

describe('an operation the node does not have', () => {
  it('says so rather than answering with nothing', async () => {
    const { context } = stubContext({
      parameters: { resource: 'pdf', operation: 'convertToWord' },
      responses: [],
    });

    await expect(run(context)).rejects.toThrow(/no pdf operation called convertToWord/);
  });
});

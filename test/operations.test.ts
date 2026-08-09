import { describe, expect, it } from 'vitest';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
  downloadOutput,
  filenameFromUrl,
  getJob,
  refuseAJobWithNothingToGive,
  renderPdf,
  waitForJob,
} from '../nodes/PaperPony/operations';
import type { JobView } from '../nodes/PaperPony/types';
import { errorResponse, stubContext, succeededJob } from './helpers';

const TEMPLATE = { template_id: 'tpl_01JZ3M8Q0000000000000000EF' };

/**
 * `succeededJob` builds a plain record, because everywhere else it is a stub
 * response body and goes over the wire untyped. These are the only calls that
 * hand it straight to typed code.
 */
const asJob = (job: Record<string, unknown>): JobView => job as unknown as JobView;

describe('the values that fill a document', () => {
  it('turns the name and value rows into an object', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: {
        dataMode: 'fields',
        dataFields: {
          entries: [
            { name: 'invoice_number', value: 'INV-001' },
            { name: 'customer', value: 'Ada Lovelace' },
          ],
        },
      },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect((calls[0]?.body as { data: unknown }).data).toEqual({
      invoice_number: 'INV-001',
      customer: 'Ada Lovelace',
    });
  });

  it('ignores a row somebody added and left blank', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: {
        dataMode: 'fields',
        dataFields: { entries: [{ name: '  ', value: 'orphan' }, { name: 'kept', value: 'yes' }] },
      },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect((calls[0]?.body as { data: unknown }).data).toEqual({ kept: 'yes' });
  });

  it('takes JSON, which is the only way to send a list of invoice lines', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: {
        dataMode: 'json',
        dataJson: '{"invoice_number":"INV-001","items":[{"name":"Design","amount":"500.00"}]}',
      },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect((calls[0]?.body as { data: { items: unknown } }).data.items).toEqual([
      { name: 'Design', amount: '500.00' },
    ]);
  });

  it('explains malformed JSON instead of sending it and letting the API answer 422', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: { dataMode: 'json', dataJson: '{invoice_number: INV-001}' },
    });

    await expect(renderPdf(context, 0, TEMPLATE)).rejects.toBeInstanceOf(NodeOperationError);
    expect(calls).toHaveLength(0);
  });

  it('refuses a JSON array, which a template cannot be filled from', async () => {
    const { context } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: { dataMode: 'json', dataJson: '[1,2,3]' },
    });

    await expect(renderPdf(context, 0, TEMPLATE)).rejects.toBeInstanceOf(NodeOperationError);
  });
});

describe('the options block', () => {
  it('unwraps the margins out of the shape n8n stores them in', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: {
        options: {
          format: 'Letter',
          margin: { values: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } },
        },
      },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect((calls[0]?.body as { options: unknown }).options).toEqual({
      format: 'Letter',
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  });

  /**
   * An option opened and left blank arrives as an empty string. Sent as one it
   * fails `page_ranges` validation and would store an empty header, so blank
   * has to mean unset.
   */
  it('drops an option that was opened and left empty', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: { options: { page_ranges: '', header_html: '', format: 'A4' } },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect((calls[0]?.body as { options: unknown }).options).toEqual({ format: 'A4' });
  });

  it('sends no options block at all when nothing was set', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
      parameters: { options: {} },
    });

    await renderPdf(context, 0, TEMPLATE);

    expect(calls[0]?.body).not.toHaveProperty('options');
  });
});

describe('a render that outran the twenty second budget', () => {
  it('polls until the job settles and returns the finished one', async () => {
    const queued = succeededJob({ status: 'queued', output_url: null, finished_at: null });
    const { context, calls } = stubContext({
      responses: [
        { statusCode: 202, body: queued },
        { statusCode: 200, body: succeededJob() },
      ],
    });

    const job = await renderPdf(context, 0, TEMPLATE);

    expect(job.status).toBe('succeeded');
    expect(calls[1]?.url).toBe('/v1/jobs/job_01JZ3M8Q0000000000000000CD');
  });

  it('hands a job that failed later back rather than throwing here', async () => {
    // The refusal moved to `execute`, which is the correction: while it lived in
    // this function it applied to the two render operations and not to Job: Get,
    // so reading a failed job back was a green item carrying status "failed".
    // `refuseAJobWithNothingToGive` covers all three now, and the assertions
    // about the sentence a person reads live beside it in PaperPony.node.test.ts.
    const queued = succeededJob({ status: 'queued', output_url: null });
    const failed = succeededJob({
      status: 'failed',
      output_url: null,
      error: { code: 'render_timeout', message: 'The render exceeded options.timeout_ms.' },
    });
    const { context } = stubContext({
      responses: [
        { statusCode: 202, body: queued },
        { statusCode: 200, body: failed },
      ],
    });

    const job = await renderPdf(context, 0, TEMPLATE);
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('render_timeout');
  });

  describe('refusing a job with nothing to give', () => {
    it('refuses a failed job, whichever operation produced it', () => {
      const { context } = stubContext({ responses: [] });
      const failed = succeededJob({
        status: 'failed',
        output_url: null,
        output_bytes: null,
        error: { code: 'render_failed', message: 'A font could not load.' },
      });

      expect(() => refuseAJobWithNothingToGive(context, asJob(failed), 0)).toThrow(NodeApiError);
    });

    it('refuses a succeeded job whose file has been deleted since', () => {
      // The composite, copied off a real production row: status stays succeeded
      // for ever and output_expires_at is nulled with the URL, so output_bytes
      // surviving is the only thing separating this from a job that never made
      // a file.
      const { context } = stubContext({ responses: [] });
      const swept = succeededJob({ output_url: null, output_expires_at: null, output_bytes: 7754 });

      expect(() => refuseAJobWithNothingToGive(context, asJob(swept), 0)).toThrow(
        /file has since been deleted/,
      );
    });

    it('lets a job that still holds its file through', () => {
      const { context } = stubContext({ responses: [] });

      expect(() => refuseAJobWithNothingToGive(context, asJob(succeededJob()), 0)).not.toThrow();
    });

    it('lets a job that never produced a file through, because that one failed', () => {
      // status failed is caught by the first branch and gets the API's own
      // sentence. This asserts the second branch does not also claim it, which
      // would replace a real error message with one about retention.
      const { context } = stubContext({ responses: [] });
      const never = succeededJob({
        status: 'failed',
        output_url: null,
        output_bytes: null,
        error: { code: 'render_failed', message: 'A font could not load.' },
      });

      // Thrown by the first branch, so it carries the API's own code rather
      // than a sentence about retention. The cause travels in `description`,
      // which is where NodeApiError puts detail and where `toThrow` does not
      // look, so the assertion is on what it is rather than on what it says.
      expect(() => refuseAJobWithNothingToGive(context, asJob(never), 0)).toThrow(NodeApiError);
      expect(() => refuseAJobWithNothingToGive(context, asJob(never), 0)).not.toThrow(
        /file has since been deleted/,
      );
    });
  });

  it('does not poll a job that was already finished when it arrived', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    await renderPdf(context, 0, TEMPLATE);

    expect(calls).toHaveLength(1);
  });
});

describe('filenameFromUrl', () => {
  it('takes the name the API actually stored the object under', () => {
    expect(
      filenameFromUrl('https://objects.example.test/o/job_01JZ/invoice-001.pdf?X-Amz-Signature=a'),
    ).toBe('invoice-001.pdf');
  });

  it('decodes a name that had to be escaped to fit in a URL', () => {
    expect(filenameFromUrl('https://objects.example.test/o/job_01JZ/%D1%80%D0%B0%D1%85.pdf')).toBe(
      'рах.pdf',
    );
  });

  it('falls back rather than throwing on something that is not a URL', () => {
    expect(filenameFromUrl('not a url')).toBe('document.pdf');
  });
});

describe('bringing the file back', () => {
  /**
   * The signed URL is the credential for object storage. Sending a PaperPony
   * bearer token with it would hand our key to a third party for no reason, and
   * a request carrying two kinds of authorization is one S3 can reject.
   */
  it('fetches the object without attaching the API key', async () => {
    const job = succeededJob() as unknown as JobView;
    const { context, downloadCalls, calls } = stubContext({
      downloads: [Buffer.from('%PDF-1.7 stub')],
      parameters: { binaryPropertyName: 'data' },
    });

    const file = await downloadOutput(context, job, 0);

    expect(calls).toHaveLength(0);
    expect(downloadCalls[0]?.url).toBe(job.output_url);
    expect(downloadCalls[0]?.headers).toBeUndefined();
    expect(file?.binaryPropertyName).toBe('data');
    expect(file?.data.fileName).toBe('invoice.pdf');
    expect(file?.data.mimeType).toBe('application/pdf');
  });

  it('returns nothing when the job has no output to fetch', async () => {
    const job = succeededJob({ output_url: null }) as unknown as JobView;
    const { context } = stubContext({ parameters: { binaryPropertyName: 'data' } });

    expect(await downloadOutput(context, job, 0)).toBeNull();
  });
});

describe('looking a job up by id', () => {
  it('reads it back, which is also what re-signs the link', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    const job = await getJob(context, 0, 'job_01JZ3M8Q0000000000000000CD');

    expect(calls[0]?.url).toBe('/v1/jobs/job_01JZ3M8Q0000000000000000CD');
    expect(job.output_url).toContain('X-Amz-Signature');
  });

  it('escapes an id rather than pasting it into the path', async () => {
    const { context, calls } = stubContext({
      responses: [{ statusCode: 200, body: succeededJob() }],
    });

    await getJob(context, 0, '../account');

    expect(calls[0]?.url).toBe('/v1/jobs/..%2Faccount');
  });

  it('gives the plain sentence when the id is not on this account', async () => {
    const { context } = stubContext({
      responses: [errorResponse(404, 'job_not_found', 'No job with id job_01H exists.')],
    });

    await expect(getJob(context, 0, 'job_01H')).rejects.toBeInstanceOf(NodeApiError);
  });
});

describe('waitForJob', () => {
  it('returns a finished job without asking again', async () => {
    const { context, calls } = stubContext({ responses: [] });
    const job = succeededJob() as unknown as JobView;

    expect(await waitForJob(context, job, 0)).toBe(job);
    expect(calls).toHaveLength(0);
  });
});

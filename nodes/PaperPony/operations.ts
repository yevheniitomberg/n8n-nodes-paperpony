import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './constants';
import { plainMessageForFailedJob } from './errors';
import { paperPonyRequest } from './transport';
import type { JobView } from './types';
import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';

const TERMINAL: ReadonlySet<string> = new Set(['succeeded', 'failed']);

interface RenderInput {
  template_id?: string;
  html?: string;
}

/**
 * The values that fill the document, from whichever of the two inputs the user
 * chose. Empty is legitimate: a template with no placeholders renders fine.
 */
function readData(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const mode = context.getNodeParameter('dataMode', itemIndex, 'fields') as string;

  if (mode === 'json') {
    const raw = context.getNodeParameter('dataJson', itemIndex, '{}');
    if (typeof raw === 'object' && raw !== null) return raw as IDataObject;

    try {
      const parsed: unknown = JSON.parse(String(raw));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed as IDataObject;
    } catch {
      throw new NodeOperationError(
        context.getNode(),
        'Values (JSON) is not a JSON object. It has to start with { and end with }, for example { "invoice_number": "INV-001" }.',
        { itemIndex },
      );
    }
  }

  const collection = context.getNodeParameter('dataFields', itemIndex, {}) as {
    entries?: Array<{ name?: string; value?: string }>;
  };

  const data: IDataObject = {};
  for (const entry of collection.entries ?? []) {
    const name = entry.name?.trim();
    if (name === undefined || name === '') continue;
    data[name] = entry.value ?? '';
  }
  return data;
}

/**
 * The Options collection into the API's `options` block.
 *
 * Two shapes have to be undone. n8n wraps a `fixedCollection` in the name of
 * its inner group, so margins arrive as `margin.values`. And an option the user
 * opened and then left blank arrives as an empty string, which the API's schema
 * rejects for `page_ranges` and would store as an empty header. Blank means
 * unset, and unset means absent.
 */
function readOptions(context: IExecuteFunctions, itemIndex: number): IDataObject {
  const raw = context.getNodeParameter('options', itemIndex, {}) as IDataObject & {
    margin?: { values?: IDataObject };
  };

  const options: IDataObject = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'margin') continue;
    if (value === undefined || value === null || value === '') continue;
    options[key] = value;
  }

  const margin = raw.margin?.values;
  if (margin !== undefined) {
    const kept: IDataObject = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const value = margin[side];
      if (typeof value === 'string' && value !== '') kept[side] = value;
    }
    if (Object.keys(kept).length > 0) options['margin'] = kept;
  }

  return options;
}

/**
 * A job that came back `failed`. The API answers a failed *synchronous* render
 * with the error envelope, which the transport already turns into an error, so
 * this is the other path: a render that failed and is being read back
 * afterwards, either because it outran the 20 second budget and went
 * asynchronous, or because somebody looked it up later with Job: Get.
 *
 * The row carries the same code and does NOT get the same sentence, which is
 * the correction. See `plainMessageForFailedJob`.
 */
function throwForFailedJob(context: IExecuteFunctions, job: JobView, itemIndex: number): never {
  const code = job.error?.code ?? 'render_failed';
  const detail = job.error?.message ?? 'PaperPony did not say what went wrong.';

  throw new NodeApiError(context.getNode(), { error: job.error } as unknown as JsonObject, {
    // Not `plainMessageFor`. That table answers "why was my request refused",
    // and this is a job read back afterwards, where most of its sentences point
    // the reader at the wrong thing.
    message: plainMessageForFailedJob(code),
    description: `${detail}\nJob: ${job.id}`,
    itemIndex,
  });
}

/**
 * A job that succeeded and has no file to hand over.
 *
 * A PDF is kept for as long as the plan allows and then deleted, and the row
 * outlives it: `status` stays `succeeded` for ever and `output_expires_at` is
 * nulled along with the URL, so no single field says the file expired. The
 * composite does: succeeded, no `output_url`, and `output_bytes` still there.
 * Checked on 9 August 2026 against every job a live PaperPony account held,
 * which the composite sorted without leaving one unclassified and without a
 * counter-example in either direction.
 *
 * It matters here more than anywhere because the README tells people to store
 * the id and read the job again, which is exactly the path into it. Before this,
 * the step went green with every field except the file.
 */
function throwForMissingOutput(context: IExecuteFunctions, job: JobView, itemIndex: number): never {
  throw new NodeOperationError(
    context.getNode(),
    'PaperPony made this PDF, and the file has since been deleted.',
    {
      itemIndex,
      description:
        'A file is kept for as long as your plan allows: a day on Free, seven days on Starter, ' +
        'thirty on Growth and Scale. After that the job record stays and the file does not. ' +
        `Make the document again to get a new file. Job: ${job.id}`,
    },
  );
}

/**
 * The one place any operation decides whether it has something to hand on.
 *
 * Called from `execute` rather than from `renderPdf`, which is a correction. It
 * used to sit inside `renderPdf`, so the two PDF operations refused a failed job
 * and `Job: Get` returned it as ordinary output. The design this node is
 * supposed to have, and the one the Make app already has, is that all three
 * refuse it, and that a caller who wants the row turns on On Error to Continue.
 * That fallback did not work either: the catch pushed the error sentence and
 * discarded the job. Both halves are fixed together because neither is much use
 * alone.
 */
export function refuseAJobWithNothingToGive(
  context: IExecuteFunctions,
  job: JobView,
  itemIndex: number,
): void {
  if (job.status === 'failed') throwForFailedJob(context, job, itemIndex);
  if (job.status === 'succeeded' && job.output_url === null && job.output_bytes !== null) {
    throwForMissingOutput(context, job, itemIndex);
  }
}

/**
 * Asks about a job until it settles.
 *
 * Only reached when the API answered 202, which it does after waiting 20
 * seconds itself. Every read re-signs `output_url`, so the job this returns
 * carries a link that has just been made rather than one that has been sitting
 * in a variable.
 */
export async function waitForJob(
  context: IExecuteFunctions,
  job: JobView,
  itemIndex: number,
): Promise<JobView> {
  if (TERMINAL.has(job.status)) return job;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let latest = job;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    latest = await paperPonyRequest<JobView>(context, {
      method: 'GET',
      path: `/v1/jobs/${encodeURIComponent(job.id)}`,
      itemIndex,
    });

    if (TERMINAL.has(latest.status)) return latest;
  }

  throw new NodeOperationError(
    context.getNode(),
    'PaperPony is still working on this PDF after five minutes, which is longer than any render should take.',
    {
      itemIndex,
      description: `The job has not been abandoned and may still finish. Look it up with the Job: Get operation, using job ID ${latest.id}.`,
    },
  );
}

export async function renderPdf(
  context: IExecuteFunctions,
  itemIndex: number,
  input: RenderInput,
): Promise<JobView> {
  const body: IDataObject = { ...input, data: readData(context, itemIndex) };

  const options = readOptions(context, itemIndex);
  if (Object.keys(options).length > 0) body['options'] = options;

  const job = await paperPonyRequest<JobView>(context, {
    method: 'POST',
    path: '/v1/pdf/render',
    body,
    itemIndex,
  });

  // The failure check used to live here, which is why it applied to two
  // operations out of three. It is in `execute` now, past the dispatch, so every
  // operation reaches it and the job row survives into the On Error branch.
  return await waitForJob(context, job, itemIndex);
}

export async function getJob(
  context: IExecuteFunctions,
  itemIndex: number,
  jobId: string,
): Promise<JobView> {
  return paperPonyRequest<JobView>(context, {
    method: 'GET',
    path: `/v1/jobs/${encodeURIComponent(jobId)}`,
    itemIndex,
  });
}

/**
 * The object key is `o/{job_id}/{filename}`, so the last path segment is the
 * name the API actually stored the file under, already sanitized. Reading it
 * back beats guessing from the node's own options, which may not be what was
 * used: a render replayed through an idempotency key keeps the first call's
 * filename.
 */
export function filenameFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter((part) => part !== '');
    const last = segments.at(-1);
    if (last === undefined) return 'document.pdf';
    return decodeURIComponent(last);
  } catch {
    return 'document.pdf';
  }
}

/**
 * Fetches the finished PDF and hands it back as n8n binary data.
 *
 * Deliberately `httpRequest` and not `httpRequestWithAuthentication`. The URL
 * points at object storage, not at our API, and it is signed: the signature is
 * the credential. Attaching a PaperPony bearer token to it would send our key
 * to a third party for no reason, and a request carrying two kinds of
 * authorization is one S3 can reject outright.
 */
export async function downloadOutput(
  context: IExecuteFunctions,
  job: JobView,
  itemIndex: number,
): Promise<{ binaryPropertyName: string; data: Awaited<ReturnType<IExecuteFunctions['helpers']['prepareBinaryData']>> } | null> {
  if (job.output_url === null) return null;

  const binaryPropertyName = context.getNodeParameter(
    'binaryPropertyName',
    itemIndex,
    'data',
  ) as string;

  // n8n types this helper as `any`; the response is the raw PDF and is read as
  // a buffer, which is what the assertion says.
  const body = (await context.helpers.httpRequest({
    method: 'GET',
    url: job.output_url,
    encoding: 'arraybuffer',
    json: false,
  })) as ArrayBuffer | Buffer;

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);

  return {
    binaryPropertyName,
    data: await context.helpers.prepareBinaryData(
      buffer,
      filenameFromUrl(job.output_url),
      'application/pdf',
    ),
  };
}

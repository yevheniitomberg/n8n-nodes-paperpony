import type { IExecuteFunctions, INode } from 'n8n-workflow';

export interface StubResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export interface StubCall {
  method?: string;
  baseURL?: string;
  url: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  qs?: unknown;
}

const NODE: INode = {
  id: 'stub',
  name: 'PaperPony',
  type: 'n8n-nodes-paperpony.paperPony',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/**
 * Enough of `IExecuteFunctions` for the request path, and nothing more.
 *
 * The cast at the end is the only way to hand a partial object to code typed
 * against n8n's full interface. It is confined to this file so no test has to
 * repeat it, and anything the code under test reaches for that is missing here
 * fails loudly rather than silently reading undefined.
 */
export function stubContext(options: {
  responses?: StubResponse[];
  /** Raw responses for `httpRequest`, which is the object-storage download. */
  downloads?: unknown[];
  parameters?: Record<string, unknown>;
  baseUrl?: string;
  /**
   * n8n's own On Error switch. Off by default, because that is the default in
   * the editor and the behaviour every other test is about.
   */
  continueOnFail?: boolean;
  /**
   * The items the node is handed. One empty item unless a test needs more, and
   * a test needs more only to prove that one bad item does not lose the rest.
   */
  items?: Array<{ json: Record<string, unknown> }>;
}): {
  context: IExecuteFunctions;
  calls: StubCall[];
  downloadCalls: StubCall[];
} {
  const responses = [...(options.responses ?? [])];
  const downloads = [...(options.downloads ?? [])];
  const calls: StubCall[] = [];
  const downloadCalls: StubCall[] = [];

  const partial = {
    getNode: () => NODE,
    getCredentials: () =>
      Promise.resolve({
        apiKey: 'pp_test_stub',
        baseUrl: options.baseUrl ?? 'https://api.example.test',
      }),
    getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => {
      const parameters = options.parameters ?? {};
      return name in parameters ? parameters[name] : fallback;
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getInputData: () => options.items ?? [{ json: {} }],
    helpers: {
      httpRequestWithAuthentication: (_credentialsType: string, request: StubCall) => {
        calls.push(request);
        const next = responses.shift();
        if (next === undefined) throw new Error('stubContext ran out of responses');
        return Promise.resolve(next);
      },
      httpRequest: (request: StubCall) => {
        downloadCalls.push(request);
        const next = downloads.shift();
        if (next === undefined) throw new Error('stubContext ran out of downloads');
        return Promise.resolve(next);
      },
      prepareBinaryData: (data: Buffer, fileName?: string, mimeType?: string) =>
        Promise.resolve({
          data: data.toString('base64'),
          mimeType: mimeType ?? 'application/octet-stream',
          fileName,
        }),
    },
  };

  return {
    context: partial as unknown as IExecuteFunctions,
    calls,
    downloadCalls,
  };
}

export function succeededJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job_01JZ3M8Q0000000000000000CD',
    status: 'succeeded',
    product: 'pdf',
    mode: 'sync',
    template_id: null,
    output_url: 'https://objects.example.test/o/job_01JZ3M8Q0000000000000000CD/invoice.pdf?X-Amz-Signature=abc',
    output_bytes: 26_112,
    output_expires_at: '2026-08-14T10:00:00.000Z',
    page_count: 2,
    credits_charged: 2,
    credits_remaining: 4_871,
    watermarked: false,
    error: null,
    created_at: '2026-08-07T10:00:00.000Z',
    started_at: '2026-08-07T10:00:01.000Z',
    finished_at: '2026-08-07T10:00:03.000Z',
    ...overrides,
  };
}

export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  extra: Record<string, string> = {},
): StubResponse {
  return {
    statusCode,
    body: {
      error: {
        code,
        message,
        doc_url: `https://paperpony.dev/docs/errors#${code}`,
        request_id: 'req_01JZ3M8Q0000000000000000AB',
        ...extra,
      },
    },
  };
}

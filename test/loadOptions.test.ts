import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import { getTemplates } from '../nodes/PaperPony/loadOptions';
import { stubContext } from './helpers';
import type { ILoadOptionsFunctions } from 'n8n-workflow';

/**
 * The Template dropdown, and specifically that it scrolls.
 *
 * Make's review of the other integration found the same picker there stopping
 * at one page, so an account with more than a hundred templates could not
 * choose the rest and nothing said why. The node was already right, and
 * nothing here proved it: an edit that dropped the loop would have left every
 * test green.
 */

const template = (index: number) => ({
  id: `tpl_01JZ3M8Q00000000000000${String(index).padStart(4, '0')}`,
  name: `Template ${String(index).padStart(3, '0')}`,
});

const page = (from: number, count: number, next: string | null) => ({
  statusCode: 200,
  body: {
    data: Array.from({ length: count }, (_, offset) => template(from + offset)),
    has_more: next !== null,
    next_cursor: next,
  },
});

const load = (context: unknown) => getTemplates.call(context as ILoadOptionsFunctions);

describe('the Template dropdown', () => {
  it('asks for one page when that is all there is', async () => {
    const { context, calls } = stubContext({ responses: [page(1, 2, null)] });

    const options = await load(context);

    expect(options).toEqual([
      { name: 'Template 001', value: template(1).id },
      { name: 'Template 002', value: template(2).id },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.qs).toEqual({ limit: 100 });
  });

  it('carries the cursor forward until the list runs out', async () => {
    const { context, calls } = stubContext({
      responses: [page(1, 100, 'cursor-two'), page(101, 100, 'cursor-three'), page(201, 5, null)],
    });

    const options = await load(context);

    expect(options).toHaveLength(205);
    // The first page asks for no cursor, and each one after it sends back
    // exactly what the page before returned.
    expect(calls.map((call) => call.qs)).toEqual([
      { limit: 100 },
      { limit: 100, cursor: 'cursor-two' },
      { limit: 100, cursor: 'cursor-three' },
    ]);
  });

  it('stops rather than paging for ever', async () => {
    // Every page claims another one follows. A dropdown that never finishes
    // drawing is worse than one that is missing the tail, and the ID can still
    // be set by expression.
    const { context, calls } = stubContext({
      responses: Array.from({ length: 12 }, (_, index) =>
        page(1 + index * 100, 100, `cursor-${String(index + 2)}`),
      ),
    });

    await load(context);

    expect(calls).toHaveLength(10);
  });

  it('says why it is empty rather than showing nothing', async () => {
    const { context } = stubContext({ responses: [page(1, 0, null)] });

    // One call, because the stub hands out each response once.
    const failure = await load(context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NodeOperationError);
    expect((failure as Error).message).toMatch(/no templates yet/);
  });
});

import { NodeOperationError } from 'n8n-workflow';
import { paperPonyRequest } from './transport';
import type { PaginatedList, TemplateView } from './types';
import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

/** The API's own ceiling on one page (`MAX_PAGE_LIMIT`). */
const PAGE_SIZE = 100;

/**
 * A dropdown that needs eleven requests to draw is a dropdown nobody waits for.
 * A thousand templates on one account is already far past anything seen, and
 * stopping is better than hanging: the ID can still be set by expression.
 */
const MAX_PAGES = 10;

/**
 * Fills the Template dropdown.
 *
 * This is the reason the node lists templates at all. Typing `tpl_01JZ...` by
 * hand is fine for somebody writing code against the API and hopeless for
 * somebody who has never seen an ID, and getting one character wrong produces a
 * 404 rather than anything that explains itself.
 *
 * Archived templates are left out, because the list is for choosing what to
 * render next and an archived template cannot be rendered.
 */
export async function getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const found: INodePropertyOptions[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const list = await paperPonyRequest<PaginatedList<TemplateView>>(this, {
      method: 'GET',
      path: '/v1/templates',
      qs: cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor },
      itemIndex: 0,
    });

    for (const template of list.data) {
      found.push({ name: template.name, value: template.id });
    }

    if (!list.has_more || list.next_cursor === null) break;
    cursor = list.next_cursor;
  }

  if (found.length === 0) {
    // An empty dropdown says nothing about why it is empty, and "you have no
    // templates yet" is the one thing the reader needs at that moment.
    throw new NodeOperationError(
      this.getNode(),
      'This PaperPony account has no templates yet. Create one at app.paperpony.dev/templates, or use the Create From HTML operation instead.',
    );
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

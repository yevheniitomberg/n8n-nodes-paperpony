import type { INodeProperties } from 'n8n-workflow';

/**
 * Every label here is written for somebody automating their own work, not for a
 * developer reading an API reference. No field is named after the JSON key it
 * becomes, no description says "string" or "object", and each one says what to
 * put in with an example where an example helps.
 *
 * The options in the collection are the API's own render options, defaults
 * included, and nothing here offers a setting the API does not have.
 */

const RESOURCE: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  default: 'pdf',
  options: [
    { name: 'PDF', value: 'pdf' },
    { name: 'Job', value: 'job' },
  ],
};

const PDF_OPERATION: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  default: 'fromTemplate',
  displayOptions: { show: { resource: ['pdf'] } },
  options: [
    {
      name: 'Create From a Template',
      value: 'fromTemplate',
      description: 'Fill one of your saved templates and get a PDF back',
      action: 'Create a PDF from a template',
    },
    {
      name: 'Create From HTML',
      value: 'fromHtml',
      description: 'Turn HTML you supply into a PDF',
      action: 'Create a PDF from HTML',
    },
  ],
};

const JOB_OPERATION: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  default: 'get',
  displayOptions: { show: { resource: ['job'] } },
  options: [
    {
      name: 'Get',
      value: 'get',
      description: 'Look up a PDF that was made earlier, by its job ID',
      action: 'Get a job',
    },
  ],
};

const TEMPLATE: INodeProperties = {
  displayName: 'Template Name or ID',
  name: 'templateId',
  type: 'options',
  typeOptions: { loadOptionsMethod: 'getTemplates' },
  required: true,
  default: '',
  displayOptions: { show: { resource: ['pdf'], operation: ['fromTemplate'] } },
  description:
    'Which of your saved templates to fill. The list comes from your PaperPony account. Create and edit templates at app.paperpony.dev/templates. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const HTML: INodeProperties = {
  displayName: 'HTML',
  name: 'html',
  type: 'string',
  typeOptions: { rows: 8 },
  required: true,
  default: '',
  displayOptions: { show: { resource: ['pdf'], operation: ['fromHtml'] } },
  description:
    'The page to turn into a PDF, as HTML. Style it with a &lt;style&gt; block or a stylesheet URL. Images and fonts can be linked by URL and are fetched while the PDF is drawn. Up to 5 MB.',
};

const JOB_ID: INodeProperties = {
  displayName: 'Job ID',
  name: 'jobId',
  type: 'string',
  required: true,
  default: '',
  placeholder: 'job_01JZ3M8Q0000000000000000CD',
  displayOptions: { show: { resource: ['job'], operation: ['get'] } },
  description:
    'The ID PaperPony gave the PDF when it was made. Take it from an earlier step rather than typing it.',
};

/**
 * Two ways to give the template its values, and the pair exists because the
 * answer differs by document. A one-page letter has half a dozen named values
 * and belongs in the fields. An invoice has a list of lines, and a list cannot
 * be expressed as name and value pairs at all.
 */
const DATA_MODE: INodeProperties = {
  displayName: 'Values',
  name: 'dataMode',
  type: 'options',
  default: 'fields',
  displayOptions: { show: { resource: ['pdf'] } },
  options: [
    {
      name: 'Fill in Fields',
      value: 'fields',
      description: 'Name each value and set it, one row at a time',
    },
    {
      name: 'Use JSON',
      value: 'json',
      description: 'Paste or map a whole JSON object, for documents with lists in them',
    },
  ],
  description: 'How to supply the values that fill the document',
};

const DATA_FIELDS: INodeProperties = {
  displayName: 'Fields',
  name: 'dataFields',
  type: 'fixedCollection',
  typeOptions: { multipleValues: true },
  default: {},
  placeholder: 'Add Value',
  displayOptions: { show: { resource: ['pdf'], dataMode: ['fields'] } },
  description:
    'The values that fill your document, for example the invoice number and the customer name. The name has to match what the template asks for.',
  options: [
    {
      displayName: 'Value',
      name: 'entries',
      values: [
        {
          displayName: 'Name',
          name: 'name',
          type: 'string',
          default: '',
          placeholder: 'invoice_number',
          description: 'The name the template uses for this value',
        },
        {
          displayName: 'Value',
          name: 'value',
          type: 'string',
          default: '',
          placeholder: 'INV-001',
          description: 'What to put there. Drag a value in from an earlier step to use it.',
        },
      ],
    },
  ],
};

const DATA_JSON: INodeProperties = {
  displayName: 'Values (JSON)',
  name: 'dataJson',
  type: 'json',
  default: '{}',
  displayOptions: { show: { resource: ['pdf'], dataMode: ['json'] } },
  description:
    'The values that fill your document, as JSON. Use this when the document contains a list, such as the lines of an invoice: { "invoice_number": "INV-001", "items": [ { "name": "Design", "amount": "500.00" } ] }.',
};

/**
 * On by default, and that is the decision the whole node turns on. Somebody
 * building a workflow in n8n wants to attach the PDF to an email or put it in a
 * folder, and that needs the file. The link is in the output either way, for
 * anyone who would rather keep one.
 */
const DOWNLOAD: INodeProperties = {
  displayName: 'Return the File',
  name: 'download',
  type: 'boolean',
  default: true,
  description:
    'Whether to bring the PDF itself back, so the next step can attach or save it. Turn this off to get only a link, which is faster when nothing downstream needs the file.',
};

const BINARY_PROPERTY: INodeProperties = {
  displayName: 'Put the File In',
  name: 'binaryPropertyName',
  type: 'string',
  default: 'data',
  required: true,
  displayOptions: { show: { download: [true] } },
  description:
    'The name of the field the PDF arrives in. Leave it as data unless a later step expects something else.',
};

const OPTIONS: INodeProperties = {
  displayName: 'Options',
  name: 'options',
  type: 'collection',
  placeholder: 'Add Option',
  default: {},
  displayOptions: { show: { resource: ['pdf'] } },
  // Alphabetical by label, which n8n's own lint enforces across every node so
  // that a reader hunting for one setting always looks in the same place.
  options: [
    {
      displayName: 'File Name',
      name: 'filename',
      type: 'string',
      default: 'document.pdf',
      description: 'The name the PDF is saved under',
    },
    {
      displayName: 'Footer HTML',
      name: 'footer_html',
      type: 'string',
      typeOptions: { rows: 3 },
      default: '',
      description:
        'A strip printed at the bottom of every page. It takes the same classes as the header.',
    },
    {
      displayName: 'Header HTML',
      name: 'header_html',
      type: 'string',
      typeOptions: { rows: 3 },
      default: '',
      description:
        'A strip printed at the top of every page. Give an element one of the classes pageNumber, totalPages, date or title and it is filled in for you, so &lt;span class="pageNumber"&gt;&lt;/span&gt; prints the page number.',
    },
    {
      displayName: 'Margins',
      name: 'margin',
      type: 'fixedCollection',
      default: {},
      description: 'The white space around the document. Give each one a unit, such as 20mm.',
      options: [
        {
          displayName: 'Margin',
          name: 'values',
          values: [
            { displayName: 'Top', name: 'top', type: 'string', default: '20mm' },
            { displayName: 'Right', name: 'right', type: 'string', default: '15mm' },
            { displayName: 'Bottom', name: 'bottom', type: 'string', default: '20mm' },
            { displayName: 'Left', name: 'left', type: 'string', default: '15mm' },
          ],
        },
      ],
    },
    {
      displayName: 'Orientation',
      name: 'orientation',
      type: 'options',
      default: 'portrait',
      options: [
        { name: 'Landscape', value: 'landscape' },
        { name: 'Portrait', value: 'portrait' },
      ],
      description: 'Which way round the page is',
    },
    {
      displayName: 'Page Size',
      name: 'format',
      type: 'options',
      default: 'A4',
      options: [
        { name: 'A3', value: 'A3' },
        { name: 'A4', value: 'A4' },
        { name: 'A5', value: 'A5' },
        { name: 'A6', value: 'A6' },
        { name: 'Ledger', value: 'Ledger' },
        { name: 'Legal', value: 'Legal' },
        { name: 'Letter', value: 'Letter' },
        { name: 'Tabloid', value: 'Tabloid' },
      ],
      description: 'The paper size to lay the document out on',
    },
    {
      displayName: 'Pages',
      name: 'page_ranges',
      type: 'string',
      default: '',
      placeholder: '1-3, 8',
      description: 'Which pages to keep. Leave empty for all of them.',
    },
    {
      displayName: 'Print Background Colours',
      name: 'print_background',
      type: 'boolean',
      default: true,
      description:
        'Whether background colours and images are printed. Turn this off and a coloured header comes out white.',
    },
    {
      displayName: 'Scale',
      name: 'scale',
      type: 'number',
      typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
      default: 1,
      description: 'Shrinks or enlarges everything on the page. 1 is the document at its own size.',
    },
    {
      displayName: 'Timeout (Ms)',
      name: 'timeout_ms',
      type: 'number',
      typeOptions: { minValue: 1000, maxValue: 60000 },
      default: 15000,
      description: 'How long PaperPony may spend drawing before it gives up. Up to 60000.',
    },
    {
      displayName: 'Wait For',
      name: 'wait_for',
      type: 'options',
      default: 'networkidle',
      options: [
        {
          name: 'Everything to Finish Loading',
          value: 'networkidle',
          description:
            'Waits for images, fonts and stylesheets. Use this if a logo comes out missing.',
        },
        {
          name: 'The HTML Only',
          value: 'domcontentloaded',
          description: 'Fastest. Anything fetched from a link may not have arrived.',
        },
        {
          name: 'The Page to Load',
          value: 'load',
          description: 'Faster, and enough for plain documents',
        },
      ],
      description: 'How long to let the document settle before it is drawn',
    },
  ],
};

export const paperPonyProperties: INodeProperties[] = [
  RESOURCE,
  PDF_OPERATION,
  JOB_OPERATION,
  TEMPLATE,
  HTML,
  JOB_ID,
  DATA_MODE,
  DATA_FIELDS,
  DATA_JSON,
  OPTIONS,
  DOWNLOAD,
  BINARY_PROPERTY,
];

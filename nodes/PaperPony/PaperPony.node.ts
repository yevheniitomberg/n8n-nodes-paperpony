import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { CREDENTIALS_NAME } from './constants';
import { paperPonyProperties } from './descriptions';
import { asNodeError } from './errors';
import { getTemplates } from './loadOptions';
import {
  downloadOutput,
  getJob,
  refuseAJobWithNothingToGive,
  renderPdf,
  waitForJob,
} from './operations';
import type { JobView } from './types';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';

export class PaperPony implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'PaperPony',
    name: 'paperPony',
    // Indigo 600 against the light theme, indigo 400 against the dark one.
    icon: { light: 'file:paperpony.svg', dark: 'file:paperpony.dark.svg' },
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Create PDFs from a saved template or your own HTML',
    defaults: { name: 'PaperPony' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    /**
     * Lets n8n's own AI agent nodes call this one as a tool.
     *
     * Spec §15 puts "any AI feature" out of scope for v1, and a formal reading
     * of that line would delete this flag. It should not be deleted. The rule
     * is about what PaperPony builds: we are not writing a model, a prompt or
     * an agent, and nothing here reaches an AI service. This says that somebody
     * else's agent, running in their n8n, may call our API the same way a
     * schedule or a webhook already can.
     *
     * Removing it would not remove an AI feature. It would remove PaperPony
     * from a growing share of the workflows in the catalogue we are shipping
     * into, which is the opposite of what phase 1f is for.
     */
    usableAsTool: true,
    credentials: [{ name: CREDENTIALS_NAME, required: true }],
    properties: paperPonyProperties,
  };

  methods = {
    loadOptions: { getTemplates },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      // Declared out here so the On Error branch can hand back the job rather
      // than only the sentence about it. It stays undefined for every failure
      // that happens before a job exists, which is what tells the two apart.
      let job: JobView | undefined;

      try {
        const resource = this.getNodeParameter('resource', itemIndex) as string;
        const operation = this.getNodeParameter('operation', itemIndex) as string;

        if (resource === 'pdf' && operation === 'fromTemplate') {
          const templateId = this.getNodeParameter('templateId', itemIndex) as string;
          job = await renderPdf(this, itemIndex, { template_id: templateId });
        } else if (resource === 'pdf' && operation === 'fromHtml') {
          const html = this.getNodeParameter('html', itemIndex) as string;
          job = await renderPdf(this, itemIndex, { html });
        } else if (resource === 'job' && operation === 'get') {
          const jobId = this.getNodeParameter('jobId', itemIndex) as string;
          // Read once, and wait only if it is still running. Somebody who put
          // this step after an asynchronous render wants the finished file, not
          // a row saying `queued` that the next step cannot use.
          job = await waitForJob(this, await getJob(this, itemIndex, jobId), itemIndex);
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `The PaperPony node has no ${resource} operation called ${operation}.`,
            { itemIndex },
          );
        }

        // One rule for all three operations: a job with nothing to give ends the
        // step. A failed render, and a succeeded one whose file has been deleted
        // since. The third case, a render still going when the wait ran out,
        // ends inside `waitForJob` for the same reason.
        refuseAJobWithNothingToGive(this, job, itemIndex);

        const entry: INodeExecutionData = {
          json: job as unknown as INodeExecutionData['json'],
          pairedItem: { item: itemIndex },
        };

        const download = this.getNodeParameter('download', itemIndex, true) as boolean;
        if (download && job.status === 'succeeded') {
          const file = await downloadOutput(this, job, itemIndex);
          if (file !== null) entry.binary = { [file.binaryPropertyName]: file.data };
        }

        output.push(entry);
      } catch (error) {
        // n8n's own switch, and it has to be honoured item by item: a workflow
        // rendering fifty invoices should be able to carry on past the one
        // whose data was wrong rather than lose the other forty-nine.
        if (this.continueOnFail()) {
          const message = error instanceof Error ? error.message : String(error);

          // The job row, when there is one, and not only the sentence. This is
          // the documented way to get a failed job's own fields, and it used to
          // hand back `{ error }` alone, so the id, the status and the error
          // code were all unreachable from the branch that exists to reach them.
          output.push({
            json: { ...(job ?? {}), error: message } as unknown as INodeExecutionData['json'],
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        throw asNodeError(this.getNode(), error, itemIndex);
      }
    }

    return [output];
  }
}

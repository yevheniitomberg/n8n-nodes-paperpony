# n8n-nodes-paperpony

Make PDFs in n8n. Fill one of your saved templates, or send your own HTML, and
the file comes back attached to the item so the next step can mail it, upload it
or drop it in a folder.

## Install

In n8n: **Settings > Community nodes > Install**, then `n8n-nodes-paperpony`.

You need a PaperPony API key. Create one at
[app.paperpony.dev/keys](https://app.paperpony.dev/keys). It is shown once and
cannot be read again, so copy it before you close the page. Paste it into a new
**PaperPony API** credential and press the test button: it calls the account
endpoint straight away and tells you there and then whether the key works.

## A workflow to paste

Copy this, click anywhere on an n8n canvas and press Ctrl+V. It arrives as two
connected nodes. Open the PaperPony one, pick your credential, and press Test
step: a PDF comes back attached to the item.

```json
{
  "nodes": [
    {
      "parameters": {},
      "id": "8f1d1a2e-0f6a-4a1e-9a3e-1b2c3d4e5f60",
      "name": "When clicking Test workflow",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "pdf",
        "operation": "fromHtml",
        "html": "<h1>Invoice INV-001</h1>\n<p>Ada Lovelace</p>\n<p>Consulting: 900.00</p>",
        "options": { "filename": "invoice-001.pdf", "format": "A4" }
      },
      "id": "3c9b7d54-6e2f-4a88-9d31-7f0e5a6b8c11",
      "name": "PaperPony",
      "type": "n8n-nodes-paperpony.paperPony",
      "typeVersion": 1,
      "position": [220, 0]
    }
  ],
  "connections": {
    "When clicking Test workflow": {
      "main": [[{ "node": "PaperPony", "type": "main", "index": 0 }]]
    }
  }
}
```

To use one of your own templates instead, change `operation` to `fromTemplate`
and pick the template by name in the Template field, which is filled from your
account.

## What it does

**PDF > Create from a template.** Pick a template from the list. It is filled
from your PaperPony account, so you choose a name rather than typing an ID. Then
give it values, either as named rows or as JSON when the document contains a
list, such as the lines of an invoice.

**PDF > Create from HTML.** For a document you have already built. Style it with
a `<style>` block or a stylesheet URL. Images and fonts can be linked by URL and
are fetched while the page is drawn.

**Job > Get.** Looks a PDF up by the ID PaperPony gave it. Useful when an earlier
render was slow and you want the file in a later branch of the workflow.

There is no trigger. PaperPony has no events to subscribe to, so a trigger would
have to invent one.

## The file, and the link

Every operation returns both. The PDF arrives as binary data on the item, in the
field named under **Put the File In**, which is `data` unless you change it. The
job's own fields arrive as JSON beside it, including `output_url`.

`output_url` is signed and expires. How long it lasts is your plan's retention:
a day on Free, seven days on Starter, and on Growth and Scale the file lives for
thirty days while the link itself is capped at seven, which is the longest such a
signature can be issued for. Storing the link is the fragile way to keep a file.
Store `id` instead and use **Job > Get**, which signs a new link every time it
reads the job.

## Things worth knowing before you build a workflow

**On the Free plan every PDF carries a watermark.** The `watermarked` field says
so on each item, so a workflow can branch on it rather than discover it from a
customer.

**One credit is one page.** A three-page invoice costs three.

**Being rate limited is not an error here.** PaperPony allows 10 requests a
minute on Free, 60 on Starter, 300 on Growth and 1,000 on Scale. When the node
runs into that limit it waits for as long as PaperPony asks and tries again,
rather than failing the step.

**Running out of credits is an error, and the step stops.** Retrying would not
produce credits and a scheduled workflow would spend the night asking.

**Limits.** HTML is capped at 5 MB, and everything the document pulls in while
being drawn at 20 MB together. A render may run for 15 seconds by default and 60
at the most, which you set under Options.

## Errors

The node translates PaperPony's error codes into sentences, so a step that fails
says what to do rather than printing `insufficient_credits`. PaperPony's own
message stays underneath, along with the request ID to quote if you write to
support.

## Licence

MIT. Built by the PaperPony team. Questions go to hello@paperpony.dev.

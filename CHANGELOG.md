# Changelog

## 0.2.0

**Breaking. A job with nothing to give now ends the step.** If you have this
node installed and a workflow that reads jobs back, read this before upgrading.

Three cases used to arrive as an ordinary green item carrying the job and no
file. All three are now an error on the step:

- **A render that failed.** `Job > Get` returned the failed row as normal
  output, with `status: "failed"` inside it and nothing attached. The two PDF
  operations already raised. Now all three do.
- **A PDF whose file has been deleted.** A file is kept for as long as your plan
  allows and the job record outlives it, so reading an old job back gave you
  every field except the one you wanted, with no indication that anything had
  happened. The node now says the document was made and the file has since been
  deleted, and names the retention your plan gives you.
- **A render still being drawn when the node stopped waiting.** Unchanged in
  behaviour and listed for completeness: it has always raised.

**If you were relying on the row rather than on the file,** turn on **On Error →
Continue** for the step. That path now hands back the job's own fields alongside
the error, which it did not do before: it used to replace the item with the
error sentence alone, so the id, the status and the error code were all
unreachable from the branch that exists to reach them.

**A failed job no longer describes itself as a refused request.** The sentences
this node shows are written for a request that was just refused, and most of
them are not true of a job read back afterwards. Reading a real failed job used
to answer "PaperPony refused the request because one of the fields is wrong"
when the request had been fine and a template had failed a week earlier. A
failed job now leads with what happened to the document. The API's own message,
the error code and the job id are all still there.

Also in this release: a workflow in the README that works from pasting, and a
contact address on the package that a bug can actually be sent to.

## 0.1.0

First release. Create a PDF from a saved template or from your own HTML, and
read a job back by its id.

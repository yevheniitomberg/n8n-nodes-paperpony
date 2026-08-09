import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the codex file into `dist`, which `n8n-node build` does not do.
 *
 * Its static-file step copies `**\/*.{png,svg}` and schema JSON, and nothing
 * else, so `PaperPony.node.json` never reaches the published tarball on its
 * own. n8n looks for the codex next to the compiled node and says
 * `No codex available for: paperPony` at debug level when it is missing, which
 * is how this was found: the file existed, the build silently left it behind,
 * and nothing failed.
 *
 * It is not decoration. The codex is where `categories` lives, and categories
 * decide where the node appears in n8n's panel. For an integration whose whole
 * purpose is that somebody searching in that panel finds us, being filed
 * nowhere is the one failure that costs the most and complains the least.
 *
 * This runs in the build, never in the node. Nothing at runtime reads a file.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const CODEX = join('nodes', 'PaperPony', 'PaperPony.node.json');

const target = join(root, 'dist', CODEX);
await mkdir(dirname(target), { recursive: true });
await copyFile(join(root, CODEX), target);

console.log(`copied ${CODEX} into dist`);

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const jobPath = join(root, 'deploy', 'nosana', 'readgate-job.template.json');
const job = JSON.parse(await readFile(jobPath, 'utf8'));
const errors = [];

if (job.version !== '0.1' || job.type !== 'container') errors.push('Job must declare Nosana schema version 0.1 and container type.');
const operation = job.ops?.[0];
if (!operation || operation.type !== 'container/run' || !operation.id) errors.push('Job needs an identified container/run operation.');
if (!operation?.args?.gpu) errors.push('Question generation must request a GPU.');
if (!operation?.args?.image || operation.args.image.includes('REPLACE_WITH')) errors.push('Set a pinned public worker image before submitting this template.');
const healthCheck = operation?.args?.expose?.[0]?.health_checks?.[0];
if (healthCheck?.type !== 'http' || healthCheck.path !== '/health' || healthCheck.expected_status !== 200) errors.push('Job must expose an HTTP /health check returning 200.');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Nosana job definition has the required ReadGate fields.');
}
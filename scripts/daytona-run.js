import { Daytona } from '@daytona/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ttlMinutes = Number(process.env.DAYTONA_TTL_MINUTES || 60);
const publicPreview = process.env.DAYTONA_PUBLIC_PREVIEW === 'true';

if (!process.env.DAYTONA_API_KEY) {
  console.error('DAYTONA_API_KEY is required. Set it in your shell or .env.local.');
  process.exitCode = 1;
} else if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) {
  console.error('DAYTONA_TTL_MINUTES must be an integer from 1 to 1440.');
  process.exitCode = 1;
} else {
  const daytona = new Daytona({
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET
  });
  const sandbox = await daytona.create({
    snapshot: 'daytona-small',
    language: 'javascript',
    ephemeral: true,
    autoStopInterval: 0,
    ttlMinutes,
    public: publicPreview
  });
  const files = [
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['server.js', 'server.js'],
    ['providers/nosana.js', 'providers/nosana.js'],
    ['providers/openrouter.js', 'providers/openrouter.js'],
    ['public/index.html', 'public/index.html'],
    ['public/styles.css', 'public/styles.css'],
    ['public/sdk.js', 'public/sdk.js'],
    ['public/app.js', 'public/app.js'],
    ['public/embed-example.html', 'public/embed-example.html'],
    ['public/evidence.json', 'public/evidence.json']
  ];

  try {
    await sandbox.fs.createFolder('public', '755');
    await sandbox.fs.createFolder('providers', '755');
    for (const [localPath, remotePath] of files) {
      await sandbox.fs.uploadFile(await readFile(join(root, localPath)), remotePath);
    }
    const install = await sandbox.process.executeCommand('npm ci --omit=dev', undefined, undefined, 120);
    if (install.exitCode !== 0) throw new Error(install.result || 'Daytona dependency installation failed.');
    const sessionId = 'readgate-server';
    await sandbox.process.createSession(sessionId);
    const serverEnvironment = { PORT: '3000' };
    if (process.env.NOSANA_INFERENCE_URL) serverEnvironment.NOSANA_INFERENCE_URL = process.env.NOSANA_INFERENCE_URL;
    if (process.env.NOSANA_MODEL) serverEnvironment.NOSANA_MODEL = process.env.NOSANA_MODEL;
    if (process.env.NOSANA_DEPLOYMENT_ID) serverEnvironment.NOSANA_DEPLOYMENT_ID = process.env.NOSANA_DEPLOYMENT_ID;
    if (process.env.NOSANA_API_KEY && (process.env.NOSANA_DEPLOYMENT_ID || process.env.NOSANA_INFERENCE_URL && new URL(process.env.NOSANA_INFERENCE_URL).hostname === 'inference.nosana.com')) {
      serverEnvironment.NOSANA_API_KEY = process.env.NOSANA_API_KEY;
    }
    if (process.env.OPENROUTER_API_KEY) serverEnvironment.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (process.env.OPENROUTER_MODEL) serverEnvironment.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;
    await sandbox.updateEnv(serverEnvironment);
    await sandbox.process.executeSessionCommand(sessionId, {
      command: 'node server.js',
      runAsync: true
    });
    const preview = await sandbox.getPreviewLink(3000);
    const healthResponse = await fetch(new URL('/health', preview.url), publicPreview ? undefined : {
      headers: { 'x-daytona-preview-token': preview.token }
    });
    const health = await healthResponse.json();
    if (!healthResponse.ok || health.status !== 'ok') throw new Error('Daytona preview health check failed.');
    console.log(JSON.stringify({
      provider: 'daytona',
      sandboxId: sandbox.id,
      status: 'running',
      ttlMinutes,
      health: health.status,
      preview: publicPreview ? preview.url : 'private; open the sandbox in the Daytona dashboard'
    }, null, 2));
  } catch (error) {
    await sandbox.delete(60, true);
    throw error;
  }
}
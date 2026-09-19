import { Daytona } from '@daytona/sdk';
import { readFile } from 'node:fs/promises';

const sandboxId = process.env.DAYTONA_SANDBOX_ID;

if (!process.env.DAYTONA_API_KEY || !sandboxId) {
  console.error('DAYTONA_API_KEY and DAYTONA_SANDBOX_ID are required.');
  process.exitCode = 1;
} else {
  const daytona = new Daytona({
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET
  });
  const sandbox = await daytona.get(sandboxId);
  await sandbox.process.executeCommand('mkdir -p providers');
  for (const [localPath, remotePath] of [
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['server.js', 'server.js'],
    ['providers/nosana.js', 'providers/nosana.js'],
    ['providers/openrouter.js', 'providers/openrouter.js'],
    ['public/app.js', 'public/app.js'],
    ['public/evidence.json', 'public/evidence.json']
  ]) {
    await sandbox.fs.uploadFile(await readFile(localPath), remotePath);
  }
  const install = await sandbox.process.executeCommand('npm ci --omit=dev', undefined, undefined, 120);
  if (install.exitCode !== 0) throw new Error(install.result || 'Daytona dependency installation failed.');
  await sandbox.process.executeCommand("pkill -f 'node server.js' || true");
  const providerEnvironment = { PORT: '3000' };
  const providerVariables = [
    'NOSANA_INFERENCE_URL', 'NOSANA_MODEL', 'NOSANA_DEPLOYMENT_ID', 'NOSANA_API_KEY',
    'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'
  ];
  for (const name of providerVariables) {
    if (process.env[name]) providerEnvironment[name] = process.env[name];
  }
  await sandbox.updateEnv(providerEnvironment, {
    unset: providerVariables.filter((name) => !process.env[name])
  });
  const sessionId = `readgate-nosana-${Date.now()}`;
  await sandbox.process.createSession(sessionId);
  await sandbox.process.executeSessionCommand(sessionId, {
    command: 'node server.js',
    runAsync: true
  });
  const preview = await sandbox.getPreviewLink(3000);
  const [healthResponse, nosanaResponse] = await Promise.all([
    fetch(new URL('/health', preview.url)),
    fetch(new URL('/api/nosana/status', preview.url))
  ]);
  const health = await healthResponse.json();
  const nosana = await nosanaResponse.json();
  if (!healthResponse.ok || health.status !== 'ok' || nosana.status !== 'connected') {
    throw new Error('Updated Daytona service did not pass health or provider status checks.');
  }
  console.log(JSON.stringify({
    provider: 'daytona',
    sandboxId: sandbox.id,
    health: health.status,
    provider: { status: nosana.status, source: nosana.source, model: nosana.model }
  }, null, 2));
}
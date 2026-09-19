import { Daytona } from '@daytona/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (!process.env.DAYTONA_API_KEY) {
  console.error('DAYTONA_API_KEY is required. Set it in your shell; do not put it in a file.');
  process.exitCode = 1;
} else {
  const daytona = new Daytona({
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET
  });
  let sandbox;
  try {
    sandbox = await daytona.create({
      snapshot: 'daytona-small',
      language: 'javascript',
      ephemeral: true,
      autoStopInterval: 5,
      ttlMinutes: 20
    });
    const packageJson = await readFile(join(root, 'package.json'));
    const server = await readFile(join(root, 'server.js'));
    const serverTest = await readFile(join(root, 'test', 'server.test.js'));
    const sdk = await readFile(join(root, 'public', 'sdk.js'));
    const embedExample = await readFile(join(root, 'public', 'embed-example.html'));
    await sandbox.fs.createFolder('test', '755');
    await sandbox.fs.createFolder('public', '755');
    await sandbox.fs.uploadFile(packageJson, 'package.json');
    await sandbox.fs.uploadFile(server, 'server.js');
    await sandbox.fs.uploadFile(serverTest, 'test/server.test.js');
    await sandbox.fs.uploadFile(sdk, 'public/sdk.js');
    await sandbox.fs.uploadFile(embedExample, 'public/embed-example.html');
    const result = await sandbox.process.executeCommand('node --test test/server.test.js');
    if (result.exitCode !== 0) throw new Error(result.result || 'Daytona test command failed.');
    console.log(JSON.stringify({ provider: 'daytona', sandboxId: sandbox.id, status: 'passed', output: result.result }, null, 2));
  } finally {
    if (sandbox) {
      await sandbox.delete(60, true);
      console.log(JSON.stringify({ provider: 'daytona', sandboxId: sandbox.id, cleanup: 'deleted' }));
    }
  }
}
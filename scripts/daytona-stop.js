import { Daytona } from '@daytona/sdk';

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
  await sandbox.delete(60, true);
  console.log(JSON.stringify({ provider: 'daytona', sandboxId, cleanup: 'deleted' }));
}
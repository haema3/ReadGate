import { Daytona } from '@daytona/sdk';
import { readFile } from 'node:fs/promises';

function errorDetails(error) {
  const code = error.cause?.code ?? error.code;
  return {
    name: error.name,
    code: typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined,
    httpStatus: error.response?.status ?? error.statusCode
  };
}

async function probe() {
  const { createNosanaClient, NosanaNetwork } = await import('@nosana/kit');
  const results = [];
  async function check(stage, operation) {
    const started = Date.now();
    let timer;
    try {
      const value = await Promise.race([
        operation(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })), 12000);
        })
      ]);
      results.push({ stage, ok: true, durationMs: Date.now() - started });
      return value;
    } catch (error) {
      results.push({ stage, ok: false, durationMs: Date.now() - started, ...errorDetails(error) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  for (const [stage, url] of [
    ['essential-https', 'https://registry.npmjs.org/-/ping'],
    ['public-https', 'https://example.com']
  ]) {
    await check(stage, async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      if (!response.ok) throw Object.assign(new Error('HTTP failure'), { response });
    });
  }
  if (process.env.NOSANA_INFERENCE_URL) {
    await check('inference-models', async () => {
      const url = new URL('/v1/models', process.env.NOSANA_INFERENCE_URL);
      if (url.protocol !== 'https:') throw Object.assign(new Error('HTTPS required'), { code: 'CONFIG_INVALID' });
      const headers = {};
      if (url.hostname === 'inference.nosana.com') headers.Authorization = `Bearer ${process.env.NOSANA_API_KEY}`;
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      if (!response.ok) throw Object.assign(new Error('HTTP failure'), { response });
    });
  }
  const nosana = createNosanaClient(NosanaNetwork.MAINNET, {
    api: { apiKey: process.env.NOSANA_API_KEY }
  });
  const deployment = await check('deployment-api', () => nosana.api.deployments.get(process.env.NOSANA_DEPLOYMENT_ID));
  if (deployment) {
    const result = await check('deployment-jobs', () => deployment.getJobs());
    const jobs = Array.isArray(result) ? result : result?.jobs ?? result?.data ?? [];
    if (jobs[0]?.address) await check('solana-job', () => nosana.jobs.get(jobs[0].address));
    else if (result) results.push({ stage: 'solana-job', ok: false, code: 'JOB_UNAVAILABLE' });
  }
  console.log(JSON.stringify({
    runtime: process.version,
    configured: {
      apiKey: Boolean(process.env.NOSANA_API_KEY),
      deployment: Boolean(process.env.NOSANA_DEPLOYMENT_ID),
      httpsProxy: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
      nodeUseEnvProxy: process.env.NODE_USE_ENV_PROXY === '1',
      extraCaCertificates: Boolean(process.env.NODE_EXTRA_CA_CERTS)
    },
    results
  }, null, 2));
  process.exit(results.some((result) => !result.ok) ? 1 : 0);
}

async function diagnose() {
  const sandboxId = process.env.DAYTONA_SANDBOX_ID;
  if (!process.env.DAYTONA_API_KEY || !sandboxId) {
    throw Object.assign(new Error('Missing Daytona configuration'), { code: 'CONFIG_REQUIRED' });
  }
  const daytona = new Daytona({
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET
  });
  const sandbox = await daytona.get(sandboxId);
  await sandbox.refreshData();
  console.log(JSON.stringify({
    provider: 'daytona',
    sandboxId,
    state: sandbox.state,
    autoDestroyAt: sandbox.autoDestroyAt,
    network: {
      blockAll: sandbox.networkBlockAll,
      hasIpAllowList: Boolean(sandbox.networkAllowList),
      hasDomainAllowList: Boolean(sandbox.domainAllowList),
      hasOutboundProxy: Boolean(sandbox.outboundProxyUrl)
    }
  }, null, 2));
  const remotePath = '.readgate-nosana-diagnose.mjs';
  await sandbox.fs.uploadFile(await readFile(new URL(import.meta.url)), remotePath);
  try {
    const result = await sandbox.process.executeCommand(`node ${remotePath} --probe`, undefined, undefined, 90);
    console.log(result.result);
    process.exitCode = result.exitCode;
  } finally {
    await sandbox.fs.deleteFile(remotePath);
  }
}

try {
  if (process.argv.includes('--probe')) await probe();
  else await diagnose();
} catch (error) {
  console.error(JSON.stringify(errorDetails(error)));
  process.exitCode = 1;
}
import { createNosanaClient, NosanaNetwork } from '@nosana/kit';
import { getOpenRouterStatus } from './openrouter.js';

function jobsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.jobs)) return result.jobs;
  if (Array.isArray(result.data)) return result.data;
  return [];
}

export async function getNosanaStatus() {
  const deploymentId = process.env.NOSANA_DEPLOYMENT_ID;
  if (!deploymentId) return { status: 'not-configured' };
  if (!process.env.NOSANA_API_KEY) return { status: 'authentication-required' };
  try {
    const nosana = createNosanaClient(NosanaNetwork.MAINNET, {
      api: { apiKey: process.env.NOSANA_API_KEY }
    });
    const deployment = await nosana.api.deployments.get(deploymentId);
    const jobs = jobsFrom(await deployment.getJobs());
    const activeJob = jobs[0];
    if (!activeJob?.address) return { status: 'job-unavailable', deploymentId, deploymentStatus: deployment.status };
    const job = await nosana.jobs.get(activeJob.address);
    return {
      status: 'connected',
      source: 'nosana-sdk',
      deploymentId,
      deploymentStatus: deployment.status,
      job: { address: job.address, state: job.state }
    };
  } catch {
    return { status: 'unreachable' };
  }
}

export async function getProviderStatus({ nosanaStatus = getNosanaStatus, openRouterStatus = getOpenRouterStatus } = {}) {
  const nosana = await nosanaStatus();
  if (nosana.status === 'connected') return nosana;
  const openRouter = await openRouterStatus();
  return openRouter.status === 'connected' ? { ...openRouter, fallbackFor: 'nosana' } : nosana;
}
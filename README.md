# ReadGate Hackathon Demo

ReadGate is an embeddable reading-check SDK demo. It observes paragraph visibility and effective dwell time, then asks server-checked questions before enabling the next step.

## Run locally

```powershell
npm install
npm test
npm start
```

Open `http://localhost:3000`. The independent SDK example is `http://localhost:3000/embed-example.html`.

## Container smoke test

```powershell
docker build -t readgate-demo:0.1.0 .
docker run --rm -p 3000:3000 readgate-demo:0.1.0
```

Confirm `http://localhost:3000/health` returns an `ok` status, then stop the container.

## Daytona verification

Set `DAYTONA_API_KEY` in your terminal, then run:

```powershell
npm run daytona:verify
```

Or, keep the key in an ignored `.env.local` file and run:

```powershell
npm run daytona:verify:local
```

The script creates a `daytona-small` ephemeral sandbox with a 20-minute TTL, uploads the server test, runs it, prints a non-secret result, and deletes the sandbox in `finally`.

## Run on Daytona

Run a private preview for up to 60 minutes:

```powershell
npm run daytona:run:local
```

The command uploads the server and SDK files, installs locked production dependencies, starts `node server.js` in a Daytona session, verifies `/health` through a private preview, and prints the sandbox ID. The preview token is never printed. Open that sandbox in the Daytona dashboard to inspect its private preview. Change `DAYTONA_TTL_MINUTES` in `.env.local` to a value from 1 to 1440.

To create a public preview for a time-limited presentation, set `DAYTONA_PUBLIC_PREVIEW=true` before running the command. A public preview URL is printed only in that mode. Do not use it for private content.

To apply a server update to an existing Daytona sandbox, set `DAYTONA_SANDBOX_ID` and run `npm run daytona:update:local`. It injects configured Nosana and OpenRouter variables into the server environment, without logging their values.

Delete the running sandbox when the demo ends:

```powershell
$env:DAYTONA_SANDBOX_ID = "sandbox-id-from-daytona-run"
npm run daytona:stop:local
```

### Nosana outbound connectivity

Run the same bounded, secret-safe probes locally and inside the existing sandbox:

```powershell
node --env-file=.env.local scripts/daytona-nosana-diagnose.js --probe
npm run daytona:diagnose-nosana:local
```

The remote command requires `DAYTONA_API_KEY` and `DAYTONA_SANDBOX_ID`. It reports sandbox policy flags and separately checks npm HTTPS, general HTTPS, the configured inference endpoint, the deployment API, deployment jobs, and Solana job lookup. It does not change network policy and deletes its temporary remote file. Exit code 1 means at least one check failed; it never prints API keys, response bodies, or configured URLs.

On 2026-09-19, npm returned HTTP 200 while general HTTPS and Nosana failed with `ECONNRESET`. The official `updateNetworkSettings` API rejected a scoped domain allow list with HTTP 400: `Network access is restricted and cannot be overridden at the sandbox level.` This confirms an organization-level egress restriction, even though the sandbox reports `networkBlockAll: false` and no allow lists.

According to [Daytona's network policy](https://www.daytona.io/docs/en/network-limits/), Tier 1 and Tier 2 restrictions cannot be overridden per sandbox; Tier 3 and Tier 4 support custom egress policies. Reinstalling the SDK, changing Nosana credentials, or disabling TLS verification does not remove this restriction.

1. Ask the hackathon organizers or Daytona support to enable the required outbound access for this organization, or use an organization with approved network access. Any paid tier change requires explicit approval; check the current [tier requirements](https://www.daytona.io/docs/en/limits/).
2. The current SDK needs `deployment-manager.k8s.prd.nos.ci` and `rpc.ironforge.network`. Allow the configured inference hostname as well, currently `inference.nosana.com`, or the assigned Nosana node hostname when using a direct endpoint. Keep `registry.npmjs.org` allowed for dependency installation.
3. Rerun the remote diagnostic after the policy change. For a deliberately restricted allow list, the general `example.com` probe may still fail; verify the Nosana-specific stages individually. Then check `/api/nosana/status` for `connected` and `/health` for `ok` on the preview URL.

SDK job lookup confirms deployment connectivity, not successful model inference or AI-generated quiz questions. The demo keeps reporting `unreachable` until the real SDK calls succeed.

### OpenRouter fallback

When the Nosana SDK status is anything other than `connected`, the server uses OpenRouter only when `OPENROUTER_API_KEY` is configured. It sends a bounded, server-side `GET https://openrouter.ai/api/v1/models?limit=1` request with the key as a Bearer token. A successful fallback is returned as `source: "openrouter-fallback"`; API keys and provider response bodies are never returned to the browser.

```env
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=optional-model-id
```

`OPENROUTER_MODEL` is display metadata only: the fallback verifies authenticated OpenRouter connectivity and does not create a billable completion. The existing quiz questions remain static; this is not AI question generation.

## Nosana preparation

Configure an Ollama-compatible Nosana inference endpoint for the demo server:

```env
NOSANA_INFERENCE_URL=https://inference.nosana.com
NOSANA_MODEL=qwen/qwen3.8-27b
NOSANA_DEPLOYMENT_ID=your-deployment-id
```

Run the local server with `.env.local` loaded:

```powershell
npm run start:local
```

The server uses `createNosanaClient()` to resolve the configured deployment's active job, then calls `nosana.jobs.get(jobAddress)` through `/api/nosana/status`. `daytona:run:local` passes the API key and deployment ID only to the Daytona server process and never logs either value.

`deploy/nosana/readgate-job.template.json` matches the documented job structure and health-check shape, but intentionally refuses validation until a pinned public image has been built and pushed. This repository does not contain a fake job identifier or claim a Nosana deployment.

```powershell
npm run nosana:validate
```

After publishing a pinned worker image and selecting a market with current capacity, replace the template image value, validate against the current official Nosana SDK/schema, deploy with approved credentials, preserve the non-secret job result, and stop the job after the presentation.
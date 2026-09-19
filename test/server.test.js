import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server.js';

let server;
let baseUrl;

test.before(async () => {
  server = createApp({
    nosanaStatus: async () => ({
      status: 'connected',
      source: 'nosana-sdk',
      deploymentId: 'deployment-id',
      deploymentStatus: 'RUNNING',
      job: { address: 'job-address', state: 1 }
    })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('requires a correct answer before completing an assigned reading check', async () => {
  const sessionResponse = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paragraphIds: ['demo'] })
  });
  const session = await sessionResponse.json();
  assert.equal(sessionResponse.status, 201);
  assert.equal(session.questions[0].correctOption, undefined);

  const blocked = await fetch(`${baseUrl}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId })
  });
  assert.equal(blocked.status, 403);

  const wrongAnswer = await fetch(`${baseUrl}/api/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId, questionId: 'demo', optionIndex: 0 })
  });
  assert.equal((await wrongAnswer.json()).correct, false);

  const correctAnswer = await fetch(`${baseUrl}/api/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId, questionId: 'demo', optionIndex: 2 })
  });
  assert.equal((await correctAnswer.json()).complete, true);

  const completed = await fetch(`${baseUrl}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.sessionId })
  });
  assert.deepEqual(await completed.json(), { completed: true });
});

test('serves the reusable SDK and independent embed example', async () => {
  const [sdk, example, pitch] = await Promise.all([
    fetch(`${baseUrl}/sdk.js`),
    fetch(`${baseUrl}/embed-example.html`),
    fetch(`${baseUrl}/pitch.html`)
  ]);
  assert.equal(sdk.status, 200);
  assert.match(await sdk.text(), /window\.ReadGate/);
  assert.equal(example.status, 200);
  assert.match(await example.text(), /data-target="#article"/);
  assert.equal(pitch.status, 200);
  assert.match(await pitch.text(), /ReadGate 발표 슬라이드/);
});

test('reports service health for local and container checks', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'readgate-demo' });
});

test('returns the configured Nosana inference status without exposing a key', async () => {
  const response = await fetch(`${baseUrl}/api/nosana/status`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'connected',
    source: 'nosana-sdk',
    deploymentId: 'deployment-id',
    deploymentStatus: 'RUNNING',
    job: { address: 'job-address', state: 1 }
  });
});

test('reports an unreachable Nosana endpoint without leaking configuration', async () => {
  const unavailableServer = createApp({ nosanaStatus: async () => ({ status: 'unreachable' }) });
  await new Promise((resolve) => unavailableServer.listen(0, '127.0.0.1', resolve));
  try {
    const port = unavailableServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/nosana/status`);
    assert.deepEqual(await response.json(), { status: 'unreachable' });
  } finally {
    unavailableServer.close();
  }
});

test('serves non-secret Daytona verification evidence', async () => {
  const response = await fetch(`${baseUrl}/evidence.json`);
  const evidence = await response.json();
  assert.equal(response.status, 200);
  assert.equal(evidence.daytona.status, 'verified');
  assert.equal(evidence.daytona.cleanup, 'deleted');
  assert.match(evidence.daytona.resourceId, /^[0-9a-f-]{36}$/);
  assert.equal(evidence.daytona.deployment.status, 'running');
  assert.equal(evidence.daytona.deployment.health, 'ok');
  assert.equal(evidence.daytona.deployment.preview, 'public');
  assert.equal('apiKey' in evidence.daytona, false);
});

test('reports OpenRouter only as a fallback provider', async () => {
  const fallbackServer = createApp({
    providerStatus: async () => ({ status: 'connected', source: 'openrouter-fallback', model: 'openai/gpt-4o-mini', fallbackFor: 'nosana' })
  });
  await new Promise((resolve) => fallbackServer.listen(0, '127.0.0.1', resolve));
  try {
    const port = fallbackServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/nosana/status`);
    assert.deepEqual(await response.json(), {
      status: 'connected', source: 'openrouter-fallback', model: 'openai/gpt-4o-mini', fallbackFor: 'nosana'
    });
  } finally {
    fallbackServer.close();
  }
});
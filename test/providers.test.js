import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviderStatus } from '../providers/nosana.js';

test('uses OpenRouter only after Nosana is unavailable', async () => {
  const status = await getProviderStatus({
    nosanaStatus: async () => ({ status: 'unreachable' }),
    openRouterStatus: async () => ({ status: 'connected', source: 'openrouter-fallback', model: 'openai/gpt-4o-mini' })
  });
  assert.deepEqual(status, {
    status: 'connected', source: 'openrouter-fallback', model: 'openai/gpt-4o-mini', fallbackFor: 'nosana'
  });
});

test('does not call OpenRouter while Nosana is connected', async () => {
  const status = await getProviderStatus({
    nosanaStatus: async () => ({ status: 'connected', source: 'nosana-sdk' }),
    openRouterStatus: async () => { throw new Error('OpenRouter should not be called.'); }
  });
  assert.deepEqual(status, { status: 'connected', source: 'nosana-sdk' });
});
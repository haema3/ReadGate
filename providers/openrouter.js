const modelsUrl = 'https://openrouter.ai/api/v1/models?limit=1';

export async function getOpenRouterStatus(fetchImplementation = fetch) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { status: 'not-configured' };
  try {
    const response = await fetchImplementation(modelsUrl, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { status: 'unreachable' };
    const payload = await response.json();
    if (!Array.isArray(payload.data)) return { status: 'unreachable' };
    return {
      status: 'connected',
      source: 'openrouter-fallback',
      model: process.env.OPENROUTER_MODEL || null
    };
  } catch {
    return { status: 'unreachable' };
  }
}
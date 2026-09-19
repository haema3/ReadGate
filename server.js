import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getProviderStatus } from './providers/nosana.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const sessionLifetimeMs = 30 * 60 * 1000;
const sessions = new Map();

const questions = {
  schedule: {
    id: 'schedule',
    paragraphId: 'schedule',
    prompt: '참가 확인을 위해 가장 먼저 해야 하는 일은 무엇인가요?',
    options: ['팀을 확정한다', '참가자 안내를 끝까지 읽는다', '발표 영상을 만든다', '새 모델을 학습한다'],
    correctOption: 1,
    explanation: '안내의 첫 단계는 참가자 안내를 끝까지 읽고 확인하는 것입니다.'
  },
  demo: {
    id: 'demo',
    paragraphId: 'demo',
    prompt: '데모에서 반드시 보여줘야 하는 경험은 무엇인가요?',
    options: ['복잡한 관리자 화면', '긴 기술 문서', '읽지 않은 문단의 퀴즈와 다음 단계 잠금', '모든 브라우저 확장 기능'],
    correctOption: 2,
    explanation: '핵심은 놓친 문단을 퀴즈로 확인하고 정답 후에만 다음 단계로 가는 경험입니다.'
  },
  evidence: {
    id: 'evidence',
    paragraphId: 'evidence',
    prompt: '플랫폼 사용을 보여줄 때 올바른 방법은 무엇인가요?',
    options: ['로고만 넣는다', '실제 실행 결과와 생성 출처를 남긴다', '직접 만든 문항을 AI 생성이라고 표시한다', 'API 키를 화면에 표시한다'],
    correctOption: 1,
    explanation: '실제 실행 기록과 생성 출처를 남기고, 비밀 값은 절대 노출하지 않습니다.'
  }
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('Request is too large.'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
  });
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || Date.now() - session.createdAt > sessionLifetimeMs) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function publicQuestion(question) {
  const { correctOption, ...safeQuestion } = question;
  return safeQuestion;
}

async function handleApi(request, response, url, providerStatus) {
  if (request.method === 'GET' && url.pathname === '/api/nosana/status') {
    return sendJson(response, 200, await providerStatus());
  }

  if (request.method === 'POST' && url.pathname === '/api/session') {
    const body = await readJson(request);
    const paragraphIds = Array.isArray(body.paragraphIds) ? body.paragraphIds.filter((id) => questions[id]) : [];
    const id = randomUUID();
    sessions.set(id, { id, createdAt: Date.now(), paragraphIds, answered: new Set() });
    return sendJson(response, 201, { sessionId: id, questions: paragraphIds.map((id) => publicQuestion(questions[id])) });
  }

  if (request.method === 'POST' && url.pathname === '/api/answer') {
    const body = await readJson(request);
    const session = getSession(body.sessionId);
    const question = questions[body.questionId];
    if (!session || !question || !session.paragraphIds.includes(question.id) || !Number.isInteger(body.optionIndex)) {
      return sendJson(response, 400, { error: 'The answer does not match an active session.' });
    }
    const correct = question.correctOption === body.optionIndex;
    if (correct) session.answered.add(question.id);
    return sendJson(response, 200, { correct, explanation: question.explanation, complete: session.answered.size === session.paragraphIds.length });
  }

  if (request.method === 'POST' && url.pathname === '/api/complete') {
    const body = await readJson(request);
    const session = getSession(body.sessionId);
    if (!session || session.answered.size !== session.paragraphIds.length) {
      return sendJson(response, 403, { error: 'Complete every assigned check before continuing.' });
    }
    return sendJson(response, 200, { completed: true });
  }

  return sendJson(response, 404, { error: 'Not found.' });
}

function sendHealth(response) {
  sendJson(response, 200, { status: 'ok', service: 'readgate-demo' });
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(root, 'public', requested));
  const publicRoot = normalize(join(root, 'public'));
  if (!filePath.startsWith(publicRoot)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

export function createApp({ nosanaStatus, providerStatus = nosanaStatus || getProviderStatus } = {}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(request, response, url, providerStatus);
      else if (url.pathname === '/health') sendHealth(response);
      else await serveStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Bad request.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApp();
  server.listen(port, () => console.log(`ReadGate is running at http://localhost:${port}`));
  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());
}
const labels = { schedule: '참가 확인', demo: '데모 흐름', evidence: '플랫폼 증빙' };
const signalList = document.querySelector('#signal-list');
const signalNote = document.querySelector('#signal-note');
const completeBanner = document.querySelector('#complete-banner');
const continueButton = document.querySelector('#continue');

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}초`;
}

window.addEventListener('readgate:status', (event) => {
  signalList.replaceChildren(...event.detail.paragraphs.map((paragraph) => {
    const item = document.createElement('div');
    const isReady = paragraph.status === 'sufficient';
    item.className = `signal-item ${isReady ? 'is-ready' : ''}`;
    item.innerHTML = `<span class="signal-dot" aria-hidden="true"></span><div><strong></strong><small></small></div><b></b>`;
    item.querySelector('strong').textContent = labels[paragraph.id] || paragraph.id;
    item.querySelector('small').textContent = paragraph.seen ? '관찰 중' : '아직 화면에 없음';
    item.querySelector('b').textContent = isReady ? '충분' : formatSeconds(paragraph.elapsedMs);
    return item;
  }));
  signalNote.textContent = '유효 체류 시간은 숨김 탭과 포커스를 잃은 시간을 제외합니다.';
});

window.addEventListener('readgate:complete', () => {
  completeBanner.hidden = false;
  completeBanner.focus();
});

window.addEventListener('readgate:error', (event) => {
  signalNote.textContent = event.detail.message;
  continueButton.disabled = false;
});

document.querySelector('#restart').addEventListener('click', () => {
  window.ReadGate.reset();
  completeBanner.hidden = true;
  continueButton.textContent = '다음 단계 확인';
  document.querySelector('#article').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const embedCode = `<script defer src="${window.location.origin}/sdk.js" data-target="#article" data-next="#continue" data-content-id="hackathon-guide-v1"><\/script>`;
document.querySelector('#install-code').textContent = embedCode;
document.querySelector('#copy-code').addEventListener('click', async () => {
  const button = document.querySelector('#copy-code');
  try {
    await navigator.clipboard.writeText(embedCode);
    button.textContent = '복사됨';
  } catch {
    button.textContent = '직접 선택해 복사';
  }
  window.setTimeout(() => { button.textContent = '코드 복사'; }, 1500);
});

async function loadEvidence() {
  try {
    const response = await fetch('/evidence.json', { cache: 'no-store' });
    if (!response.ok) return;
    const evidence = await response.json();
    const daytona = evidence.daytona;
    if (daytona?.status === 'verified') {
      const proof = document.querySelector('[data-proof="daytona"]');
      const status = document.querySelector('[data-proof-status="daytona"]');
      const verifiedAt = new Date(daytona.verifiedAt).toLocaleString('ko-KR');
      const deployment = daytona.deployment;
      if (deployment?.status === 'running') {
        const startedAt = new Date(deployment.startedAt).toLocaleString('ko-KR');
        const previewLabel = deployment.preview === 'public' ? '공개 preview' : 'private preview';
        proof.textContent = `${daytona.summary}. ${verifiedAt} 검증본은 정리 완료. 현재 서버는 ${startedAt}부터 샌드박스 ${deployment.resourceId}에서 실행 중이며, ${deployment.ttlMinutes}분 TTL과 ${previewLabel}를 사용합니다.`;
        status.textContent = '실행 중';
        status.className = 'status-chip status-running';
      } else {
        proof.textContent = `${daytona.summary}. ${verifiedAt} 실행, 샌드박스 ${daytona.resourceId}, 정리 완료.`;
        status.textContent = '검증 완료';
        status.className = 'status-chip status-verified';
      }
    }
  } catch {}
}

loadEvidence();

async function loadNosanaStatus() {
  try {
    const response = await fetch('/api/nosana/status', { cache: 'no-store' });
    if (!response.ok) return;
    const nosana = await response.json();
    const proof = document.querySelector('[data-proof="nosana"]');
    const status = document.querySelector('[data-proof-status="nosana"]');
    if (nosana.status === 'connected') {
      if (nosana.source === 'openrouter-fallback') {
        proof.textContent = `Nosana 연결 실패로 OpenRouter fallback을 사용 중입니다${nosana.model ? ` (${nosana.model})` : ''}.`;
        status.textContent = '대체 연결';
        status.className = 'status-chip status-running';
        return;
      }
      proof.textContent = `Nosana SDK로 deployment ${nosana.deploymentStatus}, job ${nosana.job.state} 상태를 확인했습니다.`;
      status.textContent = '연결 확인';
      status.className = 'status-chip status-verified';
    } else if (nosana.status === 'unreachable') {
      proof.textContent = 'Nosana inference endpoint에 연결하지 못했습니다. endpoint 네트워크 접근 정책을 확인해야 합니다.';
      status.textContent = '연결 오류';
      status.className = 'status-chip status-pending';
    }
  } catch {}
}

loadNosanaStatus();
(() => {
  const script = document.currentScript;
  const config = {
    target: script?.dataset.target,
    next: script?.dataset.next,
    contentId: script?.dataset.contentId || 'readgate-content'
  };
  const article = document.querySelector(config.target);
  const nextButton = document.querySelector(config.next);
  if (!article || !nextButton) return;

  const paragraphs = [...article.querySelectorAll('[data-readgate-id]')];
  const state = new Map(paragraphs.map((paragraph) => [paragraph.dataset.readgateId, {
    paragraph,
    visible: false,
    seen: false,
    activeSince: null,
    elapsedMs: 0
  }]));
  let sessionId = null;
  let activeQuestionIndex = 0;
  let questions = [];
  let observer;
  let statusTimer;

  const style = document.createElement('style');
  style.textContent = `
    .rg-modal { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 24px; background: rgba(21, 29, 27, .48); }
    .rg-dialog { width: min(100%, 520px); padding: 28px; border: 1px solid #cfd7d0; border-radius: 8px; background: #fbfbf6; box-shadow: 0 24px 80px rgba(16, 26, 23, .26); color: #17211e; }
    .rg-kicker { margin: 0 0 8px; color: #537866; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .rg-dialog h2 { margin: 0 0 20px; font-size: 24px; line-height: 1.28; }
    .rg-options { display: grid; gap: 10px; margin: 20px 0; }
    .rg-option { display: flex; gap: 10px; align-items: flex-start; padding: 13px; border: 1px solid #cfd7d0; border-radius: 6px; background: #fff; cursor: pointer; }
    .rg-option:has(input:focus-visible) { outline: 3px solid #f2b94b; outline-offset: 2px; }
    .rg-option input { margin-top: 3px; accent-color: #23744c; }
    .rg-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .rg-submit, .rg-return { min-height: 42px; border: 0; border-radius: 5px; padding: 0 16px; font: inherit; font-weight: 800; cursor: pointer; }
    .rg-submit { background: #23744c; color: #fff; }
    .rg-return { background: transparent; color: #274a38; text-decoration: underline; }
    .rg-feedback { min-height: 24px; margin: 10px 0 0; font-weight: 700; }
    .rg-feedback[data-kind="error"] { color: #b53620; }
    .rg-feedback[data-kind="success"] { color: #17613c; }
  `;
  document.head.append(style);

  function activeNow() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function pause(stateItem) {
    if (stateItem.activeSince !== null) {
      stateItem.elapsedMs += performance.now() - stateItem.activeSince;
      stateItem.activeSince = null;
    }
  }

  function resume(stateItem) {
    if (stateItem.visible && activeNow() && stateItem.activeSince === null) {
      stateItem.activeSince = performance.now();
    }
  }

  function elapsed(stateItem) {
    return Math.round(stateItem.elapsedMs + (stateItem.activeSince === null ? 0 : performance.now() - stateItem.activeSince));
  }

  function publishStatus() {
    const details = [...state.entries()].map(([id, item]) => ({
      id,
      elapsedMs: elapsed(item),
      seen: item.seen,
      status: item.seen && elapsed(item) >= Number(item.paragraph.dataset.readgateMinMs || 2500) ? 'sufficient' : 'checking'
    }));
    window.dispatchEvent(new CustomEvent('readgate:status', { detail: { contentId: config.contentId, paragraphs: details } }));
  }

  function issueIds() {
    return [...state.entries()]
      .filter(([, item]) => !item.seen || elapsed(item) < Number(item.paragraph.dataset.readgateMinMs || 2500))
      .map(([id]) => id);
  }

  async function request(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
    return data;
  }

  function closeModal() {
    document.querySelector('.rg-modal')?.remove();
  }

  function returnToParagraph(question) {
    closeModal();
    state.get(question.paragraphId)?.paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nextButton.focus({ preventScroll: true });
  }

  function showQuestion() {
    const question = questions[activeQuestionIndex];
    if (!question) return complete();
    closeModal();
    const modal = document.createElement('div');
    modal.className = 'rg-modal';
    modal.innerHTML = `
      <section class="rg-dialog" role="dialog" aria-modal="true" aria-labelledby="rg-title">
        <p class="rg-kicker">확인 ${activeQuestionIndex + 1} / ${questions.length}</p>
        <h2 id="rg-title"></h2>
        <form class="rg-form">
          <div class="rg-options"></div>
          <div class="rg-actions">
            <button class="rg-submit" type="submit">정답 확인</button>
            <button class="rg-return" type="button">문단 다시 보기</button>
          </div>
          <p class="rg-feedback" aria-live="polite"></p>
        </form>
      </section>
    `;
    modal.querySelector('#rg-title').textContent = question.prompt;
    const options = modal.querySelector('.rg-options');
    question.options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'rg-option';
      label.innerHTML = `<input type="radio" name="answer" value="${index}"><span></span>`;
      label.querySelector('span').textContent = option;
      options.append(label);
    });
    const feedback = modal.querySelector('.rg-feedback');
    modal.querySelector('.rg-return').addEventListener('click', () => returnToParagraph(question));
    modal.querySelector('.rg-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const selected = modal.querySelector('input[name="answer"]:checked');
      if (!selected) {
        feedback.dataset.kind = 'error';
        feedback.textContent = '선택지를 고른 뒤 확인해 주세요.';
        return;
      }
      const submit = modal.querySelector('.rg-submit');
      submit.disabled = true;
      try {
        const result = await request('/api/answer', { sessionId, questionId: question.id, optionIndex: Number(selected.value) });
        feedback.dataset.kind = result.correct ? 'success' : 'error';
        feedback.textContent = result.correct ? '정답입니다. 다음 확인으로 넘어갑니다.' : result.explanation;
        if (result.correct) window.setTimeout(() => {
          activeQuestionIndex += 1;
          showQuestion();
        }, 700);
        else submit.disabled = false;
      } catch (error) {
        feedback.dataset.kind = 'error';
        feedback.textContent = error.message;
        submit.disabled = false;
      }
    });
    document.body.append(modal);
    modal.querySelector('input')?.focus();
  }

  async function complete() {
    try {
      await request('/api/complete', { sessionId });
      closeModal();
      nextButton.disabled = false;
      nextButton.dataset.readgateComplete = 'true';
      nextButton.textContent = '다음 단계가 열렸습니다';
      window.dispatchEvent(new CustomEvent('readgate:complete', { detail: { contentId: config.contentId, sessionId } }));
      nextButton.focus();
    } catch (error) {
      nextButton.disabled = false;
      window.dispatchEvent(new CustomEvent('readgate:error', { detail: { message: error.message } }));
    }
  }

  async function beginGate(event) {
    if (nextButton.dataset.readgateComplete === 'true') return;
    event.preventDefault();
    nextButton.disabled = true;
    const originalText = nextButton.textContent;
    nextButton.textContent = '확인 준비 중...';
    try {
      const result = await request('/api/session', { paragraphIds: issueIds() });
      sessionId = result.sessionId;
      questions = result.questions;
      activeQuestionIndex = 0;
      if (questions.length) showQuestion();
      else await complete();
    } catch (error) {
      nextButton.disabled = false;
      nextButton.textContent = originalText;
      window.dispatchEvent(new CustomEvent('readgate:error', { detail: { message: error.message } }));
    }
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const item = state.get(entry.target.dataset.readgateId);
      item.visible = entry.isIntersecting && entry.intersectionRatio >= 0.45;
      if (item.visible) item.seen = true;
      if (item.visible) resume(item);
      else pause(item);
    });
    publishStatus();
  }, { threshold: [0, 0.45, 1] });
  paragraphs.forEach((paragraph) => observer.observe(paragraph));
  document.addEventListener('visibilitychange', () => {
    state.forEach((item) => activeNow() ? resume(item) : pause(item));
    publishStatus();
  });
  window.addEventListener('focus', () => state.forEach(resume));
  window.addEventListener('blur', () => state.forEach(pause));
  nextButton.addEventListener('click', beginGate);
  statusTimer = window.setInterval(publishStatus, 250);
  publishStatus();

  window.ReadGate = {
    reset() {
      closeModal();
      sessionId = null;
      questions = [];
      activeQuestionIndex = 0;
      nextButton.disabled = false;
      nextButton.dataset.readgateComplete = 'false';
      state.forEach((item) => {
        item.seen = false;
        item.elapsedMs = 0;
        item.activeSince = item.visible && activeNow() ? performance.now() : null;
      });
      publishStatus();
    },
    destroy() {
      observer.disconnect();
      window.clearInterval(statusTimer);
      closeModal();
    }
  };
})();
import { captureFrameAsBlobJpeg } from './user-screenshot.js';
import { API_PREFIX } from './http.js';

export function initGemini() {
  const btn = document.getElementById('screenshotBtn');
  const resultEl = document.getElementById('geminiResult');
  const frameEl = document.getElementById('frame');
  let busy = false;
  let hideTimer = null;
  let onAfterSolve = null;

  const showResult = (text) => {
    resultEl.textContent = text;
    resultEl.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { resultEl.hidden = true; }, 12000);
  };

  const triggerGemini = async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    showResult('...');
    try {
      const blob = await captureFrameAsBlobJpeg(frameEl);
      const res = await fetch(`${API_PREFIX}/gemini/solve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      showResult(data?.answer || '—');
      window.dispatchEvent(new CustomEvent('uix:frog', { detail: { reaction: 'geminiAnswer' } }));
      onAfterSolve?.();
    } catch (e) {
      console.error('[screenshot]', e);
      showResult('e');
      window.dispatchEvent(new CustomEvent('uix:frog', { detail: { reaction: 'geminiError' } }));
    } finally {
      busy = false;
      btn.disabled = false;
    }
  };

  const toggleResult = () => {
    if (!resultEl.textContent.trim()) return;
    if (resultEl.hidden) {
      resultEl.hidden = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { resultEl.hidden = true; }, 12000);
    } else {
      clearTimeout(hideTimer);
      resultEl.hidden = true;
    }
  };

  return {
    triggerGemini,
    toggleResult,
    showResult,
    setAfterSolve(cb) { onAfterSolve = cb; },
    button: btn,
  };
}

import { api } from './http.js';

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

  const getFrameWindow = () => {
    let win;
    try { win = frameEl.contentWindow; } catch { win = null; }
    let doc;
    try { doc = win?.document ?? null; } catch { doc = null; }
    if (!win || !doc) {
      throw new Error('iframe недоступний (cross-origin)');
    }
    return { win, doc };
  };

  const ensureHtml2Canvas = async (win) => {
    if (typeof win.html2canvas === 'function') return win.html2canvas;
    if (typeof window.html2canvas === 'function') {
      win.html2canvas = window.html2canvas;
      return win.html2canvas;
    }
    await new Promise((resolve, reject) => {
      const s = win.document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('html2canvas не завантажився'));
      win.document.head.appendChild(s);
    });
    if (typeof win.html2canvas !== 'function') {
      throw new Error('html2canvas не зареєструвався');
    }
    return win.html2canvas;
  };

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  const captureFrame = async () => {
    const { win, doc } = getFrameWindow();
    const h2c = await ensureHtml2Canvas(win);
    await nextFrame();
    await nextFrame();
    const root = doc.body || doc.documentElement;
    const viewportH = Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 1);
    const fullW = Math.max(
      1,
      doc.documentElement.scrollWidth || win.innerWidth || doc.documentElement.clientWidth || 1
    );
    return h2c(root, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      x: 0,
      y: win.scrollY || 0,
      width: fullW,
      height: viewportH,
      windowWidth: fullW,
      windowHeight: viewportH,
      logging: false,
      backgroundColor: '#ffffff',
    });
  };

  const canvasToBase64Jpeg = (canvas) =>
    new Promise((resolve, reject) => {
      const maxW = 1600;
      let target = canvas;
      if (canvas.width > maxW) {
        const scale = maxW / canvas.width;
        target = document.createElement('canvas');
        target.width = maxW;
        target.height = Math.round(canvas.height * scale);
        target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);
      }
      target.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('blob failed'));
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        0.7
      );
    });

  const triggerGemini = async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    showResult('...');
    try {
      const canvas = await captureFrame();
      const imageBase64 = await canvasToBase64Jpeg(canvas);
      const { answer } = await api('/gemini/solve', {
        method: 'POST',
        body: JSON.stringify({ imageBase64 }),
      });
      showResult(answer || '—');
      onAfterSolve?.();
    } catch (e) {
      console.error('[screenshot]', e);
      showResult('e');
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

  btn.addEventListener('click', triggerGemini);

  return {
    triggerGemini,
    toggleResult,
    showResult,
    setAfterSolve(cb) { onAfterSolve = cb; },
  };
}

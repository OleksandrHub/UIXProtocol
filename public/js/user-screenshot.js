// Capture the visible viewport of the proxied iframe as a JPEG base64 string.
// Shared between Gemini and friend-help flows so both produce identical images.

const getFrameWindow = (frameEl) => {
  let win;
  try { win = frameEl.contentWindow; } catch { win = null; }
  let doc;
  try { doc = win?.document ?? null; } catch { doc = null; }
  if (!win || !doc) throw new Error('iframe недоступний (cross-origin)');
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
  if (typeof win.html2canvas !== 'function') throw new Error('html2canvas не зареєструвався');
  return win.html2canvas;
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function captureCanvas(frameEl) {
  const { win, doc } = getFrameWindow(frameEl);
  const h2c = await ensureHtml2Canvas(win);
  await nextFrame();
  await nextFrame();
  const root = doc.body || doc.documentElement;
  const viewportH = Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 1);
  const fullW = Math.max(
    1,
    doc.documentElement.scrollWidth || win.innerWidth || doc.documentElement.clientWidth || 1,
  );
  const renderScale = Math.min(1.5, Math.max(1, win.devicePixelRatio || 1));
  return h2c(root, {
    useCORS: true,
    allowTaint: true,
    scale: renderScale,
    x: 0,
    y: win.scrollY || 0,
    width: fullW,
    height: viewportH,
    windowWidth: fullW,
    windowHeight: viewportH,
    logging: false,
    backgroundColor: '#ffffff',
  });
}

function canvasToBlobJpeg(canvas) {
  return new Promise((resolve, reject) => {
    const maxW = 2200;
    let target = canvas;
    if (canvas.width > maxW) {
      const ratio = maxW / canvas.width;
      target = document.createElement('canvas');
      target.width = maxW;
      target.height = Math.round(canvas.height * ratio);
      const ctx = target.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, target.width, target.height);
    }
    target.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('blob failed'));
        resolve(blob);
      },
      'image/jpeg',
      0.92,
    );
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function captureFrameAsBlobJpeg(frameEl) {
  const canvas = await captureCanvas(frameEl);
  return canvasToBlobJpeg(canvas);
}

export async function captureFrameAsBase64Jpeg(frameEl) {
  const blob = await captureFrameAsBlobJpeg(frameEl);
  return blobToBase64(blob);
}

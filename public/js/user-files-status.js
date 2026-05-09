import { api } from './http.js';
import { APPEARANCE_KEY, loadAppearance } from './user-appearance.js';

export function initFilesStatus() {
  const wrap = document.getElementById('filesStatus');
  const btn = document.getElementById('filesStatusBtn');
  const iconEl = document.getElementById('filesStatusIcon');
  const textEl = document.getElementById('filesStatusText');
  const closeBtn = document.getElementById('filesStatusClose');
  let lastStatus = null;

  const isVisibleByPrefs = () => loadAppearance().showFilesStatus !== false;

  const setState = (cls) => {
    wrap.classList.remove('is-ready', 'is-pending', 'is-error', 'is-loading');
    if (cls) wrap.classList.add(cls);
  };

  const render = (status) => {
    lastStatus = status;
    if (!status.hasFiles || !isVisibleByPrefs()) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const fileCount = status.files.length;
    const totalSlots = status.totalKeys * fileCount;
    const cachedSlots = status.files.reduce((acc, f) => acc + f.cachedKeys, 0);
    if (status.totalKeys === 0) {
      iconEl.textContent = '📎';
      textEl.textContent = `${fileCount} ф · нема ключів`;
      setState('is-error');
      return;
    }
    if (cachedSlots === totalSlots) {
      iconEl.textContent = '✓';
      textEl.textContent = `${fileCount} ф · готово`;
      setState('is-ready');
    } else if (cachedSlots === 0) {
      iconEl.textContent = '📎';
      textEl.textContent = `${fileCount} ф · не прогріто`;
      setState('is-pending');
    } else {
      iconEl.textContent = '⏳';
      textEl.textContent = `${cachedSlots}/${totalSlots} кешів`;
      setState('is-pending');
    }
  };

  const refresh = async () => {
    try {
      const status = await api('/me/files/status');
      render(status);
    } catch {}
  };

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    iconEl.textContent = '⟳';
    textEl.textContent = 'прогріваю…';
    setState('is-loading');
    try {
      const result = await api('/me/files/preload', { method: 'POST' });
      await refresh();
      if (result.errors?.length) {
        textEl.textContent = `помилок: ${result.errors.length}`;
        setState('is-error');
      }
    } catch (e) {
      textEl.textContent = `помилка: ${e.message?.slice(0, 30) ?? ''}`;
      setState('is-error');
    } finally {
      btn.disabled = false;
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = { ...loadAppearance(), showFilesStatus: false };
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
    wrap.hidden = true;
  });

  return {
    refresh,
    applyPrefs: () => { if (lastStatus) render(lastStatus); else refresh(); },
  };
}

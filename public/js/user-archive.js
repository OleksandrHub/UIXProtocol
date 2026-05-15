import { api } from './http.js';

const imgUrl = (id) => `/api/me/questions/${id}/image`;

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchImageDataUrl(id) {
  try {
    const res = await fetch(imgUrl(id), { credentials: 'same-origin' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function initArchive() {
  const modal = document.getElementById('archive');
  const openBtn = document.getElementById('archiveBtn');
  const closeBtn = document.getElementById('archiveClose');
  const listEl = document.getElementById('archiveList');
  const emptyEl = document.getElementById('archiveEmpty');
  const errEl = document.getElementById('archiveError');
  const tpl = document.getElementById('archiveItemTpl');
  const selectAll = document.getElementById('archiveSelectAll');
  const shareUser = document.getElementById('archiveShareUser');
  const shareBtn = document.getElementById('archiveShareBtn');
  const exportTxtBtn = document.getElementById('archiveExportTxt');
  const exportPdfBtn = document.getElementById('archiveExportPdf');

  if (!openBtn || !modal) return;

  let items = [];

  const optionsToText = (opts) => (Array.isArray(opts) ? opts.join('\n') : '');
  const textToOptions = (txt) =>
    txt
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  const selectedIds = () =>
    [...listEl.querySelectorAll('.archive-pick')]
      .filter((cb) => cb.checked)
      .map((cb) => Number(cb.dataset.id));

  const render = () => {
    listEl.innerHTML = '';
    emptyEl.hidden = items.length > 0;
    items.forEach((q) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const pick = node.querySelector('.archive-pick');
      const thumb = node.querySelector('.archive-thumb');
      const img = node.querySelector('.archive-img');
      const date = node.querySelector('.archive-date');
      const del = node.querySelector('.archive-delete');
      const question = node.querySelector('.archive-question');
      const optionsEl = node.querySelector('.archive-options');
      const correct = node.querySelector('.archive-correct');
      const saveBtn = node.querySelector('.archive-save');
      const savedMsg = node.querySelector('.archive-saved');

      pick.dataset.id = q.id;
      img.src = imgUrl(q.id);
      thumb.href = imgUrl(q.id);
      date.textContent = fmtDate(q.createdAt);
      question.value = q.question || '';
      optionsEl.value = optionsToText(q.options);
      correct.value = q.correctAnswer || '';

      const markDirty = () => {
        savedMsg.hidden = true;
      };
      question.addEventListener('input', markDirty);
      optionsEl.addEventListener('input', markDirty);
      correct.addEventListener('input', markDirty);

      saveBtn.addEventListener('click', async () => {
        errEl.textContent = '';
        saveBtn.disabled = true;
        try {
          const updated = await api(`/me/questions/${q.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              question: question.value,
              options: textToOptions(optionsEl.value),
              correctAnswer: correct.value,
            }),
          });
          Object.assign(q, updated);
          savedMsg.hidden = false;
        } catch (e) {
          errEl.textContent = e.message;
        } finally {
          saveBtn.disabled = false;
        }
      });

      del.addEventListener('click', async () => {
        errEl.textContent = '';
        try {
          await api(`/me/questions/${q.id}`, { method: 'DELETE' });
          items = items.filter((x) => x.id !== q.id);
          render();
        } catch (e) {
          errEl.textContent = e.message;
        }
      });

      listEl.appendChild(node);
    });
    selectAll.checked = false;
  };

  const load = async () => {
    errEl.textContent = '';
    try {
      items = await api('/me/questions');
    } catch (e) {
      items = [];
      errEl.textContent = e.message;
    }
    render();
  };

  openBtn.addEventListener('click', async () => {
    modal.hidden = false;
    await load();
  });

  closeBtn.addEventListener('click', () => {
    modal.hidden = true;
  });

  selectAll.addEventListener('change', () => {
    listEl.querySelectorAll('.archive-pick').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
  });

  const pickedItems = () => {
    const ids = new Set(selectedIds());
    return items.filter((q) => ids.has(q.id));
  };

  exportTxtBtn.addEventListener('click', () => {
    const picked = pickedItems();
    if (!picked.length) {
      errEl.textContent = 'Нічого не обрано.';
      return;
    }
    errEl.textContent = '';
    const blocks = picked.map((q, i) => {
      const opts = (q.options || []).map((o, j) => `  ${j + 1}. ${o}`).join('\n');
      return [
        `№${i + 1}`,
        `Питання: ${q.question || '—'}`,
        opts ? `Варіанти:\n${opts}` : 'Варіанти: —',
        `Правильна відповідь: ${q.correctAnswer || '—'}`,
      ].join('\n');
    });
    const text = blocks.join('\n\n' + '-'.repeat(40) + '\n\n');
    download('questions.txt', new Blob([text], { type: 'text/plain;charset=utf-8' }));
  });

  exportPdfBtn.addEventListener('click', async () => {
    const picked = pickedItems();
    if (!picked.length) {
      errEl.textContent = 'Нічого не обрано.';
      return;
    }
    const jsPDFCtor = window.jspdf?.jsPDF;
    if (!jsPDFCtor) {
      errEl.textContent = 'PDF-бібліотека не завантажилась.';
      return;
    }
    errEl.textContent = '';
    exportPdfBtn.disabled = true;
    try {
      const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 40;
      const maxW = pageW - margin * 2;
      let y = margin;

      const ensure = (h) => {
        if (y + h > pageH - margin) {
          doc.addPage();
          y = margin;
        }
      };
      const writeLines = (label, value, size = 11) => {
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(`${label}${value}`, maxW);
        lines.forEach((ln) => {
          ensure(size + 4);
          doc.text(ln, margin, y);
          y += size + 4;
        });
      };

      for (let i = 0; i < picked.length; i++) {
        const q = picked[i];
        ensure(20);
        doc.setFontSize(13);
        doc.text(`№${i + 1}`, margin, y);
        y += 18;

        const dataUrl = await fetchImageDataUrl(q.id);
        if (dataUrl) {
          try {
            const props = doc.getImageProperties(dataUrl);
            const imgW = Math.min(maxW, props.width);
            const imgH = (props.height * imgW) / props.width;
            const drawH = Math.min(imgH, pageH - margin * 2);
            const drawW = (props.width * drawH) / props.height > maxW
              ? maxW
              : (props.width * drawH) / props.height;
            ensure(drawH + 8);
            doc.addImage(dataUrl, 'JPEG', margin, y, drawW, drawH);
            y += drawH + 10;
          } catch {}
        }

        writeLines('Питання: ', q.question || '—');
        const opts = (q.options || []).map((o, j) => `${j + 1}. ${o}`);
        writeLines('Варіанти: ', opts.length ? '' : '—');
        opts.forEach((o) => writeLines('  ', o));
        writeLines('Правильна відповідь: ', q.correctAnswer || '—');
        y += 14;
      }

      doc.save('questions.pdf');
    } catch (e) {
      errEl.textContent = e.message || 'Помилка генерації PDF.';
    } finally {
      exportPdfBtn.disabled = false;
    }
  });

  shareBtn.addEventListener('click', async () => {
    const ids = selectedIds();
    const toUser = shareUser.value.trim();
    if (!toUser) {
      errEl.textContent = 'Вкажіть імʼя користувача.';
      return;
    }
    if (!ids.length) {
      errEl.textContent = 'Нічого не обрано.';
      return;
    }
    errEl.textContent = '';
    shareBtn.disabled = true;
    try {
      const { shared } = await api('/me/questions/share', {
        method: 'POST',
        body: JSON.stringify({ toUser, ids }),
      });
      errEl.textContent = `Поширено: ${shared}`;
      shareUser.value = '';
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      shareBtn.disabled = false;
    }
  });
}

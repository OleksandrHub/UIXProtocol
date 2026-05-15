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
  const selCount = document.getElementById('archiveSelCount');
  const pageSizeSel = document.getElementById('archivePageSize');
  const tagFilter = document.getElementById('archiveTagFilter');
  const pager = document.getElementById('archivePager');
  const pagerInfo = document.getElementById('archivePagerInfo');
  const prevBtn = document.getElementById('archivePrev');
  const nextBtn = document.getElementById('archiveNext');
  const shareUser = document.getElementById('archiveShareUser');
  const shareBtn = document.getElementById('archiveShareBtn');
  const usersDatalist = document.getElementById('archiveUsersDatalist');
  const userSearch = document.getElementById('archiveUserSearch');
  const usersListEl = document.getElementById('archiveUsersList');
  const exportTxtBtn = document.getElementById('archiveExportTxt');
  const exportPdfBtn = document.getElementById('archiveExportPdf');
  const addBtn = document.getElementById('archiveAddBtn');

  if (!openBtn || !modal) return;

  let items = [];
  let users = [];
  const selected = new Set();
  let page = 0;
  let pageSize = Number(pageSizeSel.value) || 10;
  let currentTag = '';

  const optionsToText = (opts) => (Array.isArray(opts) ? opts.join('\n') : '');
  const textToOptions = (txt) =>
    txt
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const textToTags = (txt) =>
    txt
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const view = () =>
    currentTag
      ? items.filter((q) => Array.isArray(q.tags) && q.tags.includes(currentTag))
      : items;

  const pageCount = () => Math.max(1, Math.ceil(view().length / pageSize));

  const refreshTagFilter = () => {
    const tags = [...new Set(items.flatMap((q) => q.tags || []))].sort((a, b) =>
      a.localeCompare(b, 'uk'),
    );
    if (currentTag && !tags.includes(currentTag)) currentTag = '';
    tagFilter.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'усі';
    tagFilter.appendChild(all);
    tags.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      tagFilter.appendChild(opt);
    });
    tagFilter.value = currentTag;
  };

  const updateSelCount = () => {
    selCount.textContent = `обрано: ${selected.size}`;
    const pageIds = view()
      .slice(page * pageSize, page * pageSize + pageSize)
      .map((q) => q.id);
    selectAll.checked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  };

  const renderPager = () => {
    const total = pageCount();
    pager.hidden = view().length <= pageSize;
    pagerInfo.textContent = `${page + 1} / ${total}`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= total - 1;
  };

  const render = () => {
    if (page > pageCount() - 1) page = pageCount() - 1;
    if (page < 0) page = 0;
    listEl.innerHTML = '';
    const vis = view();
    emptyEl.hidden = vis.length > 0;
    emptyEl.textContent =
      items.length && !vis.length ? 'За цим тегом нічого немає.' : 'Архів порожній.';
    const slice = vis.slice(page * pageSize, page * pageSize + pageSize);
    slice.forEach((q) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const pick = node.querySelector('.archive-pick');
      const thumb = node.querySelector('.archive-thumb');
      const img = node.querySelector('.archive-img');
      const date = node.querySelector('.archive-date');
      const del = node.querySelector('.archive-delete');
      const question = node.querySelector('.archive-question');
      const optionsEl = node.querySelector('.archive-options');
      const correct = node.querySelector('.archive-correct');
      const tagsEl = node.querySelector('.archive-tags');
      const saveBtn = node.querySelector('.archive-save');
      const savedMsg = node.querySelector('.archive-saved');

      pick.dataset.id = q.id;
      pick.checked = selected.has(q.id);
      pick.addEventListener('change', () => {
        if (pick.checked) selected.add(q.id);
        else selected.delete(q.id);
        updateSelCount();
      });

      img.src = imgUrl(q.id);
      thumb.href = imgUrl(q.id);
      img.addEventListener('error', () => {
        thumb.removeAttribute('href');
        thumb.classList.add('archive-thumb--empty');
        thumb.textContent = 'без зображення';
      });
      date.textContent = fmtDate(q.createdAt);
      question.value = q.question || '';
      optionsEl.value = optionsToText(q.options);
      correct.value = q.correctAnswer || '';
      tagsEl.value = Array.isArray(q.tags) ? q.tags.join(', ') : '';

      const markDirty = () => {
        savedMsg.hidden = true;
      };
      question.addEventListener('input', markDirty);
      optionsEl.addEventListener('input', markDirty);
      correct.addEventListener('input', markDirty);
      tagsEl.addEventListener('input', markDirty);

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
              tags: textToTags(tagsEl.value),
            }),
          });
          Object.assign(q, updated);
          savedMsg.hidden = false;
          refreshTagFilter();
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
          selected.delete(q.id);
          refreshTagFilter();
          render();
        } catch (e) {
          errEl.textContent = e.message;
        }
      });

      listEl.appendChild(node);
    });
    renderPager();
    updateSelCount();
  };

  const renderUsers = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const matched = f
      ? users.filter((u) => u.name.toLowerCase().includes(f))
      : users;
    usersListEl.innerHTML = '';
    if (!matched.length) {
      const empty = document.createElement('div');
      empty.className = 'archive-users__empty';
      empty.textContent = users.length ? 'Нічого не знайдено' : 'Немає користувачів';
      usersListEl.appendChild(empty);
      return;
    }
    matched.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'archive-users__item';
      btn.textContent = u.name;
      if (shareUser.value.trim() === u.name) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        shareUser.value = u.name;
        usersListEl
          .querySelectorAll('.archive-users__item')
          .forEach((el) => el.classList.toggle('is-active', el === btn));
      });
      usersListEl.appendChild(btn);
    });
  };

  const loadUsers = async () => {
    try {
      users = await api('/me/share-targets');
    } catch {
      users = [];
    }
    usersDatalist.innerHTML = '';
    users.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.name;
      usersDatalist.appendChild(opt);
    });
    renderUsers(userSearch.value);
  };

  const load = async () => {
    errEl.textContent = '';
    try {
      items = await api('/me/questions');
    } catch (e) {
      items = [];
      errEl.textContent = e.message;
    }
    selected.clear();
    page = 0;
    refreshTagFilter();
    render();
  };

  openBtn.addEventListener('click', async () => {
    modal.hidden = false;
    await Promise.all([load(), loadUsers()]);
  });

  closeBtn.addEventListener('click', () => {
    modal.hidden = true;
  });

  pageSizeSel.addEventListener('change', () => {
    pageSize = Number(pageSizeSel.value) || 10;
    page = 0;
    render();
  });

  tagFilter.addEventListener('change', () => {
    currentTag = tagFilter.value;
    page = 0;
    render();
  });

  addBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    addBtn.disabled = true;
    try {
      const created = await api('/me/questions', {
        method: 'POST',
        body: JSON.stringify({ question: '', options: [], correctAnswer: '', tags: [] }),
      });
      items.unshift(created);
      currentTag = '';
      tagFilter.value = '';
      page = 0;
      refreshTagFilter();
      render();
      const first = listEl.querySelector('.archive-item .archive-question');
      if (first) first.focus();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      addBtn.disabled = false;
    }
  });

  prevBtn.addEventListener('click', () => {
    if (page > 0) {
      page--;
      render();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (page < pageCount() - 1) {
      page++;
      render();
    }
  });

  selectAll.addEventListener('change', () => {
    const pageIds = view()
      .slice(page * pageSize, page * pageSize + pageSize)
      .map((q) => q.id);
    pageIds.forEach((id) => {
      if (selectAll.checked) selected.add(id);
      else selected.delete(id);
    });
    listEl.querySelectorAll('.archive-pick').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateSelCount();
  });

  userSearch.addEventListener('input', () => renderUsers(userSearch.value));

  const pickedItems = () => items.filter((q) => selected.has(q.id));

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
            const drawW = Math.min(maxW, props.width);
            let drawH = (props.height * drawW) / props.width;
            const cap = pageH - margin * 2;
            let finalW = drawW;
            if (drawH > cap) {
              drawH = cap;
              finalW = (props.width * drawH) / props.height;
            }
            ensure(drawH + 8);
            doc.addImage(dataUrl, 'JPEG', margin, y, finalW, drawH);
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
    const ids = [...selected];
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
      renderUsers(userSearch.value);
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      shareBtn.disabled = false;
    }
  });
}

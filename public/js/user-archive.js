import { api, API_PREFIX } from './http.js';

const imgUrl = (id) => `${API_PREFIX}/me/questions/${id}/image`;

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

export function initArchive({ me } = {}) {
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
  const usersAside = document.getElementById('archiveUsersAside');
  const exportTxtBtn = document.getElementById('archiveExportTxt');
  const exportPdfBtn = document.getElementById('archiveExportPdf');
  const addBtn = document.getElementById('archiveAddBtn');
  const searchEl = document.getElementById('archiveSearch');
  const deleteSelBtn = document.getElementById('archiveDeleteSel');

  const tabsEl = document.getElementById('archiveTabs');
  const errorsTabBtn = document.getElementById('archiveErrorsTab');
  const errorsListEl = document.getElementById('errorsList');
  const errorsEmptyEl = document.getElementById('errorsEmpty');
  const errorsCountEl = document.getElementById('errorsCount');
  const errorsRefreshBtn = document.getElementById('errorsRefreshBtn');
  const errorsClearBtn = document.getElementById('errorsClearBtn');
  const errorTpl = document.getElementById('archiveErrorTpl');
  const panels = modal ? modal.querySelectorAll('[data-arcpanel]') : [];

  if (!openBtn || !modal) return;

  let items = [];
  let users = [];
  const selected = new Set();
  let page = 0;
  let pageSize = Number(pageSizeSel.value) || 10;
  let currentTag = '';
  let currentSearch = '';

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

  const matchesSearch = (q) => {
    if (!currentSearch) return true;
    const hay = [
      q.question || '',
      Array.isArray(q.options) ? q.options.join(' ') : '',
      q.correctAnswer || '',
      Array.isArray(q.tags) ? q.tags.join(' ') : '',
    ]
      .join(' ')
      .toLowerCase();
    return currentSearch.split(/\s+/).every((term) => hay.includes(term));
  };

  const view = () =>
    items.filter(
      (q) =>
        (!currentTag || (Array.isArray(q.tags) && q.tags.includes(currentTag))) &&
        matchesSearch(q),
    );

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
      items.length && !vis.length ? 'Нічого не знайдено.' : 'Архів порожній.';
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
    currentSearch = '';
    if (searchEl) searchEl.value = '';
    refreshTagFilter();
    render();
  };

  const isAdmin = !!(me && me.isAdmin);
  let currentTab = 'questions';

  const renderError = (err) => {
    const node = errorTpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.errors-item__date').textContent = fmtDate(err.createdAt);
    node.querySelector('.errors-item__user').textContent = err.userName ?? `#${err.userId}`;
    node.querySelector('.errors-item__model').textContent = err.model || '—';
    node.querySelector('.errors-item__key').textContent = err.apiKeyHint
      ? `${err.apiKeyHint}…`
      : '';
    node.querySelector('.errors-item__msg').textContent = err.message || '';
    node.querySelector('.errors-item__del').addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        await api(`/admin/gemini-errors/${err.id}`, { method: 'DELETE' });
        node.remove();
        const remaining = errorsListEl.children.length;
        errorsCountEl.textContent = `${remaining} ${remaining === 1 ? 'запис' : 'записів'}`;
        errorsEmptyEl.hidden = remaining > 0;
      } catch (e) {
        errEl.textContent = e.message;
      }
    });
    return node;
  };

  const loadErrors = async () => {
    if (!isAdmin) return;
    errEl.textContent = '';
    errorsListEl.innerHTML = '';
    errorsEmptyEl.hidden = true;
    try {
      const errors = await api('/admin/gemini-errors');
      errorsCountEl.textContent = `${errors.length} ${
        errors.length === 1 ? 'запис' : 'записів'
      }`;
      if (!errors.length) {
        errorsEmptyEl.hidden = false;
        return;
      }
      errors.forEach((er) => errorsListEl.appendChild(renderError(er)));
    } catch (e) {
      errEl.textContent = e.message;
    }
  };

  const switchTab = (name) => {
    currentTab = name;
    panels.forEach((p) => {
      p.hidden = p.dataset.arcpanel !== name;
    });
    tabsEl
      .querySelectorAll('.tab')
      .forEach((t) => t.classList.toggle('is-active', t.dataset.arctab === name));
    if (usersAside) usersAside.hidden = name !== 'questions';
    if (name === 'errors') loadErrors();
  };

  if (isAdmin && errorsTabBtn) errorsTabBtn.hidden = false;
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    const name = t.dataset.arctab;
    if (!name) return;
    if (name === 'errors' && !isAdmin) return;
    switchTab(name);
  });

  if (errorsRefreshBtn) errorsRefreshBtn.addEventListener('click', loadErrors);
  if (errorsClearBtn) {
    errorsClearBtn.addEventListener('click', async () => {
      if (!confirm('Очистити всі помилки Gemini?')) return;
      errEl.textContent = '';
      try {
        await api('/admin/gemini-errors', { method: 'DELETE' });
        await loadErrors();
      } catch (e) {
        errEl.textContent = e.message;
      }
    });
  }

  openBtn.addEventListener('click', async () => {
    modal.hidden = false;
    switchTab('questions');
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

  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = searchEl.value.trim().toLowerCase();
      page = 0;
      render();
    }, 200);
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

  deleteSelBtn.addEventListener('click', async () => {
    const ids = [...selected];
    if (!ids.length) {
      errEl.textContent = 'Нічого не обрано.';
      return;
    }
    if (!window.confirm(`Видалити обрані питання (${ids.length})? Дію не скасувати.`)) {
      return;
    }
    errEl.textContent = '';
    deleteSelBtn.disabled = true;
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await api(`/me/questions/${id}`, { method: 'DELETE' });
        items = items.filter((x) => x.id !== id);
        selected.delete(id);
        ok++;
      } catch {
        failed.push(id);
      }
    }
    refreshTagFilter();
    render();
    deleteSelBtn.disabled = false;
    errEl.textContent = failed.length
      ? `Видалено: ${ok}, не вдалося: ${failed.length}`
      : `Видалено: ${ok}`;
  });

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
    const h2c = window.html2canvas;
    if (typeof h2c !== 'function') {
      errEl.textContent = 'html2canvas не завантажився.';
      return;
    }
    errEl.textContent = '';
    exportPdfBtn.disabled = true;

    const stage = document.createElement('div');
    stage.style.cssText =
      'position:fixed;left:-99999px;top:0;width:720px;font-family:system-ui,sans-serif;color:#111;background:#fff;';
    document.body.appendChild(stage);

    try {
      const doc = new jsPDFCtor({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 24;
      const innerW = pageW - margin * 2;
      let firstPage = true;

      for (let i = 0; i < picked.length; i++) {
        const q = picked[i];

        stage.innerHTML = '';
        const card = document.createElement('div');
        card.style.cssText = 'padding:24px;box-sizing:border-box;';

        const head = document.createElement('div');
        head.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:12px;';
        head.textContent = `№${i + 1}`;
        card.appendChild(head);

        const dataUrl = await fetchImageDataUrl(q.id);
        if (dataUrl) {
          const img = document.createElement('img');
          img.src = dataUrl;
          img.style.cssText =
            'max-width:100%;display:block;margin:0 0 14px;border:1px solid #ddd;';
          card.appendChild(img);
          await new Promise((res) => {
            if (img.complete) res();
            else {
              img.onload = res;
              img.onerror = res;
            }
          });
        }

        const block = (label, value) => {
          const el = document.createElement('div');
          el.style.cssText = 'margin-bottom:10px;font-size:14px;line-height:1.45;';
          const lab = document.createElement('strong');
          lab.textContent = label;
          el.appendChild(lab);
          if (typeof value === 'string') {
            el.appendChild(document.createTextNode(' ' + value));
          } else {
            el.appendChild(value);
          }
          card.appendChild(el);
        };

        block('Питання:', q.question || '—');

        if (Array.isArray(q.options) && q.options.length) {
          const list = document.createElement('ol');
          list.style.cssText = 'margin:4px 0 0 22px;padding:0;font-size:14px;line-height:1.45;';
          q.options.forEach((o) => {
            const li = document.createElement('li');
            li.style.cssText = 'margin-bottom:2px;';
            li.textContent = o;
            list.appendChild(li);
          });
          block('Варіанти:', list);
        } else {
          block('Варіанти:', '—');
        }

        block('Правильна відповідь:', q.correctAnswer || '—');

        if (Array.isArray(q.tags) && q.tags.length) {
          block('Теги:', q.tags.join(', '));
        }

        stage.appendChild(card);

        const canvas = await h2c(card, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
        });

        const ratio = innerW / canvas.width;
        const drawH = canvas.height * ratio;
        const maxH = pageH - margin * 2;

        if (!firstPage) doc.addPage();
        firstPage = false;

        if (drawH <= maxH) {
          doc.addImage(canvas.toDataURL('image/jpeg', 0.88), 'JPEG', margin, margin, innerW, drawH);
        } else {
          const slicePxPerPage = maxH / ratio;
          let y = 0;
          let firstSlice = true;
          while (y < canvas.height) {
            if (!firstSlice) doc.addPage();
            firstSlice = false;
            const sliceH = Math.min(slicePxPerPage, canvas.height - y);
            const sub = document.createElement('canvas');
            sub.width = canvas.width;
            sub.height = sliceH;
            sub
              .getContext('2d')
              .drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            doc.addImage(
              sub.toDataURL('image/jpeg', 0.88),
              'JPEG',
              margin,
              margin,
              innerW,
              sliceH * ratio,
            );
            y += sliceH;
          }
        }
      }

      doc.save('questions.pdf');
    } catch (e) {
      errEl.textContent = e.message || 'Помилка генерації PDF.';
    } finally {
      stage.remove();
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

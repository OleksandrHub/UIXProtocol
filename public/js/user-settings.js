import { api } from './http.js';
import {
  APPEARANCE_DEFAULTS,
  addVariant,
  applyAppearance,
  deleteVariant,
  getActiveVariantId,
  getVariants,
  loadAppearance,
  renameVariant,
  saveAppearance,
  setActiveVariant,
  updateActiveVariantSettings,
} from './user-appearance.js';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function initSettings({
  me,
  cfg,
  frame,
  proxyBase,
  onFilesChanged,
  onAppearanceChanged,
  onTabShown,
}) {
  const modal = document.getElementById('settings');
  const urlInput = document.getElementById('urlInput');
  const keysInput = document.getElementById('keysInput');
  const passInput = document.getElementById('passInput');
  const devToolsInput = document.getElementById('devToolsInput');
  const settingsError = document.getElementById('settingsError');

  const tabs = document.querySelectorAll('#settingsTabs .tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      const target = tab.dataset.tab;
      panels.forEach((p) => { p.hidden = p.dataset.panel !== target; });
      onTabShown?.(target);
    });
  });

  const promptsList = document.getElementById('promptsList');
  const promptTpl = document.getElementById('promptItemTpl');
  let prompts = [];
  let activePromptId = '';

  const renderPrompts = () => {
    promptsList.innerHTML = '';
    prompts.forEach((p) => {
      const node = promptTpl.content.firstElementChild.cloneNode(true);
      const radio = node.querySelector('.prompt-active');
      const name = node.querySelector('.prompt-name');
      const text = node.querySelector('.prompt-text');
      const del = node.querySelector('.prompt-delete');
      radio.checked = p.id === activePromptId;
      radio.addEventListener('change', () => {
        if (radio.checked) activePromptId = p.id;
      });
      name.value = p.name;
      name.addEventListener('input', () => { p.name = name.value; });
      text.value = p.text;
      text.addEventListener('input', () => { p.text = text.value; });
      del.addEventListener('click', () => {
        prompts = prompts.filter((x) => x !== p);
        if (activePromptId === p.id) activePromptId = prompts[0]?.id ?? '';
        renderPrompts();
      });
      promptsList.appendChild(node);
    });
  };

  document.getElementById('promptAddBtn').addEventListener('click', () => {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    prompts.push({ id, name: 'Новий промт', text: cfg.defaultPrompt ?? '' });
    if (!activePromptId) activePromptId = id;
    renderPrompts();
  });

  const modelsList = document.getElementById('modelsList');
  let enabledModels = [];
  let activeModel = '';

  const renderModels = () => {
    modelsList.innerHTML = '';
    (cfg.knownModels ?? []).forEach((m) => {
      const row = document.createElement('div');
      row.className = 'model-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabledModels.includes(m);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!enabledModels.includes(m)) enabledModels.push(m);
        } else {
          enabledModels = enabledModels.filter((x) => x !== m);
          if (activeModel === m) activeModel = enabledModels[0] ?? '';
        }
        renderModels();
      });
      const name = document.createElement('span');
      name.className = 'model-name';
      name.textContent = m;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'activeModel';
      radio.checked = m === activeModel;
      radio.disabled = !enabledModels.includes(m);
      radio.addEventListener('change', () => {
        if (radio.checked) activeModel = m;
      });
      const lbl = document.createElement('span');
      lbl.className = 'active-label';
      lbl.textContent = 'активна';
      row.append(cb, name, radio, lbl);
      modelsList.appendChild(row);
    });
  };

  const filesList = document.getElementById('filesList');
  let files = [];
  const renderFiles = () => {
    filesList.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'file-empty';
      empty.textContent = 'Жодного файлу не прикріплено.';
      filesList.appendChild(empty);
      return;
    }
    files.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name;
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = `${(f.size / 1024).toFixed(0)} KB`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'file-delete';
      del.textContent = '×';
      del.title = 'Видалити';
      del.addEventListener('click', async () => {
        try {
          await api(`/me/files/${f.id}`, { method: 'DELETE' });
          files = files.filter((x) => x.id !== f.id);
          renderFiles();
          onFilesChanged?.();
        } catch (e) {
          settingsError.textContent = e.message;
        }
      });
      row.append(name, size, del);
      filesList.appendChild(row);
    });
  };

  const fileInput = document.getElementById('fileInput');
  document.getElementById('fileAddBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    settingsError.textContent = '';
    for (const file of fileInput.files) {
      try {
        const dataBase64 = await fileToBase64(file);
        const meta = await api('/me/files', {
          method: 'POST',
          body: JSON.stringify({
            name: file.name,
            mime: file.type || 'application/octet-stream',
            dataBase64,
          }),
        });
        files.push(meta);
      } catch (e) {
        settingsError.textContent = e.message;
      }
    }
    fileInput.value = '';
    renderFiles();
    onFilesChanged?.();
  });

  const ap = {
    resultFont: document.getElementById('apResultFont'),
    resultSize: document.getElementById('apResultSize'),
    resultColor: document.getElementById('apResultColor'),
    resultColorOpacity: document.getElementById('apResultColorOpacity'),
    resultBg: document.getElementById('apResultBg'),
    resultBgOpacity: document.getElementById('apResultBgOpacity'),
    btnFont: document.getElementById('apBtnFont'),
    btnSize: document.getElementById('apBtnSize'),
    btnColor: document.getElementById('apBtnColor'),
    btnColorOpacity: document.getElementById('apBtnColorOpacity'),
    btnBg: document.getElementById('apBtnBg'),
    btnBgOpacity: document.getElementById('apBtnBgOpacity'),
    friendActiveColor: document.getElementById('apFriendActiveColor'),
    friendActiveColorOpacity: document.getElementById('apFriendActiveColorOpacity'),
    friendActiveBg: document.getElementById('apFriendActiveBg'),
    friendActiveBgOpacity: document.getElementById('apFriendActiveBgOpacity'),
    showFilesStatus: document.getElementById('apShowFilesStatus'),
    showModelToast: document.getElementById('apShowModelToast'),
    showFrameActivity: document.getElementById('apShowFrameActivity'),
  };
  const apOut = {
    resultColorOpacity: document.getElementById('apResultColorOpacityOut'),
    resultBgOpacity: document.getElementById('apResultBgOpacityOut'),
    btnColorOpacity: document.getElementById('apBtnColorOpacityOut'),
    btnBgOpacity: document.getElementById('apBtnBgOpacityOut'),
    friendActiveColorOpacity: document.getElementById('apFriendActiveColorOpacityOut'),
    friendActiveBgOpacity: document.getElementById('apFriendActiveBgOpacityOut'),
  };

  const updateOpacityLabels = () => {
    apOut.resultColorOpacity.textContent = `${ap.resultColorOpacity.value}%`;
    apOut.resultBgOpacity.textContent = `${ap.resultBgOpacity.value}%`;
    apOut.btnColorOpacity.textContent = `${ap.btnColorOpacity.value}%`;
    apOut.btnBgOpacity.textContent = `${ap.btnBgOpacity.value}%`;
    apOut.friendActiveColorOpacity.textContent = `${ap.friendActiveColorOpacity.value}%`;
    apOut.friendActiveBgOpacity.textContent = `${ap.friendActiveBgOpacity.value}%`;
  };

  const populateAppearance = (a) => {
    ap.resultFont.value = a.resultFont || '';
    ap.resultSize.value = a.resultSize ?? 11;
    ap.resultColor.value = a.resultColor || '#404040';
    ap.resultColorOpacity.value = a.resultColorOpacity ?? 100;
    ap.resultBg.value = a.resultBg || '#ffffff';
    ap.resultBgOpacity.value = a.resultBgOpacity ?? 0;
    ap.btnFont.value = a.btnFont || '';
    ap.btnSize.value = a.btnSize ?? 14;
    ap.btnColor.value = a.btnColor || '#1a1a1a';
    ap.btnColorOpacity.value = a.btnColorOpacity ?? 100;
    ap.btnBg.value = a.btnBg || '#ffffff';
    ap.btnBgOpacity.value = a.btnBgOpacity ?? 0;
    ap.friendActiveColor.value = a.friendActiveColor || '#ffffff';
    ap.friendActiveColorOpacity.value = a.friendActiveColorOpacity ?? 100;
    ap.friendActiveBg.value = a.friendActiveBg || '#2a6df4';
    ap.friendActiveBgOpacity.value = a.friendActiveBgOpacity ?? 100;
    ap.showFilesStatus.checked = a.showFilesStatus === true;
    ap.showModelToast.checked = a.showModelToast === true;
    ap.showFrameActivity.checked = a.showFrameActivity === true;
    updateOpacityLabels();
    renderVariantSelect();
  };

  // ---- Variants UI ----
  const variantSelect = document.getElementById('variantSelect');
  const variantAddBtn = document.getElementById('variantAdd');
  const variantRenameBtn = document.getElementById('variantRename');
  const variantDeleteBtn = document.getElementById('variantDelete');

  const renderVariantSelect = () => {
    if (!variantSelect) return;
    const variants = getVariants();
    const activeId = getActiveVariantId();
    variantSelect.innerHTML = '';
    variants.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      if (v.id === activeId) opt.selected = true;
      variantSelect.appendChild(opt);
    });
    if (variantDeleteBtn) variantDeleteBtn.disabled = variants.length <= 1;
  };

  if (variantSelect) {
    variantSelect.addEventListener('change', async () => {
      try {
        await setActiveVariant(variantSelect.value);
        populateAppearance(loadAppearance());
      } catch (e) {
        settingsError.textContent = e.message;
      }
    });
  }
  if (variantAddBtn) {
    variantAddBtn.addEventListener('click', async () => {
      try {
        const v = await addVariant('Новий варіант');
        await setActiveVariant(v.id);
        populateAppearance(loadAppearance());
      } catch (e) {
        settingsError.textContent = e.message;
      }
    });
  }
  if (variantRenameBtn) {
    variantRenameBtn.addEventListener('click', async () => {
      const id = getActiveVariantId();
      const current = getVariants().find((v) => v.id === id);
      if (!current) return;
      const name = prompt('Нова назва варіанту:', current.name);
      if (name == null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await renameVariant(id, trimmed);
        renderVariantSelect();
      } catch (e) {
        settingsError.textContent = e.message;
      }
    });
  }
  if (variantDeleteBtn) {
    variantDeleteBtn.addEventListener('click', async () => {
      const id = getActiveVariantId();
      const current = getVariants().find((v) => v.id === id);
      if (!current) return;
      if (!confirm(`Видалити варіант "${current.name}"?`)) return;
      try {
        await deleteVariant(id);
        populateAppearance(loadAppearance());
      } catch (e) {
        settingsError.textContent = e.message;
      }
    });
  }

  const collectAppearance = () => ({
    resultFont: ap.resultFont.value.trim(),
    resultSize: Number(ap.resultSize.value) || 11,
    resultColor: ap.resultColor.value,
    resultColorOpacity: Number(ap.resultColorOpacity.value),
    resultBg: ap.resultBg.value,
    resultBgOpacity: Number(ap.resultBgOpacity.value),
    btnFont: ap.btnFont.value.trim(),
    btnSize: Number(ap.btnSize.value) || 14,
    btnColor: ap.btnColor.value,
    btnColorOpacity: Number(ap.btnColorOpacity.value),
    btnBg: ap.btnBg.value,
    btnBgOpacity: Number(ap.btnBgOpacity.value),
    friendActiveColor: ap.friendActiveColor.value,
    friendActiveColorOpacity: Number(ap.friendActiveColorOpacity.value),
    friendActiveBg: ap.friendActiveBg.value,
    friendActiveBgOpacity: Number(ap.friendActiveBgOpacity.value),
    showFilesStatus: ap.showFilesStatus.checked,
    showModelToast: ap.showModelToast.checked,
    showFrameActivity: ap.showFrameActivity.checked,
  });

  const RESULT_KEYS = new Set([
    'resultFont',
    'resultSize',
    'resultColor',
    'resultColorOpacity',
    'resultBg',
    'resultBgOpacity',
  ]);

  Object.entries(ap).forEach(([key, el]) => {
    const handler = async () => {
      updateOpacityLabels();
      // Result-* edits write into the active variant so it's the variant
      // that survives, not just the flat snapshot.
      if (RESULT_KEYS.has(key)) {
        const collected = collectAppearance();
        const variantPartial = {};
        for (const k of RESULT_KEYS) variantPartial[k] = collected[k];
        updateActiveVariantSettings(variantPartial);
      }
      applyAppearance(collectAppearance());
      if (
        key === 'showFilesStatus' ||
        key === 'showModelToast' ||
        key === 'showFrameActivity'
      ) {
        try {
          await saveAppearance({ [key]: el.checked });
          onAppearanceChanged?.();
        } catch (e) {
          settingsError.textContent = e.message;
        }
      }
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  document.getElementById('apResetBtn').addEventListener('click', () => {
    populateAppearance(APPEARANCE_DEFAULTS);
    applyAppearance(APPEARANCE_DEFAULTS);
  });

  document.getElementById('settingsBtn').addEventListener('click', async () => {
    urlInput.value = me.targetUrl ?? '';
    keysInput.value = (me.apiKeys ?? []).join('\n');
    passInput.value = '';
    devToolsInput.checked = me.devTools === true;
    settingsError.textContent = '';

    prompts = (me.prompts ?? []).map((p) => ({ ...p }));
    activePromptId = me.activePromptId ?? '';
    if (!prompts.length) {
      const id = `p_${Date.now()}`;
      prompts = [{ id, name: 'За замовчуванням', text: cfg.defaultPrompt ?? '' }];
      activePromptId = id;
    } else if (!prompts.some((p) => p.id === activePromptId)) {
      activePromptId = prompts[0].id;
    }
    renderPrompts();

    enabledModels = [...(me.enabledModels ?? [])];
    activeModel = me.activeModel ?? '';
    if (!enabledModels.length && cfg.knownModels?.length) {
      enabledModels = ['gemini-2.5-flash'];
      activeModel = 'gemini-2.5-flash';
    }
    if (!activeModel || !enabledModels.includes(activeModel)) {
      activeModel = enabledModels[0] ?? '';
    }
    renderModels();

    try {
      files = await api('/me/files');
    } catch (e) {
      files = [];
      settingsError.textContent = e.message;
    }
    renderFiles();

    populateAppearance(loadAppearance());

    modal.hidden = false;
  });

  document.getElementById('settingsCancel').addEventListener('click', () => {
    modal.hidden = true;
    applyAppearance(loadAppearance());
  });

  document.getElementById('settingsSave').addEventListener('click', async () => {
    settingsError.textContent = '';
    try {
      const newUrl = urlInput.value.trim();
      const newKeys = keysInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const newPass = passInput.value;
      let urlChanged = false;
      if (newUrl !== (me.targetUrl ?? '')) {
        await api('/me/url', { method: 'PUT', body: JSON.stringify({ url: newUrl }) });
        me.targetUrl = newUrl;
        urlChanged = true;
      }
      if (JSON.stringify(newKeys) !== JSON.stringify(me.apiKeys)) {
        await api('/me/api-keys', { method: 'PUT', body: JSON.stringify({ apiKeys: newKeys }) });
        me.apiKeys = newKeys;
      }
      if (newPass) {
        await api('/me/password', { method: 'PUT', body: JSON.stringify({ password: newPass }) });
      }

      const cleanedPrompts = prompts.filter((p) => p.text.trim() || p.name.trim());
      if (
        JSON.stringify(cleanedPrompts) !== JSON.stringify(me.prompts ?? []) ||
        activePromptId !== (me.activePromptId ?? '')
      ) {
        const updated = await api('/me/prompts', {
          method: 'PUT',
          body: JSON.stringify({ prompts: cleanedPrompts, activePromptId }),
        });
        me.prompts = updated.prompts;
        me.activePromptId = updated.activePromptId;
      }

      if (
        JSON.stringify(enabledModels) !== JSON.stringify(me.enabledModels ?? []) ||
        activeModel !== (me.activeModel ?? '')
      ) {
        const updated = await api('/me/models', {
          method: 'PUT',
          body: JSON.stringify({ enabledModels, activeModel }),
        });
        me.enabledModels = updated.enabledModels;
        me.activeModel = updated.activeModel;
      }

      const newDevTools = devToolsInput.checked;
      let devToolsChanged = false;
      if (newDevTools !== (me.devTools === true)) {
        await api('/me/dev-tools', {
          method: 'PUT',
          body: JSON.stringify({ devTools: newDevTools }),
        });
        me.devTools = newDevTools;
        devToolsChanged = true;
      }

      const a = collectAppearance();
      await saveAppearance(a);
      applyAppearance(a);

      modal.hidden = true;
      if (urlChanged || devToolsChanged) frame.src = proxyBase;
    } catch (e) {
      settingsError.textContent = e.message;
    }
  });
}

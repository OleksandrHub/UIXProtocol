import { api, API_PREFIX } from './http.js';
import { loadAppearance, saveAppearance } from './user-appearance.js';
import { captureFrameAsBase64Jpeg } from './user-screenshot.js';

export function initFriends({ me, geminiResultEl, onModeChange, showHint }) {
  const frameEl = document.getElementById('frame');
  let mode = 'normal';
  let lists = { asAsker: [], asHelper: [], pendingIncoming: [], pendingOutgoing: [] };
  let busy = false;
  const SEARCH_DEBOUNCE_MS = 250;
  let searchQuery = '';
  let searchResults = [];
  let searchBusy = false;
  let searchError = '';
  let searchTimer = null;
  let searchLoaded = false;
  let searchListEl = null;
  let searchInputEl = null;
  let searchStatusEl = null;
  let searchErrorEl = null;
  let pollTimer = null;
  let friendAutoAccept = [];
  let friendQuickReplies = [];
  let prefsAutoInputEl = null;
  let prefsQuickInputEl = null;
  let prefsStatusEl = null;

  async function refreshLists() {
    try {
      lists = await api('/me/friends');
    } catch (e) {
      console.warn('[friends] refreshLists failed:', e.message);
      lists = { asAsker: [], asHelper: [], pendingIncoming: [], pendingOutgoing: [] };
    }
    if (panelRoot) renderPanel(panelRoot);
    renderSearchList();
    if (!searchLoaded && !searchBusy) loadSearch(searchQuery, { silent: true });
    if (!pendingRequest && lists.pendingIncoming.length) {
      openRequestModal(lists.pendingIncoming[0]);
    }
    if (mode === 'friend' && lists.asAsker.length === 0) {
      mode = 'normal';
      onModeChange?.(mode);
      showHint?.('режим друга вимкнено: немає активного помічника');
    }
  }

  let panelRoot = null;

  const button = (text, cls, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  };

  function normalizeListFromText(text, maxItems) {
    const raw = String(text ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (maxItems && out.length >= maxItems) break;
    }
    return out;
  }

  function normalizeListValue(value, maxItems) {
    if (Array.isArray(value)) return normalizeListFromText(value.join('\n'), maxItems);
    return normalizeListFromText(value ?? '', maxItems);
  }

  function listToText(list) {
    return Array.isArray(list) ? list.join('\n') : '';
  }

  function loadFriendPrefs() {
    const ap = loadAppearance();
    friendAutoAccept = normalizeListValue(ap.friendAutoAccept, 40);
    friendQuickReplies = normalizeListValue(ap.friendQuickReplies, 16);
  }

  function formatQuickReply(text) {
    const name = currentScreenshot?.askerName ?? currentScreenshot?.fromName ?? '';
    return String(text ?? '').replace(/\{name\}/g, name || '');
  }

  function renderQuickReplies() {
    if (!chatQuick) return;
    chatQuick.innerHTML = '';
    if (!friendQuickReplies.length) {
      chatQuick.hidden = true;
      return;
    }
    for (const tpl of friendQuickReplies) {
      const btn = button(tpl, 'friend-chat__quick-btn', () => {
        if (!chatReply) return;
        chatReply.value = formatQuickReply(tpl);
        chatReply.focus();
      });
      btn.title = tpl;
      chatQuick.appendChild(btn);
    }
    chatQuick.hidden = false;
  }

  loadFriendPrefs();

  function getRelationLabel(userId) {
    if (lists.asAsker.some((c) => c.helperId === userId)) return 'ваш помічник';
    if (lists.asHelper.some((c) => c.askerId === userId)) return 'ви допомагаєте';
    if (lists.pendingOutgoing.some((c) => c.helperId === userId)) return 'очікує';
    if (lists.pendingIncoming.some((c) => c.askerId === userId)) return 'вхідний запит';
    return '';
  }

  function renderSearchStatus() {
    if (!searchStatusEl) return;
    if (searchBusy) {
      searchStatusEl.textContent = 'пошук…';
      return;
    }
    if (searchQuery) searchStatusEl.textContent = `знайдено: ${searchResults.length}`;
    else searchStatusEl.textContent = searchResults.length ? `показано: ${searchResults.length}` : '';
  }

  function renderSearchList() {
    if (!searchListEl) return;
    searchListEl.innerHTML = '';
    if (searchErrorEl) searchErrorEl.textContent = searchError || '';

    if (searchBusy) {
      const li = document.createElement('li');
      li.className = 'friends-search-empty';
      li.textContent = 'пошук…';
      searchListEl.appendChild(li);
      renderSearchStatus();
      return;
    }

    if (!searchResults.length) {
      const li = document.createElement('li');
      li.className = 'friends-search-empty';
      li.textContent = searchQuery ? 'нічого не знайдено' : 'почніть вводити імʼя';
      searchListEl.appendChild(li);
      renderSearchStatus();
      return;
    }

    for (const u of searchResults) {
      const li = document.createElement('li');
      li.className = 'friends-item';

      const nameEl = document.createElement('span');
      nameEl.textContent = u.name;

      const statusEl = document.createElement('span');
      const relation = getRelationLabel(u.id);
      const online = u.isOnline === true;
      statusEl.className = `friends-status${online ? ' is-online' : ''}`;
      statusEl.textContent = relation || (online ? 'онлайн' : 'офлайн');

      const inviteBtn = button('Запросити', 'is-primary', async () => {
        if (inviteBtn.disabled) return;
        inviteBtn.disabled = true;
        try {
          await api('/me/friends/request', {
            method: 'POST',
            body: JSON.stringify({ toName: u.name }),
          });
          await refreshLists();
        } catch (e) {
          if (searchErrorEl) searchErrorEl.textContent = e.message;
          inviteBtn.disabled = false;
        }
      });

      if (relation) inviteBtn.disabled = true;

      li.append(nameEl, statusEl, inviteBtn);
      searchListEl.appendChild(li);
    }

    renderSearchStatus();
  }

  async function loadSearch(query, { silent = false } = {}) {
    searchBusy = true;
    searchError = '';
    if (!silent) renderSearchStatus();
    try {
      const res = await api(`/me/friends/users?q=${encodeURIComponent(query)}`);
      const items = Array.isArray(res) ? res : res?.items;
      searchResults = Array.isArray(items) ? items : [];
      searchLoaded = true;
    } catch (e) {
      searchError = e.message;
      searchResults = [];
    } finally {
      searchBusy = false;
      renderSearchList();
    }
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSearch(searchQuery), SEARCH_DEBOUNCE_MS);
  }

  function renderPanel(root) {
    panelRoot = root;
    root.innerHTML = '';
    loadFriendPrefs();

    const requestBlock = document.createElement('div');
    requestBlock.className = 'friends-block';
    requestBlock.innerHTML = `
      <label>
        Пошук користувача
        <div class="friends-search-row">
          <input id="friendSearchInput" type="search" placeholder="введіть ім'я" />
        </div>
      </label>
      <div class="friends-search-meta" id="friendSearchStatus"></div>
      <ul class="friends-list friends-search-list" id="friendSearchList"></ul>
      <div class="friends-error" id="friendRequestError"></div>
    `;
    root.appendChild(requestBlock);

    searchErrorEl = requestBlock.querySelector('#friendRequestError');
    searchInputEl = requestBlock.querySelector('#friendSearchInput');
    searchListEl = requestBlock.querySelector('#friendSearchList');
    searchStatusEl = requestBlock.querySelector('#friendSearchStatus');
    if (searchInputEl) {
      searchInputEl.value = searchQuery;
      searchInputEl.addEventListener('input', () => {
        searchQuery = searchInputEl.value.trim();
        scheduleSearch();
      });
      searchInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInputEl.value = '';
          searchQuery = '';
          scheduleSearch();
        }
      });
    }
    renderSearchList();

    const prefsBlock = document.createElement('div');
    prefsBlock.className = 'friends-block';
    prefsBlock.innerHTML = `
      <h4>Автоприйняття</h4>
      <label>
        Дозволені користувачі (кожне ім'я з нового рядка)
        <textarea id="friendAutoAcceptInput" rows="3" placeholder="наприклад: Maria"></textarea>
      </label>
      <h4>Швидкі відповіді</h4>
      <label>
        Шаблони (кожен з нового рядка, доступний {name})
        <textarea id="friendQuickRepliesInput" rows="4" placeholder="наприклад: {name}, зараз подивлюсь"></textarea>
      </label>
      <div class="friends-actions">
        <button type="button" id="friendPrefsSave" class="is-primary">Зберегти</button>
        <span class="friends-meta" id="friendPrefsStatus"></span>
      </div>
    `;
    root.appendChild(prefsBlock);

    prefsAutoInputEl = prefsBlock.querySelector('#friendAutoAcceptInput');
    prefsQuickInputEl = prefsBlock.querySelector('#friendQuickRepliesInput');
    prefsStatusEl = prefsBlock.querySelector('#friendPrefsStatus');
    const prefsSaveBtn = prefsBlock.querySelector('#friendPrefsSave');
    if (prefsAutoInputEl) prefsAutoInputEl.value = listToText(friendAutoAccept);
    if (prefsQuickInputEl) prefsQuickInputEl.value = listToText(friendQuickReplies);
    if (prefsSaveBtn) {
      prefsSaveBtn.addEventListener('click', async () => {
        const nextAuto = normalizeListFromText(prefsAutoInputEl?.value ?? '', 40);
        const nextQuick = normalizeListFromText(prefsQuickInputEl?.value ?? '', 16);
        if (prefsStatusEl) prefsStatusEl.textContent = 'зберігаю…';
        prefsSaveBtn.disabled = true;
        try {
          await saveAppearance({ friendAutoAccept: nextAuto, friendQuickReplies: nextQuick });
          friendAutoAccept = nextAuto;
          friendQuickReplies = nextQuick;
          if (prefsStatusEl) prefsStatusEl.textContent = 'збережено ✓';
          renderQuickReplies();
        } catch (e) {
          if (prefsStatusEl) prefsStatusEl.textContent = `помилка: ${e.message}`;
        } finally {
          prefsSaveBtn.disabled = false;
        }
      });
    }

    const section = (title, items, renderItem) => {
      if (!items.length) return null;
      const block = document.createElement('div');
      block.className = 'friends-block';
      const h = document.createElement('h4');
      h.textContent = title;
      block.appendChild(h);
      const list = document.createElement('ul');
      list.className = 'friends-list';
      items.forEach((c) => list.appendChild(renderItem(c)));
      block.appendChild(list);
      return block;
    };

    const itemRow = (label, actions) => {
      const li = document.createElement('li');
      li.className = 'friends-item';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      li.appendChild(lbl);
      actions.forEach((btn) => li.appendChild(btn));
      return li;
    };

    const incomingBlock = section('Запити на допомогу (вам)', lists.pendingIncoming, (c) =>
      itemRow(c.askerName, [
        button('Прийняти', 'is-primary', async () => {
          try {
            await api('/me/friends/accept', {
              method: 'POST',
              body: JSON.stringify({ id: c.id }),
            });
            await refreshLists();
          } catch (e) {
            if (searchErrorEl) searchErrorEl.textContent = e.message;
          }
        }),
        button('Відхилити', '', async () => {
          await api(`/me/friends/${c.id}`, { method: 'DELETE' });
          await refreshLists();
        }),
      ]),
    );
    if (incomingBlock) root.appendChild(incomingBlock);

    const outgoingBlock = section('Очікують підтвердження', lists.pendingOutgoing, (c) =>
      itemRow(`${c.helperName} (чекає підтвердження)`, [
        button('Відкликати', '', async () => {
          await api(`/me/friends/${c.id}`, { method: 'DELETE' });
          await refreshLists();
        }),
      ]),
    );
    if (outgoingBlock) root.appendChild(outgoingBlock);

    const askerBlock = section('Мій помічник', lists.asAsker, (c) => {
      const actions = [];
      if (mode === 'friend' && lists.asAsker[0]?.id === c.id) {
        actions.push(
          button('Вийти з режиму друга', 'is-primary', () => disableMode()),
        );
      }
      actions.push(
        button('Відключити', '', async () => {
          await api(`/me/friends/${c.id}`, { method: 'DELETE' });
          await refreshLists();
        }),
      );
      return itemRow(c.helperName, actions);
    });
    if (askerBlock) root.appendChild(askerBlock);

    const helperBlock = section('Я допомагаю', lists.asHelper, (c) =>
      itemRow(c.askerName, [
        button('Відключити', '', async () => {
          await api(`/me/friends/${c.id}`, { method: 'DELETE' });
          await refreshLists();
        }),
      ]),
    );
    if (helperBlock) root.appendChild(helperBlock);

    if (
      !incomingBlock &&
      !outgoingBlock &&
      !askerBlock &&
      !helperBlock
    ) {
      const empty = document.createElement('p');
      empty.className = 'friends-empty';
      empty.textContent = 'Поки що немає підключень.';
      root.appendChild(empty);
    }
  }

  const chatModal = document.getElementById('friendChat');
  const chatImg = document.getElementById('friendChatImg');
  const chatImageWrap = document.getElementById('friendChatImageWrap');
  const chatFrom = document.getElementById('friendChatFrom');
  const chatReply = document.getElementById('friendChatReply');
  const chatSend = document.getElementById('friendChatSend');
  const chatClose = document.getElementById('friendChatClose');
  const chatCopyBtn = document.getElementById('friendChatCopy');
  const chatFullscreenBtn = document.getElementById('friendChatFullscreen');
  const chatFullscreenExitBtn = document.getElementById('friendChatFullscreenExit');
  const chatQuick = document.getElementById('friendChatQuick');
  const chatStatus = document.getElementById('friendChatStatus');
  let currentScreenshot = null;

  function openChat(payload) {
    currentScreenshot = payload;
    chatImg.src = `data:image/jpeg;base64,${payload.imageBase64}`;
    chatFrom.textContent = `від: ${payload.fromName}`;
    chatReply.value = '';
    chatStatus.textContent = '';
    renderQuickReplies();
    chatModal.hidden = false;
    exitFullscreenImage();
    setTimeout(() => chatReply.focus(), 50);
  }

  function closeChat() {
    chatModal.hidden = true;
    currentScreenshot = null;
    exitFullscreenImage();
  }

  function enterFullscreenImage() {
    if (!chatImageWrap) return;
    chatImageWrap.classList.add('is-fullscreen');
    if (chatFullscreenExitBtn) chatFullscreenExitBtn.hidden = false;
  }
  function exitFullscreenImage() {
    if (!chatImageWrap) return;
    chatImageWrap.classList.remove('is-fullscreen');
    if (chatFullscreenExitBtn) chatFullscreenExitBtn.hidden = true;
  }

  async function copyChatImage() {
    if (!chatImg || !chatImg.complete) return;
    chatStatus.textContent = 'копіюю…';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = chatImg.naturalWidth;
      canvas.height = chatImg.naturalHeight;
      canvas.getContext('2d').drawImage(chatImg, 0, 0);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      );
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      chatStatus.textContent = 'зображення скопійовано ✓';
      setTimeout(() => {
        if (chatStatus.textContent.startsWith('зображення скопійовано')) chatStatus.textContent = '';
      }, 1500);
    } catch (e) {
      chatStatus.textContent = `помилка копіювання: ${e.message}`;
    }
  }

  if (chatClose) chatClose.addEventListener('click', closeChat);
  if (chatCopyBtn) chatCopyBtn.addEventListener('click', copyChatImage);
  if (chatFullscreenBtn) chatFullscreenBtn.addEventListener('click', enterFullscreenImage);
  if (chatFullscreenExitBtn) chatFullscreenExitBtn.addEventListener('click', exitFullscreenImage);
  if (chatImg) chatImg.addEventListener('click', enterFullscreenImage);
  if (chatSend) {
    chatSend.addEventListener('click', async () => {
      if (!currentScreenshot) return;
      const text = chatReply.value.trim();
      if (!text) return;
      chatSend.disabled = true;
      chatStatus.textContent = 'надсилаю…';
      try {
        await api('/me/friends/reply', {
          method: 'POST',
          body: JSON.stringify({
            askerId: currentScreenshot.askerId,
            messageId: currentScreenshot.messageId,
            text,
          }),
        });
        chatStatus.textContent = 'надіслано ✓';
        setTimeout(closeChat, 600);
      } catch (e) {
        chatStatus.textContent = `помилка: ${e.message}`;
      } finally {
        chatSend.disabled = false;
      }
    });
  }
  if (chatReply) {
    chatReply.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        chatSend?.click();
      }
      if (e.key === 'Escape') closeChat();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (chatImageWrap?.classList.contains('is-fullscreen')) {
      e.preventDefault();
      exitFullscreenImage();
    }
  });

  const requestModal = document.getElementById('friendRequest');
  const requestFromEl = document.getElementById('friendRequestFromName');
  const requestStatusEl = document.getElementById('friendRequestStatus');
  const requestAcceptBtn = document.getElementById('friendRequestAccept');
  const requestDeclineBtn = document.getElementById('friendRequestDecline');
  let pendingRequest = null;

  function openRequestModal(connection) {
    if (!requestModal) return;
    pendingRequest = connection;
    if (requestFromEl) requestFromEl.textContent = connection.askerName ?? '?';
    if (requestStatusEl) requestStatusEl.textContent = '';
    if (requestAcceptBtn) requestAcceptBtn.disabled = false;
    if (requestDeclineBtn) requestDeclineBtn.disabled = false;
    requestModal.hidden = false;
  }
  function closeRequestModal() {
    if (requestModal) requestModal.hidden = true;
    pendingRequest = null;
  }
  if (requestAcceptBtn) {
    requestAcceptBtn.addEventListener('click', async () => {
      if (!pendingRequest) return;
      requestAcceptBtn.disabled = true;
      if (requestDeclineBtn) requestDeclineBtn.disabled = true;
      if (requestStatusEl) requestStatusEl.textContent = 'приймаю…';
      try {
        await api('/me/friends/accept', {
          method: 'POST',
          body: JSON.stringify({ id: pendingRequest.id }),
        });
        closeRequestModal();
        await refreshLists();
      } catch (e) {
        if (requestStatusEl) requestStatusEl.textContent = `помилка: ${e.message}`;
        requestAcceptBtn.disabled = false;
        if (requestDeclineBtn) requestDeclineBtn.disabled = false;
      }
    });
  }
  if (requestDeclineBtn) {
    requestDeclineBtn.addEventListener('click', async () => {
      if (!pendingRequest) return;
      requestDeclineBtn.disabled = true;
      if (requestAcceptBtn) requestAcceptBtn.disabled = true;
      try {
        await api(`/me/friends/${pendingRequest.id}`, { method: 'DELETE' });
        closeRequestModal();
        await refreshLists();
      } catch {
        closeRequestModal();
      }
    });
  }

  async function triggerScreenshot() {
    if (busy) return;
    if (mode !== 'friend') return;
    if (lists.asAsker.length === 0) {
      showHint?.('немає активного помічника');
      return;
    }
    busy = true;
    showResult('...');
    try {
      const imageBase64 = await captureFrameAsBase64Jpeg(frameEl);
      await api('/me/friends/screenshot', {
        method: 'POST',
        body: JSON.stringify({ imageBase64 }),
      });
      showResult('…');
    } catch (e) {
      console.error('[friend screenshot]', e);
      showResult(`помилка: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  function showResult(text) {
    if (!geminiResultEl) return;
    geminiResultEl.textContent = text;
    geminiResultEl.hidden = false;
  }

  let evtSrc = null;
  let retryTimer = null;

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(refreshLists, 15_000);
  }

  function stopPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function connectStream() {
    if (evtSrc) {
      try { evtSrc.close(); } catch {}
    }
    evtSrc = new EventSource(`${API_PREFIX}/me/friends/stream`);
    evtSrc.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleEvent(msg);
    };
    evtSrc.onerror = () => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectStream, 5000);
    };
  }

  function handleEvent(msg) {
    switch (msg.type) {
      case 'request':
        refreshLists();
        if (msg.connection) openRequestModal(msg.connection);
        else showHint?.('новий запит на допомогу');
        window.dispatchEvent(new CustomEvent('uix:frog', { detail: { reaction: 'friendRequest' } }));
        break;
      case 'accepted':
      case 'disconnected':
        refreshLists();
        if (msg.type === 'accepted') {
          showHint?.(`помічник підключився: ${msg.connection?.helperName ?? '?'}`);
          window.dispatchEvent(new CustomEvent('uix:frog', { detail: { reaction: 'friendAccepted' } }));
        }
        break;
      case 'screenshot':
        openChat({
          askerId: msg.from?.id,
          askerName: msg.from?.name,
          fromName: msg.from?.name ?? '?',
          imageBase64: msg.imageBase64,
          messageId: msg.messageId,
        });
        break;
      case 'reply':
        showResult(msg.text || '—');
        window.dispatchEvent(new CustomEvent('uix:frog', { detail: { reaction: 'friendReply' } }));
        break;
    }
  }

  connectStream();
  refreshLists();
  startPoll();

  function enableMode() {
    if (mode === 'friend') return;
    if (lists.asAsker.length === 0) {
      showHint?.('немає активного помічника');
      return;
    }
    mode = 'friend';
    const helperName = lists.asAsker[0]?.helperName ?? null;
    onModeChange?.(mode, helperName);
    if (panelRoot) renderPanel(panelRoot);
  }

  function disableMode() {
    if (mode === 'normal') return;
    mode = 'normal';
    const helperName = lists.asAsker[0]?.helperName ?? null;
    onModeChange?.(mode, helperName);
    if (panelRoot) renderPanel(panelRoot);
  }

  return {
    getMode: () => mode,
    getActiveHelperName: () => lists.asAsker[0]?.helperName ?? null,
    enableMode,
    disableMode,
    triggerScreenshot,
    refreshFriendsPanel: renderPanel,
    destroy() {
      clearTimeout(retryTimer);
      clearTimeout(searchTimer);
      stopPoll();
      if (evtSrc) try { evtSrc.close(); } catch {}
    },
  };
}

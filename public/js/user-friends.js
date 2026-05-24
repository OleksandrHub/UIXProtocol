import { api, API_PREFIX } from './http.js';
import { captureFrameAsBase64Jpeg } from './user-screenshot.js';

export function initFriends({ me, geminiResultEl, onModeChange, showHint }) {
  const frameEl = document.getElementById('frame');
  let mode = 'normal';
  let lists = { asAsker: [], asHelper: [], pendingIncoming: [], pendingOutgoing: [] };
  let busy = false;

  async function refreshLists() {
    try {
      lists = await api('/me/friends');
    } catch (e) {
      console.warn('[friends] refreshLists failed:', e.message);
      lists = { asAsker: [], asHelper: [], pendingIncoming: [], pendingOutgoing: [] };
    }
    if (panelRoot) renderPanel(panelRoot);
    if (mode === 'friend' && lists.asAsker.length === 0) {
      mode = 'normal';
      onModeChange?.(mode);
      showHint?.('режим друга вимкнено: немає активного помічника');
    }
  }

  let panelRoot = null;

  function renderPanel(root) {
    panelRoot = root;
    root.innerHTML = '';

    const requestBlock = document.createElement('div');
    requestBlock.className = 'friends-block';
    requestBlock.innerHTML = `
      <label>
        Запросити помічника за ім'ям
        <div class="friends-input-row">
          <input id="friendNameInput" type="text" placeholder="ім'я користувача" />
          <button type="button" id="friendRequestBtn">Запросити</button>
        </div>
      </label>
      <div class="friends-error" id="friendRequestError"></div>
    `;
    root.appendChild(requestBlock);

    const errEl = requestBlock.querySelector('#friendRequestError');
    const nameInput = requestBlock.querySelector('#friendNameInput');
    requestBlock.querySelector('#friendRequestBtn').addEventListener('click', async () => {
      errEl.textContent = '';
      const toName = nameInput.value.trim();
      if (!toName) return;
      try {
        await api('/me/friends/request', {
          method: 'POST',
          body: JSON.stringify({ toName }),
        });
        nameInput.value = '';
        await refreshLists();
      } catch (e) {
        errEl.textContent = e.message;
      }
    });

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

    const button = (text, cls, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener('click', onClick);
      return b;
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
            errEl.textContent = e.message;
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
  const chatStatus = document.getElementById('friendChatStatus');
  let currentScreenshot = null;

  function openChat(payload) {
    currentScreenshot = payload;
    chatImg.src = `data:image/jpeg;base64,${payload.imageBase64}`;
    chatFrom.textContent = `від: ${payload.fromName}`;
    chatReply.value = '';
    chatStatus.textContent = '';
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
      if (evtSrc) try { evtSrc.close(); } catch {}
    },
  };
}

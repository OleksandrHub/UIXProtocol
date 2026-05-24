import { api } from './http.js';

function el(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function btn(label, onClick, variant = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (variant) b.classList.add(variant);
  b.addEventListener('click', onClick);
  return b;
}

export function setupUsers({ tbody, errEl, fieldId, setEdit }) {
  async function refresh() {
    try {
      renderUsers(await api('/users'));
    } catch (e) {
      errEl.textContent = e.message;
    }
  }

  async function removeUser(id) {
    if (!confirm(`Видалити користувача #${id}?`)) return;
    try {
      await api(`/users/${id}`, { method: 'DELETE' });
      if (fieldId.value === String(id)) setEdit(null);
      await refresh();
    } catch (e) {
      errEl.textContent = e.message;
    }
  }

  async function toggleTroll(id, nextValue) {
    try {
      await api(`/users/${id}/troll-mode`, {
        method: 'PUT',
        body: JSON.stringify({ value: nextValue }),
      });
      await refresh();
    } catch (e) {
      errEl.textContent = e.message;
    }
  }

  function renderUsers(users) {
    tbody.replaceChildren();
    if (!users.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'Немає користувачів';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const u of users) {
      const tr = document.createElement('tr');
      const id = el('td', String(u.id));
      const name = el('td', u.name);
      const admin = el('td', u.isAdmin ? 'так' : '—');
      const url = el('td', u.targetUrl || '—');
      url.classList.add('truncate');
      const keys = el('td', String(u.apiKeys.length));
      const troll = document.createElement('td');
      const trollOn = u.trollMode === true;
      troll.appendChild(
        btn(
          trollOn ? 'ВКЛ — вимкнути' : 'викл — увімкнути',
          () => toggleTroll(u.id, !trollOn),
          trollOn ? 'danger' : '',
        ),
      );
      const actions = document.createElement('td');
      actions.appendChild(btn('Редагувати', () => setEdit(u)));
      actions.appendChild(btn('Видалити', () => removeUser(u.id), 'danger'));
      tr.append(id, name, admin, url, keys, troll, actions);
      tbody.appendChild(tr);
    }
  }

  return { refresh };
}

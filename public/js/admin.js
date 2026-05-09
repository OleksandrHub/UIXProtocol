import { api } from './http.js';
import { setupUsers } from './admin-users.js';

const me = await api('/me').catch(() => null);
if (!me || !me.isAdmin) {
  location.href = '/admin';
  throw new Error('redirecting');
}

const errEl = document.getElementById('error');
const tbody = document.getElementById('users');
const form = document.getElementById('form');
const fieldId = document.getElementById('userId');
const fieldName = document.getElementById('name');
const fieldPass = document.getElementById('password');
const fieldUrl = document.getElementById('targetUrl');
const fieldKeys = document.getElementById('apiKeys');
const fieldAdmin = document.getElementById('isAdmin');
const submitBtn = document.getElementById('submitBtn');
const resetBtn = document.getElementById('resetBtn');
const formTitle = document.getElementById('formTitle');

function setEdit(user) {
  if (user) {
    fieldId.value = String(user.id);
    fieldName.value = user.name;
    fieldPass.value = '';
    fieldPass.placeholder = 'не змінювати — залиш порожнім';
    fieldUrl.value = user.targetUrl ?? '';
    fieldKeys.value = (user.apiKeys ?? []).join('\n');
    fieldAdmin.checked = !!user.isAdmin;
    submitBtn.textContent = 'Зберегти';
    formTitle.textContent = `Редагувати #${user.id}`;
  } else {
    fieldId.value = '';
    fieldName.value = '';
    fieldPass.value = '';
    fieldPass.placeholder = '';
    fieldUrl.value = '';
    fieldKeys.value = '';
    fieldAdmin.checked = false;
    submitBtn.textContent = 'Створити';
    formTitle.textContent = 'Створити користувача';
  }
}

const { refresh } = setupUsers({ tbody, errEl, fieldId, setEdit });

resetBtn.addEventListener('click', () => setEdit(null));

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  location.href = '/admin';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.textContent = '';
  const editId = fieldId.value ? Number(fieldId.value) : null;
  const apiKeys = fieldKeys.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const body = {
    name: fieldName.value.trim(),
    apiKeys,
    isAdmin: fieldAdmin.checked,
    targetUrl: fieldUrl.value.trim(),
  };
  if (fieldPass.value) body.password = fieldPass.value;

  try {
    if (editId) {
      await api(`/users/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      if (!body.password) {
        errEl.textContent = "Пароль обов'язковий для нового користувача";
        return;
      }
      await api('/users', { method: 'POST', body: JSON.stringify(body) });
    }
    setEdit(null);
    await refresh();
  } catch (e) {
    errEl.textContent = e.message;
  }
});

refresh();

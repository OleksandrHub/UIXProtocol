import { api } from './http.js';

const id = location.pathname.split('/').filter(Boolean)[0];
if (!id || !/^\d+$/.test(id)) location.href = '/';

document.getElementById('title').textContent = `Вхід (#${id})`;

const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Вхід...';
  try {
    await api(`/login/${id}`, {
      method: 'POST',
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    location.reload();
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Увійти';
  }
});

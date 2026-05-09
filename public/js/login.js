import { api } from './http.js';

const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Вхід...';
  try {
    const user = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('name').value,
        password: document.getElementById('password').value,
      }),
    });
    location.href = `/${user.id}/`;
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Увійти';
  }
});

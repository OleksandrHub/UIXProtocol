import { loadAppearance, saveAppearance } from './user-appearance.js';

const EMOTIONS = ['face-happy', 'face-wink', 'face-surprised', 'face-thinking', 'face-sleeping'];

const STEPS = [
  
  {
    emotion: 'face-happy',
    corner: 'center',
    text:
      'Ква! Я — Жаба-хакер 🐸💻. У капюшоні, з блимаючим >_ і без жодної каплі поваги до Cloudflare. ' +
      'Зараз проведу повний тур по всьому що тут є — і ще трохи. Натисни «Далі» або × щоб назавжди мене закрити.',
  },

  {
    emotion: 'face-surprised',
    corner: 'bl',
    highlight: '#frame',
    text:
      'Це iframe — сцена. Тут показується сайт через проксі. Я колись думав це справжній браузер, ' +
      'поки моя жабенятко не клікнуло F12. Спойлер: це iframe.',
  },

  {
    emotion: 'face-happy',
    corner: 'bl',
    highlight: '#screenshotBtn',
    text:
      'Кнопка S — основна магія. Клік або Alt+G робить скрін iframe і шле до Gemini. ' +
      'Альтернатива для лінивих: Alt+колесо догори. Працює і Ctrl+wheel (для тих хто не довіряє Alt).',
  },

  {
    emotion: 'face-thinking',
    corner: 'bl',
    demo: 'mockAnswer:Відповідь: 3',
    highlight: '#geminiResult',
    text:
      'Ось так виглядатиме відповідь — внизу-зліва, дискретно. Зараз я підставив фейк " Відповідь: 3 ", ' +
      'щоб ти побачив. Стиль (шрифт/колір/прозорість) — у Налаштуваннях → Вигляд.',
  },

  {
    emotion: 'face-wink',
    corner: 'bl',
    highlight: '#geminiResult',
    text:
      'Якщо викладач підкрався — Alt+H ховає/показує відповідь. Або клік просто куди завгодно повз неї. ' +
      'Друге натискання — знову з\'являється. Як гра в "ку-ку" з підказкою.',
  },

  {
    emotion: 'face-wink',
    corner: 'tl',
    highlight: '#barTrigger',
    text:
      'Бачиш правий верхній кут? Там НЕВИДИМА кнопка 44×44 — клік відкриває меню. ' +
      'Альтернатива: Alt+M. Я завжди тицяв туди як дурний, поки не дізнався про Alt+M.',
  },

  {
    emotion: 'face-happy',
    corner: 'tr',
    highlight: '#bar',
    action: 'showBar',
    text:
      'Ось воно — меню. Налаштування / Архів / Вихід (і Адмін, якщо ти бос). ' +
      'На мобільному воно випадає справа як ящик з шухлядою. Зараз пройдемося по налаштуваннях детально.',
  },

  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#urlInput',
    action: 'openSettings:general',
    text:
      'Налаштування → Основні. URL сайту — куди проксі. За замовчуванням dl.tntu.edu.ua, ' +
      'але можеш вписати будь-що. Жаба пробувала "youtube.com" — працює, але плеєр гальмує 🐸.',
  },
  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#keysInput',
    action: 'openSettings:general',
    text:
      'API ключі Gemini — по одному на рядок. Якщо у тебе три ключі — буде fallback: ' +
      'перший вичерпав квоту → пробуємо другий → третій. Один ключ працює теж, але без подушки безпеки.',
  },
  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#passInput',
    action: 'openSettings:general',
    text:
      'Новий пароль — порожньо щоб не змінювати. І чекбокс «devTools» — діагностичні скрипти ' +
      '(IP-проби в консолі, заглушки Turnstile). Без потреби краще не вмикати.',
  },

  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#promptsList',
    action: 'switchTab:prompts',
    text:
      'Промти — інструкція для Gemini. Можеш мати кілька різних (напр. «для тестів», «для перекладу»). ' +
      'Один активний (radio). Активний шле разом зі скрином кожним кліком. Кнопкою «+ Додати» — створюй нові.',
  },

  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#modelsList',
    action: 'switchTab:models',
    text:
      'Моделі — чекбокси вмикають моделі Gemini для тебе, radio робить одну активною. ' +
      'Активна — у яку летить наступний запит. Перемикання активної — без перезапуску.',
  },
  {
    emotion: 'face-wink',
    corner: 'tr',
    demo: 'mockToast:flash-2.5',
    text:
      'Alt+C циклить активну модель по колу (тільки серед увімкнених). При перемиканні з\'являється тост ' +
      'внизу-справа з ім\'ям моделі — отакий, я тобі вже намалював приклад. Тост вмикається в Вигляд → Індикатори.',
  },

  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#filesList',
    action: 'switchTab:files',
    text:
      'Файли — будь-що (PDF, картинка, аудіо, відео, txt). Все це летить у Gemini разом зі скрином ' +
      'як контекст. Корисно для тестів за матеріалами. Жаба тестувала з 200 МБ PDF — Gemini не плаче, але повільно.',
  },

  {
    emotion: 'face-wink',
    corner: 'tr',
    highlight: '.variants-bar',
    action: 'switchTab:appearance',
    text:
      'Вигляд → Варіанти. Це пресети оформлення відповіді (шрифт/колір/прозорість). ' +
      'Створюєш кілька (для дня/ночі/таємного режиму) і циклиш через Alt+V. Кнопкою + додаєш, ✎ перейменовуєш, × видаляєш.',
  },
  {
    emotion: 'face-thinking',
    corner: 'tr',
    highlight: '#apResultColor',
    action: 'switchTab:appearance',
    text:
      'Кольори тексту і фону для відповіді Gemini + повзунки прозорості. ' +
      '0% — повністю прозоро, 100% — суцільно. Хочеш «непомітну» відповідь — текст 30% прозорості того ж кольору що фон iframe.',
  },
  {
    emotion: 'face-happy',
    corner: 'tr',
    highlight: '#apShowOnboarding',
    action: 'switchTab:appearance',
    text:
      'Знизу — індикатори: статус файлів (📎), тост моделі, дебагер активності iframe, і… я (🐸). ' +
      'Якщо хочеш мене знову — клацни «Показувати гід-помічника». Чи навпаки — лишай вимкненим і живи в тиші.',
  },

  {
    emotion: 'face-happy',
    corner: 'tr',
    highlight: '#friendsPanel',
    action: 'switchTab:friends',
    text:
      'Друзі — підключаєш помічника за іменем. Він прийме → у тебе з\'явиться режим друга. ' +
      'Скрін летить йому замість Gemini, він пише текст відповіді, ти бачиш. Корисно коли Gemini тупить, а друг розумніший.',
  },

  {
    emotion: 'face-surprised',
    corner: 'bl',
    highlight: '[data-arcpanel="questions"]',
    action: 'closeSettings,openArchive',
    text:
      'Архів — банк усіх скрінів з відповідями (від Gemini або від друга). ' +
      'Пошук по тексту, фільтр по тегах, пагінація. Питання редагуються прямо тут — клацай і пиши.',
  },
  {
    emotion: 'face-thinking',
    corner: 'bl',
    highlight: '#archiveExportPdf',
    text:
      'Експорт. TXT — простий список. PDF — рендериться через html2canvas (тому кирилиця в нормі, ' +
      'на відміну від стандартного jsPDF, який без шрифту-шамана тільки латиницю розуміє).',
  },
  {
    emotion: 'face-wink',
    corner: 'bl',
    highlight: '#archiveShareBtn',
    text:
      'Поділитися — обираєш користувача в списку справа, тиснеш «Поділитися обраним», і копії питань ' +
      'летять йому в архів. Зручно якщо хтось готується до тих самих тестів. Спойлер: усі готуються до тих самих.',
  },

  {
    emotion: 'face-wink',
    corner: 'br',
    highlight: '#friendToggleBtn',
    action: 'closeArchive',
    text:
      'Режим друга — Alt+F на десктопі, або кнопка Д у правому нижньому куті на мобільному. ' +
      'Після активації скрін літає твоєму помічнику. Вимикається ТІЛЬКИ через Налаштування → Друзі → «Вийти з режиму друга».',
  },

  {
    emotion: 'face-thinking',
    corner: 'center',
    text:
      '🎹 ВСІ КЛАВІШІ (роздрукуй і повісь над монітором):\n' +
      '• Alt+G — скрін → Gemini\n' +
      '• Alt+H — сховати/показати відповідь\n' +
      '• Alt+M — меню (тих-токер альтернатива → правий-верхній кут)\n' +
      '• Alt+C — циклити модель\n' +
      '• Alt+V — циклити варіант вигляду\n' +
      '• Alt+F — увімкнути режим друга\n' +
      '• Alt+wheel-up / Ctrl+wheel-up — те саме що Alt+G\n' +
      '• Alt+wheel-down / Ctrl+wheel-down — те саме що Alt+H\n' +
      '• Quick login: на блокованому iframe — просто натисни ОДНУ літеру (перший символ пароля).',
  },

  {
    emotion: 'face-sleeping',
    corner: 'center',
    text:
      'Зззз… все, я виговорилася 😴. Магія в твоїх руках, малий. ' +
      'Жаби бачать дев\'ять кольорів — спробуй знайти всі у Налаштуваннях → Вигляд. ' +
      'А я перезапускаюся з того ж місця — Налаштування → Вигляд → «Показувати гід-помічника».',
  },
];

function changeHatEmotion(emotionId) {
  const root = document.getElementById('onboardingAvatar');
  if (!root) return;
  root.querySelectorAll('g.face').forEach((g) => {
    g.setAttribute('opacity', g.classList.contains(emotionId) ? '1' : '0');
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clearHighlight() {
  document.querySelectorAll('.onboarding-target').forEach((el) =>
    el.classList.remove('onboarding-target'),
  );
}

function applyHighlight(selector) {
  clearHighlight();
  if (!selector) return;
  const el = document.querySelector(selector);
  if (el) el.classList.add('onboarding-target');
}

function switchSettingsTab(name) {
  const btn = document.querySelector(`#settingsTabs .tab[data-tab="${name}"]`);
  if (btn) btn.click();
}

async function runAction(spec) {
  if (!spec) return;
  for (const command of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, arg] = command.split(':');
    switch (name) {
      case 'showBar':
        document.getElementById('bar')?.classList.add('show');
        break;
      case 'hideBar':
        document.getElementById('bar')?.classList.remove('show');
        break;
      case 'openSettings': {
        const modal = document.getElementById('settings');
        if (modal?.hidden) document.getElementById('settingsBtn')?.click();
        await delay(160);
        if (arg) switchSettingsTab(arg);
        break;
      }
      case 'closeSettings':
        document.getElementById('settingsCancel')?.click();
        break;
      case 'switchTab':
        if (arg) switchSettingsTab(arg);
        break;
      case 'openArchive': {
        const modal = document.getElementById('archive');
        if (modal?.hidden) document.getElementById('archiveBtn')?.click();
        await delay(220);
        break;
      }
      case 'closeArchive':
        document.getElementById('archiveClose')?.click();
        break;
    }
    await delay(120);
  }
}

let activeDemoTeardowns = [];

function teardownDemos() {
  for (const fn of activeDemoTeardowns) {
    try { fn(); } catch {}
  }
  activeDemoTeardowns = [];
}

function startDemo(spec) {
  if (!spec) return;
  const [name, ...rest] = spec.split(':');
  const arg = rest.join(':'); 

  if (name === 'mockAnswer') {
    const el = document.getElementById('geminiResult');
    if (!el) return;
    const prevText = el.textContent;
    const prevHidden = el.hidden;
    el.textContent = arg;
    el.hidden = false;
    el.classList.remove('is-fading');
    activeDemoTeardowns.push(() => {
      el.textContent = prevText;
      el.hidden = prevHidden;
    });
  } else if (name === 'mockToast') {
    const el = document.getElementById('modelToast');
    if (!el) return;
    const prevText = el.textContent;
    const prevHidden = el.hidden;
    el.textContent = arg;
    el.hidden = false;
    el.classList.remove('is-fading');
    activeDemoTeardowns.push(() => {
      el.textContent = prevText;
      el.hidden = prevHidden;
    });
  }
}

export function initOnboarding() {
  const a = loadAppearance();
  if (a.showOnboarding !== true) return null;

  const root = document.getElementById('onboarding');
  const textEl = document.getElementById('onboardingText');
  const progressEl = document.getElementById('onboardingProgress');
  const nextBtn = document.getElementById('onboardingNext');
  const skipBtn = document.getElementById('onboardingSkip');
  const closeBtn = document.getElementById('onboardingClose');
  if (!root || !textEl) return null;

  const CORNERS = ['is-tl', 'is-tr', 'is-bl', 'is-br', 'is-center'];
  let i = 0;
  let busy = false;

  const setCorner = (corner) => {
    CORNERS.forEach((c) => root.classList.remove(c));
    root.classList.add('is-' + corner);
  };

  async function render() {
    if (busy) return;
    busy = true;
    nextBtn.disabled = true;
    skipBtn.disabled = true;

    teardownDemos();

    const step = STEPS[i];

    root.classList.add('is-fading');
    await delay(220);

    await runAction(step.action);
    setCorner(step.corner);
    changeHatEmotion(step.emotion);
    applyHighlight(step.highlight);
    startDemo(step.demo);
    textEl.textContent = step.text;
    progressEl.textContent = `${i + 1} / ${STEPS.length}`;
    nextBtn.textContent = i === STEPS.length - 1 ? 'Готово' : 'Далі →';

    void root.offsetWidth;
    root.classList.remove('is-fading');

    nextBtn.disabled = false;
    skipBtn.disabled = false;
    busy = false;
  }

  const dismiss = async () => {
    teardownDemos();
    clearHighlight();
    await runAction('closeSettings,closeArchive,hideBar');
    root.hidden = true;
    window.dispatchEvent(new CustomEvent('uix:onboarding-end'));
    try {
      await saveAppearance({ showOnboarding: false });
    } catch {}
  };

  nextBtn.addEventListener('click', async () => {
    if (busy) return;
    if (i < STEPS.length - 1) {
      i++;
      await render();
    } else {
      dismiss();
    }
  });
  skipBtn.addEventListener('click', dismiss);
  closeBtn.addEventListener('click', dismiss);

  root.hidden = false;
  window.dispatchEvent(new CustomEvent('uix:onboarding-start'));
  render();
}

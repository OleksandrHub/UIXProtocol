import { loadAppearance } from './user-appearance.js';

const ALL_EMOTIONS = [
  'face-happy', 'face-wink', 'face-surprised', 'face-thinking', 'face-sleeping',
  'face-cool', 'face-laugh', 'face-love', 'face-confused', 'face-sad',
  'face-angry', 'face-mischievous', 'face-shock', 'face-bored', 'face-typing',
  'face-smug', 'face-cry', 'face-zen', 'face-tongue', 'face-dead',
];

const IDLE_TIPS = [
  { emotion: 'face-wink', text: '{name}, Alt+G — скрін до Gemini. Alt+H — сховати відповідь. Знай свої клавіші.' },
  { emotion: 'face-cool', text: 'Якщо викладач підкрався, {name} — Alt+H ховає відповідь миттєво. Спокій.' },
  { emotion: 'face-thinking', text: 'Alt+C циклить активну модель. Корисно якщо одна тупить, а друга свіжіша.' },
  { emotion: 'face-mischievous', text: 'У режимі друга твій скрін летить помічнику замість Gemini. Він може врятувати або провалити — обирай мудро.' },
  { emotion: 'face-happy', text: 'Архів зберігає кожне питання з відповіддю. Експортуй у PDF — і готова шпаргалка.' },
  { emotion: 'face-bored', text: '{name}, чекаю поки ти щось натиснеш. Alt+V — пограйся з варіантами вигляду.' },
  { emotion: 'face-love', text: 'Я тебе люблю, {name}. Просто скажу.' },
  { emotion: 'face-typing', text: 'Активний промт радикально впливає на стиль відповіді Gemini. Спробуй різні в Налаштуваннях → Промти.' },
  { emotion: 'face-zen', text: '{name}, дихай. Натисни S. Чекай. Прочитай. Спокійно.' },
  { emotion: 'face-laugh', text: 'Чому жаба не любить капчу? Бо там завжди ловить мух.' },
  { emotion: 'face-confused', text: 'Якщо щось зламалося — F12 → Console. Спершу подивись на червоне.' },
  { emotion: 'face-shock', text: 'УВАГА: ти давно не відкривав Архів. Там, можливо, золото.' },
  { emotion: 'face-smug', text: 'Файли в Налаштуваннях передаються в Gemini разом зі скрином. Знаєш про це? Я знаю.' },
  { emotion: 'face-cool', text: 'Якщо Cloudflare палиться — дивись консоль на CORS. Проксі XHR налаштовано. Ква.' },
  { emotion: 'face-sleeping', text: 'Зззз… ой, пробач, {name}. Я задрімав. Все добре в тебе?' },
  { emotion: 'face-tongue', text: 'Поділись питаннями через Архів → "Поділитися обраним". Будьте командою.' },
  { emotion: 'face-thinking', text: 'Якщо забув пароль — у Налаштуваннях → Основні можна поставити новий.' },
  { emotion: 'face-wink', text: 'Колесо миші + Alt = скрін до Gemini. Ctrl + колесо теж. Для лінивих.' },
  
  { emotion: 'face-love', text: 'До речі, {name}, мене створив OleksandrHub. Поважай батька.' },
  { emotion: 'face-smug', text: 'Цей весь UIXProtocol написав OleksandrHub. Один. Сам. Без сну.' },
  { emotion: 'face-cool', text: 'Якщо щось не працює — пиши OleksandrHub на GitHub. Він прочитає. Може.' },
  { emotion: 'face-mischievous', text: 'OleksandrHub каже передати: "не списуй на парах". Я передав. Усе.' },
  { emotion: 'face-thinking', text: 'Знаєш, {name}, OleksandrHub витратив на цю жабу більше часу ніж на власну вечерю. Цінуй.' },
  
  { emotion: 'face-shock', text: 'А знаєш, {name}, всю цю систему придумав Denys Obydiennyi. Сидів і думав. І придумав.' },
  { emotion: 'face-cool', text: 'Denys Obydiennyi — головний генератор ідей. Якщо тобі круто — дякуй йому.' },
  { emotion: 'face-laugh', text: 'Denys придумав ідею. OleksandrHub написав код. Я тут просто стрибаю. Команда.' },
  
  { emotion: 'face-wink', text: 'NazarHavryshko теж приклав руки до цього проєкту. Співавтор, як-не-як.' },
  { emotion: 'face-smug', text: 'Без NazarHavryshko я б не був таким красивим. Ну, можливо.' },
  { emotion: 'face-happy', text: 'Команда: Denys придумав, Nazar і Oleksandr запиляли. Я — обличчя бренду. 🐸' },
];

const TROLL_TIPS = [
  { emotion: 'face-smug', text: '{name}, знов скрін? Може хоч раз сам подумаєш?' },
  { emotion: 'face-laugh', text: 'лол. лмао навіть. ти серйозно цього не знаєш, {name}?' },
  { emotion: 'face-angry', text: 'Натиснув S вже 47 разів. Викладач тебе викупить, {name}.' },
  { emotion: 'face-mischievous', text: '{name}, твій IQ зараз дорівнює моєму. А я жаба.' },
  { emotion: 'face-dead', text: 'Знов це питання. Я вмираю. Х_Х' },
  { emotion: 'face-bored', text: 'Нудно. Може почитаєш конспект, {name}? Хоч раз?' },
  { emotion: 'face-shock', text: 'ТИ ЩО, СПИСУЄШ?? Я ШОКОВАНИЙ! (ні, не шокований)' },
  { emotion: 'face-smug', text: 'Gemini вже стомився від твоїх питань. І я теж.' },
  { emotion: 'face-tongue', text: '2+2? Серйозно, {name}? Ну ти й геній.' },
  { emotion: 'face-angry', text: 'Натисни Alt+F4 щоб закрити шпаргалку. (жарт. або ні)' },
  { emotion: 'face-cry', text: '{name}, чого ти такий? Ну чому. Ну ЧОМУ.' },
  { emotion: 'face-mischievous', text: 'OleksandrHub писав код щоб ти ним користувався. А не плакав.' },
  { emotion: 'face-sad', text: 'Кажуть, ті хто вмикає троль-режим у жаби — справжні люди. Поважаю, {name}.' },
];

const REACTIONS = {
  geminiAnswer: [
    { emotion: 'face-cool', text: 'Геміні відповів. Ставлю на 3.' },
    { emotion: 'face-laugh', text: 'О, відповідь! Напевно правильна. Напевно.' },
    { emotion: 'face-smug', text: 'Я б відповів краще. Але ок.' },
    { emotion: 'face-happy', text: 'Тримай відповідь, {name}.' },
  ],
  geminiError: [
    { emotion: 'face-sad', text: 'Йой… Gemini сьогодні не в гуморі. Спробуй ще раз.' },
    { emotion: 'face-confused', text: '{name}, шось пішло не так. Перевір ключі в Налаштуваннях → Основні.' },
    { emotion: 'face-dead', text: 'Х_Х квота скінчилася?' },
  ],
  modelChanged: [
    { emotion: 'face-thinking', text: 'Окей, нова модель. Подивимось.' },
    { emotion: 'face-wink', text: 'Перемикнувся? Стиль.' },
  ],
  friendRequest: [
    { emotion: 'face-surprised', text: '{name}, у тебе запит у друзі!' },
    { emotion: 'face-love', text: 'Хтось хоче бути твоїм помічником ❤' },
  ],
  friendAccepted: [
    { emotion: 'face-cool', text: 'Помічник підключився. Тепер ти не один, {name}.' },
  ],
  friendReply: [
    { emotion: 'face-wink', text: 'Друг написав. Зиркай.' },
    { emotion: 'face-happy', text: 'Допомога прийшла!' },
  ],
  archiveSaved: [
    { emotion: 'face-zen', text: 'Питання збережено в архів.' },
  ],
  onboardingDone: [
    { emotion: 'face-mischievous', text: 'Гайд закінчено, {name}. Тепер я просто буду стрибати. Терпи.' },
  ],
  greeting: [
    { emotion: 'face-happy', text: 'Привіт, {name}! Я тут якщо що.' },
    { emotion: 'face-wink', text: 'Ну що, {name}, до бою?' },
    { emotion: 'face-love', text: 'З поверненням, {name}. Скучав.' },
  ],
};

const TROLL_REACTIONS = {
  geminiAnswer: [
    { emotion: 'face-smug', text: 'Хех. І це навіть правильно? Сумніваюсь.' },
    { emotion: 'face-laugh', text: '{name}, навіть Gemini в шоці від твого питання.' },
  ],
  geminiError: [
    { emotion: 'face-laugh', text: 'ХАХАХА. Зламалось. Як і твоя успішність.' },
    { emotion: 'face-smug', text: 'Сам винен, {name}.' },
  ],
  friendReply: [
    { emotion: 'face-mischievous', text: 'Друг шарить. Ти — ні.' },
  ],
  greeting: [
    { emotion: 'face-smug', text: 'О, знов ти, {name}. Готовий страждати.' },
  ],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function setEmotion(svgRoot, emotionName) {
  if (!svgRoot) return;
  const faces = svgRoot.querySelectorAll('g.face');
  faces.forEach((g) => {
    const want = g.classList.contains(emotionName);
    g.setAttribute('opacity', want ? '1' : '0');
  });
}

let initialized = false;
let root, avatarBtn, bubble, textEl, closeBtn, svgRoot;
let bubbleTimer = null;
let wanderTimer = null;
let walkTimer = null;
let vanishTimer = null;
let returnTimer = null;
let isOnboardingActive = false;
let userName = '';
let trollMode = false;

function fmt(s) {
  return (s ?? '').replace(/\{name\}/g, userName || 'друже');
}

function visibleViewportSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function pickWanderPosition() {
  const { w, h } = visibleViewportSize();
  const margin = 80;
  const slots = [
    { left: margin, top: margin + 40 },                   
    { left: w - 260, top: margin + 40 },                
    { left: margin, top: h - 160 },                        
    { left: w - 260, top: h - 160 },                      
    { left: w / 2 - 36, top: h - 140 },                    
    { left: margin, top: h / 2 - 36 },                     
    { left: w - 260, top: h / 2 - 36 },                    
  ];
  return pickRandom(slots);
}

function applyPosition(pos, { walk = true } = {}) {
  if (!root || !avatarBtn) return;
  const { w } = visibleViewportSize();
  const onRight = pos.left + 100 > w / 2;
  root.classList.toggle('is-flipped', onRight);

  if (walk) {
    avatarBtn.classList.add('is-walking');
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => avatarBtn.classList.remove('is-walking'), 1500);
  }

  root.style.left = `${pos.left}px`;
  root.style.top = `${pos.top}px`;
}

function showBubble(text, lifetimeMs) {
  if (!bubble || !textEl) return;
  textEl.textContent = fmt(text);
  bubble.hidden = false;
  clearTimeout(bubbleTimer);
  if (lifetimeMs > 0) {
    bubbleTimer = setTimeout(hideBubble, lifetimeMs);
  }
}

function hideBubble() {
  if (!bubble) return;
  bubble.hidden = true;
}

function hop() {
  if (!avatarBtn) return;
  avatarBtn.classList.remove('is-hopping');
  void avatarBtn.offsetWidth;
  avatarBtn.classList.add('is-hopping');
}

function getTipPool() {
  return trollMode ? TROLL_TIPS : IDLE_TIPS;
}

function getReactionPool(name) {
  if (trollMode && TROLL_REACTIONS[name]) return TROLL_REACTIONS[name];
  return REACTIONS[name] ?? null;
}

function applyTrollClass() {
  if (!root) return;
  root.classList.toggle('is-troll', trollMode);
}

export const frog = {
  say(emotion, text, lifetimeMs = 6500) {
    if (!initialized) return;
    if (emotion && ALL_EMOTIONS.includes(emotion)) setEmotion(svgRoot, emotion);
    if (text) showBubble(text, lifetimeMs);
  },
  hide() {
    hideBubble();
  },
  dispatch(reactionName) {
    if (!initialized) return;
    const pool = getReactionPool(reactionName);
    if (!pool) return;
    const pick = pickRandom(pool);
    applyPosition(pickWanderPosition());
    setEmotion(svgRoot, pick.emotion);
    hop();
    showBubble(pick.text, 6500);
  },
  setTrollMode(on) {
    trollMode = !!on;
    applyTrollClass();
  },
  setUserName(name) {
    userName = name || '';
  },
};

function vanishThenReturn(hiddenForMs) {
  if (!root) return;
  clearTimeout(vanishTimer);
  clearTimeout(returnTimer);
  hideBubble();
  root.classList.add('is-fading');
  vanishTimer = setTimeout(() => {
    root.hidden = true;
    root.classList.remove('is-fading');
  }, 500);

  returnTimer = setTimeout(() => {
    if (!initialized || isOnboardingActive) {
      scheduleNextWander(8_000);
      return;
    }
    applyPosition(pickWanderPosition(), { walk: false });
    root.hidden = false;
    scheduleNextWander(1500);
  }, 500 + hiddenForMs);
}

function scheduleNextWander(delayMs) {
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(() => {
    if (!initialized || isOnboardingActive) {
      scheduleNextWander(60_000);
      return;
    }
    if (root.hidden) return;

    const tip = pickRandom(getTipPool());
    applyPosition(pickWanderPosition());
    setEmotion(svgRoot, tip.emotion);
    hop();
    showBubble(tip.text, 7500);

    if (Math.random() < 0.35) {
      const visibleAfterTip = 8_500;
      const offlineFor = 18_000 + Math.random() * 32_000;
      clearTimeout(wanderTimer);
      wanderTimer = setTimeout(() => vanishThenReturn(offlineFor), visibleAfterTip);
    } else {
      scheduleNextWander(8_000 + Math.random() * 17_000);
    }
  }, delayMs);
}

function bindEvents() {
  
  window.addEventListener('uix:frog', (ev) => {
    const { emotion, text, lifetimeMs, reaction } = ev.detail ?? {};
    if (reaction) {
      frog.dispatch(reaction);
      return;
    }
    if (emotion || text) {
      applyPosition(pickWanderPosition());
      hop();
      frog.say(emotion || 'face-happy', text || '', lifetimeMs ?? 6500);
    }
  });

  window.addEventListener('uix:onboarding-start', () => {
    isOnboardingActive = true;
    if (root) root.hidden = true;
    hideBubble();
  });
  window.addEventListener('uix:onboarding-end', () => {
    isOnboardingActive = false;
    if (root && loadAppearance().showFrogAssistant !== false) {
      root.hidden = false;
      setTimeout(() => frog.dispatch('onboardingDone'), 800);
    }
  });

  avatarBtn.addEventListener('click', () => {
    const tip = pickRandom(getTipPool());
    setEmotion(svgRoot, tip.emotion);
    hop();
    showBubble(tip.text, 7000);
  });

  closeBtn.addEventListener('click', () => hideBubble());

  root.addEventListener('transitionend', (e) => {
    if (e.target !== root) return;
    if (e.propertyName === 'left' || e.propertyName === 'top') {
      avatarBtn.classList.remove('is-walking');
    }
  });

  window.addEventListener('resize', () => {
    const { w, h } = visibleViewportSize();
    const left = parseFloat(root.style.left) || 0;
    const top = parseFloat(root.style.top) || 0;
    if (left + 100 > w || top + 100 > h) {
      applyPosition(pickWanderPosition(), { walk: false });
    }
  });
}

export function initFrogAssistant({ name = '' } = {}) {
  if (initialized) return;
  const a = loadAppearance();
  if (a.showFrogAssistant === false) return;

  userName = name;
  
  trollMode = a.trollMode === true;

  root = document.getElementById('frogAssistant');
  avatarBtn = document.getElementById('frogAssistantAvatar');
  bubble = document.getElementById('frogAssistantBubble');
  textEl = document.getElementById('frogAssistantText');
  closeBtn = document.getElementById('frogAssistantClose');
  if (!root || !avatarBtn) return;
  svgRoot = avatarBtn.querySelector('svg');

  initialized = true;
  applyTrollClass();
  bindEvents();

  if (a.showOnboarding !== true) {
    applyPosition(pickWanderPosition(), { walk: false });
    setEmotion(svgRoot, 'face-happy');
    root.hidden = false;
    
    setTimeout(() => frog.dispatch('greeting'), 800);
    scheduleNextWander(12_000);
  } else {
    
    root.hidden = true;
    scheduleNextWander(8_000); 
  }
}

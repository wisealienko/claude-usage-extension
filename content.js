// ===== ID организации: сначала cookie, иначе список организаций =====
let cachedOrg = null;
async function getOrgId() {
  const m = document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/);
  if (m) return m[1];
  if (!cachedOrg) {
    const orgs = await fetch('/api/organizations').then(r => r.json());
    cachedOrg = orgs[0] && orgs[0].uuid;
  }
  return cachedOrg;
}

// ===== Внешний вид =====
// Цвет полоски: 0% — синий, 100% — фиолетовый
function color(p) {
  const hue = 217 + (275 - 217) * Math.min(p, 100) / 100;
  return `hsl(${hue}, 85%, 60%)`;
}

const SESSION_FMT = { hour: '2-digit', minute: '2-digit' };
const WEEK_FMT = { weekday: 'short', hour: '2-digit', minute: '2-digit' };
// Время сброса округляем до ближайшей минуты: сервер присылает его с долями секунды
const fmtTime = (iso, opts) =>
  new Date(Math.round(new Date(iso) / 60000) * 60000).toLocaleString('ru-RU', opts);

function bar(p, extra) {
  return `<div style="height:4px;background:rgba(255,255,255,.15);border-radius:2px;${extra}">
    <div style="height:100%;width:${Math.min(p, 100)}%;background:${color(p)};border-radius:2px"></div></div>`;
}

function refreshSpan(t) {
  return `<span class="cu-refresh" style="opacity:.6;cursor:pointer;white-space:nowrap" title="Обновить">↻ ${t}</span>`;
}

// Свободный вид: подпись и время сверху, полоска снизу
function rowBlock(label, p, t, tip = '') {
  return `<div style="margin:4px 0" title="${tip}">
    <div style="display:flex;justify-content:space-between;gap:12px">
      <span>${label} ${Math.round(p)}%</span>${refreshSpan(t)}
    </div>${bar(p, 'margin-top:3px')}</div>`;
}

// Закреплённый вид: всё в одну строку
function rowInline(label, p, t, tip = '') {
  return `<div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0" title="${tip}">
    <span style="white-space:nowrap">${label} ${Math.round(p)}%</span>
    ${bar(p, 'flex:1;min-width:30px')}
    ${refreshSpan(t)}</div>`;
}

// ===== Размер чата: оценка токенов по тексту =====
// Предел контекста в чате по модели (справка Anthropic, платные тарифы).
// Модели, которых нет в списке, — 200K.
const CONTEXT_BY_MODEL = [
  [/opus-5|sonnet-5|haiku-5|fable-5-1/, 1000000],
  [/opus-4-[678]|sonnet-4-6|fable-5/, 500000],
];
function contextLimit(model = '') {
  for (const [re, n] of CONTEXT_BY_MODEL) if (re.test(model)) return n;
  return 200000;
}
const IMAGE_TOKENS = 1600;     // грубая оценка одной картинки

// Русские буквы / 1,5 + остальные символы / 3,1
function est(s) {
  const ru = (s.match(/[а-яё]/gi) || []).length;
  return ru / 1.5 + (s.length - ru) / 3.1;
}

// Из результата действия берём только заголовки и тексты
function pick(v) {
  if (Array.isArray(v)) return v.map(pick).join('\n');
  if (v && typeof v === 'object') return [v.title, v.text, pick(v.content)].filter(Boolean).join('\n');
  return typeof v === 'string' ? v : '';
}

let chatData = null; // { total, text, att, images } или null вне чата

let chatLoading = false; // идёт пересчёт после перехода в другой чат

async function updateChat(orgId) {
  const path = location.pathname;
  const m = path.match(/\/chat\/([0-9a-f-]{36})/);
  if (!m) { chatData = null; return; }
  const d = await fetch(`/api/organizations/${orgId}/chat_conversations/${m[1]}` +
    '?tree=True&rendering_mode=messages&render_all_tools=true').then(r => r.json());

  // Только текущая ветка: от последнего сообщения назад по родителям
  const byId = Object.fromEntries((d.chat_messages || []).map(x => [x.uuid, x]));
  let text = 0, att = 0, images = 0;
  for (let msg = byId[d.current_leaf_message_uuid]; msg; msg = byId[msg.parent_message_uuid]) {
    for (const c of msg.content || []) {
      if (c.type === 'text') text += est(c.text || '');
      else if (c.type === 'thinking') text += est(c.thinking || '');
      else if (c.type === 'tool_use') text += est(JSON.stringify(c.input || {}));
      else if (c.type === 'tool_result') text += est(pick(c.content));
      else if (c.type === 'image') images++;
    }
    for (const a of msg.attachments || []) att += est(a.extracted_content || '');
  }
  if (location.pathname !== path) return; // пока считали, перешли в другой чат
  chatData = { text, att, images, total: text + att + images * IMAGE_TOKENS,
               model: d.model || '?', limit: contextLimit(d.model) };
}

const kTok = x => x >= 1e6 ? +(x / 1e6).toFixed(1) + 'M' : Math.round(x / 1000) + 'K';

// ===== Плашка =====
const box = document.createElement('div');
box.style.cssText = 'position:fixed;z-index:99999;box-sizing:border-box;' +
  'padding:6px 10px;border-radius:8px;background:rgba(30,30,30,.9);color:#eee;' +
  'font:12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);user-select:none';
box.textContent = 'Claude Usage: загрузка…';
document.body.appendChild(box);

let lastData = null;
let layout = 'float'; // как плашка нарисована сейчас: 'float' или 'dock'

function render() {
  if (!lastData) return;
  const d = lastData;
  const s = [d.five_hour.utilization, fmtTime(d.five_hour.resets_at, SESSION_FMT)];
  const w = [d.seven_day.utilization, fmtTime(d.seven_day.resets_at, WEEK_FMT)];
  let c = null;
  if (chatLoading) {
    c = [0, '…', 'Считаю размер чата…'];
  } else if (chatData) {
    const ch = chatData;
    c = [ch.total / ch.limit * 100, `~${kTok(ch.total)} / ${kTok(ch.limit)}`,
      `Модель ${ch.model}, предел ${kTok(ch.limit)}. Оценка ±20–30%. Переписка ~${kTok(ch.text)}, вложения ~${kTok(ch.att)}, ` +
      `картинки ${ch.images} шт. ~${kTok(ch.images * IMAGE_TOKENS)}`];
  }
  box.innerHTML = layout === 'dock'
    ? `<div style="display:flex;gap:20px;align-items:center">${rowInline('Сессия', ...s)}${rowInline('Неделя', ...w)}${c ? rowInline('Чат', ...c) : ''}</div>`
    : rowBlock('Сессия', ...s) + rowBlock('Неделя', ...w) + (c ? rowBlock('Чат', ...c) : '');
}

// ===== Загрузка данных =====
async function update() {
  try {
    const id = await getOrgId();
    if (!id) throw new Error('нет ID организации');
    lastData = await fetch(`/api/organizations/${id}/usage`).then(r => r.json());
    try { await updateChat(id); } catch (e) { chatData = null; console.log('Claude Usage (чат):', e); }
    render();
  } catch (e) {
    lastData = null;
    box.textContent = 'Claude Usage: ошибка';
    console.log('Claude Usage:', e);
  }
}

// ===== Режим: закреплена -> свободная -> скрыта -> по кругу =====
const MODE_KEY = 'claude-usage-mode';
const NEXT_MODE = { dock: 'float', float: 'hidden', hidden: 'dock' };
let mode = 'dock';
try {
  mode = localStorage.getItem(MODE_KEY) ||
         (localStorage.getItem('claude-usage-hidden') === '1' ? 'hidden' : 'dock');
} catch (e) {}
if (!NEXT_MODE[mode]) mode = 'dock';

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'toggle') return;
  mode = NEXT_MODE[mode];
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  if (mode !== 'hidden') update(); // показали — сразу обновляем цифры
});

// ===== Свободный вид: место и перетаскивание =====
const POS_KEY = 'claude-usage-pos';

function place(left, top) {
  const maxL = window.innerWidth - box.offsetWidth;
  const maxT = window.innerHeight - box.offsetHeight;
  box.style.left = Math.max(0, Math.min(maxL, left)) + 'px';
  box.style.top = Math.max(0, Math.min(maxT, top)) + 'px';
  box.style.right = 'auto';
  box.style.bottom = 'auto';
}

function applyFloat() {
  box.style.width = '210px';
  box.style.cursor = 'move'; box.style.zIndex = '99999';
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) {}
  if (pos && Number.isFinite(pos.left)) {
    place(pos.left, pos.top);
  } else {
    box.style.left = 'auto'; box.style.top = 'auto';
    box.style.right = '12px'; box.style.bottom = '12px';
  }
}

let downX = 0, downY = 0;
box.addEventListener('mousedown', e => {
  downX = e.clientX; downY = e.clientY;
  if (layout !== 'float') return; // закреплённую не двигаем
  const r = box.getBoundingClientRect();
  const dx = e.clientX - r.left, dy = e.clientY - r.top;
  const move = ev => place(ev.clientX - dx, ev.clientY - dy);
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (box.style.left && box.style.left !== 'auto') {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          left: parseInt(box.style.left), top: parseInt(box.style.top)
        }));
      } catch (e) {}
    }
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
});

// ===== Обновление по клику на ↻ (но не после перетаскивания) =====
box.addEventListener('click', e => {
  if (!e.target.closest('.cu-refresh')) return;
  if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) return;
  box.style.opacity = '.5';
  update();
  setTimeout(() => { box.style.opacity = ''; }, 500);
});

// ===== Закреплённый вид: поиск рамки поля ввода =====
let frame = null;
let lastFail = -Infinity;

function findFrame() {
  if (frame && frame.isConnected) return frame;
  let el = document.querySelector('[data-testid="chat-input"]');
  for (let i = 0; i < 10 && el; i++) {
    const s = getComputedStyle(el);
    if (parseFloat(s.borderTopLeftRadius) > 0 && s.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return (frame = el);
    }
    el = el.parentElement;
  }
  return (frame = null);
}

// Переход в другой чат: сайт не перезагружает страницу, меняется только адрес
let lastPath = location.pathname;

async function refreshChat() {
  const onChat = /\/chat\/[0-9a-f-]{36}/.test(location.pathname);
  chatLoading = onChat;
  if (!onChat) chatData = null;
  render();
  if (!onChat) return;
  const path = location.pathname;
  try { await updateChat(await getOrgId()); }
  catch (e) { chatData = null; console.log('Claude Usage (чат):', e); }
  if (location.pathname === path) { chatLoading = false; render(); }
}

// Каждый кадр: прячем, закрепляем над полем ввода или оставляем свободной
function tick(now) {
  requestAnimationFrame(tick);

  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    if (mode !== 'hidden') refreshChat();
  }

  if (mode === 'hidden') { box.style.display = 'none'; return; }
  box.style.display = '';

  let f = null;
  if (mode === 'dock') {
    if (frame && frame.isConnected) f = frame;
    else if (now - lastFail > 500) {   // нет поля — ищем не чаще раза в полсекунды
      f = findFrame();
      if (!f) lastFail = now;
    }
  }
  const r = f && f.getBoundingClientRect();
  const want = r && r.width > 0 ? 'dock' : 'float';

  if (want !== layout) {
    layout = want;
    if (layout === 'float') {
      applyFloat();
    } else {
      box.style.right = 'auto'; box.style.bottom = 'auto';
      box.style.cursor = 'default'; box.style.zIndex = '1';
    }
    render();
  }

  if (layout === 'dock') {
    box.style.left = r.left + 'px';
    box.style.width = r.width + 'px';
    box.style.top = (r.top - box.offsetHeight - 6) + 'px';
  }
}

// ===== Старт =====
applyFloat();
if (mode !== 'hidden') update();
setInterval(() => { if (mode !== 'hidden') update(); }, 60 * 1000);
requestAnimationFrame(tick);

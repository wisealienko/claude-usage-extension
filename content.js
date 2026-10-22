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
const fmtTime = (iso, opts) => new Date(iso).toLocaleString('ru-RU', opts);

function bar(p, extra) {
  return `<div style="height:4px;background:rgba(255,255,255,.15);border-radius:2px;${extra}">
    <div style="height:100%;width:${Math.min(p, 100)}%;background:${color(p)};border-radius:2px"></div></div>`;
}

function refreshSpan(t) {
  return `<span class="cu-refresh" style="opacity:.6;cursor:pointer;white-space:nowrap" title="Обновить">↻ ${t}</span>`;
}

// Свободный вид: подпись и время сверху, полоска снизу
function rowBlock(label, p, t) {
  return `<div style="margin:4px 0">
    <div style="display:flex;justify-content:space-between;gap:12px">
      <span>${label} ${Math.round(p)}%</span>${refreshSpan(t)}
    </div>${bar(p, 'margin-top:3px')}</div>`;
}

// Закреплённый вид: всё в одну строку
function rowInline(label, p, t) {
  return `<div style="flex:1;display:flex;align-items:center;gap:8px;min-width:0">
    <span style="white-space:nowrap">${label} ${Math.round(p)}%</span>
    ${bar(p, 'flex:1;min-width:30px')}
    ${refreshSpan(t)}</div>`;
}

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
  box.innerHTML = layout === 'dock'
    ? `<div style="display:flex;gap:20px;align-items:center">${rowInline('Сессия', ...s)}${rowInline('Неделя', ...w)}</div>`
    : rowBlock('Сессия', ...s) + rowBlock('Неделя', ...w);
}

// ===== Загрузка данных =====
async function update() {
  try {
    const id = await getOrgId();
    if (!id) throw new Error('нет ID организации');
    lastData = await fetch(`/api/organizations/${id}/usage`).then(r => r.json());
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

// Каждый кадр: прячем, закрепляем над полем ввода или оставляем свободной
function tick(now) {
  requestAnimationFrame(tick);

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

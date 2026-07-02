'use strict';

/* ===== Firebase ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCvHuf6pHO6eVMOnU-qnLll0Du6kjUIlSc",
  authDomain: "baseball-stats-79cd3.firebaseapp.com",
  databaseURL: "https://baseball-stats-79cd3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "baseball-stats-79cd3",
  storageBucket: "baseball-stats-79cd3.firebasestorage.app",
  messagingSenderId: "157498240597",
  appId: "1:157498240597:web:aaed0734c47966ef946edc"
};
firebase.initializeApp(firebaseConfig);
const DATA_REF = firebase.database().ref('teamData');

/* ===== Storage ===== */
const SCHEMA_VERSION = 1;

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, teamName: '自チーム', seasons: [], games: [], players: [], battingRecords: [], pitchingRecords: [], fieldingRecords: [], leagueTeams: [], leagueResults: [], practiceSessions: [], practiceBattingRecords: [], practicePitchingRecords: [] };
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

function migrate(data) {
  if (!data.schemaVersion) data.schemaVersion = SCHEMA_VERSION;
  data.seasons = toArray(data.seasons || []);
  data.games = toArray(data.games);
  data.players = toArray(data.players);
  data.battingRecords = toArray(data.battingRecords);
  data.pitchingRecords = toArray(data.pitchingRecords);
  data.fieldingRecords = toArray(data.fieldingRecords);
  data.leagueTeams = toArray(data.leagueTeams);
  data.leagueResults = toArray(data.leagueResults);
  data.practiceSessions = toArray(data.practiceSessions);
  data.practiceBattingRecords = toArray(data.practiceBattingRecords);
  data.practicePitchingRecords = toArray(data.practicePitchingRecords);
  if (data.teamName === undefined || data.teamName === null) data.teamName = '自チーム';
  data.players.forEach(p => {
    if (!p.positions) {
      p.positions = p.position ? [p.position] : [];
      delete p.position;
    }
    if (!p.grade) p.grade = null;
    if (p.furigana === undefined) p.furigana = '';
  });
  // シーズンが未作成なら現在年度で自動作成し既存試合を割り当て
  if (!data.seasons.length) {
    const year = new Date().getFullYear();
    const defaultSeason = { id: newId('s'), year, name: `${year}年度` };
    data.seasons.push(defaultSeason);
    data.games.forEach(g => { g.seasonId = defaultSeason.id; });
  }
  data.games.forEach(g => {
    if (!g.gameType) g.gameType = 'spring';
    if (g.memo === undefined) g.memo = '';
    if (!g.seasonId) g.seasonId = data.seasons[0].id;
    // 旧バージョンの表記ゆれを正規化（勝利/敗北/引き分け → 勝/負/引分）
    const norm = { '勝利': '勝', '敗北': '負', '引き分け': '引分' }[g.result];
    if (norm) g.result = norm;
  });
  data.battingRecords.forEach(r => {
    if (r.appeared === undefined) r.appeared = false;
    if (r.battingOrder === undefined) r.battingOrder = null;
    if (r.replaces === undefined) r.replaces = null;
  });
  return data;
}

function gameTypeLabel(type) {
  return { spring: '春リーグ', fall: '秋リーグ', practice: '練習試合', other: 'その他' }[type] || '−';
}

function venueLabel(game) {
  // 旧データは homeAway しか持たないためフォールバック表示
  if (game.venue) return game.venue;
  if (game.homeAway === 'home') return 'ホーム';
  if (game.homeAway === 'away') return 'アウェイ';
  return '−';
}

/* ===== オフライン対応 =====
 * 全データをlocalStorageにミラーし、オフライン中の変更はdirtyフラグで管理。
 * 再接続時（またはFirebaseのvalueイベント受信時）にローカルの変更を再送する。
 */
const LOCAL_STATE_KEY = 'jyunkoLocalState';
const LOCAL_DIRTY_KEY = 'jyunkoLocalDirty';

function mirrorToLocal(state) {
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state)); } catch (e) { /* 容量超過時は無視 */ }
}

function saveData(state) {
  mirrorToLocal(state);
  localStorage.setItem(LOCAL_DIRTY_KEY, '1');
  DATA_REF.set(state)
    .then(() => localStorage.removeItem(LOCAL_DIRTY_KEY))
    .catch(() => { /* オフライン時はdirtyのまま保持し再接続時に同期 */ });
}

function flushLocalChanges() {
  if (!localStorage.getItem(LOCAL_DIRTY_KEY)) return;
  DATA_REF.set(state)
    .then(() => { localStorage.removeItem(LOCAL_DIRTY_KEY); showToast('オフライン中の変更を同期しました ✓'); })
    .catch(() => {});
}

function updateOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (navigator.onLine) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.className = 'offline-banner';
    banner.textContent = '📡 オフライン — 変更は再接続時に自動同期されます';
    document.body.appendChild(banner);
  }
}

let state = freshState();
const openHistoryCards = new Set();

/* ===== Season Management ===== */
let currentSeasonId = localStorage.getItem('currentSeasonId') || null;

function getCurrentSeason() {
  if (currentSeasonId && state.seasons.find(s => s.id === currentSeasonId)) {
    return state.seasons.find(s => s.id === currentSeasonId);
  }
  const sorted = [...state.seasons].sort((a, b) => b.year - a.year);
  return sorted[0] || null;
}

function setCurrentSeason(id) {
  currentSeasonId = id;
  localStorage.setItem('currentSeasonId', id);
  openHistoryCards.clear();
  updateSeasonHeader();
  renderAll();
}

function updateSeasonHeader() {
  const s = getCurrentSeason();
  const el = document.getElementById('season-name-display');
  if (el) el.textContent = s ? s.name : 'シーズン未設定';
}

function showSeasonModal() {
  const body = document.getElementById('season-modal-body');
  body.innerHTML = '';
  const current = getCurrentSeason();
  const sorted = [...state.seasons].sort((a, b) => b.year - a.year);
  if (!sorted.length) {
    body.appendChild(emptyState('📅', 'シーズンがありません', ''));
    return;
  }
  sorted.forEach(s => {
    const row = document.createElement('div');
    row.className = 'season-row' + (s.id === current?.id ? ' season-row-active' : '');
    const gameCount = state.games.filter(g => g.seasonId === s.id).length;
    const info = document.createElement('div');
    info.className = 'season-row-info';
    const name = document.createElement('span'); name.className = 'season-row-name'; name.textContent = s.name;
    const count = document.createElement('span'); count.className = 'season-row-count'; count.textContent = `${gameCount}試合`;
    info.append(name, count);
    row.appendChild(info);
    if (s.id === current?.id) {
      const badge = document.createElement('span'); badge.className = 'season-current-badge'; badge.textContent = '現在';
      row.appendChild(badge);
    } else {
      const btn = document.createElement('button'); btn.className = 'btn btn-ghost btn-sm'; btn.textContent = '切り替え';
      btn.addEventListener('click', () => { setCurrentSeason(s.id); document.getElementById('season-modal-overlay').style.display = 'none'; });
      row.appendChild(btn);
    }
    body.appendChild(row);
  });
  document.getElementById('season-modal-overlay').style.display = 'flex';
}

function showNewSeasonModal() {
  const nextYear = (getCurrentSeason()?.year ?? new Date().getFullYear()) + 1;
  document.getElementById('new-season-year').value = nextYear;
  document.getElementById('new-season-name').value = `${nextYear}年度`;
  document.getElementById('new-season-modal-overlay').style.display = 'flex';
  document.getElementById('new-season-year').addEventListener('input', e => {
    document.getElementById('new-season-name').value = `${e.target.value}年度`;
  }, { once: true });
}

function createNewSeason() {
  const year = parseInt(document.getElementById('new-season-year').value);
  const name = document.getElementById('new-season-name').value.trim();
  if (!year || !name) { showToast('年度とシーズン名を入力してください', 'error'); return; }
  if (state.seasons.find(s => s.year === year)) { showToast(`${year}年度のシーズンは既に存在します`, 'error'); return; }
  const s = { id: newId('s'), year, name };
  state.seasons.push(s);
  saveData(state);
  document.getElementById('new-season-modal-overlay').style.display = 'none';
  document.getElementById('season-modal-overlay').style.display = 'none';
  setCurrentSeason(s.id);
  showToast(`${name}を作成しました ✓`);
}

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/* ===== Security ===== */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) Object.assign(e, attrs);
  if (children) {
    if (typeof children === 'string') e.textContent = children;
    else children.forEach(c => c && e.appendChild(c));
  }
  return e;
}

function td(text, cls) {
  const cell = document.createElement('td');
  cell.textContent = text ?? '';
  if (cls) cell.className = cls;
  return cell;
}

/* ===== Toast ===== */
let toastTimer = null;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast toast-' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// 「元に戻す」ボタン付きトースト（約6秒）
function showUndoToast(msg, onUndo) {
  const t = document.getElementById('toast');
  t.textContent = '';
  const span = document.createElement('span'); span.textContent = msg;
  const btn = document.createElement('button'); btn.className = 'toast-undo-btn'; btn.textContent = '元に戻す';
  btn.addEventListener('click', () => {
    clearTimeout(toastTimer);
    t.classList.remove('show');
    t.textContent = '';
    onUndo();
  });
  t.append(span, btn);
  t.className = 'toast toast-info show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 6000);
}

/* ===== Confirm Modal ===== */
function confirmModal(title, body, onConfirm) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  overlay.style.display = 'flex';
  document.getElementById('modal-confirm').onclick = () => { overlay.style.display = 'none'; onConfirm(); };
  document.getElementById('modal-cancel').onclick  = () => { overlay.style.display = 'none'; };
}

/* ===== Tab Navigation ===== */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'stats') renderStatsTab();
  if (name === 'drill') renderDrillTab();
  if (name === 'practice-stats') renderPracticeStats();
  if (name === 'history') renderHistoryTab();
}

/* ===== Sub-tabs ===== */
function initSubtabs() {
  document.querySelectorAll('.subtab-nav').forEach(nav => {
    const group = nav.closest('.stats-subtabs');
    nav.querySelectorAll('.subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b === btn));
        group.querySelectorAll('.subtab-panel').forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
        renderSubtab(btn.dataset.subtab);
      });
    });
  });
}

/* ===== Inning Grid ===== */
function buildInningGrid(containerId) {
  const outer = document.getElementById(containerId);
  outer.innerHTML = '';
  outer.className = '';

  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'inning-scroll-wrap';
  outer.appendChild(scrollWrap);

  const container = document.createElement('div');
  container.className = 'inning-grid';
  scrollWrap.appendChild(container);

  const totalId = containerId + '-total';
  for (let i = 1; i <= 9; i++) {
    const h = document.createElement('div');
    h.className = 'inning-header';
    h.textContent = i;
    container.appendChild(h);
  }
  const th = document.createElement('div');
  th.className = 'inning-header total-header';
  th.textContent = '計';
  container.appendChild(th);

  for (let i = 1; i <= 9; i++) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.max = '99';
    inp.value = '0';
    inp.className = 'inning-input';
    inp.dataset.inning = i;
    inp.addEventListener('input', () => updateTotal(containerId, totalId));
    container.appendChild(inp);
  }
  const total = document.createElement('input');
  total.type = 'number';
  total.id = totalId;
  total.className = 'inning-input total-cell';
  total.readOnly = true;
  total.value = '0';
  container.appendChild(total);
}

function updateTotal(containerId, totalId) {
  const inputs = document.querySelectorAll('#' + containerId + ' input.inning-input:not(.total-cell)');
  const sum = Array.from(inputs).reduce((s, inp) => s + (parseInt(inp.value) || 0), 0);
  document.getElementById(totalId).value = sum;
}

function getInnings(containerId) {
  const inputs = document.querySelectorAll('#' + containerId + ' input.inning-input:not(.total-cell)');
  return Array.from(inputs).map(inp => parseInt(inp.value) || 0);
}

/* ===== INLINE STATS (game registration form) ===== */
let inlineBattingController = null;
let inlinePitchingInputs = null;
let inlinePitchingResultSelect = null;
let inlinePitchingPlayerId = null;
let inlineBattingBuilt = false;
let inlinePitchingList = [];

/* ===== タップ式打撃入力（共通部品） ===== */
const TALLY_OUTCOMES = [
  { key: 'single',     label: '単打',   group: 'hit' },
  { key: 'double',     label: '二塁打', group: 'hit' },
  { key: 'triple',     label: '三塁打', group: 'hit' },
  { key: 'homeRun',    label: '本塁打', group: 'hit' },
  { key: 'walk',       label: '四球',   group: 'ob' },
  { key: 'hitByPitch', label: '死球',   group: 'ob' },
  { key: 'strikeout',  label: '三振',   group: 'out' },
  { key: 'out',        label: '凡退',   group: 'out' },
  { key: 'sacrifice',  label: '犠打',   group: 'etc' },
];
const TALLY_STEPPERS = [
  { key: 'rbi',            label: '打点' },
  { key: 'runs',          label: '得点' },
  { key: 'stolenBases',   label: '盗塁' },
  { key: 'caughtStealing', label: '盗塁死' },
];

function tallyToRecord(t) {
  const singles = t.single || 0, doubles = t.double || 0, triples = t.triple || 0, homeRuns = t.homeRun || 0;
  const hits = singles + doubles + triples + homeRuns;
  const atBats = hits + (t.strikeout || 0) + (t.out || 0);
  return {
    atBats, hits, doubles, triples, homeRuns,
    strikeouts: t.strikeout || 0, walks: t.walk || 0, hitByPitch: t.hitByPitch || 0,
    sacrifices: t.sacrifice || 0, rbi: t.rbi || 0, runs: t.runs || 0,
    stolenBases: t.stolenBases || 0, caughtStealing: t.caughtStealing || 0,
  };
}
function recordToTally(r) {
  const singles = (r.hits || 0) - (r.doubles || 0) - (r.triples || 0) - (r.homeRuns || 0);
  const outs = (r.atBats || 0) - (r.hits || 0) - (r.strikeouts || 0);
  return {
    single: Math.max(0, singles), double: r.doubles || 0, triple: r.triples || 0, homeRun: r.homeRuns || 0,
    walk: r.walks || 0, hitByPitch: r.hitByPitch || 0, strikeout: r.strikeouts || 0, out: Math.max(0, outs),
    sacrifice: r.sacrifices || 0, rbi: r.rbi || 0, runs: r.runs || 0,
    stolenBases: r.stolenBases || 0, caughtStealing: r.caughtStealing || 0, history: [],
  };
}
function tallyHasData(t) {
  return TALLY_OUTCOMES.some(o => (t[o.key] || 0) > 0) || TALLY_STEPPERS.some(s => (t[s.key] || 0) > 0);
}

// 1選手分のタップ式打撃入力カードを構築。
// options.showOrder=true で打順セレクトを表示。
// 戻り値 { card, getOrder, getTally, hasData }
function buildTallyCard(player, existing, options = {}) {
  const t = existing ? recordToTally(existing) : { history: [] };

  const card = document.createElement('div');
  card.className = 'tally-player';

  const head = document.createElement('div');
  head.className = 'tally-head';
  let order = null;
  if (options.showOrder) {
    order = document.createElement('select');
    order.className = 'roster-input tally-order';
    [['', '—'], ...Array.from({ length: 9 }, (_, i) => [String(i + 1), String(i + 1)]), ['10', '途中']].forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; order.appendChild(o);
    });
    if (existing && existing.battingOrder != null) order.value = String(existing.battingOrder);
  }
  let name = null;
  if (player) {
    name = document.createElement('span');
    name.className = 'tally-name';
    name.textContent = (player.number != null ? `#${player.number} ` : '') + player.name;
  }
  const summary = document.createElement('span'); summary.className = 'tally-summary';
  const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'tally-undo'; undo.textContent = '↩ 取消';
  head.append(...[order, options.leadEl, name].filter(Boolean), summary, undo);
  card.appendChild(head);

  const countEls = {};
  const updateSummary = () => {
    const rec = tallyToRecord(t);
    summary.textContent = `打${rec.atBats} 安${rec.hits}`;
    TALLY_OUTCOMES.forEach(o => { if (countEls[o.key]) countEls[o.key].textContent = (t[o.key] || 0) || ''; });
    TALLY_STEPPERS.forEach(s => { if (countEls[s.key]) countEls[s.key].textContent = (t[s.key] || 0); });
  };

  const btns = document.createElement('div');
  btns.className = 'tally-buttons';
  TALLY_OUTCOMES.forEach(o => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tally-btn tally-' + o.group;
    const lbl = document.createElement('span'); lbl.textContent = o.label;
    const cnt = document.createElement('span'); cnt.className = 'tally-count'; cnt.textContent = (t[o.key] || 0) || '';
    countEls[o.key] = cnt;
    b.append(lbl, cnt);
    b.addEventListener('click', () => { t[o.key] = (t[o.key] || 0) + 1; t.history.push(o.key); updateSummary(); });
    btns.appendChild(b);
  });
  card.appendChild(btns);

  const steps = document.createElement('div');
  steps.className = 'tally-steppers';
  TALLY_STEPPERS.forEach(s => {
    const wrap = document.createElement('div'); wrap.className = 'tally-stepper';
    const lab = document.createElement('span'); lab.className = 'tally-step-label'; lab.textContent = s.label;
    const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'tally-step-btn'; minus.textContent = '−';
    const val = document.createElement('span'); val.className = 'tally-count'; countEls[s.key] = val; val.textContent = (t[s.key] || 0);
    const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'tally-step-btn'; plus.textContent = '＋';
    minus.addEventListener('click', () => { t[s.key] = Math.max(0, (t[s.key] || 0) - 1); updateSummary(); });
    plus.addEventListener('click', () => { t[s.key] = (t[s.key] || 0) + 1; updateSummary(); });
    wrap.append(lab, minus, val, plus);
    steps.appendChild(wrap);
  });
  card.appendChild(steps);

  undo.addEventListener('click', () => {
    const last = t.history.pop();
    if (last) { t[last] = Math.max(0, (t[last] || 0) - 1); updateSummary(); }
  });

  updateSummary();

  return {
    card,
    getOrder: () => order ? (parseInt(order.value) || null) : null,
    getTally: () => t,
    hasData: () => tallyHasData(t),
  };
}

// container に全選手のタップ式打撃入力を構築。getExisting(playerId)->record|null。
// 戻り値 { collect } : 入力のある選手の {playerId, battingOrder, appeared, replaces, ...recordFields}
function buildBattingTally(container, getExisting) {
  container.innerHTML = '';
  if (!state.players.length) {
    container.appendChild(emptyState('👥', '選手が未登録です', '「選手管理」タブで先に選手を登録してください'));
    return { collect: () => [] };
  }
  const cards = {};
  [...state.players].sort(comparePlayers).forEach(player => {
    const existing = getExisting ? getExisting(player.id) : null;
    const c = buildTallyCard(player, existing, { showOrder: true });
    cards[player.id] = c;
    container.appendChild(c.card);
  });

  return {
    collect() {
      const out = [];
      state.players.forEach(player => {
        const c = cards[player.id]; if (!c) return;
        const orderVal = c.getOrder();
        if (!c.hasData() && orderVal == null) return;
        out.push({ playerId: player.id, battingOrder: orderVal, appeared: true, replaces: null, ...tallyToRecord(c.getTally()) });
      });
      return out;
    }
  };
}

// 投球回「回＋アウト」入力コントロール
function buildIpControl(initialDec) {
  const wrap = document.createElement('div');
  wrap.className = 'ip-control';
  const inn = document.createElement('input');
  inn.type = 'number'; inn.min = '0'; inn.className = 'form-input ip-innings'; inn.placeholder = '0';
  const innUnit = document.createElement('span'); innUnit.className = 'ip-unit'; innUnit.textContent = '回';
  const outSel = document.createElement('select');
  outSel.className = 'form-select ip-outs';
  [0, 1, 2].forEach(n => { const o = document.createElement('option'); o.value = String(n); o.textContent = n + 'アウト'; outSel.appendChild(o); });
  if (initialDec != null && initialDec !== '' && !isNaN(initialDec)) {
    inn.value = Math.floor(initialDec);
    outSel.value = String(Math.min(2, Math.round((initialDec % 1) * 10)));
  }
  wrap.append(inn, innUnit, outSel);
  return {
    wrap,
    innInput: inn,
    getValue() { const i = parseInt(inn.value); if (isNaN(i) || i < 0) return NaN; return i + (parseInt(outSel.value) || 0) / 10; },
  };
}

function buildInlineBattingSection() {
  const body = document.getElementById('inline-batting-body');
  inlineBattingBuilt = true;
  inlineBattingController = buildBattingTally(body, () => null);
}

function buildInlinePitchingFormForPlayer(playerId) {
  const area = document.getElementById('inline-pitching-form');
  area.innerHTML = '';
  inlinePitchingInputs = null;
  inlinePitchingResultSelect = null;
  inlinePitchingPlayerId = null;
  if (!playerId) return;

  inlinePitchingPlayerId = playerId;

  const fields = [
    { key: 'inningsPitched',  label: '投球回',   placeholder: '例: 6.2', step: '0.1', min: '0' },
    { key: 'pitchCount',      label: '球数',      placeholder: '例: 85',  step: '1',   min: '0' },
    { key: 'hitsAllowed',     label: '被安打',    placeholder: '0',       step: '1',   min: '0' },
    { key: 'runsAllowed',     label: '失点',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'earnedRuns',      label: '自責点',    placeholder: '0',       step: '1',   min: '0' },
    { key: 'walks',           label: '与四球',    placeholder: '0',       step: '1',   min: '0' },
    { key: 'hitByPitch',      label: '与死球',    placeholder: '0',       step: '1',   min: '0' },
    { key: 'strikeouts',      label: '奪三振',    placeholder: '0',       step: '1',   min: '0' },
    { key: 'homeRunsAllowed', label: '被本塁打',  placeholder: '0',       step: '1',   min: '0' },
  ];

  const form = document.createElement('div');
  form.className = 'pitching-form';
  const inputs = {};
  fields.forEach(f => {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = f.label;
    if (f.key === 'inningsPitched') {
      const ip = buildIpControl(null);
      inputs[f.key] = ip;
      group.append(label, ip.wrap);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = f.step;
      input.min = f.min;
      input.placeholder = f.placeholder;
      input.className = 'form-input';
      input.value = 0;
      inputs[f.key] = input;
      group.append(label, input);
    }
    form.appendChild(group);
  });

  const resultGroup = document.createElement('div');
  resultGroup.className = 'form-group';
  const resultLabel = document.createElement('label');
  resultLabel.className = 'form-label';
  resultLabel.textContent = '勝敗';
  const resultSelect = document.createElement('select');
  resultSelect.className = 'form-select';
  [['ND','記録なし'],['W','勝利'],['L','敗北'],['S','セーブ']].forEach(([v, t]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    resultSelect.appendChild(opt);
  });
  resultGroup.append(resultLabel, resultSelect);
  form.appendChild(resultGroup);

  const addGroup = document.createElement('div');
  addGroup.className = 'form-group form-group-full form-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-ghost-dark';
  addBtn.textContent = 'この投手を追加';
  addBtn.addEventListener('click', () => {
    const ipRaw = inlinePitchingInputs.inningsPitched.getValue();
    if (isNaN(ipRaw) || ipRaw < 0) { showToast('投球回を入力してください', 'error'); return; }
    const runsAllowed = parseInt(inlinePitchingInputs.runsAllowed.value) || 0;
    const earnedRuns = parseInt(inlinePitchingInputs.earnedRuns.value) || 0;
    if (earnedRuns > runsAllowed) { showToast('自責点は失点以下にしてください', 'error'); return; }

    const snapshot = { playerId, result: inlinePitchingResultSelect.value };
    ['inningsPitched','pitchCount','hitsAllowed','runsAllowed','earnedRuns','walks','hitByPitch','strikeouts','homeRunsAllowed'].forEach(key => {
      snapshot[key] = key === 'inningsPitched' ? ipRaw : (parseInt(inlinePitchingInputs[key].value) || 0);
    });
    inlinePitchingList.push(snapshot);

    renderInlinePitchingList();

    document.getElementById('inline-pitcher-select').value = '';
    document.getElementById('inline-pitching-form').innerHTML = '';
    inlinePitchingInputs = null;
    inlinePitchingResultSelect = null;
    inlinePitchingPlayerId = null;
    showToast('投手を追加しました');
  });
  addGroup.appendChild(addBtn);
  form.appendChild(addGroup);

  area.appendChild(form);
  inlinePitchingInputs = inputs;
  inlinePitchingResultSelect = resultSelect;
}

function renderInlinePitchingList() {
  let listEl = document.getElementById('inline-pitching-list');
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.id = 'inline-pitching-list';
    listEl.className = 'inline-pitching-list';
    const body = document.getElementById('inline-pitching-body');
    body.insertBefore(listEl, body.firstChild);
  }
  listEl.innerHTML = '';
  if (!inlinePitchingList.length) { listEl.remove(); return; }

  inlinePitchingList.forEach((entry, idx) => {
    const p = state.players.find(x => x.id === entry.playerId);
    const chip = document.createElement('div');
    chip.className = 'pitcher-chip';
    const name = p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明';
    chip.innerHTML = `<span>${name} ${entry.inningsPitched}回 ${entry.strikeouts}K</span>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pitcher-chip-del';
    del.textContent = '✕';
    del.addEventListener('click', () => { inlinePitchingList.splice(idx, 1); renderInlinePitchingList(); });
    chip.appendChild(del);
    listEl.appendChild(chip);
  });
}

function populateInlinePitcherSelect() {
  const sel = document.getElementById('inline-pitcher-select');
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  [...state.players]
    .filter(p => (p.positions || []).includes('投手'))
    .sort(comparePlayers)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
      sel.appendChild(opt);
    });
  if (prev) sel.value = prev;
}

function initInlineStats() {
  document.getElementById('toggle-inline-batting').addEventListener('click', () => {
    const wasOpen = document.getElementById('toggle-inline-batting').classList.contains('open');
    toggleAccordion('toggle-inline-batting', 'inline-batting-body');
    if (!wasOpen && !inlineBattingBuilt) buildInlineBattingSection();
  });

  document.getElementById('toggle-inline-pitching').addEventListener('click', () => {
    const wasOpen = document.getElementById('toggle-inline-pitching').classList.contains('open');
    toggleAccordion('toggle-inline-pitching', 'inline-pitching-body');
    if (!wasOpen) populateInlinePitcherSelect();
  });

  document.getElementById('inline-pitcher-select').addEventListener('change', e => {
    buildInlinePitchingFormForPlayer(e.target.value || null);
  });
}

function resetInlineStats() {
  closeAccordion('toggle-inline-batting', 'inline-batting-body');
  document.getElementById('inline-batting-body').innerHTML = '';
  inlineBattingController = null;
  inlineBattingBuilt = false;

  closeAccordion('toggle-inline-pitching', 'inline-pitching-body');
  document.getElementById('inline-pitching-form').innerHTML = '';
  document.getElementById('inline-pitcher-select').value = '';
  inlinePitchingInputs = null;
  inlinePitchingResultSelect = null;
  inlinePitchingPlayerId = null;
  inlinePitchingList = [];
  renderInlinePitchingList();
}

/* ===== GAMES ===== */
function initGameForm() {
  buildInningGrid('inning-our');
  buildInningGrid('inning-opp');

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('game-date').value = today;

  document.getElementById('form-game').addEventListener('submit', e => {
    e.preventDefault();
    const dateVal = document.getElementById('game-date').value;
    const opp = document.getElementById('game-opponent').value.trim();
    if (!dateVal || !opp) { showToast('試合日と対戦相手を入力してください', 'error'); return; }

    const ourInnings = getInnings('inning-our');
    const oppInnings = getInnings('inning-opp');
    const ourScore = ourInnings.reduce((a, b) => a + b, 0);
    const oppScore = oppInnings.reduce((a, b) => a + b, 0);
    const result = ourScore > oppScore ? '勝' : ourScore < oppScore ? '負' : '引分';
    const venue = document.getElementById('game-venue').value.trim();
    const gameType = document.querySelector('input[name="game-type"]:checked').value;

    const memo = document.getElementById('game-memo').value.trim();
    const seasonId = getCurrentSeason()?.id || null;

    const battingRows = inlineBattingController ? inlineBattingController.collect() : [];
    const pitchingRows = inlinePitchingList.slice();

    const commit = () => {
      const game = { id: newId('g'), date: dateVal, opponent: opp, venue, gameType, innings: ourInnings, opponentInnings: oppInnings, ourScore, opponentScore: oppScore, result, memo, seasonId };
      state.games.push(game);
      battingRows.forEach(row => state.battingRecords.push({ id: newId('b'), gameId: game.id, ...row }));
      pitchingRows.forEach(entry => state.pitchingRecords.push({ id: newId('pi'), gameId: game.id, ...entry }));
      saveData(state);
      renderGamesList();
      document.getElementById('form-game').reset();
      buildInningGrid('inning-our');
      buildInningGrid('inning-opp');
      document.getElementById('game-date').value = today;
      resetInlineStats();
      showToast('試合を登録しました ✓');
    };

    // 空入力ガード：スコアも成績も無い場合は確認
    if (!battingRows.length && !pitchingRows.length && ourScore === 0 && oppScore === 0) {
      confirmModal('入力内容の確認', 'スコアも打撃・投球成績も未入力です。このまま登録しますか？', commit);
    } else {
      commit();
    }
  });
}

function renderGamesList() {
  const container = document.getElementById('games-list');
  if (!container) return;
  const season = getCurrentSeason();
  const seasonGames = season ? state.games.filter(g => g.seasonId === season.id) : state.games;
  if (!seasonGames.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('⚾', 'まだ試合が登録されていません', '上のフォームから登録してください'));
    return;
  }

  const sorted = [...seasonGames].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'games-table';
  tbl.innerHTML = '<thead><tr><th>日付</th><th>種別</th><th>対戦相手</th><th>会場</th><th>スコア</th><th>結果</th><th></th><th></th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  sorted.forEach(game => {
    const tr = document.createElement('tr');
    const score = document.createElement('td');
    const sd = document.createElement('div');
    sd.className = 'score-display';
    const us = document.createElement('span'); us.className = 'score-us'; us.textContent = game.ourScore;
    const sep = document.createElement('span'); sep.className = 'score-sep'; sep.textContent = '−';
    const opp = document.createElement('span'); opp.className = 'score-opp'; opp.textContent = game.opponentScore;
    sd.append(us, sep, opp);
    score.appendChild(sd);

    const badgeTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (game.result === '勝' ? 'badge-win' : game.result === '負' ? 'badge-loss' : 'badge-draw');
    badge.textContent = game.result;
    badgeTd.appendChild(badge);

    const entryTd = document.createElement('td');
    const entryBtn = document.createElement('button');
    entryBtn.className = 'btn-entry';
    entryBtn.textContent = '成績入力';
    entryBtn.addEventListener('click', () => showStatsEntry(game.id));
    entryTd.appendChild(entryBtn);

    const editTd = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-icon btn-icon-edit';
    editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>';
    editBtn.title = '編集';
    editBtn.addEventListener('click', () => showEditGameModal(game.id));
    editTd.appendChild(editBtn);

    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
    delBtn.title = '削除';
    delBtn.addEventListener('click', () => {
      confirmModal('試合を削除', `${game.date} vs ${game.opponent} を削除しますか？関連する打撃・投球データも削除されます。`, () => {
        deleteGame(game.id);
      });
    });
    delTd.appendChild(delBtn);

    tr.append(
      td(game.date),
      td(gameTypeLabel(game.gameType)),
      td(game.opponent),
      td(venueLabel(game)),
      score,
      badgeTd,
      entryTd,
      editTd,
      delTd
    );
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function deleteGame(id) {
  const snap = {
    games: state.games.slice(),
    battingRecords: state.battingRecords.slice(),
    pitchingRecords: state.pitchingRecords.slice(),
    fieldingRecords: state.fieldingRecords.slice(),
  };
  state.games = state.games.filter(g => g.id !== id);
  state.battingRecords = state.battingRecords.filter(r => r.gameId !== id);
  state.pitchingRecords = state.pitchingRecords.filter(r => r.gameId !== id);
  state.fieldingRecords = state.fieldingRecords.filter(r => r.gameId !== id);
  saveData(state);
  if (currentStatsEntryGameId === id) hideStatsEntry();
  renderGamesList();
  showUndoToast('試合を削除しました', () => { Object.assign(state, snap); saveData(state); renderAll(); });
}

/* ===== PLAYERS ===== */
function initPlayerForm() {
  document.getElementById('form-player').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('player-name').value.trim();
    if (!name) { showToast('選手名を入力してください', 'error'); return; }
    const positions = [...document.querySelectorAll('#player-positions input:checked')].map(el => el.value);
    const grade = parseInt(document.getElementById('player-grade').value) || null;
    const player = {
      id: newId('p'),
      name,
      furigana: document.getElementById('player-furigana').value.trim(),
      number: parseInt(document.getElementById('player-number').value) || null,
      grade,
      positions
    };
    state.players.push(player);
    saveData(state);
    renderPlayersList();
    if (currentStatsEntryGameId) populateEntryPitcherSelect();
    document.getElementById('form-player').reset();
    document.getElementById('player-furigana').value = '';
    document.querySelectorAll('#player-positions input').forEach(cb => cb.checked = false);
    showToast(`${name} を追加しました ✓`);
  });
}

function showPlayerStatsModal(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  document.getElementById('player-stats-modal-title').textContent =
    (player.number != null ? `#${player.number} ` : '') + player.name + ' の成績';
  const body = document.getElementById('player-stats-modal-body');
  document.getElementById('player-stats-modal-overlay').style.display = 'flex';
  renderPlayerStatsContent(playerId, body);
}

function closePlayerStatsModal() {
  document.getElementById('player-stats-modal-overlay').style.display = 'none';
  document.getElementById('player-stats-modal-body').innerHTML = '';
}

function renderPlayersList() {
  const container = document.getElementById('players-list');
  if (!state.players.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('👥', 'まだ選手が登録されていません', '下のフォームから選手を追加してください'));
    return;
  }

  const sorted = [...state.players].sort(comparePlayers);
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'games-table';
  tbl.innerHTML = '<thead><tr><th>背番号</th><th>選手名</th><th>ふりがな</th><th>学年</th><th>ポジション</th><th></th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  sorted.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'player-row-clickable';
    tr.title = 'クリックで成績を表示';
    tr.addEventListener('click', () => showPlayerStatsModal(p.id));
    const editTd2 = document.createElement('td');
    const editBtn2 = document.createElement('button');
    editBtn2.className = 'btn btn-icon btn-icon-edit';
    editBtn2.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>';
    editBtn2.title = '編集';
    editBtn2.addEventListener('click', (e) => { e.stopPropagation(); showEditPlayerModal(p.id); });
    editTd2.appendChild(editBtn2);

    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
    delBtn.title = '削除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmModal('選手を削除', `${p.name} を削除しますか？この選手の打撃・投球・守備データも全て削除されます。`, () => deletePlayer(p.id));
    });
    delTd.appendChild(delBtn);
    tr.append(td(p.number ?? '-'), td(p.name), td(p.furigana || '−'), td(p.grade ? `${p.grade}年` : '−'), td((p.positions || []).join('・')), editTd2, delTd);
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function deletePlayer(id) {
  const snap = {
    players: state.players.slice(),
    battingRecords: state.battingRecords.slice(),
    pitchingRecords: state.pitchingRecords.slice(),
    fieldingRecords: state.fieldingRecords.slice(),
  };
  state.players = state.players.filter(p => p.id !== id);
  state.battingRecords = state.battingRecords.filter(r => r.playerId !== id);
  state.pitchingRecords = state.pitchingRecords.filter(r => r.playerId !== id);
  state.fieldingRecords = state.fieldingRecords.filter(r => r.playerId !== id);
  saveData(state);
  renderPlayersList();
  if (currentStatsEntryGameId) populateEntryPitcherSelect();
  showUndoToast('選手を削除しました', () => { Object.assign(state, snap); saveData(state); renderAll(); });
}


/* ===== BATTING / PITCHING DATA ===== */
const BATTING_COLS = [
  { key: 'atBats',       label: '打数', min: 0 },
  { key: 'hits',         label: '安打', min: 0 },
  { key: 'doubles',      label: '二塁打', min: 0 },
  { key: 'triples',      label: '三塁打', min: 0 },
  { key: 'homeRuns',     label: '本塁打', min: 0 },
  { key: 'rbi',          label: '打点', min: 0 },
  { key: 'runs',         label: '得点', min: 0 },
  { key: 'strikeouts',   label: '三振', min: 0 },
  { key: 'walks',        label: '四球', min: 0 },
  { key: 'hitByPitch',   label: '死球', min: 0 },
  { key: 'sacrifices',   label: '犠打', min: 0 },
  { key: 'stolenBases',  label: '盗塁', min: 0 },
  { key: 'caughtStealing', label: '盗塁死', min: 0 },
];

function renderRosterGrid(area, gameId, type, cols, records, prefix) {
  const card = document.createElement('div');
  card.className = 'roster-grid-card';

  const header = document.createElement('div');
  header.className = 'roster-grid-header';
  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = type === 'batting' ? '打撃データ入力（全選手）' : '守備データ入力（全選手）';
  header.appendChild(title);
  card.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'roster-grid-wrap';

  const tbl = document.createElement('table');
  tbl.className = 'roster-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const nameTh = document.createElement('th');
  nameTh.textContent = '選手名';
  htr.appendChild(nameTh);
  if (type === 'batting') {
    ['出場','打順','交代元#'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      htr.appendChild(th);
    });
  }
  cols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const inputMap = {};

  state.players.forEach(player => {
    const existing = records.find(r => r.gameId === gameId && r.playerId === player.id) || {};
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = (player.number != null ? `#${player.number} ` : '') + player.name;
    tr.appendChild(nameTd);

    inputMap[player.id] = {};

    if (type === 'batting') {
      // 出場
      const appearedTd = document.createElement('td');
      const appearedCb = document.createElement('input');
      appearedCb.type = 'checkbox';
      appearedCb.className = 'roster-checkbox';
      appearedCb.checked = existing.appeared || false;
      inputMap[player.id].appeared = appearedCb;
      appearedTd.appendChild(appearedCb);
      tr.appendChild(appearedTd);

      // 打順
      const orderTd = document.createElement('td');
      const orderInput = document.createElement('select');
      orderInput.className = 'roster-input';
      orderInput.style.width = '80px';
      [['', '-'], ...Array.from({length:9},(_,i)=>[String(i+1),String(i+1)]), ['10','途中出場']].forEach(([val,label]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        orderInput.appendChild(opt);
      });
      orderInput.value = existing.battingOrder != null ? String(existing.battingOrder) : '';
      inputMap[player.id].battingOrder = orderInput;
      orderTd.appendChild(orderInput);
      tr.appendChild(orderTd);

      // 交代元背番号
      const replacesTd = document.createElement('td');
      const replacesInput = document.createElement('input');
      replacesInput.type = 'number';
      replacesInput.min = 0;
      replacesInput.max = 99;
      replacesInput.placeholder = '-';
      replacesInput.className = 'roster-input';
      replacesInput.style.width = '50px';
      replacesInput.title = '代打・代走の場合、交代前の選手の背番号を入力';
      replacesInput.value = existing.replaces ?? '';
      inputMap[player.id].replaces = replacesInput;
      replacesTd.appendChild(replacesInput);
      tr.appendChild(replacesTd);
    }

    cols.forEach(col => {
      const td = document.createElement('td');
      let input;
      if (col.type === 'select') {
        input = document.createElement('select');
        input.className = 'roster-input';
        input.style.minWidth = '80px';
        col.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          input.appendChild(o);
        });
        input.value = existing[col.key] || player.position || col.options[0];
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.min = col.min ?? 0;
        input.value = existing[col.key] ?? 0;
        input.className = 'roster-input';
      }
      inputMap[player.id][col.key] = input;
      td.appendChild(input);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  card.appendChild(wrap);

  const actions = document.createElement('div');
  actions.className = 'roster-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '全選手のデータを保存する';
  saveBtn.addEventListener('click', () => {
    const collection = type === 'batting' ? 'battingRecords' : 'fieldingRecords';
    state.players.forEach(player => {
      const inputs = inputMap[player.id];
      const record = { id: newId(prefix), gameId, playerId: player.id };
      cols.forEach(col => {
        const inp = inputs[col.key];
        record[col.key] = col.type === 'select' ? inp.value : (parseInt(inp.value) || 0);
      });
      if (type === 'batting') {
        record.appeared = inputs.appeared ? inputs.appeared.checked : false;
        record.battingOrder = inputs.battingOrder ? (parseInt(inputs.battingOrder.value) || null) : null;
        record.replaces = inputs.replaces ? (parseInt(inputs.replaces.value) ?? null) || null : null;
      }
      const idx = state[collection].findIndex(r => r.gameId === gameId && r.playerId === player.id);
      if (idx >= 0) state[collection][idx] = { ...state[collection][idx], ...record };
      else state[collection].push(record);
    });
    saveData(state);
    showToast('データを保存しました ✓');
  });
  actions.appendChild(saveBtn);
  card.appendChild(actions);

  area.innerHTML = '';
  area.appendChild(card);
}

// 成績入力パネルの打撃（タップ式・既存試合の編集）
function renderBattingEntry(area, gameId) {
  const controller = buildBattingTally(area, pid =>
    state.battingRecords.find(r => r.gameId === gameId && r.playerId === pid) || null);

  const actions = document.createElement('div');
  actions.className = 'roster-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '打撃データを保存する';
  saveBtn.addEventListener('click', () => {
    const rows = controller.collect();
    const byPlayer = {};
    rows.forEach(r => { byPlayer[r.playerId] = r; });
    const before = state.battingRecords.slice();
    state.players.forEach(player => {
      const idx = state.battingRecords.findIndex(r => r.gameId === gameId && r.playerId === player.id);
      const row = byPlayer[player.id];
      if (row) {
        const rec = { gameId, playerId: player.id, ...row };
        if (idx >= 0) state.battingRecords[idx] = { ...state.battingRecords[idx], ...rec };
        else state.battingRecords.push({ id: newId('b'), ...rec });
      } else if (idx >= 0) {
        state.battingRecords.splice(idx, 1); // 全項目ゼロになった選手は記録削除
      }
    });
    saveData(state);
    if (typeof showUndoToast === 'function') {
      showUndoToast('打撃データを保存しました ✓', () => { state.battingRecords = before; saveData(state); renderAll(); if (currentStatsEntryGameId) showStatsEntry(currentStatsEntryGameId); });
    } else {
      showToast('打撃データを保存しました ✓');
    }
  });
  actions.appendChild(saveBtn);
  area.appendChild(actions);
}

/* ===== PITCHING FORM ===== */
function renderPitchingForm(area, gameId, playerId) {
  const existing = state.pitchingRecords.find(r => r.gameId === gameId && r.playerId === playerId) || {};

  const card = document.createElement('div');
  card.className = 'card';
  const cardHeader = document.createElement('div');
  cardHeader.className = 'card-header';
  const cardTitle = document.createElement('h2');
  cardTitle.className = 'card-title';
  const player = state.players.find(p => p.id === playerId);
  cardTitle.textContent = `投球データ: ${player ? player.name : ''}`;
  cardHeader.appendChild(cardTitle);
  card.appendChild(cardHeader);

  const fields = [
    { key: 'inningsPitched',    label: '投球回',     placeholder: '例: 6.2', step: '0.1', min: '0' },
    { key: 'pitchCount',        label: '球数',        placeholder: '例: 85',  step: '1',   min: '0' },
    { key: 'hitsAllowed',       label: '被安打',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'runsAllowed',       label: '失点',        placeholder: '0',       step: '1',   min: '0' },
    { key: 'earnedRuns',        label: '自責点',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'walks',             label: '与四球',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'hitByPitch',        label: '与死球',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'strikeouts',        label: '奪三振',      placeholder: '0',       step: '1',   min: '0' },
    { key: 'homeRunsAllowed',   label: '被本塁打',    placeholder: '0',       step: '1',   min: '0' },
  ];

  const form = document.createElement('div');
  form.className = 'pitching-form';

  const inputs = {};
  fields.forEach(f => {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = f.label;
    if (f.key === 'inningsPitched') {
      const ip = buildIpControl(existing.inningsPitched);
      inputs[f.key] = ip;
      group.append(label, ip.wrap);
    } else {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = f.step;
      input.min = f.min;
      input.placeholder = f.placeholder;
      input.className = 'form-input';
      input.value = existing[f.key] ?? 0;
      inputs[f.key] = input;
      group.append(label, input);
    }
    form.appendChild(group);
  });

  const resultGroup = document.createElement('div');
  resultGroup.className = 'form-group';
  const resultLabel = document.createElement('label');
  resultLabel.className = 'form-label';
  resultLabel.textContent = '勝敗';
  const resultSelect = document.createElement('select');
  resultSelect.className = 'form-select';
  [['ND','記録なし'],['W','勝利'],['L','敗北'],['S','セーブ']].forEach(([v, t]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = t;
    resultSelect.appendChild(opt);
  });
  resultSelect.value = existing.result || 'ND';
  resultGroup.append(resultLabel, resultSelect);
  form.appendChild(resultGroup);

  const saveGroup = document.createElement('div');
  saveGroup.className = 'form-group form-group-full form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '保存する';

  saveBtn.addEventListener('click', () => {
    const ipRaw = inputs.inningsPitched.getValue();
    if (isNaN(ipRaw) || ipRaw < 0) {
      showToast('投球回を正しく入力してください', 'error');
      inputs.inningsPitched.innInput.classList.add('error');
      return;
    }
    inputs.inningsPitched.innInput.classList.remove('error');
    const runsAllowed = parseInt(inputs.runsAllowed.value) || 0;
    const earnedRuns = parseInt(inputs.earnedRuns.value) || 0;
    if (earnedRuns > runsAllowed) { showToast('自責点は失点以下にしてください', 'error'); return; }

    const record = {
      id: newId('pi'),
      gameId,
      playerId,
      result: resultSelect.value,
    };
    fields.forEach(f => {
      record[f.key] = f.key === 'inningsPitched' ? ipRaw : (parseInt(inputs[f.key].value) || 0);
    });

    const snap = state.pitchingRecords.slice();
    const idx = state.pitchingRecords.findIndex(r => r.gameId === gameId && r.playerId === playerId);
    if (idx >= 0) state.pitchingRecords[idx] = { ...state.pitchingRecords[idx], ...record };
    else state.pitchingRecords.push(record);
    saveData(state);
    showUndoToast('投球データを保存しました ✓', () => { state.pitchingRecords = snap; saveData(state); renderAll(); if (currentStatsEntryGameId) showStatsEntry(currentStatsEntryGameId); });
  });

  saveGroup.appendChild(saveBtn);
  form.appendChild(saveGroup);
  card.appendChild(form);
  area.innerHTML = '';
  area.appendChild(card);
}

/* ===== STATS ENTRY (games tab) ===== */
let currentStatsEntryGameId = null;

function showStatsEntry(gameId) {
  currentStatsEntryGameId = gameId;
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  document.getElementById('stats-entry-game-label').textContent =
    `成績入力：${game.date} vs ${game.opponent}`;
  document.getElementById('game-stats-entry').style.display = '';

  const battingBody = document.getElementById('batting-entry-body');
  if (!state.players.length) {
    battingBody.innerHTML = '';
    battingBody.appendChild(emptyState('👥', '選手が未登録です', '「選手管理」タブで選手を追加してください'));
  } else {
    renderBattingEntry(battingBody, gameId);
  }

  populateEntryPitcherSelect();
  document.getElementById('stats-entry-pitching-form').innerHTML = '';
  document.getElementById('stats-entry-pitcher-select').value = '';

  openAccordion('toggle-batting-entry', 'batting-entry-body');
  closeAccordion('toggle-pitching-entry', 'pitching-entry-body');

  document.getElementById('game-stats-entry').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideStatsEntry() {
  document.getElementById('game-stats-entry').style.display = 'none';
  currentStatsEntryGameId = null;
}

function openAccordion(toggleId, bodyId) {
  document.getElementById(toggleId).classList.add('open');
  document.getElementById(bodyId).classList.add('open');
}

function closeAccordion(toggleId, bodyId) {
  document.getElementById(toggleId).classList.remove('open');
  document.getElementById(bodyId).classList.remove('open');
}

function toggleAccordion(toggleId, bodyId) {
  const isOpen = document.getElementById(toggleId).classList.contains('open');
  if (isOpen) closeAccordion(toggleId, bodyId);
  else openAccordion(toggleId, bodyId);
}

function populateEntryPitcherSelect() {
  const sel = document.getElementById('stats-entry-pitcher-select');
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  [...state.players]
    .filter(p => (p.positions || []).includes('投手'))
    .sort(comparePlayers)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
      sel.appendChild(opt);
    });
  if (prev) sel.value = prev;
}

/* ===== STATS ===== */
// 選手のデフォルト並び順：学年降順（上級生が上）→ 同学年内はふりがな（あいうえお）昇順
function comparePlayers(a, b) {
  const ga = a?.grade ?? 0, gb = b?.grade ?? 0;
  if (ga !== gb) return gb - ga;
  return (a?.furigana || a?.name || '').localeCompare(b?.furigana || b?.name || '', 'ja');
}

function ipToDecimal(ip) {
  const floor = Math.floor(ip);
  const frac = Math.round((ip % 1) * 10);
  return floor + frac / 3;
}

function fmt(val, dec = 3) {
  if (val == null || isNaN(val) || !isFinite(val)) return '---';
  return val.toFixed(dec);
}

function fmtAvg(val) {
  if (val == null || isNaN(val) || !isFinite(val)) return '---';
  const r = Math.round(val * 1000);
  if (r >= 1000) return (r / 1000).toFixed(3);   // 1.000 / 4.000 など（1.000以上）
  return '.' + r.toString().padStart(3, '0');     // .500 / .000 など
}

function computeBattingStats(filterIds, records = state.battingRecords, idKey = 'gameId') {
  const map = {};
  records.filter(r => !filterIds || filterIds.has(r[idKey])).forEach(r => {
    if (!map[r.playerId]) map[r.playerId] = { playerId: r.playerId, games: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0, rbi: 0, runs: 0, strikeouts: 0, walks: 0, hitByPitch: 0, sacrifices: 0, stolenBases: 0, caughtStealing: 0 };
    const m = map[r.playerId];
    m.games++;
    ['atBats','hits','doubles','triples','homeRuns','rbi','runs','strikeouts','walks','hitByPitch','sacrifices','stolenBases','caughtStealing'].forEach(k => m[k] += (r[k] || 0));
  });
  return Object.values(map).map(m => {
    const singles = m.hits - m.doubles - m.triples - m.homeRuns;
    const tb = singles + m.doubles * 2 + m.triples * 3 + m.homeRuns * 4;
    const pa = m.atBats + m.walks + m.hitByPitch + m.sacrifices;
    const avg = m.atBats > 0 ? m.hits / m.atBats : NaN;
    const obp = pa > 0 ? (m.hits + m.walks + m.hitByPitch) / pa : NaN;
    const slg = m.atBats > 0 ? tb / m.atBats : NaN;
    const ops = obp + slg;
    const sbPct = (m.stolenBases + m.caughtStealing) > 0 ? m.stolenBases / (m.stolenBases + m.caughtStealing) : NaN;
    const player = state.players.find(p => p.id === m.playerId);
    return { name: player ? player.name : '不明', grade: player ? player.grade : null, furigana: player ? (player.furigana || '') : '', ...m, avg, obp, slg, ops, tb, pa, sbPct };
  }).sort(comparePlayers);
}

function computePitchingStats(filterIds, records = state.pitchingRecords, idKey = 'gameId') {
  const map = {};
  records.filter(r => !filterIds || filterIds.has(r[idKey])).forEach(r => {
    if (!map[r.playerId]) map[r.playerId] = { playerId: r.playerId, games: 0, wins: 0, losses: 0, saves: 0, ipDec: 0, hitsAllowed: 0, runsAllowed: 0, earnedRuns: 0, walks: 0, hitByPitch: 0, strikeouts: 0, homeRunsAllowed: 0, pitchCount: 0 };
    const m = map[r.playerId];
    m.games++;
    if (r.result === 'W') m.wins++;
    if (r.result === 'L') m.losses++;
    if (r.result === 'S') m.saves++;
    m.ipDec += ipToDecimal(r.inningsPitched || 0);
    ['hitsAllowed','runsAllowed','earnedRuns','walks','hitByPitch','strikeouts','homeRunsAllowed','pitchCount'].forEach(k => m[k] += (r[k] || 0));
  });
  return Object.values(map).map(m => {
    const ipDec = m.ipDec;
    const era = ipDec > 0 ? m.earnedRuns * 9 / ipDec : NaN;
    const whip = ipDec > 0 ? (m.walks + m.hitsAllowed) / ipDec : NaN;
    const k9 = ipDec > 0 ? m.strikeouts * 9 / ipDec : NaN;
    const bfp = Math.round(ipDec * 3) + m.hitsAllowed + m.walks + m.hitByPitch;
    const bavg = bfp > 0 ? m.hitsAllowed / bfp : NaN;
    const player = state.players.find(p => p.id === m.playerId);
    return { name: player ? player.name : '不明', grade: player ? player.grade : null, furigana: player ? (player.furigana || '') : '', ...m, era, whip, k9, bavg };
  }).sort(comparePlayers);
}


function filterGamesByType(filterVal) {
  if (filterVal === 'all') return state.games;
  if (filterVal === 'total') return state.games.filter(g => g.gameType === 'spring' || g.gameType === 'fall');
  return state.games.filter(g => g.gameType === filterVal);
}

function getFilteredGameIds(typeVal, baseGames) {
  let games = baseGames || state.games;
  if (typeVal === 'total') games = games.filter(g => g.gameType === 'spring' || g.gameType === 'fall');
  else if (typeVal !== 'all') games = games.filter(g => g.gameType === typeVal);
  return new Set(games.map(g => g.id));
}

function buildStatsFilter(panel, onFilter, baseGames) {
  const wrap = document.createElement('div');
  wrap.className = 'stats-filter';
  const label = document.createElement('span');
  label.className = 'stats-filter-label';
  label.textContent = '絞り込み：';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'form-select stats-filter-select';
  [['all','全試合'],['total','リーグ計'],['spring','春リーグ'],['fall','秋リーグ'],['practice','練習試合'],['other','その他']].forEach(([v,t]) => {
    const opt = document.createElement('option'); opt.value = v; opt.textContent = t; typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener('change', () => onFilter(getFilteredGameIds(typeSelect.value, baseGames)));
  wrap.append(label, typeSelect);
  panel.appendChild(wrap);
}

/* ===== Stats Rendering ===== */
const _charts = {};

// 成績描画のデータソース記述子。試合成績と実践成績で同一の描画関数を共有する。
function gameStatsCtx() {
  const season = getCurrentSeason();
  const units = season ? state.games.filter(g => g.seasonId === season.id) : state.games;
  return {
    kind: 'game', batRecords: state.battingRecords, pitRecords: state.pitchingRecords, idKey: 'gameId',
    units, unitIds: new Set(units.map(g => g.id)),
    battingPanelId: 'subtab-batting-stats', pitchingPanelId: 'subtab-pitching-stats',
    showFilter: true, unitNoun: '試合',
  };
}
function practiceStatsCtx() {
  const season = getCurrentSeason();
  const units = season ? state.practiceSessions.filter(s => s.seasonId === season.id) : state.practiceSessions;
  return {
    kind: 'practice', batRecords: state.practiceBattingRecords, pitRecords: state.practicePitchingRecords, idKey: 'sessionId',
    units, unitIds: new Set(units.map(s => s.id)),
    battingPanelId: 'subtab-p-batting-stats', pitchingPanelId: 'subtab-p-pitching-stats',
    showFilter: false, unitNoun: '回', exactBavg: true,
  };
}

function renderStatsTab() {
  const activeSubtab = document.querySelector('#panel-stats .subtab.active');
  if (activeSubtab) renderSubtab(activeSubtab.dataset.subtab);
  else renderSubtab('batting-stats');
}

function renderPracticeStats() {
  const activeSubtab = document.querySelector('#panel-practice-stats .subtab.active');
  renderSubtab(activeSubtab ? activeSubtab.dataset.subtab : 'p-batting-stats');
}

function renderSubtab(name) {
  if (name === 'batting-stats')    renderBattingStats(gameStatsCtx());
  if (name === 'pitching-stats')   renderPitchingStats(gameStatsCtx());
  if (name === 'p-batting-stats')  renderBattingStats(practiceStatsCtx());
  if (name === 'p-pitching-stats') renderPitchingStats(practiceStatsCtx());
}

/* ===== 個人成績タブ ===== */
function teamBattingAggregate(rows) {
  const s = { atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0, walks: 0, hitByPitch: 0, sacrifices: 0 };
  rows.forEach(r => { ['atBats','hits','doubles','triples','homeRuns','walks','hitByPitch','sacrifices'].forEach(k => s[k] += (r[k] || 0)); });
  const tb = (s.hits - s.doubles - s.triples - s.homeRuns) + s.doubles * 2 + s.triples * 3 + s.homeRuns * 4;
  const pa = s.atBats + s.walks + s.hitByPitch + s.sacrifices;
  const avg = s.atBats > 0 ? s.hits / s.atBats : NaN;
  const obp = pa > 0 ? (s.hits + s.walks + s.hitByPitch) / pa : NaN;
  const slg = s.atBats > 0 ? tb / s.atBats : NaN;
  return { avg, obp, slg, ops: obp + slg };
}
function teamPitchingAggregate(rows) {
  let ip = 0; const s = { earnedRuns: 0, hitsAllowed: 0, walks: 0, strikeouts: 0 };
  rows.forEach(r => { ip += (r.ipDec || 0); ['earnedRuns','hitsAllowed','walks','strikeouts'].forEach(k => s[k] += (r[k] || 0)); });
  return { era: ip > 0 ? s.earnedRuns * 9 / ip : NaN, whip: ip > 0 ? (s.walks + s.hitsAllowed) / ip : NaN };
}

function fmtMetric(v, fmt) {
  if (v == null || isNaN(v) || !isFinite(v)) return '---';
  if (fmt === 'avg') return fmtAvg(v);
  if (fmt === 'dec3') return v.toFixed(3);
  if (fmt === 'dec2') return v.toFixed(2);
  return v;
}

// 個人KPIカード：値＋チーム平均との比較
function makePlayerKpi(label, value, teamValue, fmt, higherBetter) {
  const card = document.createElement('div');
  card.className = 'kpi-card';
  const l = document.createElement('div'); l.className = 'kpi-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'kpi-value'; v.textContent = fmtMetric(value, fmt);
  card.append(l, v);
  if (teamValue != null && !isNaN(teamValue) && isFinite(teamValue) && value != null && !isNaN(value) && isFinite(value)) {
    const cmp = document.createElement('div');
    cmp.className = 'kpi-compare';
    const diff = value - teamValue;
    const good = higherBetter ? diff > 0 : diff < 0;
    const sign = diff > 0 ? '+' : '';
    const diffStr = (fmt === 'avg' || fmt === 'dec3') ? (sign + diff.toFixed(3)) : (fmt === 'dec2' ? sign + diff.toFixed(2) : sign + diff);
    cmp.innerHTML = `チーム平均 ${fmtMetric(teamValue, fmt)} <span style="color:${Math.abs(diff) < 1e-9 ? 'var(--text-muted)' : (good ? '#16a34a' : '#dc2626')};font-weight:700">${Math.abs(diff) < 1e-9 ? '±0' : diffStr}</span>`;
    card.appendChild(cmp);
  }
  return card;
}

function renderPlayerStatsContent(playerId, container) {
  if (!container) return;
  container.innerHTML = '';
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  const season = getCurrentSeason();
  const seasonGameIds = new Set((season ? state.games.filter(g => g.seasonId === season.id) : state.games).map(g => g.id));

  const battingRows = computeBattingStats(seasonGameIds);
  const me = battingRows.find(r => r.playerId === playerId);
  const teamBat = teamBattingAggregate(battingRows);

  // メタ情報（出場試合数・守備位置）
  const meta = document.createElement('div');
  meta.className = 'player-meta';
  const gp = me ? me.games : 0;
  const positions = (player.positions || []).join('・') || '—';
  meta.innerHTML = `<span class="player-meta-item">出場 <strong>${gp}</strong> 試合</span><span class="player-meta-item">守備位置 <strong>${positions}</strong></span><span class="player-meta-item">学年 <strong>${player.grade ? player.grade + '年' : '—'}</strong></span>`;
  container.appendChild(meta);

  // 打撃KPI
  if (me) {
    const h = document.createElement('h2'); h.className = 'card-title player-section-title'; h.textContent = '打撃';
    container.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'kpi-grid';
    grid.appendChild(makePlayerKpi('打率', me.avg, teamBat.avg, 'avg', true));
    grid.appendChild(makePlayerKpi('出塁率', me.obp, teamBat.obp, 'avg', true));
    grid.appendChild(makePlayerKpi('長打率', me.slg, teamBat.slg, 'avg', true));
    grid.appendChild(makePlayerKpi('OPS', me.ops, teamBat.ops, 'dec3', true));
    grid.appendChild(makeKpiCard('本塁打', me.homeRuns));
    grid.appendChild(makeKpiCard('打点', me.rbi));
    container.appendChild(grid);
    renderPlayerTrendChart(container, 'batting', playerId);
    renderPlayerGameLog(container, playerId, 'batting');
  }

  // 投球KPI（投手記録がある場合のみ）
  const pitchRows = computePitchingStats(seasonGameIds);
  const mePitch = pitchRows.find(r => r.playerId === playerId);
  if (mePitch) {
    const teamPit = teamPitchingAggregate(pitchRows);
    const h = document.createElement('h2'); h.className = 'card-title player-section-title'; h.textContent = '投球';
    container.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'kpi-grid';
    grid.appendChild(makePlayerKpi('防御率', mePitch.era, teamPit.era, 'dec2', false));
    grid.appendChild(makePlayerKpi('WHIP', mePitch.whip, teamPit.whip, 'dec2', false));
    grid.appendChild(makeKpiCard('奪三振', mePitch.strikeouts));
    grid.appendChild(makeKpiCard('勝-敗-S', `${mePitch.wins}-${mePitch.losses}-${mePitch.saves}`));
    container.appendChild(grid);
    renderPlayerTrendChart(container, 'pitching', playerId);
    renderPlayerGameLog(container, playerId, 'pitching');
  }

  if (!me && !mePitch) {
    container.appendChild(emptyState('📊', 'この選手の成績記録がありません', '試合の成績を入力すると表示されます'));
  }
}

// 試合ごとのログ表（直近順）
function renderPlayerGameLog(container, playerId, type) {
  const records = (type === 'batting' ? state.battingRecords : state.pitchingRecords)
    .filter(r => r.playerId === playerId)
    .map(r => { const g = state.games.find(x => x.id === r.gameId); return g ? { ...r, _date: g.date, _opp: g.opponent } : null; })
    .filter(Boolean)
    .sort((a, b) => b._date.localeCompare(a._date));
  if (!records.length) return;

  const card = document.createElement('div'); card.className = 'card';
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const tbl = document.createElement('table'); tbl.className = 'data-table';
  let heads, rowFn;
  if (type === 'batting') {
    heads = ['試合日', '対戦', '打数', '安打', '二', '三', '本', '打点', '得点', '三振', '四球', '打率'];
    rowFn = r => {
      const avg = r.atBats > 0 ? r.hits / r.atBats : NaN;
      return [r._date.slice(5), r._opp, r.atBats||0, r.hits||0, r.doubles||0, r.triples||0, r.homeRuns||0, r.rbi||0, r.runs||0, r.strikeouts||0, r.walks||0, fmtAvg(avg)];
    };
  } else {
    heads = ['試合日', '対戦', '投球回', '球数', '被安打', '失点', '自責点', '与四球', '奪三振', '防御率'];
    rowFn = r => {
      const ip = ipToDecimal(r.inningsPitched || 0);
      const era = ip > 0 ? (r.earnedRuns || 0) * 9 / ip : NaN;
      const outs = Math.round((r.inningsPitched || 0) % 1 * 10);
      const ipStr = `${Math.floor(r.inningsPitched || 0)}${outs ? '.' + outs : ''}`;
      return [r._date.slice(5), r._opp, ipStr, r.pitchCount||0, r.hitsAllowed||0, r.runsAllowed||0, r.earnedRuns||0, r.walks||0, r.strikeouts||0, isNaN(era) ? '---' : era.toFixed(2)];
    };
  }
  const thead = document.createElement('thead'); const htr = document.createElement('tr');
  heads.forEach(h => { const th = document.createElement('th'); th.textContent = h; htr.appendChild(th); });
  thead.appendChild(htr); tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  records.forEach(r => {
    const tr = document.createElement('tr');
    rowFn(r).forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i === 1) td.style.fontFamily = 'var(--font-sans)'; tr.appendChild(td); });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  wrap.appendChild(tbl); card.appendChild(wrap); container.appendChild(card);
}

function renderBattingStats(ctx = gameStatsCtx()) {
  const panel = document.getElementById(ctx.battingPanelId);
  panel.innerHTML = '';

  const body = document.createElement('div');

  const drawBattingStats = (filterGameIds) => {
    body.innerHTML = '';
    const rows = computeBattingStats(filterGameIds, ctx.batRecords, ctx.idKey);

    if (!rows.length) {
      body.appendChild(emptyState('📊', 'データがありません', '試合結果を入力すると自動で集計されます'));
      return;
    }

    const teamAvg = rows.reduce((s, r) => s + (isNaN(r.avg) ? 0 : r.avg), 0) / rows.filter(r => !isNaN(r.avg)).length;
    const validOps = rows.filter(r => !isNaN(r.ops) && isFinite(r.ops));
    const teamOPS = validOps.length ? validOps.reduce((s, r) => s + r.ops, 0) / validOps.length : NaN;
    const totalSb = rows.reduce((s,r)=>s+r.stolenBases,0);
    const totalCs = rows.reduce((s,r)=>s+r.caughtStealing,0);
    const teamSbPct = (totalSb + totalCs) > 0 ? totalSb / (totalSb + totalCs) : NaN;

    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'kpi-grid';
    [
      { label: 'チーム打率', value: fmtAvg(teamAvg) },
      { label: 'チーム得点', value: rows.reduce((s,r)=>s+r.runs,0) },
      { label: '盗塁成功率', value: isNaN(teamSbPct) ? '---' : (teamSbPct*100).toFixed(1)+'%' },
      { label: 'チームOPS',  value: isNaN(teamOPS) ? '---' : teamOPS.toFixed(3) },
    ].forEach(k => kpiGrid.appendChild(makeKpiCard(k.label, k.value)));
    body.appendChild(kpiGrid);

    const totalGames = filterGameIds ? filterGameIds.size : ctx.units.length;
    const qualBatting = rows.filter(r => r.pa >= Math.max(1, totalGames));
    const chartBase = qualBatting.length > 0 ? qualBatting : rows;
    const avgTop5 = [...chartBase].filter(r => !isNaN(r.avg) && isFinite(r.avg)).sort((a, b) => b.avg - a.avg).slice(0, 5);
    const opsTop5 = [...chartBase].filter(r => !isNaN(r.ops) && isFinite(r.ops)).sort((a, b) => b.ops - a.ops).slice(0, 5);

    if ((avgTop5.length >= 1 || opsTop5.length >= 1) && typeof Chart !== 'undefined') {
      const chartRow = document.createElement('div');
      chartRow.className = 'chart-row';
      const c1 = document.createElement('div'); c1.className = 'chart-card';
      const t1 = document.createElement('div'); t1.className = 'chart-title'; t1.textContent = '打率 TOP5（規定打席到達者）';
      const canvas1 = document.createElement('canvas'); canvas1.height = 220;
      c1.append(t1, canvas1); chartRow.appendChild(c1);
      const c2 = document.createElement('div'); c2.className = 'chart-card';
      const t2 = document.createElement('div'); t2.className = 'chart-title'; t2.textContent = 'OPS TOP5（規定打席到達者）';
      const canvas2 = document.createElement('canvas'); canvas2.height = 220;
      c2.append(t2, canvas2); chartRow.appendChild(c2);
      body.appendChild(chartRow);
      if (_charts.battingAvg) _charts.battingAvg.destroy();
      _charts.battingAvg = new Chart(canvas1, { type: 'bar', data: { labels: avgTop5.map(r=>r.name), datasets: [{ label: '打率', data: avgTop5.map(r=>+r.avg.toFixed(3)), backgroundColor: 'rgba(0,120,255,0.7)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '.'+String(Math.round(v*1000)).padStart(3,'0') } } } } });
      if (_charts.battingBar) _charts.battingBar.destroy();
      _charts.battingBar = new Chart(canvas2, { type: 'bar', data: { labels: opsTop5.map(r=>r.name), datasets: [{ label: 'OPS', data: opsTop5.map(r=>+r.ops.toFixed(3)), backgroundColor: 'rgba(139,92,246,0.7)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v.toFixed(3) } } } } });
    }

    if (typeof Chart !== 'undefined') {
      const BATTING_METRICS = [
        { key: 'atBats', label: '打数', fmt: 'int' }, { key: 'pa', label: '打席', fmt: 'int' },
        { key: 'hits', label: '安打', fmt: 'int' }, { key: 'doubles', label: '二塁打', fmt: 'int' },
        { key: 'triples', label: '三塁打', fmt: 'int' }, { key: 'homeRuns', label: '本塁打', fmt: 'int' },
        { key: 'rbi', label: '打点', fmt: 'int' }, { key: 'runs', label: '得点', fmt: 'int' },
        { key: 'strikeouts', label: '三振', fmt: 'int' }, { key: 'walks', label: '四球', fmt: 'int' },
        { key: 'stolenBases', label: '盗塁', fmt: 'int' }, { key: 'tb', label: '塁打', fmt: 'int' },
        { key: 'avg', label: '打率', fmt: 'avg' }, { key: 'obp', label: '出塁率', fmt: 'avg' },
        { key: 'slg', label: '長打率', fmt: 'avg' }, { key: 'ops', label: 'OPS', fmt: 'dec3' },
        { key: 'sbPct', label: '盗塁成功率', fmt: 'pct' },
      ];
      const customBattingCard = document.createElement('div'); customBattingCard.className = 'chart-card';
      const customBattingHeader = document.createElement('div'); customBattingHeader.className = 'chart-custom-header';
      const customBattingTitle = document.createElement('div'); customBattingTitle.className = 'chart-title'; customBattingTitle.textContent = 'カスタム項目グラフ';
      const customBattingSelect = document.createElement('select'); customBattingSelect.className = 'form-select chart-custom-select';
      BATTING_METRICS.forEach(m => { const opt = document.createElement('option'); opt.value = m.key; opt.textContent = m.label; customBattingSelect.appendChild(opt); });
      customBattingHeader.append(customBattingTitle, customBattingSelect);
      const customBattingCanvas = document.createElement('canvas'); customBattingCanvas.height = 220;
      customBattingCard.append(customBattingHeader, customBattingCanvas);
      body.appendChild(customBattingCard);
      const drawCustomBatting = key => {
        const meta = BATTING_METRICS.find(m => m.key === key);
        const sorted = [...rows].filter(r => r[key] != null && !isNaN(r[key]) && isFinite(r[key])).sort((a, b) => b[key] - a[key]).slice(0, 10);
        const ticksCb = meta.fmt === 'avg' ? { callback: v => '.'+String(Math.round(v*1000)).padStart(3,'0') } : meta.fmt === 'dec3' ? { callback: v => v.toFixed(3) } : meta.fmt === 'pct' ? { callback: v => (v*100).toFixed(1)+'%' } : {};
        const dataVals = sorted.map(r => meta.fmt === 'avg' ? +r[key].toFixed(3) : meta.fmt === 'dec3' ? +r[key].toFixed(3) : meta.fmt === 'pct' ? +r[key].toFixed(3) : r[key]);
        if (_charts.battingCustom) _charts.battingCustom.destroy();
        _charts.battingCustom = new Chart(customBattingCanvas, { type: 'bar', data: { labels: sorted.map(r=>r.name), datasets: [{ label: meta.label, data: dataVals, backgroundColor: 'rgba(251,146,60,0.75)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: ticksCb } } } });
      };
      customBattingSelect.addEventListener('change', () => drawCustomBatting(customBattingSelect.value));
      drawCustomBatting(BATTING_METRICS[0].key);
    }

    const cols = [
      { key: 'name',        label: '選手名',  num: false },
      { key: 'games',       label: '試合',   p: 0 },
      { key: 'atBats',      label: '打数',   p: 0 },
      { key: 'pa',          label: '打席',   p: 0, highIsGood: true },
      { key: 'hits',        label: '安打',   p: 0, highIsGood: true },
      { key: 'doubles',     label: '二塁',   p: 0, highIsGood: true },
      { key: 'triples',     label: '三塁',   p: 0, highIsGood: true },
      { key: 'homeRuns',    label: '本塁',   p: 0, highIsGood: true },
      { key: 'rbi',         label: '打点',   p: 0, highIsGood: true },
      { key: 'runs',        label: '得点',   p: 0, highIsGood: true },
      { key: 'strikeouts',  label: '三振',   p: 0 },
      { key: 'walks',       label: '四球',   p: 0, highIsGood: true },
      { key: 'stolenBases', label: '盗塁',   p: 0, highIsGood: true },
      { key: 'sbPct',       label: '盗塁成功率', pct: true, highIsGood: true },
      { key: 'avg',         label: '打率',   avg: true, highIsGood: true },
      { key: 'obp',         label: '出塁率', avg: true, highIsGood: true },
      { key: 'slg',         label: '長打率', avg: true, highIsGood: true },
      { key: 'ops',         label: 'OPS',    p: 3, highIsGood: true },
    ];
    renderRecentForm(body, 'batting', filterGameIds, ctx);
    renderPlayerComparison(body, 'batting', rows);
    body.appendChild(makeStatsTable(rows, cols));

    const csvBtnB = document.createElement('button');
    csvBtnB.className = 'btn btn-ghost btn-sm';
    csvBtnB.style.marginTop = '8px';
    csvBtnB.textContent = 'CSVで出力';
    csvBtnB.addEventListener('click', () => {
      downloadCSV('batting_stats_' + new Date().toISOString().split('T')[0] + '.csv', rows, [
        { key: 'name', label: '選手名' }, { key: 'games', label: '試合', p: 0 },
        { key: 'atBats', label: '打数', p: 0 }, { key: 'pa', label: '打席', p: 0 },
        { key: 'hits', label: '安打', p: 0 }, { key: 'doubles', label: '二塁打', p: 0 },
        { key: 'triples', label: '三塁打', p: 0 }, { key: 'homeRuns', label: '本塁打', p: 0 },
        { key: 'rbi', label: '打点', p: 0 }, { key: 'runs', label: '得点', p: 0 },
        { key: 'strikeouts', label: '三振', p: 0 }, { key: 'walks', label: '四球', p: 0 },
        { key: 'stolenBases', label: '盗塁', p: 0 }, { key: 'caughtStealing', label: '盗塁死', p: 0 },
        { key: 'avg', label: '打率', avg: true }, { key: 'obp', label: '出塁率', avg: true },
        { key: 'slg', label: '長打率', avg: true }, { key: 'ops', label: 'OPS', p: 3 },
      ]);
    });
    body.appendChild(csvBtnB);
  };

  if (ctx.showFilter) buildStatsFilter(panel, drawBattingStats, ctx.units);
  panel.appendChild(body);
  drawBattingStats(ctx.unitIds);
}

function renderPitchingStats(ctx = gameStatsCtx()) {
  const panel = document.getElementById(ctx.pitchingPanelId);
  panel.innerHTML = '';

  const body = document.createElement('div');

  const drawPitchingStats = (filterGameIds) => {
    body.innerHTML = '';
    const rows = computePitchingStats(filterGameIds, ctx.pitRecords, ctx.idKey);

    if (!rows.length) {
      body.appendChild(emptyState('📊', 'データがありません', '投球データを入力してください'));
      return;
    }

    // 実践は正確な被打数(atBatsAgainst)を保持しているため、被打率をIP由来近似から実測へ上書き
    if (ctx.exactBavg) {
      const abMap = {};
      ctx.pitRecords.filter(r => !filterGameIds || filterGameIds.has(r[ctx.idKey])).forEach(r => {
        if (!abMap[r.playerId]) abMap[r.playerId] = { ab: 0, h: 0 };
        abMap[r.playerId].ab += (r.atBatsAgainst || 0);
        abMap[r.playerId].h += (r.hitsAllowed || 0);
      });
      rows.forEach(row => { const m = abMap[row.playerId]; if (m && m.ab > 0) row.bavg = m.h / m.ab; });
    }

    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'kpi-grid';
    const totalIpDec = rows.reduce((s,r)=>s+(r.ipDec||0),0);
    const teamEra = totalIpDec > 0 ? rows.reduce((s,r)=>s+r.earnedRuns,0)*9 / totalIpDec : NaN;
    [
      { label: 'チーム防御率', value: fmt(teamEra, 2),                                        cls: 'accent-green' },
      { label: '総失点',       value: rows.reduce((s,r)=>s+(r.runsAllowed||0),0),             cls: 'accent-green' },
      { label: '総自責点',     value: rows.reduce((s,r)=>s+r.earnedRuns,0),                   cls: 'accent-green' },
      { label: '四死球',       value: rows.reduce((s,r)=>s+r.walks+r.hitByPitch,0),           cls: 'accent-green' },
    ].forEach(k => kpiGrid.appendChild(makeKpiCard(k.label, k.value, k.cls)));
    body.appendChild(kpiGrid);

    const totalGamesP = filterGameIds ? filterGameIds.size : ctx.units.length;
    const qualPitching = rows.filter(r => r.ipDec >= Math.max(1, totalGamesP));
    const pitchBase = qualPitching.length > 0 ? qualPitching : rows;
    const eraTop5  = [...pitchBase].filter(r => !isNaN(r.era)  && isFinite(r.era)).sort((a, b) => a.era  - b.era).slice(0, 5);
    const whipTop5 = [...pitchBase].filter(r => !isNaN(r.whip) && isFinite(r.whip)).sort((a, b) => a.whip - b.whip).slice(0, 5);

    if ((eraTop5.length >= 1 || whipTop5.length >= 1) && typeof Chart !== 'undefined') {
      const chartRow = document.createElement('div'); chartRow.className = 'chart-row';
      const c1 = document.createElement('div'); c1.className = 'chart-card';
      const t1 = document.createElement('div'); t1.className = 'chart-title'; t1.textContent = '防御率 TOP5（規定投球回到達者）';
      const canvas1 = document.createElement('canvas'); canvas1.height = 220;
      c1.append(t1, canvas1); chartRow.appendChild(c1);
      const c2 = document.createElement('div'); c2.className = 'chart-card';
      const t2 = document.createElement('div'); t2.className = 'chart-title'; t2.textContent = 'WHIP TOP5（規定投球回到達者）';
      const canvas2 = document.createElement('canvas'); canvas2.height = 220;
      c2.append(t2, canvas2); chartRow.appendChild(c2);
      body.appendChild(chartRow);
      if (_charts.pitchingEra) _charts.pitchingEra.destroy();
      _charts.pitchingEra = new Chart(canvas1, { type: 'bar', data: { labels: eraTop5.map(r=>r.name), datasets: [{ label: '防御率', data: eraTop5.map(r=>+r.era.toFixed(2)), backgroundColor: 'rgba(22,163,74,0.7)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'ERA（低いほど良い）' } } } } });
      if (_charts.pitchingBar) _charts.pitchingBar.destroy();
      _charts.pitchingBar = new Chart(canvas2, { type: 'bar', data: { labels: whipTop5.map(r=>r.name), datasets: [{ label: 'WHIP', data: whipTop5.map(r=>+r.whip.toFixed(2)), backgroundColor: 'rgba(0,120,255,0.7)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'WHIP（低いほど良い）' } } } } });
    }

    if (typeof Chart !== 'undefined') {
      const PITCHING_METRICS = [
        { key: 'games', label: '登板', fmt: 'int' }, { key: 'wins', label: '勝', fmt: 'int' },
        { key: 'losses', label: '負', fmt: 'int' }, { key: 'saves', label: 'S', fmt: 'int' },
        { key: 'pitchCount', label: '球数', fmt: 'int' }, { key: 'hitsAllowed', label: '被安打', fmt: 'int' },
        { key: 'runsAllowed', label: '失点', fmt: 'int' }, { key: 'earnedRuns', label: '自責点', fmt: 'int' },
        { key: 'walks', label: '与四球', fmt: 'int' }, { key: 'strikeouts', label: '奪三振', fmt: 'int' },
        { key: 'homeRunsAllowed', label: '被本塁打', fmt: 'int' },
        { key: 'era', label: '防御率', fmt: 'dec2' }, { key: 'whip', label: 'WHIP', fmt: 'dec2' },
        { key: 'k9', label: 'K/9', fmt: 'dec2' }, { key: 'bavg', label: '被打率', fmt: 'avg' },
      ];
      const customPitchingCard = document.createElement('div'); customPitchingCard.className = 'chart-card';
      const customPitchingHeader = document.createElement('div'); customPitchingHeader.className = 'chart-custom-header';
      const customPitchingTitle = document.createElement('div'); customPitchingTitle.className = 'chart-title'; customPitchingTitle.textContent = 'カスタム項目グラフ';
      const customPitchingSelect = document.createElement('select'); customPitchingSelect.className = 'form-select chart-custom-select';
      PITCHING_METRICS.forEach(m => { const opt = document.createElement('option'); opt.value = m.key; opt.textContent = m.label; customPitchingSelect.appendChild(opt); });
      customPitchingHeader.append(customPitchingTitle, customPitchingSelect);
      const customPitchingCanvas = document.createElement('canvas'); customPitchingCanvas.height = 220;
      customPitchingCard.append(customPitchingHeader, customPitchingCanvas);
      body.appendChild(customPitchingCard);
      const drawCustomPitching = key => {
        const meta = PITCHING_METRICS.find(m => m.key === key);
        const lowerIsBetter = ['era', 'whip', 'bavg'].includes(key);
        const sorted = [...rows].filter(r => r[key] != null && !isNaN(r[key]) && isFinite(r[key])).sort((a, b) => lowerIsBetter ? a[key]-b[key] : b[key]-a[key]).slice(0, 10);
        const ticksCb = meta.fmt === 'avg' ? { callback: v => '.'+String(Math.round(v*1000)).padStart(3,'0') } : meta.fmt === 'dec2' ? { callback: v => v.toFixed(2) } : {};
        const dataVals = sorted.map(r => meta.fmt === 'avg' ? +r[key].toFixed(3) : meta.fmt === 'dec2' ? +r[key].toFixed(2) : r[key]);
        if (_charts.pitchingCustom) _charts.pitchingCustom.destroy();
        _charts.pitchingCustom = new Chart(customPitchingCanvas, { type: 'bar', data: { labels: sorted.map(r=>r.name), datasets: [{ label: meta.label, data: dataVals, backgroundColor: 'rgba(20,184,166,0.75)', borderRadius: 4 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: ticksCb } } } });
      };
      customPitchingSelect.addEventListener('change', () => drawCustomPitching(customPitchingSelect.value));
      drawCustomPitching(PITCHING_METRICS[0].key);
    }

    const cols = [
      { key: 'name',        label: '選手名',  num: false },
      { key: 'games',       label: '登板',   p: 0 },
      { key: 'wins',        label: '勝',     p: 0, highIsGood: true },
      { key: 'losses',      label: '負',     p: 0 },
      { key: 'saves',       label: 'S',      p: 0, highIsGood: true },
      { key: 'ipDec',       label: '投球回', ipDec: true, highIsGood: true },
      { key: 'pitchCount',  label: '球数',   p: 0 },
      { key: 'hitsAllowed', label: '被安打', p: 0, highIsGood: false },
      { key: 'runsAllowed', label: '失点',   p: 0, highIsGood: false },
      { key: 'earnedRuns',  label: '自責点', p: 0, highIsGood: false },
      { key: 'walks',       label: '与四球', p: 0, highIsGood: false },
      { key: 'hitByPitch',  label: '与死球', p: 0, highIsGood: false },
      { key: 'strikeouts',  label: '奪三振', p: 0, highIsGood: true },
      { key: 'era',         label: '防御率', p: 2, highIsGood: false },
      { key: 'whip',        label: 'WHIP',   p: 2, highIsGood: false },
      { key: 'k9',          label: 'K/9',    p: 2, highIsGood: true },
      { key: 'bavg',        label: '被打率', avg: true, highIsGood: false },
    ];
    renderRecentForm(body, 'pitching', filterGameIds, ctx);
    renderPlayerComparison(body, 'pitching', rows);
    body.appendChild(makeStatsTable(rows, cols));

    const csvBtnP = document.createElement('button');
    csvBtnP.className = 'btn btn-ghost btn-sm';
    csvBtnP.style.marginTop = '8px';
    csvBtnP.textContent = 'CSVで出力';
    csvBtnP.addEventListener('click', () => {
      downloadCSV('pitching_stats_' + new Date().toISOString().split('T')[0] + '.csv', rows, [
        { key: 'name', label: '選手名' }, { key: 'games', label: '登板', p: 0 },
        { key: 'wins', label: '勝', p: 0 }, { key: 'losses', label: '負', p: 0 },
        { key: 'saves', label: 'S', p: 0 }, { key: 'ipDec', label: '投球回', ipDec: true },
        { key: 'pitchCount', label: '球数', p: 0 }, { key: 'hitsAllowed', label: '被安打', p: 0 },
        { key: 'runsAllowed', label: '失点', p: 0 }, { key: 'earnedRuns', label: '自責点', p: 0 },
        { key: 'walks', label: '与四球', p: 0 }, { key: 'hitByPitch', label: '与死球', p: 0 },
        { key: 'strikeouts', label: '奪三振', p: 0 }, { key: 'homeRunsAllowed', label: '被本塁打', p: 0 },
        { key: 'era', label: '防御率', p: 2 }, { key: 'whip', label: 'WHIP', p: 2 },
        { key: 'k9', label: 'K/9', p: 2 }, { key: 'bavg', label: '被打率', avg: true },
      ]);
    });
    body.appendChild(csvBtnP);
  };

  if (ctx.showFilter) buildStatsFilter(panel, drawPitchingStats, ctx.units);
  panel.appendChild(body);
  drawPitchingStats(ctx.unitIds);
}


function renderGameStats() {
  const panel = document.getElementById('game-stats-container');
  if (!panel) return;
  panel.innerHTML = '';

  const season = getCurrentSeason();
  const seasonGames = season ? state.games.filter(g => g.seasonId === season.id) : state.games;

  if (!seasonGames.length) return;

  const filterWrap = document.createElement('div');
  filterWrap.className = 'stats-filter';
  const filterLabel = document.createElement('span');
  filterLabel.className = 'stats-filter-label';
  filterLabel.textContent = '表示範囲：';
  const filterSelect = document.createElement('select');
  filterSelect.className = 'form-select stats-filter-select';
  [['total','合計'],['all','全て'],['spring','春リーグ'],['fall','秋リーグ'],['practice','練習試合'],['other','その他']].forEach(([v,t]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    filterSelect.appendChild(opt);
  });
  filterWrap.append(filterLabel, filterSelect);
  panel.appendChild(filterWrap);

  const body = document.createElement('div');
  panel.appendChild(body);

  const drawGameStats = (filterVal) => {
    body.innerHTML = '';
    let games = seasonGames;
    if (filterVal === 'total') games = games.filter(g => g.gameType === 'spring' || g.gameType === 'fall');
    else if (filterVal !== 'all') games = games.filter(g => g.gameType === filterVal);

    if (!games.length) {
      body.appendChild(emptyState('📊', 'データがありません', '該当する試合がありません'));
      return;
    }

    const wins   = games.filter(g => g.result === '勝').length;
    const losses = games.filter(g => g.result === '負').length;
    const draws  = games.filter(g => g.result === '引分').length;
    const total  = games.length;
    const scored  = games.reduce((s, g) => s + g.ourScore, 0);
    const allowed = games.reduce((s, g) => s + g.opponentScore, 0);
    const wpct = (wins + losses) > 0 ? wins / (wins + losses) : NaN;

    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'kpi-grid';
    [
      { label: '試合数', value: total, cls: 'accent-amber' },
      { label: '勝敗',   value: `${wins}勝${losses}敗${draws}分`, cls: 'accent-amber kpi-compact' },
      { label: '勝率',   value: isNaN(wpct) ? '---' : fmt(wpct, 3), cls: 'accent-amber' },
      { label: '得点−失点', value: `${scored}−${allowed}`, cls: 'accent-amber kpi-compact' },
    ].forEach(k => kpiGrid.appendChild(makeKpiCard(k.label, k.value, k.cls)));
    body.appendChild(kpiGrid);
  };

  filterSelect.addEventListener('change', () => drawGameStats(filterSelect.value));
  drawGameStats('total');
}

/* ===== GAME HISTORY TAB ===== */

/* ===== 星取表（リーグ戦） ===== */
function ourTeamName() {
  return (state.teamName && state.teamName.trim()) || '自チーム';
}

// 自チームの試合 + 他チーム同士の結果を合算したリーグ順位表
function computeStandings(seasonId, type) {
  const OUR = ourTeamName();
  const teamNames = state.leagueTeams.filter(t => t.seasonId === seasonId && t.type === type).map(t => t.name);
  const allNames = [OUR, ...teamNames];
  const stat = {};
  allNames.forEach(n => stat[n] = { name: n, isOur: n === OUR, games: 0, w: 0, l: 0, d: 0, rf: 0, ra: 0 });
  const apply = (name, rf, ra) => {
    const s = stat[name];
    if (!s) return;
    s.games++; s.rf += rf; s.ra += ra;
    if (rf > ra) s.w++; else if (rf < ra) s.l++; else s.d++;
  };
  // 自チームの試合（試合登録データから自動）
  state.games.filter(g => g.seasonId === seasonId && g.gameType === type).forEach(g => {
    apply(OUR, g.ourScore || 0, g.opponentScore || 0);
    apply(g.opponent, g.opponentScore || 0, g.ourScore || 0);
  });
  // 他チーム同士の結果（手入力）
  state.leagueResults.filter(r => r.seasonId === seasonId && r.type === type).forEach(r => {
    apply(r.teamA, r.scoreA || 0, r.scoreB || 0);
    apply(r.teamB, r.scoreB || 0, r.scoreA || 0);
  });
  const rows = Object.values(stat).map(s => ({ ...s, diff: s.rf - s.ra, pct: (s.w + s.l) > 0 ? s.w / (s.w + s.l) : null }));
  rows.sort((a, b) => {
    const pa = a.pct == null ? -1 : a.pct, pb = b.pct == null ? -1 : b.pct;
    if (pb !== pa) return pb - pa;
    return b.diff - a.diff;
  });
  return rows;
}

function renderStandings() {
  const container = document.getElementById('standings-container');
  if (!container) return;
  container.innerHTML = '';
  const season = getCurrentSeason();
  if (!season) return;

  [['spring', '春リーグ'], ['fall', '秋リーグ']].forEach(([type, label]) => {
    const teamNames = state.leagueTeams.filter(t => t.seasonId === season.id && t.type === type).map(t => t.name);
    const rows = computeStandings(season.id, type);
    const card = document.createElement('div');
    card.className = 'card standings-card';

    const head = document.createElement('div');
    head.className = 'card-header';
    const h = document.createElement('h2'); h.className = 'card-title'; h.textContent = `${label} 星取表`;
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit-teams';
    editBtn.textContent = '⚙ 参加チーム編集';
    editBtn.addEventListener('click', () => openLeagueModal(season.id, type, label));
    head.append(h, editBtn);
    card.appendChild(head);

    if (!teamNames.length) {
      card.appendChild(emptyState('🏆', '参加チームが未登録です', '「参加チーム編集」からリーグの対戦校を追加してください'));
      container.appendChild(card);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'data-table standings-table';
    tbl.innerHTML = '<thead><tr><th>順位</th><th>チーム</th><th>試合</th><th>勝</th><th>負</th><th>分</th><th>勝率</th><th>得点</th><th>失点</th><th>得失差</th></tr></thead>';
    const tbody = document.createElement('tbody');
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.isOur) tr.className = 'our-team-row';
      const td = (txt, sans) => { const c = document.createElement('td'); c.textContent = txt; if (sans) c.style.fontFamily = 'var(--font-sans)'; return c; };
      const pct = r.pct == null ? '---' : r.pct.toFixed(3).replace(/^0/, '');
      const diff = (r.diff > 0 ? '+' : '') + r.diff;
      tr.append(
        td(r.games ? i + 1 : '−'),
        td(r.name, true),
        td(r.games), td(r.w), td(r.l), td(r.d),
        td(pct), td(r.rf), td(r.ra), td(diff)
      );
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);

    // 他チーム同士の結果 入力セクション
    card.appendChild(buildLeagueResultInput(season.id, type, teamNames));
    container.appendChild(card);
  });
}

// 他チーム同士の結果の入力フォーム＋登録済みリスト
function buildLeagueResultInput(seasonId, type, teamNames) {
  const sec = document.createElement('div');
  sec.className = 'league-result-input';
  const title = document.createElement('div');
  title.className = 'league-result-title';
  title.textContent = '他チーム同士の結果を入力';
  sec.appendChild(title);

  if (teamNames.length < 2) {
    const hint = document.createElement('div');
    hint.className = 'league-empty-hint';
    hint.textContent = '参加チームを2チーム以上登録すると入力できます';
    sec.appendChild(hint);
    return sec;
  }

  const mkSelect = (placeholder) => {
    const s = document.createElement('select');
    s.className = 'form-select';
    const none = document.createElement('option'); none.value = ''; none.textContent = placeholder; s.appendChild(none);
    teamNames.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; s.appendChild(o); });
    return s;
  };
  const mkScore = () => {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '0'; inp.max = '99'; inp.className = 'form-input league-score-input'; inp.placeholder = '0';
    return inp;
  };

  const row = document.createElement('div');
  row.className = 'league-result-row';
  const teamA = mkSelect('チームA');
  const scoreA = mkScore();
  const sep = document.createElement('span'); sep.className = 'league-score-sep'; sep.textContent = '−';
  const scoreB = mkScore();
  const teamB = mkSelect('チームB');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-sm'; addBtn.textContent = '追加';
  addBtn.addEventListener('click', () => {
    const a = teamA.value, b = teamB.value;
    const sa = parseInt(scoreA.value), sb = parseInt(scoreB.value);
    if (!a || !b) { showToast('対戦する2チームを選んでください', 'error'); return; }
    if (a === b) { showToast('異なるチームを選んでください', 'error'); return; }
    if (isNaN(sa) || isNaN(sb)) { showToast('両チームの得点を入力してください', 'error'); return; }
    state.leagueResults.push({ id: newId('lr'), seasonId, type, teamA: a, teamB: b, scoreA: sa, scoreB: sb });
    saveData(state);
    renderStandings();
  });
  row.append(teamA, scoreA, sep, scoreB, teamB, addBtn);
  sec.appendChild(row);

  // 登録済みリスト
  const results = state.leagueResults.filter(r => r.seasonId === seasonId && r.type === type);
  if (results.length) {
    const list = document.createElement('div');
    list.className = 'league-result-list';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'league-result-item';
      const txt = document.createElement('span');
      txt.textContent = `${r.teamA} ${r.scoreA} − ${r.scoreB} ${r.teamB}`;
      const del = document.createElement('button');
      del.className = 'btn-icon-del'; del.textContent = '✕'; del.title = '削除';
      del.addEventListener('click', () => {
        const snap = state.leagueResults.slice();
        state.leagueResults = state.leagueResults.filter(x => x.id !== r.id);
        saveData(state);
        renderStandings();
        showUndoToast('結果を削除しました', () => { state.leagueResults = snap; saveData(state); renderStandings(); });
      });
      item.append(txt, del);
      list.appendChild(item);
    });
    sec.appendChild(list);
  }
  return sec;
}

/* ===== リーグ参加チーム管理モーダル ===== */
let _leagueModalCtx = null;

function openLeagueModal(seasonId, type, label) {
  _leagueModalCtx = { seasonId, type };
  document.getElementById('league-modal-title').textContent = `${label} 参加チーム`;
  document.getElementById('league-team-input').value = '';
  renderLeagueModalBody();
  document.getElementById('league-modal-overlay').style.display = 'flex';
  document.getElementById('league-team-input').focus();
}

function closeLeagueModal() {
  document.getElementById('league-modal-overlay').style.display = 'none';
  _leagueModalCtx = null;
}

function renderLeagueModalBody() {
  const body = document.getElementById('league-modal-body');
  body.innerHTML = '';
  if (!_leagueModalCtx) return;
  const teams = state.leagueTeams.filter(t => t.seasonId === _leagueModalCtx.seasonId && t.type === _leagueModalCtx.type);
  if (!teams.length) {
    const p = document.createElement('p'); p.className = 'league-empty-hint'; p.textContent = 'まだチームがありません。下の欄から追加してください。';
    body.appendChild(p);
    return;
  }
  teams.forEach(t => {
    const row = document.createElement('div');
    row.className = 'league-team-row';
    const name = document.createElement('span'); name.textContent = t.name;
    const del = document.createElement('button');
    del.className = 'btn-icon-del'; del.textContent = '✕'; del.title = '削除';
    del.addEventListener('click', () => {
      const snap = state.leagueTeams.slice();
      state.leagueTeams = state.leagueTeams.filter(x => x.id !== t.id);
      saveData(state);
      renderLeagueModalBody();
      renderStandings();
      showUndoToast('チームを削除しました', () => { state.leagueTeams = snap; saveData(state); renderLeagueModalBody(); renderStandings(); });
    });
    row.append(name, del);
    body.appendChild(row);
  });
}

function addLeagueTeam() {
  if (!_leagueModalCtx) return;
  const input = document.getElementById('league-team-input');
  const name = input.value.trim();
  if (!name) { showToast('チーム名を入力してください', 'error'); return; }
  const dup = state.leagueTeams.some(t => t.seasonId === _leagueModalCtx.seasonId && t.type === _leagueModalCtx.type && t.name === name);
  if (dup) { showToast('同名のチームが既に登録されています', 'error'); return; }
  state.leagueTeams.push({ id: newId('lt'), seasonId: _leagueModalCtx.seasonId, type: _leagueModalCtx.type, name });
  saveData(state);
  input.value = '';
  renderLeagueModalBody();
  renderStandings();
  input.focus();
}

function renderHistoryTab() {
  renderGameStats();
  renderStandings();
  const container = document.getElementById('history-list');
  const season = getCurrentSeason();
  const baseGames = season ? state.games.filter(g => g.seasonId === season.id) : state.games;
  const filterVal = document.getElementById('history-filter-select').value;
  let games = filterVal === 'all' ? baseGames : baseGames.filter(g => g.gameType === filterVal);

  if (!games.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('📋', 'まだ試合が登録されていません', '「試合登録」タブから試合を追加してください'));
    return;
  }

  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date));
  container.innerHTML = '';
  sorted.forEach(game => container.appendChild(buildHistoryCard(game)));
}

function buildHistoryCard(game) {
  const card = document.createElement('div');
  card.className = 'history-card';

  const header = document.createElement('div');
  header.className = 'history-card-header' + (openHistoryCards.has(game.id) ? ' open' : '');

  const info = document.createElement('div');
  info.className = 'history-card-info';
  const dateEl = document.createElement('span'); dateEl.className = 'history-date'; dateEl.textContent = game.date;
  const typeEl = document.createElement('span'); typeEl.className = 'history-type'; typeEl.textContent = gameTypeLabel(game.gameType);
  const oppEl  = document.createElement('span'); oppEl.className  = 'history-opponent'; oppEl.textContent = `vs ${game.opponent}`;
  const haEl   = document.createElement('span'); haEl.className   = 'history-ha'; haEl.textContent = venueLabel(game);
  info.append(dateEl, typeEl, oppEl, haEl);

  const right = document.createElement('div');
  right.className = 'history-card-right';
  const scoreEl = document.createElement('div'); scoreEl.className = 'score-display';
  const us  = document.createElement('span'); us.className  = 'score-us';  us.textContent = game.ourScore;
  const sep = document.createElement('span'); sep.className = 'score-sep'; sep.textContent = '−';
  const opp = document.createElement('span'); opp.className = 'score-opp'; opp.textContent = game.opponentScore;
  scoreEl.append(us, sep, opp);
  const badge = document.createElement('span');
  badge.className = 'badge ' + (game.result === '勝' ? 'badge-win' : game.result === '負' ? 'badge-loss' : 'badge-draw');
  badge.textContent = game.result;
  const chevron = document.createElement('span'); chevron.className = 'history-chevron';
  chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>';
  right.append(scoreEl, badge, chevron);

  header.append(info, right);

  const detail = document.createElement('div');
  detail.className = 'history-card-detail' + (openHistoryCards.has(game.id) ? ' open' : '');

  if (openHistoryCards.has(game.id)) {
    renderGameDetailContent(detail, game);
    detail.dataset.loaded = '1';
  }

  header.addEventListener('click', () => {
    const isOpen = openHistoryCards.has(game.id);
    if (isOpen) { openHistoryCards.delete(game.id); }
    else { openHistoryCards.add(game.id); }
    header.classList.toggle('open', !isOpen);
    detail.classList.toggle('open', !isOpen);
    if (!isOpen && !detail.dataset.loaded) {
      renderGameDetailContent(detail, game);
      detail.dataset.loaded = '1';
    }
  });

  card.append(header, detail);
  return card;
}

function renderGameDetailContent(container, game) {
  container.innerHTML = '';

  // イニング別スコア
  const inningSection = document.createElement('div');
  inningSection.className = 'history-inning-section';
  const inningTitle = document.createElement('div');
  inningTitle.className = 'history-section-title';
  inningTitle.textContent = 'イニング別スコア';

  const innings    = game.innings          || Array(9).fill(0);
  const oppInnings = game.opponentInnings  || Array(9).fill(0);

  const inningWrap = document.createElement('div'); inningWrap.className = 'history-inning-wrap';
  const tbl = document.createElement('table'); tbl.className = 'history-inning-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const blankTh = document.createElement('th'); blankTh.textContent = '';
  htr.appendChild(blankTh);
  for (let i = 1; i <= 9; i++) { const th = document.createElement('th'); th.textContent = i; htr.appendChild(th); }
  const totalTh = document.createElement('th'); totalTh.textContent = '計'; htr.appendChild(totalTh);
  thead.appendChild(htr); tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const buildRow = (label, inn, total, isOur) => {
    const tr = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.className = 'history-team-label' + (isOur ? ' our' : '');
    labelTd.textContent = label;
    tr.appendChild(labelTd);
    inn.forEach(s => { const c = document.createElement('td'); c.textContent = s; tr.appendChild(c); });
    const totalTd = document.createElement('td'); totalTd.className = 'history-inning-total'; totalTd.textContent = total;
    tr.appendChild(totalTd);
    return tr;
  };
  tbody.append(buildRow('自チーム', innings, game.ourScore, true), buildRow(game.opponent, oppInnings, game.opponentScore, false));
  tbl.appendChild(tbody); inningWrap.appendChild(tbl);
  inningSection.append(inningTitle, inningWrap);

  container.appendChild(inningSection);

  if (game.memo) {
    const memoEl = document.createElement('div');
    memoEl.className = 'history-memo';
    memoEl.textContent = '📝 ' + game.memo;
    container.appendChild(memoEl);
  }

  // スターティングオーダー
  const gameBatting = state.battingRecords.filter(r => r.gameId === game.id);
  const starters = gameBatting
    .filter(r => r.battingOrder >= 1 && r.battingOrder <= 9)
    .sort((a, b) => a.battingOrder - b.battingOrder);
  const subs = gameBatting.filter(r => r.battingOrder === 10);

  if (starters.length > 0) {
    const lineupSection = document.createElement('div');
    lineupSection.className = 'history-inning-section';
    const lineupTitle = document.createElement('div');
    lineupTitle.className = 'history-section-title';
    lineupTitle.textContent = 'スターティングオーダー';
    lineupSection.appendChild(lineupTitle);

    const lineupGrid = document.createElement('div');
    lineupGrid.className = 'lineup-grid';

    starters.forEach(r => {
      const p = state.players.find(x => x.id === r.playerId);
      const name = p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明';
      const item = document.createElement('div');
      item.className = 'lineup-item';
      item.innerHTML = `<span class="lineup-order">${r.battingOrder}番</span><span class="lineup-name">${name}</span>`;
      lineupGrid.appendChild(item);
    });

    if (subs.length > 0) {
      const subItem = document.createElement('div');
      subItem.className = 'lineup-item lineup-sub';
      const subNames = subs.map(r => { const p = state.players.find(x => x.id === r.playerId); return p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明'; }).join('・');
      subItem.innerHTML = `<span class="lineup-order">途中出場</span><span class="lineup-name">${subNames}</span>`;
      lineupGrid.appendChild(subItem);
    }

    lineupSection.appendChild(lineupGrid);
    container.appendChild(lineupSection);
  }

  // 打撃成績
  const battingSection = buildGameStatSection(
    '打撃成績',
    gameBatting,
    (records) => {
      const rows = records.map(r => {
        const p = state.players.find(x => x.id === r.playerId);
        const avg = r.atBats > 0 ? r.hits / r.atBats : NaN;
        return { name: p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明', num: p ? (p.number ?? 999) : 999, ...r, avg };
      }).sort((a, b) => {
        const oa = a.battingOrder ?? 999, ob = b.battingOrder ?? 999;
        if (oa !== ob) return oa - ob;
        return a.num - b.num;
      });

      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      const t = document.createElement('table'); t.className = 'games-table history-stats-table';
      t.innerHTML = '<thead><tr><th>打順</th><th>選手名</th><th>交代元#</th><th>打数</th><th>安打</th><th>二塁打</th><th>三塁打</th><th>本塁打</th><th>打点</th><th>得点</th><th>三振</th><th>四球</th><th>打率</th></tr></thead>';
      const tb = document.createElement('tbody');
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.append(td(r.battingOrder === 10 ? '途中出場' : r.battingOrder || '-'), td(r.name), td(r.replaces != null ? r.replaces : '-'), td(r.atBats), td(r.hits), td(r.doubles), td(r.triples), td(r.homeRuns), td(r.rbi), td(r.runs), td(r.strikeouts), td(r.walks), td(r.atBats > 0 ? fmtAvg(r.avg) : '---'));
        tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t);
      return wrap;
    },
    '📊', '打撃データなし', '「試合登録」から成績入力してください'
  );

  // 投球成績
  const pitchingSection = buildGameStatSection(
    '投球成績',
    state.pitchingRecords.filter(r => r.gameId === game.id),
    (records) => {
      const rows = records.map(r => {
        const p = state.players.find(x => x.id === r.playerId);
        const ipDec = ipToDecimal(r.inningsPitched || 0);
        const outs = Math.round(ipDec * 3);
        const ipFmt = (outs % 3) > 0 ? `${Math.floor(outs/3)}.${outs%3}` : `${Math.floor(outs/3)}`;
        const era = ipDec > 0 ? r.earnedRuns * 9 / ipDec : NaN;
        const resultLabel = {W:'勝',L:'負',S:'セーブ',ND:'−'}[r.result] || '−';
        return { name: p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明', num: p ? (p.number ?? 999) : 999, ...r, ipFmt, era, resultLabel };
      }).sort((a, b) => a.num - b.num);

      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      const t = document.createElement('table'); t.className = 'games-table history-stats-table';
      t.innerHTML = '<thead><tr><th>選手名</th><th>投球回</th><th>球数</th><th>被安打</th><th>失点</th><th>自責点</th><th>与四球</th><th>奪三振</th><th>防御率</th><th>勝敗</th></tr></thead>';
      const tb = document.createElement('tbody');
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.append(td(r.name), td(r.ipFmt), td(r.pitchCount), td(r.hitsAllowed), td(r.runsAllowed), td(r.earnedRuns), td(r.walks), td(r.strikeouts), td(isNaN(r.era) ? '---' : r.era.toFixed(2)), td(r.resultLabel));
        tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t);
      return wrap;
    },
    '⚾', '投球データなし', '「試合登録」から成績入力してください'
  );

  // アクションボタン
  const actions = document.createElement('div');
  actions.className = 'history-card-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost-dark btn-sm';
  editBtn.textContent = '試合情報を編集';
  editBtn.addEventListener('click', e => { e.stopPropagation(); showEditGameModal(game.id); });
  const statsBtn = document.createElement('button');
  statsBtn.className = 'btn-entry';
  statsBtn.textContent = '成績を入力・修正';
  statsBtn.addEventListener('click', e => { e.stopPropagation(); switchTab('games'); showStatsEntry(game.id); });
  actions.append(editBtn, statsBtn);

  container.append(battingSection, pitchingSection, actions);
}

function buildGameStatSection(title, records, renderFn, emptyIcon, emptyText, emptySub) {
  const section = document.createElement('div');
  section.className = 'history-stats-section';
  const titleEl = document.createElement('div');
  titleEl.className = 'history-section-title';
  titleEl.textContent = title;
  section.appendChild(titleEl);
  if (records.length) {
    section.appendChild(renderFn(records));
  } else {
    section.appendChild(emptyState(emptyIcon, emptyText, emptySub));
  }
  return section;
}

/* ===== EDIT GAME ===== */

function showEditGameModal(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  document.getElementById('edit-modal-title').textContent = '試合情報を編集';
  const body = document.getElementById('edit-modal-body');
  body.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'form-grid';

  const makeGroup = (labelText, el, full = false) => {
    const g = document.createElement('div');
    g.className = 'form-group' + (full ? ' form-group-full' : '');
    const l = document.createElement('label'); l.className = 'form-label'; l.textContent = labelText;
    g.append(l, el); return g;
  };

  const dateInput = document.createElement('input');
  dateInput.type = 'date'; dateInput.className = 'form-input'; dateInput.value = game.date;

  const oppInput = document.createElement('input');
  oppInput.type = 'text'; oppInput.className = 'form-input'; oppInput.value = game.opponent; oppInput.maxLength = 30;

  const makeToggle = (name, options, current) => {
    const g = document.createElement('div'); g.className = 'toggle-group';
    options.forEach(([v, t]) => {
      const lbl = document.createElement('label'); lbl.className = 'toggle-option';
      const inp = document.createElement('input'); inp.type = 'radio'; inp.name = name; inp.value = v; inp.checked = current === v;
      const span = document.createElement('span'); span.textContent = t;
      lbl.append(inp, span); g.appendChild(lbl);
    });
    return g;
  };

  const typeToggle = makeToggle('edit-game-type', [['spring','春リーグ'],['fall','秋リーグ'],['practice','練習試合'],['other','その他']], game.gameType);
  const venueInput = document.createElement('input');
  venueInput.type = 'text'; venueInput.className = 'form-input'; venueInput.maxLength = 30;
  venueInput.placeholder = '例: ○○グラウンド';
  venueInput.value = game.venue || '';

  const ourContainer = document.createElement('div'); ourContainer.id = 'edit-inning-our';
  const oppContainer = document.createElement('div'); oppContainer.id = 'edit-inning-opp';

  const memoTextarea = document.createElement('textarea');
  memoTextarea.className = 'form-input';
  memoTextarea.rows = 2;
  memoTextarea.placeholder = '例: 雨天中断、継投策など';
  memoTextarea.maxLength = 200;
  memoTextarea.style.resize = 'vertical';
  memoTextarea.value = game.memo || '';

  form.append(
    makeGroup('試合日', dateInput),
    makeGroup('対戦相手', oppInput),
    makeGroup('種別', typeToggle, true),
    makeGroup('会場', venueInput, true),
    makeGroup('自チーム得点 (イニング別)', ourContainer, true),
    makeGroup('相手チーム得点 (イニング別)', oppContainer, true),
    makeGroup('メモ', memoTextarea, true)
  );
  body.appendChild(form);
  document.getElementById('edit-modal-overlay').style.display = 'flex';

  buildInningGrid('edit-inning-our');
  buildInningGrid('edit-inning-opp');

  const fillInnings = (containerId, vals) => {
    document.querySelectorAll('#' + containerId + ' input.inning-input:not(.total-cell)').forEach((inp, i) => { inp.value = vals[i] ?? 0; });
    updateTotal(containerId, containerId + '-total');
  };
  fillInnings('edit-inning-our', game.innings || Array(9).fill(0));
  fillInnings('edit-inning-opp', game.opponentInnings || Array(9).fill(0));

  document.getElementById('edit-modal-save').onclick = () => {
    const dateVal = dateInput.value;
    const oppVal  = oppInput.value.trim();
    if (!dateVal || !oppVal) { showToast('試合日と対戦相手を入力してください', 'error'); return; }

    const ourInnings = getInnings('edit-inning-our');
    const oppInnings = getInnings('edit-inning-opp');
    const ourScore  = ourInnings.reduce((a, b) => a + b, 0);
    const oppScore  = oppInnings.reduce((a, b) => a + b, 0);
    const result    = ourScore > oppScore ? '勝' : ourScore < oppScore ? '負' : '引分';
    const gameType  = document.querySelector('input[name="edit-game-type"]:checked').value;
    const venue     = venueInput.value.trim();

    const idx = state.games.findIndex(g => g.id === gameId);
    if (idx >= 0) {
      state.games[idx] = { ...state.games[idx], date: dateVal, opponent: oppVal, venue, gameType, innings: ourInnings, opponentInnings: oppInnings, ourScore, opponentScore: oppScore, result, memo: memoTextarea.value.trim() };
    }
    saveData(state);
    closeEditModal();
    showToast('試合情報を更新しました ✓');
  };
}

/* ===== EDIT PLAYER ===== */

function showEditPlayerModal(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  document.getElementById('edit-modal-title').textContent = '選手情報を編集';
  const body = document.getElementById('edit-modal-body');
  body.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'form-grid';

  const makeInput = (type, val, opts = {}) => {
    const inp = document.createElement('input');
    inp.type = type; inp.className = 'form-input'; inp.value = val ?? '';
    Object.assign(inp, opts); return inp;
  };
  const makeGroup = (labelText, el, full = false) => {
    const g = document.createElement('div');
    g.className = 'form-group' + (full ? ' form-group-full' : '');
    const l = document.createElement('label'); l.className = 'form-label'; l.textContent = labelText;
    g.append(l, el); return g;
  };

  const nameInput = makeInput('text', player.name, { maxLength: 30 });
  const furiInput = makeInput('text', player.furigana || '', { maxLength: 50 });
  const numInput  = makeInput('number', player.number ?? '', { min: 0, max: 99 });

  const gradeSelect = document.createElement('select'); gradeSelect.className = 'form-select';
  [1,2,3,4].forEach(g => {
    const opt = document.createElement('option'); opt.value = g; opt.textContent = `${g}年`;
    if (player.grade === g) opt.selected = true;
    gradeSelect.appendChild(opt);
  });

  const posWrap = document.createElement('div'); posWrap.className = 'checkbox-group';
  const posCheckboxes = {};
  ['投手','捕手','内野','外野'].forEach(pos => {
    const lbl = document.createElement('label'); lbl.className = 'checkbox-option';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.value = pos;
    inp.checked = (player.positions || []).includes(pos);
    posCheckboxes[pos] = inp;
    const span = document.createElement('span'); span.textContent = pos;
    lbl.append(inp, span); posWrap.appendChild(lbl);
  });

  form.append(
    makeGroup('選手名 *', nameInput),
    makeGroup('ふりがな', furiInput),
    makeGroup('背番号', numInput),
    makeGroup('学年', gradeSelect),
    makeGroup('ポジション', posWrap, true)
  );
  body.appendChild(form);
  document.getElementById('edit-modal-overlay').style.display = 'flex';

  document.getElementById('edit-modal-save').onclick = () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) { showToast('選手名を入力してください', 'error'); return; }

    const idx = state.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      state.players[idx] = {
        ...state.players[idx],
        name: nameVal,
        furigana: furiInput.value.trim(),
        number: parseInt(numInput.value) || null,
        grade: parseInt(gradeSelect.value) || null,
        positions: Object.entries(posCheckboxes).filter(([, cb]) => cb.checked).map(([pos]) => pos)
      };
    }
    saveData(state);
    closeEditModal();
    showToast(`${nameVal} の情報を更新しました ✓`);
  };
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').style.display = 'none';
}

/* ===== 直近N試合の調子 ===== */
function aggBatting(recs) {
  const m = { atBats:0, hits:0, doubles:0, triples:0, homeRuns:0, walks:0, hitByPitch:0, sacrifices:0, rbi:0 };
  recs.forEach(r => Object.keys(m).forEach(k => m[k] += (r[k] || 0)));
  const tb = (m.hits - m.doubles - m.triples - m.homeRuns) + m.doubles*2 + m.triples*3 + m.homeRuns*4;
  const pa = m.atBats + m.walks + m.hitByPitch + m.sacrifices;
  const avg = m.atBats > 0 ? m.hits / m.atBats : NaN;
  const obp = pa > 0 ? (m.hits + m.walks + m.hitByPitch) / pa : NaN;
  const slg = m.atBats > 0 ? tb / m.atBats : NaN;
  return { avg, obp, slg, ops: obp + slg };
}
function aggPitching(recs) {
  let ipDec = 0;
  const m = { earnedRuns:0, hitsAllowed:0, walks:0, strikeouts:0 };
  recs.forEach(r => { ipDec += ipToDecimal(r.inningsPitched || 0); Object.keys(m).forEach(k => m[k] += (r[k] || 0)); });
  const era = ipDec > 0 ? m.earnedRuns * 9 / ipDec : NaN;
  const whip = ipDec > 0 ? (m.walks + m.hitsAllowed) / ipDec : NaN;
  return { era, whip, ipDec };
}

function renderRecentForm(panel, type, filterGameIds, ctx = gameStatsCtx()) {
  const records = type === 'batting' ? ctx.batRecords : ctx.pitRecords;
  const idKey = ctx.idKey;
  const unitById = new Map(ctx.units.map(u => [u.id, u]));
  const byPlayer = {};
  records.forEach(r => {
    if (filterGameIds && !filterGameIds.has(r[idKey])) return;
    const u = unitById.get(r[idKey]);
    if (!u || !u.date) return;
    (byPlayer[r.playerId] = byPlayer[r.playerId] || []).push({ ...r, date: u.date });
  });
  const entries = Object.entries(byPlayer).filter(([pid]) => state.players.find(p => p.id === pid));
  if (!entries.length) return;

  const card = document.createElement('div');
  card.className = 'chart-card';
  const header = document.createElement('div');
  header.className = 'chart-custom-header';
  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = '直近の調子';
  const nSelect = document.createElement('select');
  nSelect.className = 'form-select chart-custom-select';
  // 実践練習は頻度が高いので期間で、試合は数で絞る
  const periodMode = ctx.kind === 'practice';
  if (periodMode) {
    [['30','直近1ヶ月'],['90','直近3ヶ月'],['all','全期間']].forEach(([v,t]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = t;
      nSelect.appendChild(o);
    });
    nSelect.value = '30';
  } else {
    // 1試合〜該当選手の最大出場試合数まで、すべての値を選択可能に
    const maxN = Math.max(...entries.map(([, recs]) => recs.length));
    for (let n = 1; n <= maxN; n++) {
      const o = document.createElement('option'); o.value = n;
      o.textContent = n === maxN ? `全${n}${ctx.unitNoun}` : '直近' + n + ctx.unitNoun;
      nSelect.appendChild(o);
    }
    nSelect.value = String(Math.min(5, maxN));
  }
  header.append(title, nSelect);
  card.appendChild(header);
  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';
  card.appendChild(tableWrap);
  panel.appendChild(card);

  const draw = () => {
    const cutoff = periodMode && nSelect.value !== 'all'
      ? new Date(Date.now() - parseInt(nSelect.value, 10) * 86400000).toISOString().split('T')[0]
      : null;
    const n = periodMode ? 0 : parseInt(nSelect.value, 10);
    const rows = entries.map(([pid, recs]) => {
      const sorted = [...recs].sort((a, b) => a.date.localeCompare(b.date));
      const recent = periodMode
        ? (cutoff ? sorted.filter(r => r.date >= cutoff) : sorted)
        : sorted.slice(-n);
      const player = state.players.find(p => p.id === pid);
      if (type === 'batting') {
        const rc = aggBatting(recent), all = aggBatting(sorted);
        return { name: player.name, gp: recent.length, recent: rc.avg, recentOps: rc.ops, season: all.avg,
                 delta: (!isNaN(rc.avg) && !isNaN(all.avg)) ? rc.avg - all.avg : NaN };
      } else {
        const rc = aggPitching(recent), all = aggPitching(sorted);
        return { name: player.name, gp: recent.length, recent: rc.era, recentWhip: rc.whip, season: all.era,
                 delta: (!isNaN(rc.era) && !isNaN(all.era)) ? rc.era - all.era : NaN, ipDec: rc.ipDec };
      }
    }).filter(r => type === 'batting' ? !isNaN(r.recent) : r.ipDec > 0);

    const higherBetter = type === 'batting';
    rows.sort((a, b) => {
      const av = isNaN(a.recent) ? (higherBetter ? -Infinity : Infinity) : a.recent;
      const bv = isNaN(b.recent) ? (higherBetter ? -Infinity : Infinity) : b.recent;
      return higherBetter ? bv - av : av - bv;
    });

    const fmtDelta = d => {
      if (isNaN(d)) return { t: '---', c: 'var(--text-muted)' };
      // 打撃: プラス=好調(緑) / 投球: マイナス(防御率低下)=好調(緑)
      const good = higherBetter ? d > 0 : d < 0;
      const flat = Math.abs(d) < (higherBetter ? 0.001 : 0.005);
      if (flat) return { t: '±0', c: 'var(--text-muted)' };
      const arrow = (higherBetter ? d > 0 : d > 0) ? '▲' : '▼';
      const mag = higherBetter ? ('.' + Math.round(Math.abs(d) * 1000).toString().padStart(3, '0')) : Math.abs(d).toFixed(2);
      return { t: arrow + mag, c: good ? '#16a34a' : '#dc2626' };
    };

    const tbl = document.createElement('table');
    tbl.className = 'data-table';
    const heads = type === 'batting'
      ? ['選手名', ctx.unitNoun, '直近打率', '直近OPS', '通算打率', '増減']
      : ['選手名', '登板', '直近防御率', '直近WHIP', '通算防御率', '増減'];
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    heads.forEach(h => { const th = document.createElement('th'); th.textContent = h; htr.appendChild(th); });
    thead.appendChild(htr);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const cells = [];
      const nameTd = document.createElement('td'); nameTd.textContent = r.name; nameTd.style.fontFamily = 'var(--font-sans)'; cells.push(nameTd);
      const gpTd = document.createElement('td'); gpTd.textContent = r.gp; cells.push(gpTd);
      if (type === 'batting') {
        const a = document.createElement('td'); a.textContent = fmtAvg(r.recent); cells.push(a);
        const o = document.createElement('td'); o.textContent = isNaN(r.recentOps) ? '---' : r.recentOps.toFixed(3); cells.push(o);
        const s = document.createElement('td'); s.textContent = fmtAvg(r.season); cells.push(s);
      } else {
        const e = document.createElement('td'); e.textContent = isNaN(r.recent) ? '---' : r.recent.toFixed(2); cells.push(e);
        const w = document.createElement('td'); w.textContent = isNaN(r.recentWhip) ? '---' : r.recentWhip.toFixed(2); cells.push(w);
        const s = document.createElement('td'); s.textContent = isNaN(r.season) ? '---' : r.season.toFixed(2); cells.push(s);
      }
      const d = fmtDelta(r.delta);
      const dTd = document.createElement('td'); dTd.textContent = d.t; dTd.style.color = d.c; dTd.style.fontWeight = '700'; cells.push(dTd);
      cells.forEach(c => tr.appendChild(c));
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tableWrap.innerHTML = '';
    tableWrap.appendChild(tbl);
  };
  nSelect.addEventListener('change', draw);
  draw();
}

/* ===== 選手比較（レーダーチャート） ===== */
function renderPlayerComparison(panel, type, rows) {
  if (typeof Chart === 'undefined' || !rows || rows.length < 2) return;

  // 比較できる全項目（invert=低いほど良い指標）
  const METRICS = type === 'batting'
    ? [
        { key: 'avg', label: '打率', invert: false, fmt: 'avg' },
        { key: 'obp', label: '出塁率', invert: false, fmt: 'avg' },
        { key: 'slg', label: '長打率', invert: false, fmt: 'avg' },
        { key: 'ops', label: 'OPS', invert: false, fmt: 'dec3' },
        { key: 'sbPct', label: '盗塁成功率', invert: false, fmt: 'pct' },
        { key: 'hits', label: '安打', invert: false, fmt: 'int' },
        { key: 'doubles', label: '二塁打', invert: false, fmt: 'int' },
        { key: 'triples', label: '三塁打', invert: false, fmt: 'int' },
        { key: 'homeRuns', label: '本塁打', invert: false, fmt: 'int' },
        { key: 'tb', label: '塁打', invert: false, fmt: 'int' },
        { key: 'rbi', label: '打点', invert: false, fmt: 'int' },
        { key: 'runs', label: '得点', invert: false, fmt: 'int' },
        { key: 'walks', label: '四球', invert: false, fmt: 'int' },
        { key: 'strikeouts', label: '三振', invert: true, fmt: 'int' },
        { key: 'stolenBases', label: '盗塁', invert: false, fmt: 'int' },
        { key: 'atBats', label: '打数', invert: false, fmt: 'int' },
        { key: 'pa', label: '打席', invert: false, fmt: 'int' },
      ]
    : [
        { key: 'era', label: '防御率', invert: true, fmt: 'dec2' },
        { key: 'whip', label: 'WHIP', invert: true, fmt: 'dec2' },
        { key: 'k9', label: '奪三振率', invert: false, fmt: 'dec2' },
        { key: 'bavg', label: '被打率', invert: true, fmt: 'avg' },
        { key: 'ipDec', label: '投球回', invert: false, fmt: 'ip' },
        { key: 'strikeouts', label: '奪三振', invert: false, fmt: 'int' },
        { key: 'wins', label: '勝', invert: false, fmt: 'int' },
        { key: 'saves', label: 'セーブ', invert: false, fmt: 'int' },
        { key: 'games', label: '登板', invert: false, fmt: 'int' },
        { key: 'hitsAllowed', label: '被安打', invert: true, fmt: 'int' },
        { key: 'runsAllowed', label: '失点', invert: true, fmt: 'int' },
        { key: 'earnedRuns', label: '自責点', invert: true, fmt: 'int' },
        { key: 'walks', label: '与四球', invert: true, fmt: 'int' },
        { key: 'hitByPitch', label: '与死球', invert: true, fmt: 'int' },
        { key: 'homeRunsAllowed', label: '被本塁打', invert: true, fmt: 'int' },
        { key: 'pitchCount', label: '球数', invert: false, fmt: 'int' },
      ];
  const DEFAULT_KEYS = type === 'batting'
    ? ['avg', 'obp', 'slg', 'rbi', 'stolenBases']
    : ['era', 'whip', 'k9', 'bavg', 'ipDec'];
  const selectedMetrics = new Set(DEFAULT_KEYS);

  const COLORS = [
    { border: 'rgba(0,120,255,0.9)', bg: 'rgba(0,120,255,0.18)' },
    { border: 'rgba(220,38,38,0.9)', bg: 'rgba(220,38,38,0.18)' },
    { border: 'rgba(22,163,74,0.9)', bg: 'rgba(22,163,74,0.18)' },
  ];

  const card = document.createElement('div');
  card.className = 'chart-card';
  const header = document.createElement('div');
  header.className = 'chart-custom-header';
  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = '選手比較（最大3名）';
  header.appendChild(title);
  card.appendChild(header);

  // 比較する選手をプルダウンで選択（最大3名）
  const sortedInit = [...rows].sort((a, b) => type === 'batting'
    ? (b.ops || -Infinity) - (a.ops || -Infinity)
    : (a.era ?? Infinity) - (b.era ?? Infinity));
  const selectRow = document.createElement('div');
  selectRow.className = 'compare-selects';
  const selectEls = [];
  const placeholders = ['-- 選手1 --', '-- 選手2 --', '-- 選手3（任意） --'];
  for (let i = 0; i < 3; i++) {
    const sel = document.createElement('select');
    sel.className = 'form-select chart-custom-select';
    const none = document.createElement('option');
    none.value = ''; none.textContent = placeholders[i];
    sel.appendChild(none);
    rows.forEach(r => { const o = document.createElement('option'); o.value = r.playerId; o.textContent = r.name; sel.appendChild(o); });
    sel.value = (i < 2 && sortedInit[i]) ? sortedInit[i].playerId : '';
    sel.addEventListener('change', () => draw());
    selectEls.push(sel);
    selectRow.appendChild(sel);
  }
  card.appendChild(selectRow);

  // 比較項目の選択（任意の項目、3つ以上でレーダー描画）
  const metricLabel = document.createElement('div');
  metricLabel.className = 'compare-metric-label';
  metricLabel.textContent = '比較項目（3つ以上選択）';
  card.appendChild(metricLabel);
  const metricChips = document.createElement('div');
  metricChips.className = 'metric-chips';
  METRICS.forEach(m => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'metric-chip';
    chip.textContent = m.label;
    const sync = () => chip.classList.toggle('active', selectedMetrics.has(m.key));
    chip.addEventListener('click', () => {
      if (selectedMetrics.has(m.key)) selectedMetrics.delete(m.key);
      else selectedMetrics.add(m.key);
      sync(); draw();
    });
    sync();
    metricChips.appendChild(chip);
  });
  card.appendChild(metricChips);

  const canvas = document.createElement('canvas');
  canvas.height = 260;
  card.appendChild(canvas);

  const noteEl = document.createElement('div');
  noteEl.className = 'compare-note';
  card.appendChild(noteEl);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';
  tableWrap.style.marginTop = 'var(--space-4)';
  card.appendChild(tableWrap);
  panel.appendChild(card);

  const chartKey = type === 'batting' ? 'compareBatting' : 'comparePitching';
  const fmtCell = (r, ax) => {
    const v = r[ax.key];
    if (v == null || isNaN(v) || !isFinite(v)) return '---';
    switch (ax.fmt) {
      case 'avg':  return fmtAvg(v);
      case 'dec3': return v.toFixed(3);
      case 'dec2': return v.toFixed(2);
      case 'pct':  return (v * 100).toFixed(1) + '%';
      case 'ip':   { const o = Math.round(v * 3); return (o % 3) > 0 ? `${Math.floor(o/3)}.${o%3}` : `${Math.floor(o/3)}`; }
      default:     return v;
    }
  };

  const draw = () => {
    const axes = METRICS.filter(m => selectedMetrics.has(m.key));
    const ids = [...new Set(selectEls.map(s => s.value).filter(Boolean))];
    const picks = ids.map(id => rows.find(r => r.playerId === id)).filter(Boolean);
    if (_charts[chartKey]) { _charts[chartKey].destroy(); _charts[chartKey] = null; }
    tableWrap.innerHTML = '';
    canvas.style.display = '';
    if (!picks.length) { noteEl.textContent = '比較する選手を選んでください'; canvas.style.display = 'none'; return; }
    if (axes.length < 3) { noteEl.textContent = 'レーダーには比較項目を3つ以上選んでください'; canvas.style.display = 'none'; return; }
    noteEl.textContent = '';

    // 選択した各項目を min-max 正規化（1.0=最良。invert項目は反転）
    const scales = axes.map(ax => {
      const vals = rows.map(r => r[ax.key]).filter(v => v != null && !isNaN(v) && isFinite(v));
      return { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0 };
    });
    const normalize = (val, i) => {
      const ax = axes[i], sc = scales[i];
      if (val == null || isNaN(val) || !isFinite(val)) return 0;
      if (sc.max === sc.min) return 0.5;
      const t = (val - sc.min) / (sc.max - sc.min);
      return ax.invert ? 1 - t : t;
    };

    _charts[chartKey] = new Chart(canvas, {
      type: 'radar',
      data: {
        labels: axes.map(a => a.label),
        datasets: picks.map((r, i) => ({
          label: r.name,
          data: axes.map((ax, idx) => +normalize(r[ax.key], idx).toFixed(3)),
          borderColor: COLORS[i % 3].border,
          backgroundColor: COLORS[i % 3].bg,
          borderWidth: 2,
          pointRadius: 3,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { color: 'var(--text-secondary)' } },
          tooltip: { callbacks: { label: ctx => {
            const r = picks[ctx.datasetIndex]; const ax = axes[ctx.dataIndex];
            return ax.label + ': ' + fmtCell(r, ax);
          } } },
        },
        scales: { r: { min: 0, max: 1, ticks: { display: false }, pointLabels: { font: { size: 12 } } } },
      },
    });

    // 比較テーブル（生値）：行=選手、列=項目
    const bestByAxis = axes.map(ax => {
      const valid = picks.map(r => r[ax.key]).filter(v => v != null && !isNaN(v) && isFinite(v));
      return valid.length ? (ax.invert ? Math.min(...valid) : Math.max(...valid)) : null;
    });
    const tbl = document.createElement('table');
    tbl.className = 'data-table';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const blank = document.createElement('th'); blank.textContent = '選手'; htr.appendChild(blank);
    axes.forEach(ax => { const th = document.createElement('th'); th.textContent = ax.label; htr.appendChild(th); });
    thead.appendChild(htr); tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    picks.forEach(r => {
      const tr = document.createElement('tr');
      const name = document.createElement('td'); name.textContent = r.name; name.style.fontFamily = 'var(--font-sans)'; tr.appendChild(name);
      axes.forEach((ax, idx) => {
        const td = document.createElement('td'); td.textContent = fmtCell(r, ax);
        const v = r[ax.key];
        const best = bestByAxis[idx];
        if (picks.length > 1 && best != null && v === best && v != null && !isNaN(v)) { td.style.fontWeight = '700'; td.style.color = '#16a34a'; }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tableWrap.appendChild(tbl);
  };
  draw();
}

/* ===== 実践練習タブ ===== */
let drillBattingRows = [];   // [{ card, getPlayerId }]
let drillPitchingInputs = null;   // { inningsPitched, runsAllowed, earnedRuns }
let drillPitchingPlayerId = null;
let editingDrillSessionId = null; // 編集中の練習セッションID（新規登録時はnull）
const openDrillCards = new Set();

// 打者行用の選手セレクトを生成
function makeDrillBatterSelect() {
  const sel = document.createElement('select');
  sel.className = 'form-select tally-row-select';
  const def = document.createElement('option'); def.value = ''; def.textContent = '-- 打者を選択 --'; sel.appendChild(def);
  [...state.players].sort(comparePlayers).forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
    sel.appendChild(o);
  });
  return sel;
}

// 打者を1行追加（行ごとに選手選択＋タップ式入力）。prefill={playerId, record}で既存値を反映（編集用）
function addDrillBattingRow(prefill) {
  if (!state.players.length) { showToast('先に選手を登録してください', 'error'); return; }
  const container = document.getElementById('drill-batting-rows');
  const select = makeDrillBatterSelect();
  if (prefill && prefill.playerId) select.value = prefill.playerId;
  const card = buildTallyCard(null, prefill ? prefill.record : null, { showOrder: false, leadEl: select });
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'tally-row-del'; rm.textContent = '✕'; rm.title = '行を削除';
  const entry = { card, getPlayerId: () => select.value };
  rm.addEventListener('click', () => {
    card.card.remove();
    drillBattingRows = drillBattingRows.filter(e => e !== entry);
  });
  card.card.querySelector('.tally-head').appendChild(rm);
  container.appendChild(card.card);
  drillBattingRows.push(entry);
}

// 打者行を集計。エラーがあれば { error }、正常なら { rows }
function collectDrillBatting() {
  const out = [];
  const seen = new Set();
  for (const entry of drillBattingRows) {
    const pid = entry.getPlayerId();
    const has = entry.card.hasData();
    if (!pid && !has) continue;                 // 空行はスキップ
    if (!pid) return { error: '打者が未選択の行があります' };
    if (!has) return { error: '結果が未入力の打者行があります' };
    if (seen.has(pid)) return { error: '同じ打者が複数行にあります' };
    seen.add(pid);
    out.push({ playerId: pid, battingOrder: null, appeared: true, replaces: null, ...tallyToRecord(entry.card.getTally()) });
  }
  return { rows: out };
}

function populateDrillPitcherSelect() {
  const sel = document.getElementById('drill-pitcher-select');
  const prev = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  [...state.players].filter(p => (p.positions || []).includes('投手')).sort(comparePlayers).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

// 投手の手入力フォーム（投球回・失点・自責点の3項目のみ）。被打成績は打者の対戦結果から導出する。
// prefill={inningsPitched, runsAllowed, earnedRuns} で既存値を反映（編集用）
function buildDrillPitchingForm(playerId, prefill) {
  const area = document.getElementById('drill-pitching-form');
  area.innerHTML = '';
  drillPitchingInputs = null;
  drillPitchingPlayerId = null;
  if (!playerId) return;
  drillPitchingPlayerId = playerId;
  const form = document.createElement('div'); form.className = 'pitching-form';
  const inputs = {};
  // 投球回
  const ipGroup = document.createElement('div'); ipGroup.className = 'form-group';
  const ipLabel = document.createElement('label'); ipLabel.className = 'form-label'; ipLabel.textContent = '投球回';
  const ip = buildIpControl(prefill ? prefill.inningsPitched : null); inputs.inningsPitched = ip;
  ipGroup.append(ipLabel, ip.wrap); form.appendChild(ipGroup);
  // 失点・自責点
  [['runsAllowed', '失点'], ['earnedRuns', '自責点']].forEach(([key, label]) => {
    const group = document.createElement('div'); group.className = 'form-group';
    const lab = document.createElement('label'); lab.className = 'form-label'; lab.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.value = prefill ? (prefill[key] || 0) : 0; input.className = 'form-input';
    inputs[key] = input; group.append(lab, input); form.appendChild(group);
  });
  area.appendChild(form);
  drillPitchingInputs = inputs;
}

// 打者行の対戦結果を合算して、投手の被打成績を生成する（投球回・失点は手入力で別途付与）
function derivePitchingFromBatting(pitcherId, battingRows) {
  const agg = { playerId: pitcherId, battersFaced: 0, atBatsAgainst: 0, hitsAllowed: 0, doublesAllowed: 0, triplesAllowed: 0, homeRunsAllowed: 0, strikeouts: 0, walks: 0, hitByPitch: 0 };
  battingRows.forEach(r => {
    agg.battersFaced   += (r.atBats || 0) + (r.walks || 0) + (r.hitByPitch || 0) + (r.sacrifices || 0);
    agg.atBatsAgainst  += (r.atBats || 0);
    agg.hitsAllowed    += (r.hits || 0);
    agg.doublesAllowed += (r.doubles || 0);
    agg.triplesAllowed += (r.triples || 0);
    agg.homeRunsAllowed += (r.homeRuns || 0);
    agg.strikeouts     += (r.strikeouts || 0);
    agg.walks          += (r.walks || 0);
    agg.hitByPitch     += (r.hitByPitch || 0);
  });
  return agg;
}

function resetDrillForm() {
  document.getElementById('drill-batting-rows').innerHTML = '';
  drillBattingRows = [];
  document.getElementById('drill-pitcher-select').value = '';
  document.getElementById('drill-pitching-form').innerHTML = '';
  drillPitchingInputs = null; drillPitchingPlayerId = null;
  editingDrillSessionId = null;
  document.getElementById('drill-edit-banner').style.display = 'none';
  document.getElementById('drill-submit-btn').textContent = '練習を登録する';
}

// 既存の練習セッションを入力フォームに読み込み、編集モードにする
function loadDrillSessionForEdit(sessionId) {
  const session = state.practiceSessions.find(s => s.id === sessionId);
  if (!session) return;
  switchTab('drill');
  resetDrillForm();
  editingDrillSessionId = sessionId;
  document.getElementById('drill-date').value = session.date;
  document.getElementById('drill-memo').value = session.memo || '';
  // 投手
  const pitch = state.practicePitchingRecords.find(r => r.sessionId === sessionId);
  if (pitch) {
    const sel = document.getElementById('drill-pitcher-select');
    sel.value = pitch.playerId;
    buildDrillPitchingForm(pitch.playerId, { inningsPitched: pitch.inningsPitched, runsAllowed: pitch.runsAllowed, earnedRuns: pitch.earnedRuns });
  }
  // 打者行
  state.practiceBattingRecords.filter(r => r.sessionId === sessionId).forEach(r => addDrillBattingRow({ playerId: r.playerId, record: r }));
  // 編集モード表示
  document.getElementById('drill-edit-banner-text').textContent = `✏️ 編集中：${session.date}`;
  document.getElementById('drill-edit-banner').style.display = 'flex';
  document.getElementById('drill-submit-btn').textContent = '更新する';
  document.getElementById('form-drill').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initDrillForm() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('drill-date').value = today;
  document.getElementById('drill-add-batter').addEventListener('click', () => addDrillBattingRow());
  document.getElementById('drill-pitcher-select').addEventListener('change', e => buildDrillPitchingForm(e.target.value || null));
  document.getElementById('drill-edit-cancel').addEventListener('click', () => {
    document.getElementById('form-drill').reset();
    document.getElementById('drill-date').value = today;
    resetDrillForm();
    showToast('編集をやめました');
  });
  document.getElementById('form-drill').addEventListener('submit', e => {
    e.preventDefault();
    const dateVal = document.getElementById('drill-date').value;
    if (!dateVal) { showToast('練習日を入力してください', 'error'); return; }
    const memo = document.getElementById('drill-memo').value.trim();
    const seasonId = getCurrentSeason()?.id || null;
    const batRes = collectDrillBatting();
    if (batRes.error) { showToast(batRes.error, 'error'); return; }
    const battingRows = batRes.rows;
    // 投手を選択している場合、打者の対戦結果を合算し、投球回・失点・自責点（手入力）を付与して投手成績に反映
    const pitcherId = document.getElementById('drill-pitcher-select').value;
    let pitchingRows = [];
    if (pitcherId) {
      const ipRaw = drillPitchingInputs ? drillPitchingInputs.inningsPitched.getValue() : NaN;
      if (isNaN(ipRaw) || ipRaw < 0) { showToast('投手の投球回を入力してください', 'error'); return; }
      const ra = parseInt(drillPitchingInputs.runsAllowed.value) || 0;
      const er = parseInt(drillPitchingInputs.earnedRuns.value) || 0;
      if (er > ra) { showToast('自責点は失点以下にしてください', 'error'); return; }
      pitchingRows = [{ ...derivePitchingFromBatting(pitcherId, battingRows), inningsPitched: ipRaw, runsAllowed: ra, earnedRuns: er }];
    }
    const commit = () => {
      const editing = editingDrillSessionId;
      const sid = editing || newId('ps');
      if (editing) {
        // 既存セッションを更新：日付・メモを上書きし、紐づく記録を入れ替え
        const sess = state.practiceSessions.find(s => s.id === editing);
        if (sess) { sess.date = dateVal; sess.memo = memo; }
        state.practiceBattingRecords = state.practiceBattingRecords.filter(r => r.sessionId !== editing);
        state.practicePitchingRecords = state.practicePitchingRecords.filter(r => r.sessionId !== editing);
      } else {
        state.practiceSessions.push({ id: sid, seasonId, date: dateVal, memo });
      }
      battingRows.forEach(row => state.practiceBattingRecords.push({ id: newId('pb'), sessionId: sid, ...row }));
      pitchingRows.forEach(entry => state.practicePitchingRecords.push({ id: newId('pp'), sessionId: sid, ...entry }));
      saveData(state);
      document.getElementById('form-drill').reset();
      document.getElementById('drill-date').value = today;
      resetDrillForm();
      renderDrillTab();
      showToast(editing ? '練習を更新しました ✓' : '練習を登録しました ✓');
    };
    if (!battingRows.length && !pitchingRows.length) {
      confirmModal('入力内容の確認', '打撃・投球成績が未入力です。このまま登録しますか？', commit);
    } else commit();
  });
}

function deleteDrillSession(id) {
  const snap = {
    practiceSessions: state.practiceSessions.slice(),
    practiceBattingRecords: state.practiceBattingRecords.slice(),
    practicePitchingRecords: state.practicePitchingRecords.slice(),
  };
  state.practiceSessions = state.practiceSessions.filter(s => s.id !== id);
  state.practiceBattingRecords = state.practiceBattingRecords.filter(r => r.sessionId !== id);
  state.practicePitchingRecords = state.practicePitchingRecords.filter(r => r.sessionId !== id);
  saveData(state);
  renderDrillTab();
  showUndoToast('練習を削除しました', () => { Object.assign(state, snap); saveData(state); renderDrillTab(); });
}

function renderDrillTab() {
  populateDrillPitcherSelect();
  renderDrillHistory();
}

function renderDrillHistory() {
  const container = document.getElementById('drill-history');
  if (!container) return;
  container.innerHTML = '';
  const season = getCurrentSeason();
  const sessions = (season ? state.practiceSessions.filter(s => s.seasonId === season.id) : state.practiceSessions)
    .slice().sort((a, b) => b.date.localeCompare(a.date));
  const card = document.createElement('div'); card.className = 'card';
  const head = document.createElement('div'); head.className = 'card-header';
  const h = document.createElement('h2'); h.className = 'card-title'; h.textContent = '練習履歴';
  head.appendChild(h); card.appendChild(head);
  if (!sessions.length) {
    card.appendChild(emptyState('🥎', '練習がまだありません', '上のフォームから練習を登録してください'));
    container.appendChild(card); return;
  }
  const list = document.createElement('div'); list.className = 'history-list';
  sessions.forEach(s => list.appendChild(buildDrillHistoryCard(s)));
  card.appendChild(list); container.appendChild(card);
}

function buildDrillHistoryCard(session) {
  const bcount = state.practiceBattingRecords.filter(r => r.sessionId === session.id).length;
  const pcount = state.practicePitchingRecords.filter(r => r.sessionId === session.id).length;
  const card = document.createElement('div'); card.className = 'history-card';
  const header = document.createElement('div');
  header.className = 'history-card-header' + (openDrillCards.has(session.id) ? ' open' : '');
  const info = document.createElement('div'); info.className = 'history-card-info';
  const dateEl = document.createElement('span'); dateEl.className = 'history-date'; dateEl.textContent = session.date;
  info.append(dateEl);
  if (session.memo) { const m = document.createElement('span'); m.className = 'history-type'; m.textContent = session.memo; info.append(m); }
  const right = document.createElement('div'); right.className = 'history-card-right';
  const counts = document.createElement('span'); counts.className = 'history-ha'; counts.textContent = `打${bcount}・投${pcount}`;
  const chevron = document.createElement('span'); chevron.className = 'history-chevron';
  chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>';
  right.append(counts, chevron);
  header.append(info, right);
  const detail = document.createElement('div');
  detail.className = 'history-card-detail' + (openDrillCards.has(session.id) ? ' open' : '');
  if (openDrillCards.has(session.id)) { renderDrillDetailContent(detail, session); detail.dataset.loaded = '1'; }
  header.addEventListener('click', () => {
    const isOpen = openDrillCards.has(session.id);
    if (isOpen) openDrillCards.delete(session.id); else openDrillCards.add(session.id);
    header.classList.toggle('open', !isOpen);
    detail.classList.toggle('open', !isOpen);
    if (!isOpen && !detail.dataset.loaded) { renderDrillDetailContent(detail, session); detail.dataset.loaded = '1'; }
  });
  card.append(header, detail);
  return card;
}

function renderDrillDetailContent(container, session) {
  container.innerHTML = '';
  if (session.memo) {
    const m = document.createElement('div'); m.className = 'history-memo'; m.textContent = '📝 ' + session.memo;
    container.appendChild(m);
  }
  // 打者成績
  const bats = state.practiceBattingRecords.filter(r => r.sessionId === session.id);
  const batSection = buildGameStatSection('打者成績', bats, (records) => {
    const rows = records.map(r => {
      const p = state.players.find(x => x.id === r.playerId);
      const avg = r.atBats > 0 ? r.hits / r.atBats : NaN;
      return { name: p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明', num: p ? (p.number ?? 999) : 999, ...r, avg };
    }).sort((a, b) => a.num - b.num);
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const t = document.createElement('table'); t.className = 'games-table history-stats-table';
    t.innerHTML = '<thead><tr><th>選手名</th><th>打数</th><th>安打</th><th>二塁打</th><th>三塁打</th><th>本塁打</th><th>打点</th><th>三振</th><th>四球</th><th>打率</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.append(td(r.name), td(r.atBats), td(r.hits), td(r.doubles), td(r.triples), td(r.homeRuns), td(r.rbi), td(r.strikeouts), td(r.walks), td(r.atBats > 0 ? fmtAvg(r.avg) : '---'));
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }, '📊', '打者データなし', '');
  // 投手成績
  const pits = state.practicePitchingRecords.filter(r => r.sessionId === session.id);
  const pitSection = buildGameStatSection('投手成績', pits, (records) => {
    const rows = records.map(r => {
      const p = state.players.find(x => x.id === r.playerId);
      const ipDec = ipToDecimal(r.inningsPitched || 0);
      const outs = Math.round(ipDec * 3);
      const ipFmt = (outs % 3) > 0 ? `${Math.floor(outs / 3)}.${outs % 3}` : `${Math.floor(outs / 3)}`;
      const era = ipDec > 0 ? r.earnedRuns * 9 / ipDec : NaN;
      const bavg = r.atBatsAgainst > 0 ? r.hitsAllowed / r.atBatsAgainst : NaN;
      return { name: p ? ((p.number != null ? `#${p.number} ` : '') + p.name) : '不明', ...r, ipFmt, era, bavg };
    });
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const t = document.createElement('table'); t.className = 'games-table history-stats-table';
    t.innerHTML = '<thead><tr><th>選手名</th><th>投球回</th><th>被安打</th><th>失点</th><th>自責点</th><th>与四球</th><th>奪三振</th><th>防御率</th><th>被打率</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.append(td(r.name), td(r.ipFmt), td(r.hitsAllowed), td(r.runsAllowed), td(r.earnedRuns), td(r.walks), td(r.strikeouts), td(isNaN(r.era) ? '---' : r.era.toFixed(2)), td(isNaN(r.bavg) ? '---' : fmtAvg(r.bavg)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }, '⚾', '投手データなし', '');
  // アクション
  const actions = document.createElement('div'); actions.className = 'history-card-actions';
  const editBtn = document.createElement('button'); editBtn.className = 'btn btn-ghost-dark btn-sm'; editBtn.textContent = '編集する';
  editBtn.addEventListener('click', e => { e.stopPropagation(); loadDrillSessionForEdit(session.id); });
  const delBtn = document.createElement('button'); delBtn.className = 'btn btn-ghost-dark btn-sm'; delBtn.textContent = '削除';
  delBtn.addEventListener('click', e => { e.stopPropagation(); confirmModal('練習を削除', `${session.date} の練習を削除しますか？`, () => deleteDrillSession(session.id)); });
  actions.append(editBtn, delBtn);
  container.append(batSection, pitSection, actions);
}

function renderPlayerTrendChart(panel, type, fixedPlayerId) {
  if (typeof Chart === 'undefined') return;
  const records = type === 'batting' ? state.battingRecords : state.pitchingRecords;
  let playerIds = [...new Set(records.map(r => r.playerId))]
    .map(pid => state.players.find(p => p.id === pid))
    .filter(Boolean)
    .sort(comparePlayers)
    .map(p => p.id);
  if (fixedPlayerId) {
    if (!playerIds.includes(fixedPlayerId)) return;
    playerIds = [fixedPlayerId];
  }
  if (!playerIds.length || !state.games.length) return;

  // 累計（通算）推移：accFn で1試合分を積み上げ、valFn でその時点の通算値を算出
  const BATTING_METRICS = [
    { key: 'avg', label: '打率', accFn: (a, r) => { a.atBats += (r.atBats||0); a.hits += (r.hits||0); }, valFn: a => a.atBats > 0 ? a.hits / a.atBats : null, fmt: 'avg' },
    { key: 'obp', label: '出塁率', accFn: (a, r) => { a.atBats += (r.atBats||0); a.hits += (r.hits||0); a.walks += (r.walks||0); a.hitByPitch += (r.hitByPitch||0); a.sacrifices += (r.sacrifices||0); }, valFn: a => { const pa = a.atBats + a.walks + a.hitByPitch + a.sacrifices; return pa > 0 ? (a.hits + a.walks + a.hitByPitch) / pa : null; }, fmt: 'avg' },
    { key: 'ops', label: 'OPS', accFn: (a, r) => { a.atBats += (r.atBats||0); a.hits += (r.hits||0); a.doubles += (r.doubles||0); a.triples += (r.triples||0); a.homeRuns += (r.homeRuns||0); a.walks += (r.walks||0); a.hitByPitch += (r.hitByPitch||0); a.sacrifices += (r.sacrifices||0); }, valFn: a => { const pa = a.atBats + a.walks + a.hitByPitch + a.sacrifices; const obp = pa > 0 ? (a.hits + a.walks + a.hitByPitch) / pa : null; const tb = (a.hits - a.doubles - a.triples - a.homeRuns) + a.doubles*2 + a.triples*3 + a.homeRuns*4; const slg = a.atBats > 0 ? tb / a.atBats : null; return (obp == null || slg == null) ? null : obp + slg; }, fmt: 'dec3' },
    { key: 'sbPct', label: '盗塁成功率', accFn: (a, r) => { a.stolenBases += (r.stolenBases||0); a.caughtStealing += (r.caughtStealing||0); }, valFn: a => { const att = a.stolenBases + a.caughtStealing; return att > 0 ? a.stolenBases / att : null; }, fmt: 'pct' },
  ];
  const PITCHING_METRICS = [
    { key: 'era', label: '防御率', accFn: (a, r) => { a.er += (r.earnedRuns||0); a.ip += ipToDecimal(r.inningsPitched||0); }, valFn: a => a.ip > 0 ? a.er * 9 / a.ip : null, fmt: 'dec2' },
    { key: 'whip', label: 'WHIP', accFn: (a, r) => { a.walks += (r.walks||0); a.hitsAllowed += (r.hitsAllowed||0); a.ip += ipToDecimal(r.inningsPitched||0); }, valFn: a => a.ip > 0 ? (a.walks + a.hitsAllowed) / a.ip : null, fmt: 'dec2' },
    { key: 'k9', label: '奪三振率', accFn: (a, r) => { a.strikeouts += (r.strikeouts||0); a.ip += ipToDecimal(r.inningsPitched||0); }, valFn: a => a.ip > 0 ? a.strikeouts * 9 / a.ip : null, fmt: 'dec2' },
    { key: 'bb9', label: '与四死球率', accFn: (a, r) => { a.walks += (r.walks||0); a.hitByPitch += (r.hitByPitch||0); a.ip += ipToDecimal(r.inningsPitched||0); }, valFn: a => a.ip > 0 ? (a.walks + a.hitByPitch) * 9 / a.ip : null, fmt: 'dec2' },
  ];
  const metrics = type === 'batting' ? BATTING_METRICS : PITCHING_METRICS;

  const card = document.createElement('div');
  card.className = 'chart-card';
  const header = document.createElement('div');
  header.className = 'chart-custom-header';
  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = '選手別成績推移（累計）';

  const playerSelect = document.createElement('select');
  playerSelect.className = 'form-select chart-custom-select';
  playerIds.forEach(pid => {
    const p = state.players.find(x => x.id === pid);
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
    playerSelect.appendChild(opt);
  });

  if (fixedPlayerId) { playerSelect.value = fixedPlayerId; playerSelect.style.display = 'none'; }

  const metricSelect = document.createElement('select');
  metricSelect.className = 'form-select chart-custom-select';
  metrics.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.key; opt.textContent = m.label;
    metricSelect.appendChild(opt);
  });

  header.append(title, playerSelect, metricSelect);
  const canvas = document.createElement('canvas');
  canvas.height = 220;
  card.append(header, canvas);
  panel.appendChild(card);

  const chartKey = type === 'batting' ? 'playerBattingTrend' : 'playerPitchingTrend';
  const color = type === 'batting' ? 'rgba(0,120,255' : 'rgba(22,163,74';

  const draw = () => {
    const pid = playerSelect.value;
    const metricKey = metricSelect.value;
    const meta = metrics.find(m => m.key === metricKey);
    const playerRecords = records
      .filter(r => r.playerId === pid)
      .map(r => { const g = state.games.find(x => x.id === r.gameId); return { ...r, date: g ? g.date : '', opp: g ? g.opponent : '' }; })
      .filter(r => r.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const labels = playerRecords.map(r => r.date.slice(5) + ' vs ' + r.opp);
    const acc = { atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0, walks: 0, hitByPitch: 0, sacrifices: 0, stolenBases: 0, caughtStealing: 0, er: 0, ip: 0, strikeouts: 0, hitsAllowed: 0 };
    const data = playerRecords.map(r => { meta.accFn(acc, r); return meta.valFn(acc); });
    const ticksCb = meta.fmt === 'avg' ? { callback: v => '.' + String(Math.round(v*1000)).padStart(3,'0') }
                  : meta.fmt === 'dec3' ? { callback: v => v.toFixed(3) }
                  : meta.fmt === 'dec2' ? { callback: v => v.toFixed(2) }
                  : meta.fmt === 'pct'  ? { callback: v => (v*100).toFixed(0) + '%' } : {};
    if (_charts[chartKey]) _charts[chartKey].destroy();
    _charts[chartKey] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ label: meta.label, data, borderColor: color + ',0.8)', backgroundColor: color + ',0.1)', tension: 0.3, pointRadius: 5, spanGaps: false }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: meta.fmt === 'int', ticks: ticksCb } } }
    });
  };
  playerSelect.addEventListener('change', draw);
  metricSelect.addEventListener('change', draw);
  draw();
}

function makeKpiCard(label, value, cls = '') {
  const card = document.createElement('div');
  card.className = 'kpi-card ' + cls;
  const l = document.createElement('div'); l.className = 'kpi-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'kpi-value'; v.textContent = value;
  card.append(l, v);
  return card;
}

function makeStatsTable(rows, cols) {
  const RANK_COLORS = ['rgba(220,38,38,0.22)', 'rgba(220,38,38,0.13)', 'rgba(220,38,38,0.07)'];

  function computeTop3Map() {
    const map = {};
    cols.forEach(col => {
      if (col.highIsGood === undefined) return;
      const vals = rows.map(r => r[col.key]).filter(v => v != null && !isNaN(v) && isFinite(v));
      const distinct = [...new Set(vals)].sort((a, b) => col.highIsGood ? b - a : a - b);
      map[col.key] = distinct.slice(0, 3);
    });
    return map;
  }
  const top3Map = computeTop3Map();

  function fillCell(cell, row, col) {
    if (col.num === false) {
      cell.textContent = row[col.key] ?? '';
      cell.style.fontFamily = 'var(--font-sans)';
      return;
    }
    let rawVal = null;
    if (col.pct) {
      const v = row[col.key];
      cell.textContent = (v != null && !isNaN(v) && isFinite(v)) ? (v * 100).toFixed(1) + '%' : '---';
      rawVal = (v != null && !isNaN(v) && isFinite(v)) ? v : null;
    } else if (col.avg) {
      cell.textContent = fmtAvg(row[col.key]);
      rawVal = (row[col.key] != null && !isNaN(row[col.key]) && isFinite(row[col.key])) ? row[col.key] : null;
    } else if (col.ipDec) {
      const dec = row[col.key] ?? 0;
      const outs = Math.round(dec * 3);
      const innings = Math.floor(outs / 3);
      const frac = outs % 3;
      cell.textContent = frac > 0 ? `${innings}.${frac}` : `${innings}`;
      rawVal = dec > 0 ? dec : null;
    } else if (col.p != null) {
      const v = row[col.key];
      cell.textContent = (v != null && !isNaN(v) && isFinite(v)) ? (col.p > 0 ? Number(v).toFixed(col.p) : v) : '---';
      rawVal = (v != null && !isNaN(v) && isFinite(v)) ? v : null;
    } else {
      cell.textContent = row[col.key] ?? '---';
      rawVal = (row[col.key] != null && !isNaN(row[col.key])) ? row[col.key] : null;
    }
    if (col.highIsGood !== undefined && rawVal !== null && top3Map[col.key]) {
      const rank = top3Map[col.key].indexOf(rawVal);
      if (rank >= 0) {
        cell.style.background = RANK_COLORS[rank];
        if (rank === 0) cell.style.fontWeight = '700';
      }
    }
  }

  const card = document.createElement('div');
  card.className = 'card';
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'data-table';

  let sortKey = null;
  let sortDir = -1;

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const thEls = [];
  cols.forEach(col => {
    const th = document.createElement('th');
    if (col.num === false) {
      th.textContent = col.label;
    } else {
      th.className = 'sortable';
      const lbl = document.createElement('span');
      lbl.textContent = col.label;
      const icon = document.createElement('span');
      icon.className = 'sort-icon';
      th.append(lbl, icon);
      th.addEventListener('click', () => {
        if (sortKey === col.key) sortDir *= -1;
        else { sortKey = col.key; sortDir = -1; }
        thEls.forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
        renderBody();
      });
    }
    thEls.push(th);
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  tbl.appendChild(tbody);

  function renderBody() {
    const sorted = sortKey ? [...rows].sort((a, b) => {
      const nullVal = sortDir === 1 ? Infinity : -Infinity;
      let av = a[sortKey], bv = b[sortKey];
      if (av == null || isNaN(av) || !isFinite(av)) av = nullVal;
      if (bv == null || isNaN(bv) || !isFinite(bv)) bv = nullVal;
      return (av - bv) * sortDir;
    }) : rows;
    tbody.innerHTML = '';
    sorted.forEach(row => {
      const tr = document.createElement('tr');
      cols.forEach(col => {
        const cell = document.createElement('td');
        fillCell(cell, row, col);
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
  }

  renderBody();
  wrap.appendChild(tbl);
  card.appendChild(wrap);
  return card;
}

/* ===== Empty State ===== */
function emptyState(icon, text, sub) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  const iconEl = document.createElement('div'); iconEl.className = 'empty-state-icon'; iconEl.textContent = icon;
  const textEl = document.createElement('div'); textEl.className = 'empty-state-text'; textEl.textContent = text;
  const subEl  = document.createElement('div'); subEl.className  = 'empty-state-sub';  subEl.textContent  = sub;
  div.append(iconEl, textEl, subEl);
  return div;
}

/* ===== CSV Export ===== */
function downloadCSV(filename, rows, colDefs) {
  const BOM = '﻿';
  const header = colDefs.map(c => c.label).join(',');
  const lines = rows.map(row => colDefs.map(c => {
    let v = row[c.key];
    if (c.avg) v = (v != null && !isNaN(v) && isFinite(v)) ? ('.' + Math.round(v * 1000).toString().padStart(3,'0')) : '---';
    else if (c.ipDec) { const o = Math.round((v||0)*3); v = (o%3)>0?`${Math.floor(o/3)}.${o%3}`:`${Math.floor(o/3)}`; }
    else if (c.p != null) v = (v != null && !isNaN(v) && isFinite(v)) ? Number(v).toFixed(c.p) : '---';
    else if (v == null || v === undefined) v = '';
    return '"' + String(v).replace(/"/g, '""') + '"';
  }).join(','));
  const csv = BOM + [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('CSVをダウンロードしました ✓');
}

/* ===== Export / Import ===== */
function exportJSON() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'yakyu_backup_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('データをエクスポートしました ✓');
}

function importJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.games || !data.players) throw new Error('無効なファイル形式です');
      confirmModal('データをインポート', `現在のデータをすべて上書きします。よろしいですか？ (試合: ${data.games.length}件, 選手: ${data.players.length}名)`, () => {
        state = migrate(data);
        saveData(state);
        renderAll();
        showToast('インポートしました ✓');
      });
    } catch (err) {
      showToast('インポートに失敗しました: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/* ===== Init ===== */
function renderAll() {
  updateSeasonHeader();
  renderGamesList();
  renderPlayersList();
  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab) {
    if (activeTab.dataset.tab === 'history') renderHistoryTab();
    if (activeTab.dataset.tab === 'stats') renderStatsTab();
    if (activeTab.dataset.tab === 'drill') renderDrillTab();
    if (activeTab.dataset.tab === 'practice-stats') renderPracticeStats();
  }
}

function init() {
  initTabs();
  initSubtabs();
  initGameForm();
  initInlineStats();
  initDrillForm();
  initPlayerForm();

  document.getElementById('toggle-batting-entry').addEventListener('click', () =>
    toggleAccordion('toggle-batting-entry', 'batting-entry-body'));
  document.getElementById('toggle-pitching-entry').addEventListener('click', () =>
    toggleAccordion('toggle-pitching-entry', 'pitching-entry-body'));
  document.getElementById('stats-entry-close').addEventListener('click', hideStatsEntry);
  document.getElementById('stats-entry-pitcher-select').addEventListener('change', e => {
    if (currentStatsEntryGameId && e.target.value) {
      renderPitchingForm(document.getElementById('stats-entry-pitching-form'), currentStatsEntryGameId, e.target.value);
    } else {
      document.getElementById('stats-entry-pitching-form').innerHTML = '';
    }
  });

  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('input-import').addEventListener('change', e => { importJSON(e.target.files[0]); e.target.value = ''; });

  // モバイル用ヘッダーメニュー
  const headerMenu = document.getElementById('header-menu');
  document.getElementById('btn-header-menu').addEventListener('click', e => {
    e.stopPropagation();
    headerMenu.style.display = headerMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', e => {
    if (headerMenu.style.display !== 'none' && !headerMenu.contains(e.target)) headerMenu.style.display = 'none';
  });
  document.getElementById('menu-export').addEventListener('click', () => { headerMenu.style.display = 'none'; exportJSON(); });
  document.getElementById('input-import-mobile').addEventListener('change', e => {
    headerMenu.style.display = 'none';
    importJSON(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('edit-modal-overlay')) closeEditModal();
  });

  document.getElementById('player-stats-modal-close').addEventListener('click', closePlayerStatsModal);
  document.getElementById('player-stats-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('player-stats-modal-overlay')) closePlayerStatsModal();
  });
  document.getElementById('history-filter-select').addEventListener('change', renderHistoryTab);

  document.getElementById('league-modal-close').addEventListener('click', closeLeagueModal);
  document.getElementById('league-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('league-modal-overlay')) closeLeagueModal();
  });
  document.getElementById('league-team-add').addEventListener('click', addLeagueTeam);
  document.getElementById('league-team-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLeagueTeam(); } });

  document.getElementById('btn-season').addEventListener('click', showSeasonModal);
  document.getElementById('season-modal-close').addEventListener('click', () => { document.getElementById('season-modal-overlay').style.display = 'none'; });
  document.getElementById('season-modal-overlay').addEventListener('click', e => { if (e.target === document.getElementById('season-modal-overlay')) document.getElementById('season-modal-overlay').style.display = 'none'; });
  document.getElementById('btn-new-season').addEventListener('click', showNewSeasonModal);
  document.getElementById('new-season-modal-close').addEventListener('click', () => { document.getElementById('new-season-modal-overlay').style.display = 'none'; });
  document.getElementById('new-season-cancel').addEventListener('click', () => { document.getElementById('new-season-modal-overlay').style.display = 'none'; });
  document.getElementById('new-season-confirm').addEventListener('click', createNewSeason);

  // オフライン起動時はローカルミラーから即座に復元
  const cached = localStorage.getItem(LOCAL_STATE_KEY);
  if (cached) {
    try {
      state = migrate(JSON.parse(cached));
      renderAll();
    } catch (e) { /* 破損時はFirebaseの受信を待つ */ }
  }

  DATA_REF.on('value', snapshot => {
    // ローカルに未送信の変更があれば、リモートを受け入れずに再送する
    if (localStorage.getItem(LOCAL_DIRTY_KEY)) {
      flushLocalChanges();
      return;
    }
    const data = snapshot.val();
    state = data ? migrate(data) : freshState();
    mirrorToLocal(state);
    renderAll();
    if (currentStatsEntryGameId) showStatsEntry(currentStatsEntryGameId);
  });

  window.addEventListener('online', () => { updateOfflineBanner(); flushLocalChanges(); });
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();
}

document.addEventListener('DOMContentLoaded', init);

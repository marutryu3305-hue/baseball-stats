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
  return { schemaVersion: SCHEMA_VERSION, games: [], players: [], battingRecords: [], pitchingRecords: [], fieldingRecords: [] };
}

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

function migrate(data) {
  if (!data.schemaVersion) data.schemaVersion = SCHEMA_VERSION;
  data.games = toArray(data.games);
  data.players = toArray(data.players);
  data.battingRecords = toArray(data.battingRecords);
  data.pitchingRecords = toArray(data.pitchingRecords);
  data.fieldingRecords = toArray(data.fieldingRecords);
  data.players.forEach(p => {
    if (!p.positions) {
      p.positions = p.position ? [p.position] : [];
      delete p.position;
    }
    if (!p.grade) p.grade = null;
    if (p.furigana === undefined) p.furigana = '';
  });
  data.games.forEach(g => {
    if (!g.gameType) g.gameType = 'spring';
  });
  return data;
}

function gameTypeLabel(type) {
  return { spring: '春リーグ', fall: '秋リーグ', practice: '練習試合' }[type] || '−';
}

function saveData(state) {
  DATA_REF.set(state).catch(() => showToast('データの保存に失敗しました。', 'error'));
}

let state = freshState();

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
}

/* ===== Sub-tabs ===== */
function initSubtabs() {
  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.subtab-panel').forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
      renderSubtab(btn.dataset.subtab);
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
    const homeAway = document.querySelector('input[name="home-away"]:checked').value;
    const gameType = document.querySelector('input[name="game-type"]:checked').value;

    const game = { id: newId('g'), date: dateVal, opponent: opp, homeAway, gameType, innings: ourInnings, opponentInnings: oppInnings, ourScore, opponentScore: oppScore, result };
    state.games.push(game);
    saveData(state);
    renderGamesList();
    document.getElementById('form-game').reset();
    buildInningGrid('inning-our');
    buildInningGrid('inning-opp');
    document.getElementById('game-date').value = today;
    showToast('試合を登録しました ✓');
    showStatsEntry(game.id);
  });
}

function renderGamesList() {
  const container = document.getElementById('games-list');
  if (!state.games.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('⚾', 'まだ試合が登録されていません', '上のフォームから登録してください'));
    return;
  }

  const sorted = [...state.games].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'games-table';
  tbl.innerHTML = '<thead><tr><th>日付</th><th>種別</th><th>対戦相手</th><th>H/A</th><th>スコア</th><th>結果</th><th></th><th></th></tr></thead>';
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
      td(game.homeAway === 'home' ? '🏠 H' : '✈️ A'),
      score,
      badgeTd,
      entryTd,
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
  state.games = state.games.filter(g => g.id !== id);
  state.battingRecords = state.battingRecords.filter(r => r.gameId !== id);
  state.pitchingRecords = state.pitchingRecords.filter(r => r.gameId !== id);
  state.fieldingRecords = state.fieldingRecords.filter(r => r.gameId !== id);
  saveData(state);
  if (currentStatsEntryGameId === id) hideStatsEntry();
  renderGamesList();
  showToast('試合を削除しました', 'info');
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

function renderPlayersList() {
  const container = document.getElementById('players-list');
  if (!state.players.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('👥', 'まだ選手が登録されていません', '上のフォームから選手を追加してください'));
    return;
  }

  const sorted = [...state.players].sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'games-table';
  tbl.innerHTML = '<thead><tr><th>背番号</th><th>選手名</th><th>ふりがな</th><th>学年</th><th>ポジション</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  sorted.forEach(p => {
    const tr = document.createElement('tr');
    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-icon';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
    delBtn.title = '削除';
    delBtn.addEventListener('click', () => {
      confirmModal('選手を削除', `${p.name} を削除しますか？この選手の打撃・投球・守備データも全て削除されます。`, () => deletePlayer(p.id));
    });
    delTd.appendChild(delBtn);
    tr.append(td(p.number ?? '-'), td(p.name), td(p.furigana || '−'), td(p.grade ? `${p.grade}年` : '−'), td((p.positions || []).join('・')), delTd);
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function deletePlayer(id) {
  state.players = state.players.filter(p => p.id !== id);
  state.battingRecords = state.battingRecords.filter(r => r.playerId !== id);
  state.pitchingRecords = state.pitchingRecords.filter(r => r.playerId !== id);
  state.fieldingRecords = state.fieldingRecords.filter(r => r.playerId !== id);
  saveData(state);
  renderPlayersList();
  if (currentStatsEntryGameId) populateEntryPitcherSelect();
  showToast('選手を削除しました', 'info');
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
    const input = document.createElement('input');
    input.type = 'number';
    input.step = f.step;
    input.min = f.min;
    input.placeholder = f.placeholder;
    input.className = 'form-input';
    input.value = existing[f.key] ?? (f.key === 'inningsPitched' ? '' : 0);
    inputs[f.key] = input;
    group.append(label, input);
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
    const ipRaw = parseFloat(inputs.inningsPitched.value);
    if (isNaN(ipRaw) || ipRaw < 0) {
      showToast('投球回を正しく入力してください', 'error');
      inputs.inningsPitched.classList.add('error');
      return;
    }
    const frac = Math.round((ipRaw % 1) * 10);
    if (frac > 2) {
      showToast('投球回の小数点は 0, .1, .2 のみ有効です（例: 6.2）', 'error');
      inputs.inningsPitched.classList.add('error');
      return;
    }
    inputs.inningsPitched.classList.remove('error');

    const record = {
      id: newId('pi'),
      gameId,
      playerId,
      result: resultSelect.value,
    };
    fields.forEach(f => {
      record[f.key] = f.key === 'inningsPitched' ? ipRaw : (parseInt(inputs[f.key].value) || 0);
    });

    const idx = state.pitchingRecords.findIndex(r => r.gameId === gameId && r.playerId === playerId);
    if (idx >= 0) state.pitchingRecords[idx] = { ...state.pitchingRecords[idx], ...record };
    else state.pitchingRecords.push(record);
    saveData(state);
    showToast('投球データを保存しました ✓');
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
    renderRosterGrid(battingBody, gameId, 'batting', BATTING_COLS, state.battingRecords, 'b');
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
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999))
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.number != null ? `#${p.number} ` : '') + p.name;
      sel.appendChild(opt);
    });
  if (prev) sel.value = prev;
}

/* ===== STATS ===== */
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
  return '.' + Math.round(val * 1000).toString().padStart(3, '0');
}

function computeBattingStats() {
  const map = {};
  state.battingRecords.forEach(r => {
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
    const player = state.players.find(p => p.id === m.playerId);
    return { name: player ? player.name : '不明', grade: player ? player.grade : null, furigana: player ? (player.furigana || '') : '', ...m, avg, obp, slg, ops, tb };
  }).sort((a, b) => {
    const ga = a.grade ?? 0, gb = b.grade ?? 0;
    if (ga !== gb) return gb - ga;
    return (a.furigana || a.name || '').localeCompare(b.furigana || b.name || '', 'ja');
  });
}

function computePitchingStats() {
  const map = {};
  state.pitchingRecords.forEach(r => {
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
  }).sort((a, b) => {
    const ga = a.grade ?? 0, gb = b.grade ?? 0;
    if (ga !== gb) return gb - ga;
    return (a.furigana || a.name || '').localeCompare(b.furigana || b.name || '', 'ja');
  });
}


function filterGamesByType(filterVal) {
  if (filterVal === 'all') return state.games;
  if (filterVal === 'total') return state.games.filter(g => g.gameType === 'spring' || g.gameType === 'fall');
  return state.games.filter(g => g.gameType === filterVal);
}

/* ===== Stats Rendering ===== */
const _charts = {};

function renderStatsTab() {
  const activeSubtab = document.querySelector('.subtab.active');
  if (activeSubtab) renderSubtab(activeSubtab.dataset.subtab);
  else renderSubtab('batting-stats');
}

function renderSubtab(name) {
  if (name === 'batting-stats')  renderBattingStats();
  if (name === 'pitching-stats') renderPitchingStats();
  if (name === 'game-stats')     renderGameStats();
}

function renderBattingStats() {
  const panel = document.getElementById('subtab-batting-stats');
  panel.innerHTML = '';
  const rows = computeBattingStats();

  if (!rows.length) {
    panel.appendChild(emptyState('📊', 'データがありません', '試合結果を入力すると自動で集計されます'));
    return;
  }

  const teamAvg = rows.length ? rows.reduce((s, r) => s + (isNaN(r.avg) ? 0 : r.avg), 0) / rows.filter(r => !isNaN(r.avg)).length : NaN;
  const validOps = rows.filter(r => !isNaN(r.ops) && isFinite(r.ops));
  const teamOPS = validOps.length ? validOps.reduce((s, r) => s + r.ops, 0) / validOps.length : NaN;

  const kpiGrid = document.createElement('div');
  kpiGrid.className = 'kpi-grid';
  [
    { label: 'チーム打率', value: fmtAvg(teamAvg) },
    { label: 'チーム得点', value: rows.reduce((s,r)=>s+r.runs,0) },
    { label: 'チーム盗塁', value: rows.reduce((s,r)=>s+r.stolenBases,0) },
    { label: 'チームOPS',  value: isNaN(teamOPS) ? '---' : teamOPS.toFixed(3) },
  ].forEach(k => kpiGrid.appendChild(makeKpiCard(k.label, k.value)));
  panel.appendChild(kpiGrid);

  const totalGames = state.games.length;
  const qualBatting = rows.filter(r => {
    const pa = r.atBats + r.walks + r.hitByPitch + r.sacrifices;
    return pa >= Math.max(1, totalGames);
  });
  const chartBase = qualBatting.length > 0 ? qualBatting : rows;
  const avgTop5 = [...chartBase].filter(r => !isNaN(r.avg) && isFinite(r.avg)).sort((a, b) => b.avg - a.avg).slice(0, 5);
  const opsTop5 = [...chartBase].filter(r => !isNaN(r.ops) && isFinite(r.ops)).sort((a, b) => b.ops - a.ops).slice(0, 5);

  if ((avgTop5.length >= 1 || opsTop5.length >= 1) && typeof Chart !== 'undefined') {
    const chartRow = document.createElement('div');
    chartRow.className = 'chart-row';

    const c1 = document.createElement('div');
    c1.className = 'chart-card';
    const t1 = document.createElement('div');
    t1.className = 'chart-title';
    t1.textContent = '打率 TOP5（規定打席到達者）';
    const canvas1 = document.createElement('canvas');
    canvas1.height = 220;
    c1.append(t1, canvas1);
    chartRow.appendChild(c1);

    const c2 = document.createElement('div');
    c2.className = 'chart-card';
    const t2 = document.createElement('div');
    t2.className = 'chart-title';
    t2.textContent = 'OPS TOP5（規定打席到達者）';
    const canvas2 = document.createElement('canvas');
    canvas2.height = 220;
    c2.append(t2, canvas2);
    chartRow.appendChild(c2);

    panel.appendChild(chartRow);

    if (_charts.battingAvg) _charts.battingAvg.destroy();
    _charts.battingAvg = new Chart(canvas1, {
      type: 'bar',
      data: {
        labels: avgTop5.map(r => r.name),
        datasets: [{ label: '打率', data: avgTop5.map(r => +r.avg.toFixed(3)), backgroundColor: 'rgba(0,120,255,0.7)', borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '.' + String(Math.round(v * 1000)).padStart(3, '0') } } }
      }
    });

    if (_charts.battingBar) _charts.battingBar.destroy();
    _charts.battingBar = new Chart(canvas2, {
      type: 'bar',
      data: {
        labels: opsTop5.map(r => r.name),
        datasets: [{ label: 'OPS', data: opsTop5.map(r => +r.ops.toFixed(3)), backgroundColor: 'rgba(139,92,246,0.7)', borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v.toFixed(3) } } }
      }
    });
  }

  if (typeof Chart !== 'undefined') {
    const BATTING_METRICS = [
      { key: 'atBats',      label: '打数',   fmt: 'int' },
      { key: 'hits',        label: '安打',   fmt: 'int' },
      { key: 'doubles',     label: '二塁打', fmt: 'int' },
      { key: 'triples',     label: '三塁打', fmt: 'int' },
      { key: 'homeRuns',    label: '本塁打', fmt: 'int' },
      { key: 'rbi',         label: '打点',   fmt: 'int' },
      { key: 'runs',        label: '得点',   fmt: 'int' },
      { key: 'strikeouts',  label: '三振',   fmt: 'int' },
      { key: 'walks',       label: '四球',   fmt: 'int' },
      { key: 'stolenBases', label: '盗塁',   fmt: 'int' },
      { key: 'tb',          label: '塁打',   fmt: 'int' },
      { key: 'avg',         label: '打率',   fmt: 'avg' },
      { key: 'obp',         label: '出塁率', fmt: 'avg' },
      { key: 'slg',         label: '長打率', fmt: 'avg' },
      { key: 'ops',         label: 'OPS',    fmt: 'dec3' },
    ];
    const customBattingCard = document.createElement('div');
    customBattingCard.className = 'chart-card';
    const customBattingHeader = document.createElement('div');
    customBattingHeader.className = 'chart-custom-header';
    const customBattingTitle = document.createElement('div');
    customBattingTitle.className = 'chart-title';
    customBattingTitle.textContent = 'カスタム項目グラフ';
    const customBattingSelect = document.createElement('select');
    customBattingSelect.className = 'form-select chart-custom-select';
    BATTING_METRICS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.key; opt.textContent = m.label;
      customBattingSelect.appendChild(opt);
    });
    customBattingHeader.append(customBattingTitle, customBattingSelect);
    const customBattingCanvas = document.createElement('canvas');
    customBattingCanvas.height = 220;
    customBattingCard.append(customBattingHeader, customBattingCanvas);
    panel.appendChild(customBattingCard);

    const drawCustomBatting = key => {
      const meta = BATTING_METRICS.find(m => m.key === key);
      const sorted = [...rows].filter(r => r[key] != null && !isNaN(r[key]) && isFinite(r[key])).sort((a, b) => b[key] - a[key]).slice(0, 10);
      const ticksCb = meta.fmt === 'avg'  ? { callback: v => '.' + String(Math.round(v * 1000)).padStart(3, '0') }
                    : meta.fmt === 'dec3' ? { callback: v => v.toFixed(3) } : {};
      const dataVals = sorted.map(r => meta.fmt === 'avg' ? +r[key].toFixed(3) : meta.fmt === 'dec3' ? +r[key].toFixed(3) : r[key]);
      if (_charts.battingCustom) _charts.battingCustom.destroy();
      _charts.battingCustom = new Chart(customBattingCanvas, {
        type: 'bar',
        data: { labels: sorted.map(r => r.name), datasets: [{ label: meta.label, data: dataVals, backgroundColor: 'rgba(251,146,60,0.75)', borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: ticksCb } } }
      });
    };
    customBattingSelect.addEventListener('change', () => drawCustomBatting(customBattingSelect.value));
    drawCustomBatting(BATTING_METRICS[0].key);
  }

  const cols = [
    { key: 'name',        label: '選手名',  num: false },
    { key: 'games',       label: '試合',   p: 0 },
    { key: 'atBats',      label: '打数',   p: 0 },
    { key: 'hits',        label: '安打',   p: 0, highIsGood: true },
    { key: 'doubles',     label: '二塁',   p: 0, highIsGood: true },
    { key: 'triples',     label: '三塁',   p: 0, highIsGood: true },
    { key: 'homeRuns',    label: '本塁',   p: 0, highIsGood: true },
    { key: 'rbi',         label: '打点',   p: 0, highIsGood: true },
    { key: 'runs',        label: '得点',   p: 0, highIsGood: true },
    { key: 'strikeouts',  label: '三振',   p: 0 },
    { key: 'walks',       label: '四球',   p: 0, highIsGood: true },
    { key: 'stolenBases', label: '盗塁',   p: 0, highIsGood: true },
    { key: 'avg',         label: '打率',   avg: true, highIsGood: true },
    { key: 'obp',         label: '出塁率', avg: true, highIsGood: true },
    { key: 'slg',         label: '長打率', avg: true, highIsGood: true },
    { key: 'ops',         label: 'OPS',    avg: true, highIsGood: true },
  ];
  panel.appendChild(makeStatsTable(rows, cols));
}

function renderPitchingStats() {
  const panel = document.getElementById('subtab-pitching-stats');
  panel.innerHTML = '';
  const rows = computePitchingStats();

  if (!rows.length) {
    panel.appendChild(emptyState('📊', 'データがありません', '投球データを入力してください'));
    return;
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
  panel.appendChild(kpiGrid);

  const totalGamesP = state.games.length;
  const qualPitching = rows.filter(r => r.ipDec >= Math.max(1, totalGamesP));
  const pitchBase = qualPitching.length > 0 ? qualPitching : rows;
  const eraTop5  = [...pitchBase].filter(r => !isNaN(r.era)  && isFinite(r.era)).sort((a, b) => a.era  - b.era).slice(0, 5);
  const whipTop5 = [...pitchBase].filter(r => !isNaN(r.whip) && isFinite(r.whip)).sort((a, b) => a.whip - b.whip).slice(0, 5);

  if ((eraTop5.length >= 1 || whipTop5.length >= 1) && typeof Chart !== 'undefined') {
    const chartRow = document.createElement('div');
    chartRow.className = 'chart-row';

    const c1 = document.createElement('div');
    c1.className = 'chart-card';
    const t1 = document.createElement('div');
    t1.className = 'chart-title';
    t1.textContent = '防御率 TOP5（規定投球回到達者）';
    const canvas1 = document.createElement('canvas');
    canvas1.height = 220;
    c1.append(t1, canvas1);
    chartRow.appendChild(c1);

    const c2 = document.createElement('div');
    c2.className = 'chart-card';
    const t2 = document.createElement('div');
    t2.className = 'chart-title';
    t2.textContent = 'WHIP TOP5（規定投球回到達者）';
    const canvas2 = document.createElement('canvas');
    canvas2.height = 220;
    c2.append(t2, canvas2);
    chartRow.appendChild(c2);

    panel.appendChild(chartRow);

    if (_charts.pitchingEra) _charts.pitchingEra.destroy();
    _charts.pitchingEra = new Chart(canvas1, {
      type: 'bar',
      data: {
        labels: eraTop5.map(r => r.name),
        datasets: [{ label: '防御率', data: eraTop5.map(r => +r.era.toFixed(2)), backgroundColor: 'rgba(22,163,74,0.7)', borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'ERA（低いほど良い）' } } }
      }
    });

    if (_charts.pitchingBar) _charts.pitchingBar.destroy();
    _charts.pitchingBar = new Chart(canvas2, {
      type: 'bar',
      data: {
        labels: whipTop5.map(r => r.name),
        datasets: [{ label: 'WHIP', data: whipTop5.map(r => +r.whip.toFixed(2)), backgroundColor: 'rgba(0,120,255,0.7)', borderRadius: 4 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'WHIP（低いほど良い）' } } }
      }
    });
  }

  if (typeof Chart !== 'undefined') {
    const PITCHING_METRICS = [
      { key: 'games',           label: '登板',   fmt: 'int' },
      { key: 'wins',            label: '勝',     fmt: 'int' },
      { key: 'losses',          label: '負',     fmt: 'int' },
      { key: 'saves',           label: 'S',      fmt: 'int' },
      { key: 'pitchCount',      label: '球数',   fmt: 'int' },
      { key: 'hitsAllowed',     label: '被安打', fmt: 'int' },
      { key: 'runsAllowed',     label: '失点',   fmt: 'int' },
      { key: 'earnedRuns',      label: '自責点', fmt: 'int' },
      { key: 'walks',           label: '与四球', fmt: 'int' },
      { key: 'strikeouts',      label: '奪三振', fmt: 'int' },
      { key: 'homeRunsAllowed', label: '被本塁打', fmt: 'int' },
      { key: 'era',             label: '防御率', fmt: 'dec2' },
      { key: 'whip',            label: 'WHIP',   fmt: 'dec2' },
      { key: 'k9',              label: 'K/9',    fmt: 'dec2' },
      { key: 'bavg',            label: '被打率', fmt: 'avg' },
    ];
    const customPitchingCard = document.createElement('div');
    customPitchingCard.className = 'chart-card';
    const customPitchingHeader = document.createElement('div');
    customPitchingHeader.className = 'chart-custom-header';
    const customPitchingTitle = document.createElement('div');
    customPitchingTitle.className = 'chart-title';
    customPitchingTitle.textContent = 'カスタム項目グラフ';
    const customPitchingSelect = document.createElement('select');
    customPitchingSelect.className = 'form-select chart-custom-select';
    PITCHING_METRICS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.key; opt.textContent = m.label;
      customPitchingSelect.appendChild(opt);
    });
    customPitchingHeader.append(customPitchingTitle, customPitchingSelect);
    const customPitchingCanvas = document.createElement('canvas');
    customPitchingCanvas.height = 220;
    customPitchingCard.append(customPitchingHeader, customPitchingCanvas);
    panel.appendChild(customPitchingCard);

    const drawCustomPitching = key => {
      const meta = PITCHING_METRICS.find(m => m.key === key);
      const lowerIsBetter = ['era', 'whip', 'bavg'].includes(key);
      const sorted = [...rows].filter(r => r[key] != null && !isNaN(r[key]) && isFinite(r[key])).sort((a, b) => lowerIsBetter ? a[key] - b[key] : b[key] - a[key]).slice(0, 10);
      const ticksCb = meta.fmt === 'avg'  ? { callback: v => '.' + String(Math.round(v * 1000)).padStart(3, '0') }
                    : meta.fmt === 'dec2' ? { callback: v => v.toFixed(2) } : {};
      const dataVals = sorted.map(r => meta.fmt === 'avg' ? +r[key].toFixed(3) : meta.fmt === 'dec2' ? +r[key].toFixed(2) : r[key]);
      if (_charts.pitchingCustom) _charts.pitchingCustom.destroy();
      _charts.pitchingCustom = new Chart(customPitchingCanvas, {
        type: 'bar',
        data: { labels: sorted.map(r => r.name), datasets: [{ label: meta.label, data: dataVals, backgroundColor: 'rgba(20,184,166,0.75)', borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: ticksCb } } }
      });
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
  panel.appendChild(makeStatsTable(rows, cols));
}


function renderGameStats() {
  const panel = document.getElementById('subtab-game-stats');
  panel.innerHTML = '';

  if (!state.games.length) {
    panel.appendChild(emptyState('📊', 'データがありません', '試合を登録してください'));
    return;
  }

  const filterWrap = document.createElement('div');
  filterWrap.className = 'stats-filter';
  const filterLabel = document.createElement('span');
  filterLabel.className = 'stats-filter-label';
  filterLabel.textContent = '表示範囲：';
  const filterSelect = document.createElement('select');
  filterSelect.className = 'form-select stats-filter-select';
  [['total','合計'],['all','全て'],['spring','春リーグ'],['fall','秋リーグ'],['practice','練習試合']].forEach(([v,t]) => {
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
    const games = filterGamesByType(filterVal);

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
      { label: '試合数', value: total,  cls: 'accent-amber' },
      { label: '勝利',   value: wins,   cls: 'accent-amber' },
      { label: '敗北',   value: losses, cls: 'accent-amber' },
      { label: '引分',   value: draws,  cls: 'accent-amber' },
      { label: '勝率',   value: isNaN(wpct) ? '---' : fmt(wpct, 3), cls: 'accent-amber' },
      { label: '総得点', value: scored,  cls: 'accent-amber' },
      { label: '総失点', value: allowed, cls: 'accent-amber' },
    ].forEach(k => kpiGrid.appendChild(makeKpiCard(k.label, k.value, k.cls)));
    body.appendChild(kpiGrid);

    if (typeof Chart !== 'undefined' && total > 0) {
      const chartCard = document.createElement('div');
      chartCard.className = 'chart-card chart-card-pie';
      const chartTitle = document.createElement('div');
      chartTitle.className = 'chart-title';
      chartTitle.textContent = '勝敗内訳';
      const canvas = document.createElement('canvas');
      chartCard.append(chartTitle, canvas);
      body.appendChild(chartCard);

      if (_charts.gamePie) _charts.gamePie.destroy();
      const labels = [], data = [], colors = [];
      if (wins > 0)   { labels.push('勝'); data.push(wins);   colors.push('rgba(22,163,74,0.85)'); }
      if (losses > 0) { labels.push('負'); data.push(losses); colors.push('rgba(220,38,38,0.85)'); }
      if (draws > 0)  { labels.push('引分'); data.push(draws); colors.push('rgba(217,119,6,0.85)'); }

      _charts.gamePie = new Chart(canvas, {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'white' }] },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}試合 (${Math.round(ctx.raw/total*100)}%)` } }
          }
        }
      });
    }

    const wrap = document.createElement('div');
    wrap.className = 'card';
    const wrapHeader = document.createElement('div');
    wrapHeader.className = 'card-header';
    const wrapTitle = document.createElement('h2');
    wrapTitle.className = 'card-title';
    wrapTitle.textContent = '試合一覧';
    wrapHeader.appendChild(wrapTitle);
    wrap.appendChild(wrapHeader);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    const tbl = document.createElement('table');
    tbl.className = 'games-table';
    tbl.innerHTML = '<thead><tr><th>日付</th><th>種別</th><th>対戦相手</th><th>H/A</th><th>得点</th><th>失点</th><th>結果</th></tr></thead>';
    const tbody = document.createElement('tbody');
    [...games].sort((a,b) => a.date.localeCompare(b.date)).forEach(g => {
      const tr = document.createElement('tr');
      const badgeTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge ' + (g.result==='勝'?'badge-win':g.result==='負'?'badge-loss':'badge-draw');
      badge.textContent = g.result;
      badgeTd.appendChild(badge);
      tr.append(td(g.date), td(gameTypeLabel(g.gameType)), td(g.opponent), td(g.homeAway==='home'?'H':'A'), td(g.ourScore), td(g.opponentScore), badgeTd);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tableWrap.appendChild(tbl);
    wrap.appendChild(tableWrap);
    body.appendChild(wrap);
  };

  filterSelect.addEventListener('change', () => drawGameStats(filterSelect.value));
  drawGameStats('total');
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
    if (col.avg) {
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
  renderGamesList();
  renderPlayersList();
}

function init() {
  initTabs();
  initSubtabs();
  initGameForm();
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

  DATA_REF.on('value', snapshot => {
    const data = snapshot.val();
    state = data ? migrate(data) : freshState();
    renderAll();
    if (currentStatsEntryGameId) showStatsEntry(currentStatsEntryGameId);
  });
}

document.addEventListener('DOMContentLoaded', init);

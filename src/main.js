import './styles.css';
import { SKILLS } from './engine/data.js';
import { getAttackTiming } from './engine/attack-move.js';
import { Simulation } from './engine/simulation.js';
import { BattlefieldRenderer } from './ui/renderer.js';

const $ = (selector) => document.querySelector(selector);
const simulation = new Simulation();
const renderer = new BattlefieldRenderer($('#battlefield'), simulation);
let activeTab = 'decision';
let lastActionCount = -1;
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 1800);
}

function formatTime(time) {
  const minutes = Math.floor(time / 60).toString().padStart(2, '0');
  const seconds = Math.floor(time % 60).toString().padStart(2, '0');
  const tenths = Math.floor((time % 1) * 10);
  return `T+ ${minutes}:${seconds}.${tenths}`;
}

function fillRange(input) {
  const percent = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
  input.style.setProperty('--fill', `${percent}%`);
}

function bindRange(selector, outputSelector, key, format) {
  const input = $(selector);
  const output = $(outputSelector);
  const update = () => {
    const value = Number(input.value);
    simulation.setConfig({ [key]: value });
    output.value = format(value);
    fillRange(input);
  };
  input.addEventListener('input', update);
  update();
}

bindRange('#reaction', '#reaction-value', 'reactionMs', (value) => `${value} ms`);
bindRange('#horizon', '#horizon-value', 'horizon', (value) => `${value.toFixed(2)} s`);
bindRange('#margin', '#margin-value', 'margin', (value) => `${value} px`);
bindRange('#speed', '#speed-value', 'speed', (value) => `${value.toFixed(2)}×`);
bindRange('#cast-interval', '#cast-value', 'castInterval', (value) => `${value.toFixed(2)} s`);

$('#auto-combo').addEventListener('change', (event) => {
  simulation.setConfig({ autoCombo: event.target.checked });
  toast(event.target.checked ? '自动连招已接管决策' : '自动连招已关闭，进入手动观察');
});
$('#auto-dodge').addEventListener('change', (event) => {
  simulation.setConfig({ autoDodge: event.target.checked });
  toast(event.target.checked ? '自动躲避已启用' : '自动躲避已关闭，可观察命中结果');
});
$('#combo-select').addEventListener('change', (event) => {
  simulation.setConfig({ combo: event.target.value });
  toast('连招状态机已切换到新序列');
});
$('#auto-kite').addEventListener('change', (event) => {
  simulation.setConfig({ autoKite: event.target.checked });
  toast(event.target.checked ? '流畅走 A 已启用' : '流畅走 A 已关闭');
});
$('#attack-speed').addEventListener('change', (event) => {
  simulation.setConfig({ attackSpeed: Number(event.target.value) });
  updateAttackTiming();
  toast(`攻速已切换至 ${Number(event.target.value).toFixed(2)} 次/秒`);
});

function updateAttackTiming() {
  const timing = getAttackTiming(simulation.config.attackSpeed);
  $('#attack-interval').textContent = `${timing.interval.toFixed(3)} s`;
  $('#attack-windup').textContent = `${timing.windup.toFixed(3)} s`;
  $('#attack-recovery').textContent = `${timing.recovery.toFixed(3)} s`;
}
updateAttackTiming();

function toggleRunning() {
  if (!simulation.state.player.alive) {
    simulation.reset();
    toast('已重新开始仿真');
    return;
  }
  simulation.setRunning(!simulation.state.running);
}
$('#play-toggle').addEventListener('click', toggleRunning);
$('#reset-button').addEventListener('click', () => {
  simulation.reset();
  toast('对象、弹道、冷却与日志已重置');
});

$('#panel-toggle').addEventListener('click', () => {
  const panel = $('.control-panel');
  panel.classList.toggle('collapsed');
  $('#panel-toggle').textContent = panel.classList.contains('collapsed') ? '+' : '−';
});
$('#inspector-toggle').addEventListener('click', () => {
  const inspector = $('.inspector');
  inspector.classList.toggle('collapsed');
  $('#inspector-toggle').textContent = inspector.classList.contains('collapsed') ? '+' : '−';
});

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    for (const other of document.querySelectorAll('.tab')) {
      const selected = other === tab;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-selected', String(selected));
    }
    for (const page of document.querySelectorAll('.tab-page')) page.classList.remove('active');
    $(`#tab-${activeTab}`).classList.add('active');
    updateUI(true);
  });
}

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); toggleRunning(); }
  if (event.key.toLowerCase() === 'r') simulation.reset();
});

const kindNames = {
  skill: 'CAST', dodge: 'EVADE', move: 'MOVE', attackStart: 'WINDUP', attack: 'ATTACK', enemy: 'ENEMY',
  damage: 'HIT', input: 'INPUT', state: 'STATE',
};

function renderActionLog() {
  const count = simulation.state.nextActionId - 1;
  $('#action-count').textContent = String(count);
  if (count === lastActionCount) return;
  lastActionCount = count;
  const log = $('#action-log');
  log.replaceChildren();
  if (simulation.state.actions.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-log';
    empty.textContent = '暂无动作。运行仿真后，每次决策输出都会记录在这里。';
    log.append(empty);
    return;
  }
  for (const action of simulation.state.actions) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = formatTime(action.time).replace('T+ ', '');
    const kind = document.createElement('span');
    kind.className = 'action-kind';
    kind.textContent = kindNames[action.kind] || action.kind;
    const message = document.createElement('span');
    message.className = 'action-message';
    message.textContent = action.message;
    const reason = document.createElement('span');
    reason.className = 'action-reason';
    reason.textContent = action.reason;
    item.append(time, kind, message, reason);
    log.append(item);
  }
}

function updateObjectRows() {
  const rows = $('#object-rows');
  rows.replaceChildren();
  const entities = [simulation.state.player, ...simulation.state.enemies];
  for (const entity of entities) {
    const row = document.createElement('tr');
    const status = !entity.alive ? '退出战场' : entity.id === 'player'
      ? simulation.currentDecision.mode
      : `${Math.max(0, entity.nextCast).toFixed(1)} s 后施法`;
    const values = [
      entity.name,
      entity.team === 'ally' ? '友方' : '敌方',
      `${Math.ceil(entity.hp)} / ${entity.maxHp}`,
      `${Math.round(entity.x)}, ${Math.round(entity.y)}`,
      status,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 1) cell.className = entity.team === 'ally' ? 'team-ally' : 'team-enemy';
      row.append(cell);
    });
    rows.append(row);
  }
}

function updateUI(force = false) {
  const state = simulation.state;
  const decision = simulation.currentDecision;
  const threats = simulation.threats;
  $('#tick-ms').textContent = simulation.lastTickMs.toFixed(2);
  $('#object-count').textContent = String(1 + state.enemies.filter((enemy) => enemy.alive).length + state.projectiles.length);
  $('#threat-count').textContent = String(threats.length);
  $('#play-toggle').textContent = !state.player.alive ? '重新开始' : state.running ? '暂停仿真' : '继续仿真';
  $('#decision-mode').textContent = decision.mode;
  $('#decision-mode').style.color = decision.mode === '躲避' ? 'var(--green)' : decision.mode === '受胁' || decision.mode === '仿真结束' ? 'var(--red)' : 'var(--cyan)';
  $('#decision-reason').textContent = decision.reason;
  const target = state.enemies.find((enemy) => enemy.id === state.selectedTargetId && enemy.alive);
  $('#selected-target').textContent = target ? `${target.name} · ${Math.ceil(target.hp)} HP` : '未选择';
  const next = simulation.nextSkill;
  $('#next-skill').textContent = `${next} · ${SKILLS[next].name} · ${state.player.cooldowns[next].toFixed(1)} s`;
  $('#nearest-threat').textContent = threats.length ? `#${threats[0].projectileId} · ${threats[0].time.toFixed(2)} s` : '预测窗口内无威胁';
  $('#safe-position').textContent = decision.safePosition ? `${Math.round(decision.safePosition.x)}, ${Math.round(decision.safePosition.y)}` : '无需转移';
  $('#sim-time').textContent = formatTime(state.time);
  $('#pipeline-decision').className = ['连招', '躲避', '接近', '等待冷却', '衔接普攻'].includes(decision.mode) || decision.mode.startsWith('走A') ? 'done' : 'active';
  $('#pipeline-output').className = ['skill', 'attackStart', 'attack', 'move', 'dodge'].includes(state.actions[0]?.kind) ? 'done' : '';
  renderActionLog();
  if (activeTab === 'objects' || force) updateObjectRows();
}

let previous = performance.now();
let fps = 60;
let uiAccumulator = 0;
function frame(now) {
  const rawDt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  fps = fps * 0.92 + (rawDt > 0 ? 1 / rawDt : 60) * 0.08;
  simulation.tick(rawDt);
  renderer.render();
  uiAccumulator += rawDt;
  if (uiAccumulator >= 0.1) {
    $('#fps').textContent = String(Math.round(fps));
    updateUI();
    uiAccumulator = 0;
  }
  requestAnimationFrame(frame);
}

updateUI(true);
requestAnimationFrame(frame);

// 便于离线研究和自动化检查；不提供任何真实游戏进程接口。
window.__decisionLab = { simulation, renderer, updateUI };

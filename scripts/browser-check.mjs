import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'decision-lab-chrome-'));
let chrome;
let server;
let socket;
const errors = [];

async function waitFor(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { return await check(); } catch { /* Chrome 尚未就绪 */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('浏览器检查等待超时');
}

try {
  server = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 7100, strictPort: true } });
  await server.listen();
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=9223', `--user-data-dir=${profile}`,
    '--window-size=1440,900', 'http://127.0.0.1:7100/',
  ], { stdio: 'ignore' });

  const pages = await waitFor(async () => {
    const response = await fetch('http://127.0.0.1:9223/json/list');
    const list = await response.json();
    const page = list.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:7100'));
    if (!page) throw new Error('页面未就绪');
    return list;
  });
  const page = pages.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:7100'));
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCall, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCall(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '));
    }
  });
  const cdp = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await waitFor(async () => {
    const ready = await evaluate('Boolean(window.__decisionLab && document.querySelector("#battlefield").width > 0)');
    if (!ready) throw new Error('仿真尚未初始化');
    return ready;
  });
  await evaluate('new Promise(resolve => setTimeout(resolve, 500))');

  const initial = await evaluate(`(() => {
    const lab = window.__decisionLab;
    return {
      title: document.title,
      canvas: [document.querySelector('#battlefield').width, document.querySelector('#battlefield').height],
      running: lab.simulation.state.running,
      enemyCount: lab.simulation.state.enemies.length,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      panelVisible: getComputedStyle(document.querySelector('.control-panel')).display !== 'none'
    };
  })()`);

  await evaluate(`document.querySelector('#play-toggle').click()`);
  const paused = await evaluate('window.__decisionLab.simulation.state.running === false');
  await evaluate(`document.querySelector('#play-toggle').click()`);

  await evaluate(`(() => {
    const input = document.querySelector('#reaction');
    input.value = '300';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const combo = document.querySelector('#combo-select');
    combo.value = 'burst';
    combo.dispatchEvent(new Event('change', { bubbles: true }));
    const attackSpeed = document.querySelector('#attack-speed');
    attackSpeed.value = '2.00';
    attackSpeed.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const controls = await evaluate(`({
    reactionMs: window.__decisionLab.simulation.config.reactionMs,
    combo: window.__decisionLab.simulation.config.combo,
    attackSpeed: window.__decisionLab.simulation.config.attackSpeed,
    autoKite: window.__decisionLab.simulation.config.autoKite,
    output: document.querySelector('#reaction-value').value,
    attackInterval: document.querySelector('#attack-interval').textContent,
    attackWindup: document.querySelector('#attack-windup').textContent,
    attackRecovery: document.querySelector('#attack-recovery').textContent
  })`);

  const targetPoint = await evaluate(`(() => {
    const lab = window.__decisionLab;
    const enemy = lab.simulation.state.enemies[2];
    const view = lab.renderer.viewport;
    const rect = lab.renderer.canvas.getBoundingClientRect();
    return { x: rect.left + view.x + enemy.x * view.scale, y: rect.top + view.y + enemy.y * view.scale, id: enemy.id };
  })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...targetPoint, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...targetPoint, button: 'left', clickCount: 1 });
  const targetSelected = await evaluate(`window.__decisionLab.simulation.state.selectedTargetId === '${targetPoint.id}'`);

  const movePoint = await evaluate(`(() => {
    const view = window.__decisionLab.renderer.viewport;
    const rect = window.__decisionLab.renderer.canvas.getBoundingClientRect();
    return { x: rect.left + view.x + 400 * view.scale, y: rect.top + view.y + 310 * view.scale };
  })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...movePoint, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...movePoint, button: 'left', clickCount: 1 });
  const manualMove = await evaluate('Boolean(window.__decisionLab.simulation.state.player.moveTarget)');

  await evaluate(`document.querySelector('[data-tab="actions"]').click()`);
  const actionTab = await evaluate(`document.querySelector('#tab-actions').classList.contains('active')`);
  await evaluate('new Promise(resolve => setTimeout(resolve, 1200))');
  const actionCount = await evaluate('window.__decisionLab.simulation.state.nextActionId - 1');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = join(root, 'browser-check.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  const result = {
    ok: paused && targetSelected && manualMove && actionTab && actionCount > 0 && errors.length === 0 && !initial.overflow
      && controls.attackSpeed === 2 && controls.autoKite && controls.attackInterval === '0.500 s'
      && controls.attackWindup === '0.090 s' && controls.attackRecovery === '0.410 s',
    initial, paused, controls, targetSelected, manualMove, actionTab, actionCount,
    consoleErrors: errors, screenshot: screenshotPath,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  if (socket) socket.close();
  if (chrome) {
    const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit));
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  }
  if (server) await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

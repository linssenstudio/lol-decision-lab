import test from 'node:test';
import assert from 'node:assert/strict';
import { closestApproach } from '../src/engine/math.js';
import { analyzeThreats, DecisionEngine, findSafePosition } from '../src/engine/decision.js';
import { createInitialState, DEFAULT_CONFIG } from '../src/engine/data.js';

const config = { ...DEFAULT_CONFIG, autoDodge: false };

test('closestApproach 计算匀速弹道的命中时间与最近距离', () => {
  const result = closestApproach(
    { x: 100, y: 100 },
    { x: 0, y: 100, vx: 100, vy: 0, range: 200, traveled: 0, delay: 0.5 },
  );
  assert.equal(result.time, 1.5);
  assert.equal(result.minDistance, 0);
  assert.deepEqual(result.closest, { x: 100, y: 100 });
});

test('analyzeThreats 只保留预测窗口内会进入安全余量的弹道', () => {
  const state = createInitialState();
  const projectiles = [
    { id: 1, ownerId: 'e', x: 100, y: 320, vx: 300, vy: 0, radius: 15, range: 500, traveled: 0, delay: 0 },
    { id: 2, ownerId: 'e', x: 100, y: 100, vx: 300, vy: 0, radius: 15, range: 500, traveled: 0, delay: 0 },
  ];
  const threats = analyzeThreats(state.player, projectiles, { ...DEFAULT_CONFIG, horizon: 1.4 });
  assert.equal(threats.length, 1);
  assert.equal(threats[0].projectileId, 1);
  assert.ok(Math.abs(threats[0].time - 110 / 300) < 0.00001);
});

test('findSafePosition 能离开直线弹道的碰撞区域', () => {
  const state = createInitialState();
  const projectile = { id: 1, ownerId: 'e', x: 100, y: 320, vx: 300, vy: 0, radius: 15, range: 600, traveled: 0, delay: 0 };
  const safe = findSafePosition(state.player, [projectile], state.enemies, DEFAULT_CONFIG);
  assert.ok(safe);
  assert.ok(Math.abs(safe.y - state.player.y) > 40);
  const approach = closestApproach(safe, projectile);
  assert.ok(approach.minDistance > state.player.radius + projectile.radius);
});

test('连招状态机在条件满足时施法，并在 commit 后推进序列', () => {
  const state = createInitialState();
  state.player.x = 700;
  state.player.y = 205;
  const engine = new DecisionEngine();
  const decision = engine.decide(state, config);
  assert.equal(decision.type, 'cast');
  assert.equal(decision.skillKey, 'Q');
  engine.commit(decision, config);
  assert.equal(engine.nextSkill(config), 'W');
});

test('目标超出技能范围时，决策先接近而不是施法', () => {
  const state = createInitialState();
  const engine = new DecisionEngine();
  const decision = engine.decide(state, config);
  assert.equal(decision.type, 'move');
  assert.equal(decision.mode, '接近');
});

test('紧急弹道优先于连招，输出安全移动动作', () => {
  const state = createInitialState();
  state.projectiles.push({ id: 9, ownerId: 'enemy-a', x: 100, y: 320, vx: 300, vy: 0, radius: 15, range: 600, traveled: 0, delay: 0 });
  const engine = new DecisionEngine();
  const decision = engine.decide(state, { ...DEFAULT_CONFIG, autoDodge: true });
  assert.equal(decision.type, 'move');
  assert.equal(decision.mode, '躲避');
  assert.ok(decision.safePosition);
});

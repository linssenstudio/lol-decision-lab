import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_SPEED_TIERS, getAttackTiming, getKitePosition } from '../src/engine/attack-move.js';
import { Simulation } from '../src/engine/simulation.js';
import { WORLD } from '../src/engine/data.js';

function advanceUntil(sim, predicate, maxFrames = 200) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    sim.tick(0.05);
    if (predicate()) return true;
  }
  return false;
}

function createAttackRig(attackSpeed) {
  const sim = new Simulation({
    autoCombo: false, autoKite: true, autoDodge: false,
    attackSpeed, reactionMs: 60,
  }, () => 0.5);
  sim.state.player.x = 650;
  sim.state.player.y = 205;
  for (const enemy of sim.state.enemies) {
    enemy.speed = 0;
    enemy.nextCast = 99;
  }
  return sim;
}

test('每个攻速档位都有正数后摇，且前摇小于完整攻击间隔', () => {
  for (const tier of ATTACK_SPEED_TIERS) {
    const timing = getAttackTiming(tier);
    assert.ok(Math.abs(timing.interval - 1 / tier) < 0.000001);
    assert.ok(timing.windup > 0);
    assert.ok(timing.windup < timing.interval);
    assert.ok(timing.recovery > 0);
    assert.ok(Math.abs(timing.windup + timing.recovery - timing.interval) < 0.000001);
  }
});

test('后撤走A位置始终限制在世界边界内', () => {
  const player = { x: WORLD.padding, y: WORLD.padding };
  const target = { x: 400, y: 400 };
  for (let time = 0; time < 5; time += 0.25) {
    const point = getKitePosition(player, target, time);
    assert.ok(point.x >= WORLD.padding && point.x <= WORLD.width - WORLD.padding);
    assert.ok(point.y >= WORLD.padding && point.y <= WORLD.height - WORLD.padding);
  }
});

for (const tier of ATTACK_SPEED_TIERS) {
  test(`${tier.toFixed(2)} 攻速档位：前摇结算、后摇走位和连续攻击节奏正确`, () => {
    const sim = createAttackRig(tier);
    const target = sim.state.enemies[0];
    const initialHp = target.hp;
    const started = advanceUntil(sim, () => sim.state.player.attackPhase === 'windup', 10);
    assert.equal(started, true);
    assert.equal(target.hp, initialHp, '前摇开始时不能提前扣血');

    const position = { x: sim.state.player.x, y: sim.state.player.y };
    sim.state.player.moveTarget = { x: position.x + 50, y: position.y };
    sim.tick(0.01);
    assert.deepEqual({ x: sim.state.player.x, y: sim.state.player.y }, position, '前摇期间不能移动');

    const hit = advanceUntil(sim, () => sim.state.actions.some((action) => action.kind === 'attack'), 20);
    assert.equal(hit, true);
    assert.equal(target.hp, initialHp - 34);
    assert.equal(sim.state.player.attackPhase, 'recovery');

    const moved = advanceUntil(sim, () => sim.currentDecision.mode === '走A · 走位', 10);
    assert.equal(moved, true);
    assert.ok(sim.state.player.moveTarget);

    advanceUntil(sim, () => sim.state.time >= 6, 150);
    const hits = sim.state.actions.filter((action) => action.kind === 'attack').map((action) => action.time).sort((a, b) => a - b);
    assert.ok(hits.length >= 3, `${tier} 档位在 6 秒内应完成至少 3 次普攻`);
    const timing = getAttackTiming(tier);
    for (let index = 1; index < hits.length; index += 1) {
      assert.ok(hits[index] - hits[index - 1] >= timing.interval - 0.00001, '相邻普攻不能短于攻速档位间隔');
    }
  });
}

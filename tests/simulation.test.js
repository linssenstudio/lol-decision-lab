import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/simulation.js';

function advance(simulation, frames = 4) {
  for (let index = 0; index < frames; index += 1) simulation.tick(0.05);
}

test('仿真执行技能后更新伤害、冷却、动作日志和连招位置', () => {
  const sim = new Simulation({ autoDodge: false, autoKite: false, reactionMs: 60 }, () => 0.5);
  sim.state.player.x = 700;
  sim.state.player.y = 205;
  for (const enemy of sim.state.enemies) enemy.nextCast = 99;
  const target = sim.state.enemies[0];
  advance(sim);
  assert.equal(target.hp, target.maxHp - 90);
  assert.ok(sim.state.player.cooldowns.Q > 3);
  assert.equal(sim.nextSkill, 'W');
  assert.equal(sim.state.actions[0].kind, 'skill');
});

test('躲避决策会生成移动目标并记录输出原因', () => {
  const sim = new Simulation({ autoDodge: true, reactionMs: 60 }, () => 0.5);
  sim.state.projectiles.push({ id: 1, ownerId: 'enemy-a', x: 100, y: 320, vx: 300, vy: 0, radius: 15, range: 600, traveled: 0, delay: 0, damage: 85 });
  advance(sim, 2);
  assert.equal(sim.currentDecision.mode, '躲避');
  assert.ok(sim.state.player.moveTarget);
  assert.equal(sim.state.actions[0].kind, 'dodge');
});

test('实际碰撞会扣除生命值并移除弹道', () => {
  const sim = new Simulation({ autoDodge: false, autoCombo: false, reactionMs: 500 }, () => 0.5);
  sim.state.projectiles.push({ id: 4, ownerId: 'enemy-a', x: 210, y: 320, vx: 100, vy: 0, radius: 15, range: 600, traveled: 0, delay: 0, damage: 85 });
  sim.tick(0.01);
  assert.equal(sim.state.player.hp, 915);
  assert.equal(sim.state.projectiles.length, 0);
  assert.equal(sim.state.actions[0].kind, 'damage');
});

test('点击目标选择只改变存活敌人的锁定状态', () => {
  const sim = new Simulation({}, () => 0.5);
  const enemy = sim.state.enemies[1];
  const selected = sim.selectTargetAt({ x: enemy.x, y: enemy.y });
  assert.equal(selected, true);
  assert.equal(sim.state.selectedTargetId, enemy.id);
  assert.equal(sim.state.actions[0].kind, 'input');
});

test('重置恢复所有世界状态，但保留实时参数', () => {
  const sim = new Simulation({ reactionMs: 200 }, () => 0.5);
  sim.state.player.hp = 100;
  sim.state.projectiles.push({ id: 1 });
  sim.recordAction('state', '测试');
  sim.reset();
  assert.equal(sim.state.player.hp, 1000);
  assert.equal(sim.state.projectiles.length, 0);
  assert.equal(sim.state.actions.length, 0);
  assert.equal(sim.config.reactionMs, 200);
});

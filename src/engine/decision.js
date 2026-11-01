import { COMBOS, SKILLS, WORLD } from './data.js';
import { decideAttackMove } from './attack-move.js';
import { clamp, closestApproach, distance } from './math.js';

export function analyzeThreats(player, projectiles, config) {
  if (!player.alive) return [];
  const threats = [];
  for (const projectile of projectiles) {
    const approach = closestApproach(player, projectile);
    if (!approach || approach.time < 0 || approach.time > config.horizon) continue;
    const collisionDistance = player.radius + projectile.radius + config.margin;
    if (approach.minDistance > collisionDistance) continue;
    threats.push({
      projectileId: projectile.id,
      ownerId: projectile.ownerId,
      time: approach.time,
      minDistance: approach.minDistance,
      closest: approach.closest,
      severity: clamp(1 - approach.time / config.horizon, 0, 1),
    });
  }
  return threats.sort((a, b) => a.time - b.time);
}

function dangerAt(point, projectiles, enemies, config, playerRadius) {
  let score = 0;
  let collisions = 0;
  for (const projectile of projectiles) {
    const approach = closestApproach(point, projectile);
    if (!approach || approach.time < 0 || approach.time > config.horizon) continue;
    const collisionDistance = playerRadius + projectile.radius + config.margin;
    if (approach.minDistance <= collisionDistance) {
      collisions += 1;
      score += 120 + (config.horizon - approach.time) * 130 / (approach.time + 0.3);
    }
  }
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const enemyDistance = distance(point, enemy);
    if (enemyDistance < 125) score += (125 - enemyDistance) * 0.45;
  }
  return { score, collisions };
}

export function findSafePosition(player, projectiles, enemies, config) {
  const current = dangerAt(player, projectiles, enemies, config, player.radius);
  let best = null;
  const radii = [75, 125, 185, 240];
  const samples = 24;

  for (const radius of radii) {
    for (let index = 0; index < samples; index += 1) {
      const angle = index / samples * Math.PI * 2;
      const candidate = {
        x: clamp(player.x + Math.cos(angle) * radius, WORLD.padding, WORLD.width - WORLD.padding),
        y: clamp(player.y + Math.sin(angle) * radius, WORLD.padding, WORLD.height - WORLD.padding),
      };
      if (distance(candidate, player) < radius * 0.55) continue;
      const danger = dangerAt(candidate, projectiles, enemies, config, player.radius);
      const travelCost = distance(candidate, player) * 0.055;
      const score = danger.score + travelCost;
      if (!best || score < best.score) best = { ...candidate, score, collisions: danger.collisions };
    }
  }

  if (!best || best.score >= current.score + 15) return null;
  return best;
}

export class DecisionEngine {
  constructor() {
    this.comboIndex = 0;
    this.comboName = 'standard';
    this.lastTargetId = null;
  }

  reset() {
    this.comboIndex = 0;
    this.lastTargetId = null;
  }

  nextSkill(config) {
    const combo = COMBOS[config.combo] || COMBOS.standard;
    return combo.sequence[this.comboIndex % combo.sequence.length];
  }

  decide(state, config) {
    const player = state.player;
    if (!player.alive) return { type: 'wait', mode: '仿真结束', reason: '玩家生命值归零，重置后可再次运行。', threats: [] };

    const threats = analyzeThreats(player, state.projectiles, config);
    if (config.autoDodge && threats.length > 0) {
      const safePosition = findSafePosition(player, state.projectiles, state.enemies, config);
      if (safePosition) {
        const nearest = threats[0];
        return {
          type: 'move', mode: '躲避', x: safePosition.x, y: safePosition.y,
          reason: `弹道 #${nearest.projectileId} 预计在 ${nearest.time.toFixed(2)} 秒到达，当前位置安全余量不足。`,
          threats, safePosition,
        };
      }
      return {
        type: 'wait', mode: '受胁',
        reason: `检测到 ${threats.length} 条威胁弹道，但当前采样范围内没有更优安全点。`,
        threats,
      };
    }

    const target = state.enemies.find((enemy) => enemy.id === state.selectedTargetId && enemy.alive);
    if (!target) {
      this.comboIndex = 0;
      return { type: 'wait', mode: '等待目标', reason: '点击战场中的敌人可重新锁定目标。', threats };
    }
    if (this.lastTargetId !== target.id) {
      this.lastTargetId = target.id;
      this.comboIndex = 0;
    }

    // 普攻前摇期间不插入移动或技能，确保本次攻击不会被意外取消。
    if (player.attackPhase === 'windup') {
      return { ...decideAttackMove(state, config, target), threats };
    }

    const combo = COMBOS[config.combo] || COMBOS.standard;
    if (this.comboName !== config.combo) {
      this.comboName = config.combo;
      this.comboIndex = 0;
    }
    const skillKey = combo.sequence[this.comboIndex % combo.sequence.length];
    const skill = SKILLS[skillKey];
    const targetDistance = distance(player, target);
    const common = { threats, targetId: target.id, skillKey };

    if (config.autoCombo) {
      if (targetDistance > skill.range - 8) {
        return {
          ...common, type: 'move', mode: '接近', x: target.x, y: target.y,
          reason: `${skillKey} · ${skill.name}需要 ${skill.range} 范围，当前距离 ${Math.round(targetDistance)}。`,
        };
      }
      if (player.cooldowns[skillKey] <= 0 && player.globalCooldown <= 0) {
        return {
          ...common, type: 'cast', mode: '连招',
          reason: `${combo.name}第 ${this.comboIndex % combo.sequence.length + 1} 步：距离与冷却条件满足。`,
        };
      }
      if (config.autoKite) return { ...decideAttackMove(state, config, target), threats, skillKey };
      return {
        ...common, type: 'wait', mode: '等待冷却',
        reason: `${skillKey} · ${skill.name}剩余 ${Math.max(player.cooldowns[skillKey], player.globalCooldown).toFixed(2)} 秒。`,
      };
    }

    if (config.autoKite) return { ...decideAttackMove(state, config, target), threats };
    return { type: 'wait', mode: '手动观察', reason: '自动连招与走A均已关闭，仅保留世界更新与威胁分析。', threats };
  }

  commit(decision, config) {
    if (decision.type !== 'cast') return;
    const combo = COMBOS[config.combo] || COMBOS.standard;
    this.comboIndex = (this.comboIndex + 1) % combo.sequence.length;
  }
}

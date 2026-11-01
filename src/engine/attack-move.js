import { WORLD } from './data.js';
import { clamp, distance, normalize } from './math.js';

export const ATTACK_SPEED_TIERS = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5]);

/** 攻速同时缩放攻击间隔与前摇，保证每个档位都有可走位后摇。 */
export function getAttackTiming(attackSpeed) {
  const speed = clamp(Number(attackSpeed) || 1, 0.5, 3);
  const interval = 1 / speed;
  const windup = clamp(0.18 / speed, 0.055, 0.22);
  return {
    attackSpeed: speed,
    interval,
    windup,
    recovery: Math.max(0, interval - windup),
  };
}

/**
 * 优先后撤，靠近边界时自动转为侧向走位，避免走A把角色送进墙角。
 */
export function getKitePosition(player, target, time = 0) {
  const away = normalize({ x: player.x - target.x, y: player.y - target.y });
  const perpendicular = { x: -away.y, y: away.x };
  const side = Math.sin(time * 1.7) >= 0 ? 1 : -1;
  const candidates = [
    { x: player.x + away.x * 120 + perpendicular.x * 34 * side, y: player.y + away.y * 120 + perpendicular.y * 34 * side },
    { x: player.x + perpendicular.x * 125 * side, y: player.y + perpendicular.y * 125 * side },
    { x: player.x - perpendicular.x * 125 * side, y: player.y - perpendicular.y * 125 * side },
  ];
  for (const candidate of candidates) {
    const point = {
      x: clamp(candidate.x, WORLD.padding, WORLD.width - WORLD.padding),
      y: clamp(candidate.y, WORLD.padding, WORLD.height - WORLD.padding),
    };
    if (distance(point, player) >= 55 && distance(point, target) >= Math.min(115, distance(player, target))) return point;
  }
  return {
    x: clamp(player.x + away.x * 80, WORLD.padding, WORLD.width - WORLD.padding),
    y: clamp(player.y + away.y * 80, WORLD.padding, WORLD.height - WORLD.padding),
  };
}

export function decideAttackMove(state, config, target) {
  const player = state.player;
  const timing = getAttackTiming(config.attackSpeed);
  const targetDistance = distance(player, target);
  const common = { targetId: target.id, attackTiming: timing };

  if (player.attackPhase === 'windup') {
    return {
      ...common, type: 'wait', mode: '走A · 前摇',
      reason: `攻击前摇剩余 ${Math.max(0, player.attackTimer).toFixed(3)} 秒，结算前不移动，避免取消本次普攻。`,
    };
  }
  if (targetDistance > player.attackRange) {
    return {
      ...common, type: 'move', mode: '走A · 接近', x: target.x, y: target.y,
      reason: `目标距离 ${Math.round(targetDistance)}，超出普攻范围 ${player.attackRange}，先接近目标。`,
    };
  }
  if (player.attackCooldown > 0 || player.attackPhase === 'recovery') {
    const point = getKitePosition(player, target, state.time);
    return {
      ...common, type: 'move', mode: '走A · 走位', x: point.x, y: point.y,
      reason: `${timing.attackSpeed.toFixed(2)} 次/秒档位：伤害已结算，利用 ${timing.recovery.toFixed(3)} 秒后摇窗口走位。`,
      kitePosition: point,
    };
  }
  return {
    ...common, type: 'attackStart', mode: '走A · 前摇',
    reason: `开始第 ${player.attackCount + 1} 次普攻：前摇 ${timing.windup.toFixed(3)} 秒，攻击间隔 ${timing.interval.toFixed(3)} 秒。`,
  };
}

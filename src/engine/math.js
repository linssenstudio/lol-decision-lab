export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const length = (v) => Math.hypot(v.x, v.y);

export function normalize(v) {
  const size = length(v);
  return size > 0.00001 ? { x: v.x / size, y: v.y / size } : { x: 0, y: 0 };
}

export function moveToward(entity, target, maxDistance) {
  const delta = { x: target.x - entity.x, y: target.y - entity.y };
  const remaining = length(delta);
  if (remaining <= maxDistance || remaining < 0.00001) {
    entity.x = target.x;
    entity.y = target.y;
    return true;
  }
  const direction = normalize(delta);
  entity.x += direction.x * maxDistance;
  entity.y += direction.y * maxDistance;
  entity.facing = Math.atan2(direction.y, direction.x);
  return false;
}

/**
 * 预测匀速直线弹道与一个静止圆目标的最近接近关系。
 * delay 表示弹道仍处于预警阶段，尚未开始运动。
 */
export function closestApproach(point, projectile) {
  const speedSq = projectile.vx * projectile.vx + projectile.vy * projectile.vy;
  const delay = Math.max(0, projectile.delay || 0);
  const speed = Math.sqrt(speedSq);
  const remainingRange = Math.max(0, projectile.range - (projectile.traveled || 0));
  const travelTime = speed > 0 ? remainingRange / speed : 0;
  if (speedSq < 0.00001 || travelTime <= 0) return null;

  const relative = { x: point.x - projectile.x, y: point.y - projectile.y };
  const rawTime = (relative.x * projectile.vx + relative.y * projectile.vy) / speedSq;
  const travelT = clamp(rawTime, 0, travelTime);
  const closest = {
    x: projectile.x + projectile.vx * travelT,
    y: projectile.y + projectile.vy * travelT,
  };
  return {
    time: delay + travelT,
    minDistance: distance(point, closest),
    closest,
    rawTime: delay + rawTime,
  };
}

export const WORLD = Object.freeze({ width: 1000, height: 600, padding: 34 });

export const SKILLS = Object.freeze({
  Q: { name: '破空斩', range: 330, cooldown: 3.2, damage: 90, color: '#2cc9ff' },
  W: { name: '星轨束缚', range: 280, cooldown: 7.5, damage: 70, color: '#a2db3c' },
  E: { name: '相位突袭', range: 240, cooldown: 9, damage: 115, color: '#ffc107' },
  R: { name: '终局脉冲', range: 420, cooldown: 26, damage: 240, color: '#f44336' },
});

export const COMBOS = Object.freeze({
  standard: { name: '标准消耗', sequence: ['Q', 'W', 'E'] },
  burst: { name: '爆发终结', sequence: ['W', 'Q', 'R'] },
  mobility: { name: '突进衔接', sequence: ['E', 'Q', 'W'] },
});

export const DEFAULT_CONFIG = Object.freeze({
  autoCombo: true,
  autoDodge: true,
  autoKite: true,
  attackSpeed: 1.25,
  combo: 'standard',
  reactionMs: 140,
  horizon: 1.4,
  margin: 44,
  speed: 1,
  castInterval: 2.6,
});

export function createInitialState() {
  return {
    time: 0,
    running: true,
    player: {
      id: 'player', name: '观测者', team: 'ally', x: 210, y: 320,
      radius: 18, speed: 235, hp: 1000, maxHp: 1000,
      attackRange: 175, attackCooldown: 0, globalCooldown: 0,
      attackPhase: 'idle', attackTimer: 0, attackTargetId: null, attackCount: 0,
      cooldowns: { Q: 0, W: 0, E: 0, R: 0 },
      moveTarget: null, facing: 0, targetId: 'enemy-a', alive: true,
    },
    enemies: [
      { id: 'enemy-a', name: '赤红执行体', team: 'enemy', x: 735, y: 205, radius: 19, speed: 82, hp: 680, maxHp: 680, nextCast: 1.1, castRange: 610, alive: true, facing: Math.PI },
      { id: 'enemy-b', name: '远程压制体', team: 'enemy', x: 805, y: 425, radius: 17, speed: 72, hp: 520, maxHp: 520, nextCast: 2.2, castRange: 650, alive: true, facing: Math.PI },
      { id: 'enemy-c', name: '游走干扰体', team: 'enemy', x: 540, y: 105, radius: 16, speed: 92, hp: 460, maxHp: 460, nextCast: 3.4, castRange: 560, alive: true, facing: Math.PI },
    ],
    projectiles: [],
    effects: [],
    actions: [],
    selectedTargetId: 'enemy-a',
    nextProjectileId: 1,
    nextActionId: 1,
  };
}

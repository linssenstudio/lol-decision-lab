import { createInitialState, DEFAULT_CONFIG, SKILLS, WORLD } from './data.js';
import { getAttackTiming } from './attack-move.js';
import { analyzeThreats, DecisionEngine } from './decision.js';
import { clamp, distance, moveToward, normalize } from './math.js';

export class Simulation {
  constructor(config = {}, rng = Math.random) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = rng;
    this.state = createInitialState();
    this.decision = new DecisionEngine();
    this.decisionAccumulator = 0;
    this.manualUntil = 0;
    this.lastTickMs = 0;
    this.currentDecision = {
      type: 'wait', mode: '待机', reason: '状态模型已建立，等待第一次决策周期。', threats: [],
    };
  }

  reset() {
    this.state = createInitialState();
    this.decision.reset();
    this.decisionAccumulator = 0;
    this.manualUntil = 0;
    this.currentDecision = {
      type: 'wait', mode: '待机', reason: '世界状态已重置，所有对象与冷却恢复初始值。', threats: [],
    };
  }

  setConfig(patch) {
    this.config = { ...this.config, ...patch };
  }

  setRunning(running) {
    if (this.state.player.alive) this.state.running = running;
  }

  recordAction(kind, message, reason = '') {
    const action = {
      id: this.state.nextActionId++, time: this.state.time,
      kind, message, reason,
    };
    this.state.actions.unshift(action);
    if (this.state.actions.length > 100) this.state.actions.length = 100;
    return action;
  }

  selectTargetAt(point) {
    const target = this.state.enemies.find((enemy) => enemy.alive && distance(point, enemy) <= enemy.radius + 16);
    if (!target) return false;
    this.state.selectedTargetId = target.id;
    this.state.player.targetId = target.id;
    this.recordAction('input', `锁定 ${target.name}`, '用户输入覆盖当前目标。');
    return true;
  }

  manualMove(point) {
    if (!this.state.player.alive) return;
    const target = {
      x: clamp(point.x, WORLD.padding, WORLD.width - WORLD.padding),
      y: clamp(point.y, WORLD.padding, WORLD.height - WORLD.padding),
    };
    this.state.player.moveTarget = target;
    this.manualUntil = this.state.time + 1.1;
    this.currentDecision = {
      type: 'move', mode: '手动移动', reason: '用户输入优先保留 1.1 秒；紧急躲避仍可打断。', threats: [],
    };
    this.recordAction('move', `移动至 ${Math.round(target.x)}, ${Math.round(target.y)}`, '用户指定位置。');
  }

  spawnProjectile(enemy) {
    const player = this.state.player;
    const direction = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
    const speed = 315 + this.rng() * 70;
    const projectile = {
      id: this.state.nextProjectileId++, ownerId: enemy.id,
      x: enemy.x, y: enemy.y, vx: direction.x * speed, vy: direction.y * speed,
      radius: 13 + this.rng() * 5, range: enemy.castRange,
      traveled: 0, delay: 0.45, damage: 85,
    };
    this.state.projectiles.push(projectile);
    this.recordAction('enemy', `${enemy.name}释放弹道 #${projectile.id}`, '预警 0.45 秒后沿直线运动。');
  }

  applyDecision(decision) {
    this.currentDecision = decision;
    const player = this.state.player;
    if (decision.type === 'move') {
      player.moveTarget = { x: decision.x, y: decision.y };
      this.recordAction(
        decision.mode === '躲避' ? 'dodge' : 'move',
        `${decision.mode}至 ${Math.round(decision.x)}, ${Math.round(decision.y)}`,
        decision.reason,
      );
      return;
    }
    if (decision.type === 'attackStart') {
      const target = this.state.enemies.find((enemy) => enemy.id === decision.targetId && enemy.alive);
      if (!target) return;
      const timing = getAttackTiming(this.config.attackSpeed);
      player.attackPhase = 'windup';
      player.attackTimer = timing.windup;
      player.attackTargetId = target.id;
      player.attackCooldown = timing.interval;
      player.attackCount += 1;
      player.moveTarget = null;
      this.recordAction(
        'attackStart',
        `走A · 第 ${player.attackCount} 次普攻前摇`,
        `${this.config.attackSpeed.toFixed(2)} 次/秒 · 前摇 ${timing.windup.toFixed(3)} 秒 · 间隔 ${timing.interval.toFixed(3)} 秒。`,
      );
      return;
    }
    if (decision.type !== 'cast') return;

    const target = this.state.enemies.find((enemy) => enemy.id === decision.targetId && enemy.alive);
    const skill = SKILLS[decision.skillKey];
    if (!target || !skill) return;
    player.cooldowns[decision.skillKey] = skill.cooldown;
    player.globalCooldown = 0.24;
    target.hp = Math.max(0, target.hp - skill.damage);

    if (decision.skillKey === 'E') {
      const direction = normalize({ x: player.x - target.x, y: player.y - target.y });
      player.x = clamp(target.x + direction.x * 105, WORLD.padding, WORLD.width - WORLD.padding);
      player.y = clamp(target.y + direction.y * 105, WORLD.padding, WORLD.height - WORLD.padding);
      player.moveTarget = null;
    }
    this.state.effects.push({
      type: 'skill', x: target.x, y: target.y, ttl: 0.65, maxTtl: 0.65,
      text: `−${skill.damage}`, color: skill.color, skillKey: decision.skillKey,
    });
    this.recordAction('skill', `${decision.skillKey} · ${skill.name} → ${target.name}`, decision.reason);
    this.decision.commit(decision, this.config);
    if (target.hp <= 0) this.killEnemy(target);
  }

  killEnemy(target) {
    target.alive = false;
    target.moveTarget = null;
    this.state.effects.push({ type: 'defeat', x: target.x, y: target.y, ttl: 1.2, maxTtl: 1.2, text: '目标失效' });
    this.recordAction('state', `${target.name}已退出战场`, '生命值归零，不再参与碰撞与决策。');
    const next = this.state.enemies.find((enemy) => enemy.alive);
    this.state.selectedTargetId = next?.id || null;
  }

  updateCooldowns(dt) {
    const player = this.state.player;
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.globalCooldown = Math.max(0, player.globalCooldown - dt);
    for (const key of Object.keys(player.cooldowns)) {
      player.cooldowns[key] = Math.max(0, player.cooldowns[key] - dt);
    }
  }

  updateAttack(dt) {
    const player = this.state.player;
    if (player.attackPhase === 'windup') {
      player.attackTimer = Math.max(0, player.attackTimer - dt);
      if (player.attackTimer > 0) return;
      const target = this.state.enemies.find((enemy) => enemy.id === player.attackTargetId && enemy.alive);
      player.attackPhase = 'recovery';
      player.attackTargetId = null;
      if (!target) return;
      player.facing = Math.atan2(target.y - player.y, target.x - player.x);
      target.hp = Math.max(0, target.hp - 34);
      this.state.effects.push({ type: 'attack', x: target.x, y: target.y, ttl: 0.35, maxTtl: 0.35, text: '−34' });
      this.recordAction('attack', `走A · 普攻命中 → ${target.name}`, `第 ${player.attackCount} 次普攻完成结算，后摇阶段可以移动。`);
      if (target.hp <= 0) this.killEnemy(target);
      return;
    }
    if (player.attackPhase === 'recovery' && player.attackCooldown <= 0) {
      player.attackPhase = 'idle';
    }
  }

  updateEnemies(dt) {
    const player = this.state.player;
    if (!player.alive) return;
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      const gap = distance(enemy, player);
      if (gap > 310) moveToward(enemy, player, enemy.speed * dt);
      enemy.nextCast -= dt;
      if (enemy.nextCast <= 0 && gap <= enemy.castRange) {
        this.spawnProjectile(enemy);
        enemy.nextCast = this.config.castInterval * (0.85 + this.rng() * 0.3);
      }
    }
  }

  updateProjectiles(dt) {
    const player = this.state.player;
    const survivors = [];
    for (const projectile of this.state.projectiles) {
      if (projectile.delay > 0) {
        projectile.delay = Math.max(0, projectile.delay - dt);
      } else {
        const step = Math.hypot(projectile.vx, projectile.vy) * dt;
        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;
        projectile.traveled += step;
      }
      if (player.alive && projectile.delay <= 0 && distance(player, projectile) <= player.radius + projectile.radius) {
        player.hp = Math.max(0, player.hp - projectile.damage);
        this.state.effects.push({ type: 'hit', x: player.x, y: player.y, ttl: 0.55, maxTtl: 0.55, text: `−${projectile.damage}` });
        this.recordAction('damage', `弹道 #${projectile.id}命中`, `玩家生命值剩余 ${Math.round(player.hp)}。`);
        if (player.hp <= 0) {
          player.alive = false;
          player.moveTarget = null;
          this.state.running = false;
          this.currentDecision = { type: 'wait', mode: '仿真结束', reason: '玩家生命值归零。点击重置开始新一轮仿真。', threats: [] };
        }
        continue;
      }
      if (projectile.traveled < projectile.range) survivors.push(projectile);
    }
    this.state.projectiles = survivors;
  }

  tick(rawDt) {
    if (!this.state.running) return;
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = Math.min(Math.max(rawDt, 0), 0.05) * this.config.speed;
    this.state.time += dt;
    this.updateCooldowns(dt);
    this.updateAttack(dt);
    this.decisionAccumulator += dt;

    const decisionPeriod = this.config.reactionMs / 1000;
    if (this.decisionAccumulator >= decisionPeriod) {
      this.decisionAccumulator %= decisionPeriod;
      const threats = analyzeThreats(this.state.player, this.state.projectiles, this.config);
      const manualActive = this.state.time < this.manualUntil;
      if (!manualActive || (this.config.autoDodge && threats.length > 0)) {
        this.applyDecision(this.decision.decide(this.state, this.config));
      } else {
        this.currentDecision = { ...this.currentDecision, threats };
      }
    }

    const player = this.state.player;
    if (player.alive && player.attackPhase !== 'windup' && player.moveTarget) {
      const arrived = moveToward(player, player.moveTarget, player.speed * dt);
      player.x = clamp(player.x, WORLD.padding, WORLD.width - WORLD.padding);
      player.y = clamp(player.y, WORLD.padding, WORLD.height - WORLD.padding);
      if (arrived) player.moveTarget = null;
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.state.effects = this.state.effects
      .map((effect) => ({ ...effect, ttl: effect.ttl - dt }))
      .filter((effect) => effect.ttl > 0);
    if (started) this.lastTickMs = performance.now() - started;
  }

  get threats() {
    return analyzeThreats(this.state.player, this.state.projectiles, this.config);
  }

  get nextSkill() {
    return this.decision.nextSkill(this.config);
  }
}

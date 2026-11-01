import { SKILLS, WORLD } from '../engine/data.js';
import { getAttackTiming } from '../engine/attack-move.js';

const TAU = Math.PI * 2;

export class BattlefieldRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.simulation = simulation;
    this.viewport = { width: 0, height: 0, scale: 1, x: 0, y: 0, dpr: 1 };
    this.hover = null;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => {
      this.hover = this.toWorld(event);
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    const scale = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
    this.viewport = {
      width: rect.width, height: rect.height, dpr, scale,
      x: (rect.width - WORLD.width * scale) / 2,
      y: (rect.height - WORLD.height * scale) / 2,
    };
  }

  toWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const { scale, x, y } = this.viewport;
    return {
      x: (event.clientX - rect.left - x) / scale,
      y: (event.clientY - rect.top - y) / scale,
    };
  }

  onPointerDown(event) {
    const point = this.toWorld(event);
    if (point.x < 0 || point.y < 0 || point.x > WORLD.width || point.y > WORLD.height) return;
    if (!this.simulation.selectTargetAt(point)) this.simulation.manualMove(point);
  }

  circle(x, y, radius, fill, stroke, width = 1) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    for (let x = 0; x <= WORLD.width; x += 50) {
      ctx.strokeStyle = x % 200 === 0 ? '#20242b' : '#12151a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); ctx.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 50) {
      ctx.strokeStyle = y % 200 === 0 ? '#20242b' : '#12151a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); ctx.stroke();
    }
    ctx.strokeStyle = '#343a45';
    ctx.strokeRect(0.5, 0.5, WORLD.width - 1, WORLD.height - 1);
  }

  drawRanges() {
    const { player, selectedTargetId } = this.simulation.state;
    const ctx = this.ctx;
    if (!player.alive) return;
    ctx.save();
    ctx.setLineDash([5, 7]);
    this.circle(player.x, player.y, player.attackRange, null, '#2cc9ff38', 1);
    const next = this.simulation.nextSkill;
    this.circle(player.x, player.y, SKILLS[next].range, null, '#2cc9ff1c', 1);
    const target = this.simulation.state.enemies.find((enemy) => enemy.id === selectedTargetId && enemy.alive);
    if (target) {
      ctx.strokeStyle = '#2cc9ff45';
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(target.x, target.y); ctx.stroke();
    }
    ctx.restore();
  }

  drawProjectiles() {
    const ctx = this.ctx;
    const threats = this.simulation.threats;
    for (const projectile of this.simulation.state.projectiles) {
      const threatened = threats.some((threat) => threat.projectileId === projectile.id);
      const remaining = projectile.range - projectile.traveled;
      const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
      const end = {
        x: projectile.x + projectile.vx / speed * remaining,
        y: projectile.y + projectile.vy / speed * remaining,
      };
      ctx.save();
      ctx.strokeStyle = threatened ? '#f44336a8' : '#ffc10750';
      ctx.lineWidth = threatened ? projectile.radius * 1.3 : 1;
      ctx.setLineDash(projectile.delay > 0 ? [9, 7] : []);
      ctx.beginPath(); ctx.moveTo(projectile.x, projectile.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.restore();
      this.circle(projectile.x, projectile.y, projectile.radius + 5, threatened ? '#f4433622' : '#ffc10718');
      this.circle(projectile.x, projectile.y, projectile.radius, threatened ? '#f44336' : '#ffc107', '#fff8', 1);
      ctx.fillStyle = '#0a0a0a';
      ctx.font = 'bold 9px Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(projectile.id), projectile.x, projectile.y + 3);
      ctx.textAlign = 'left';
    }
  }

  drawHealth(entity, width = 54) {
    const ctx = this.ctx;
    const x = entity.x - width / 2;
    const y = entity.y - entity.radius - 18;
    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(x, y, width, 4);
    ctx.fillStyle = entity.team === 'ally' ? '#2cc9ff' : '#f44336';
    ctx.fillRect(x, y, width * Math.max(0, entity.hp / entity.maxHp), 4);
  }

  drawAttackPhase(player) {
    if (player.attackPhase === 'idle') return;
    const ctx = this.ctx;
    const timing = getAttackTiming(this.simulation.config.attackSpeed);
    const duration = player.attackPhase === 'windup' ? timing.windup : timing.recovery;
    const progress = duration > 0 ? Math.min(1, Math.max(0, 1 - player.attackTimer / duration)) : 1;
    const phaseProgress = player.attackPhase === 'windup'
      ? progress
      : Math.min(1, Math.max(0, 1 - player.attackCooldown / timing.recovery));
    const radius = player.radius + 13;
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a4a5a88';
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = player.attackPhase === 'windup' ? '#ffc107' : '#2cc9ff';
    ctx.beginPath(); ctx.arc(player.x, player.y, radius, -Math.PI / 2, -Math.PI / 2 + TAU * phaseProgress); ctx.stroke();
    ctx.restore();
  }

  drawEntities() {
    const ctx = this.ctx;
    const { player, enemies, selectedTargetId } = this.simulation.state;
    for (const enemy of enemies) {
      if (!enemy.alive) {
        ctx.save(); ctx.globalAlpha = 0.22;
        this.circle(enemy.x, enemy.y, enemy.radius, '#4a4a5a');
        ctx.restore();
        continue;
      }
      if (enemy.id === selectedTargetId) {
        ctx.save(); ctx.setLineDash([4, 4]);
        this.circle(enemy.x, enemy.y, enemy.radius + 10, null, '#f44336', 1.5);
        ctx.restore();
      }
      this.circle(enemy.x, enemy.y, enemy.radius + 5, '#f4433618');
      this.circle(enemy.x, enemy.y, enemy.radius, '#3b1418', '#f44336', 1.5);
      ctx.fillStyle = '#ffb4b4';
      ctx.font = '600 11px -apple-system, PingFang SC, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(enemy.name, enemy.x, enemy.y + enemy.radius + 18);
      ctx.textAlign = 'left';
      this.drawHealth(enemy);
    }

    if (player.alive) {
      this.circle(player.x, player.y, player.radius + 8, '#2cc9ff20');
      this.circle(player.x, player.y, player.radius, '#082d3a', '#2cc9ff', 2);
      this.drawAttackPhase(player);
      const fx = Math.cos(player.facing) * player.radius;
      const fy = Math.sin(player.facing) * player.radius;
      ctx.strokeStyle = '#d3efff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(player.x + fx, player.y + fy); ctx.stroke();
      this.drawHealth(player, 64);
      ctx.fillStyle = '#d3efff';
      ctx.font = '600 11px -apple-system, PingFang SC, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('观测者', player.x, player.y + player.radius + 19);
      ctx.textAlign = 'left';
    }
  }

  drawMovement() {
    const ctx = this.ctx;
    const target = this.simulation.state.player.moveTarget;
    if (!target) return;
    const dodge = this.simulation.currentDecision.mode === '躲避';
    ctx.save();
    ctx.strokeStyle = dodge ? '#4caf50' : '#2cc9ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(target.x - 7, target.y); ctx.lineTo(target.x + 7, target.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(target.x, target.y - 7); ctx.lineTo(target.x, target.y + 7); ctx.stroke();
    this.circle(target.x, target.y, 13, null, dodge ? '#4caf5088' : '#2cc9ff88');
    ctx.restore();
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const effect of this.simulation.state.effects) {
      const progress = 1 - effect.ttl / effect.maxTtl;
      ctx.save();
      ctx.globalAlpha = Math.max(0, effect.ttl / effect.maxTtl);
      const color = effect.color || (effect.type === 'hit' ? '#f44336' : '#2cc9ff');
      this.circle(effect.x, effect.y, 20 + progress * 45, null, color, 2);
      ctx.fillStyle = color;
      ctx.font = '600 13px Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(effect.text, effect.x, effect.y - 30 - progress * 24);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  render() {
    const { dpr, scale, x, y, width, height } = this.viewport;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
    this.drawGrid();
    this.drawRanges();
    this.drawMovement();
    this.drawProjectiles();
    this.drawEntities();
    this.drawEffects();

    if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x <= WORLD.width && this.hover.y <= WORLD.height) {
      ctx.fillStyle = '#9a9aab';
      ctx.font = '10px Menlo, monospace';
      ctx.fillText(`${Math.round(this.hover.x)}, ${Math.round(this.hover.y)}`, this.hover.x + 12, this.hover.y - 12);
    }
  }
}

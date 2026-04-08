import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from '../entities/BaseEnemy';
import { TILE_S } from '../utils/constants';
import { calcDamage } from '../utils/combat';
import { TILE_WALL } from './DungeonGenerator';

const ARROW_SPEED  = 480; // px/s
const MAX_RANGE    = TILE_S * 10;
const ARROW_SCALE  = 0.96; // original 1.2 * 0.8
// Slight arc: perpendicular drift in px/s² — positive = clockwise curve
const ARC_ACCEL    = 60;

interface Arrow {
  sprite:   Phaser.GameObjects.Image;
  vx:       number;
  vy:       number;
  // perpendicular acceleration components (arc)
  ax:       number;
  ay:       number;
  traveled: number;
}

export class ArrowSystem {
  private scene:   Phaser.Scene;
  private enemies: Phaser.Physics.Arcade.Group;
  private tiles:   number[][];
  private arrows:  Arrow[] = [];
  private cooldown = 0;
  private onDamage: (x: number, y: number, dmg: number, isCrit: boolean) => void;

  constructor(
    scene:    Phaser.Scene,
    enemies:  Phaser.Physics.Arcade.Group,
    tiles:    number[][],
    onDamage: (x: number, y: number, dmg: number, isCrit: boolean) => void,
  ) {
    this.scene    = scene;
    this.enemies  = enemies;
    this.tiles    = tiles;
    this.onDamage = onDamage;
  }

  getCooldownPct(): number {
    return this.cooldown > 0 ? Math.min(1, this.cooldown / balance.player.attack3.cooldown) : 0;
  }

  shoot(x: number, y: number, angle: number): boolean {

    const vx = Math.cos(angle) * ARROW_SPEED;
    const vy = Math.sin(angle) * ARROW_SPEED;

    // Arc: small perpendicular drift. Perpendicular = angle + π/2 (clockwise)
    const perpAngle = angle + Math.PI / 2;
    const ax = Math.cos(perpAngle) * ARC_ACCEL;
    const ay = Math.sin(perpAngle) * ARC_ACCEL;

    const sprite = this.scene.add.image(x, y, 'arrow')
      .setScale(ARROW_SCALE)
      .setRotation(angle)
      .setDepth(y + 1);

    this.arrows.push({ sprite, vx, vy, ax, ay, traveled: 0 });
    return true;
  }

  update(delta: number): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    const dt = delta / 1000;

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];

      // Apply arc acceleration
      a.vx += a.ax * dt;
      a.vy += a.ay * dt;

      const dx = a.vx * dt;
      const dy = a.vy * dt;
      a.sprite.x += dx;
      a.sprite.y += dy;
      a.traveled += Math.sqrt(dx * dx + dy * dy);

      // Update rotation and depth
      a.sprite.setRotation(Math.atan2(a.vy, a.vx));
      a.sprite.setDepth(a.sprite.y + 1);

      // Wall check
      const col = Math.floor(a.sprite.x / TILE_S);
      const row = Math.floor(a.sprite.y / TILE_S);
      const hitWall = this.tiles[row]?.[col] === TILE_WALL;

      // Enemy hit check
      let hitEnemy = false;
      for (const child of this.enemies.getChildren()) {
        const enemy = child as BaseEnemy;
        if (!enemy.active) continue;
        const body = enemy.body as Phaser.Physics.Arcade.Body;
        const dist = Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, body.center.x, body.center.y);
        const hitR = body.halfWidth + 10;
        if (dist < hitR) {
          const isCrit = Math.random() < balance.player.critChance;
          const mult   = isCrit ? balance.player.critMultiplier : 1;
          const dmg    = calcDamage(balance.player.attack * mult, enemy.getArmor());
          const kb     = Phaser.Math.Angle.Between(a.sprite.x, a.sprite.y, enemy.x, enemy.y);
          enemy.takeDamage(dmg, Math.cos(kb) * enemy.getKnockbackForce(), Math.sin(kb) * enemy.getKnockbackForce());
          this.onDamage(enemy.x, enemy.y, dmg, isCrit);
          hitEnemy = true;
          break;
        }
      }

      if (hitEnemy || hitWall || a.traveled >= MAX_RANGE) {
        this.poof(a.sprite.x, a.sprite.y);
        a.sprite.destroy();
        this.arrows.splice(i, 1);
      }
    }
  }

  private poof(x: number, y: number): void {
    const g = this.scene.add.graphics({ x, y }).setDepth(210);
    g.fillStyle(0xffffff, 0.7);
    g.fillCircle(0, 0, 5);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 2.5,
      scaleY: 2.5,
      duration: 200,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }
}

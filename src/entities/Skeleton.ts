import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from './BaseEnemy';
import { SCALE } from '../utils/constants';

// Body covers visible character pixels head-to-feet, full width.
// OFFX = (32 - BODY_W) / 2, OFFY = (32 - BODY_H) / 2
// World width = 12 * 3 = 36px → fits in 1-tile corridor (48px).
const BODY_W    = 8;
const BODY_H    = 12;
const BODY_OFFX = 10; // (32 - 12) / 2 = 10
const BODY_OFFY =  15; // (32 - 15) / 2 = 8.5, rounded to 10

export class Skeleton extends BaseEnemy {
  constructor(scene: Phaser.Scene, x: number, y: number, hpMult = 1, atkMult = 1) {
    const b = balance.enemies.skeleton;
    super(
      scene, x, y,
      'skeleton-idle', SCALE,
      BODY_W, BODY_H, BODY_OFFX, BODY_OFFY,
      b.hp, b.armor, b.speed,
      b.aggroRange, b.attack, b.attackRange, b.attackCooldown,
      b.invincibilityDuration,
      b.patrolSpeed, b.leashRange, b.patrolPause,
      b.knockbackForce, b.hitKnockback, b.knockbackResist,
      hpMult, atkMult,
    );
    this.setupAnimations('skeleton');
  }
}

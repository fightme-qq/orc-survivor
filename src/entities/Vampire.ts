import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from './BaseEnemy';
import { SCALE } from '../utils/constants';

// Body covers visible character pixels head-to-feet, full width.
// OFFX = (32 - BODY_W) / 2, OFFY = (32 - BODY_H) / 2
// World width = 12 * 3 = 36px → fits in 1-tile corridor (48px).
const BODY_W    = 10;
const BODY_H    = 14;
const BODY_OFFX = 10; // (32 - 12) / 2 = 10
const BODY_OFFY =  15; // (32 - 18) / 2 = 7

export class Vampire extends BaseEnemy {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    const b = balance.enemies.vampire;
    super(
      scene, x, y,
      'vampire-idle', SCALE,
      BODY_W, BODY_H, BODY_OFFX, BODY_OFFY,
      b.hp, b.armor, b.speed,
      b.aggroRange, b.attack, b.attackRange, b.attackCooldown,
      b.invincibilityDuration,
      b.patrolSpeed, b.leashRange, b.patrolPause,
      b.knockbackForce,
    );
    this.barOffsetY = -10;
    this.setupAnimations('vampire');
  }
}

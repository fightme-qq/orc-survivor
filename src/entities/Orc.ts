import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from './BaseEnemy';

// 100×100 frame at scale 2.5 — same setup as Player.
const ORC_SCALE = 2.5;

// Body matches player collider style: tight to visible character.
// OFFX = (100 - BODY_W) / 2, OFFY = (100 - BODY_H) / 2
const BODY_W    = 14;
const BODY_H    = 15;
const BODY_OFFX = 43; // (100 - 14) / 2 = 43
const BODY_OFFY = 42; // (100 - 15) / 2 = 42

export class Orc extends BaseEnemy {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    const b = balance.enemies.orc;
    super(
      scene, x, y,
      'orc-idle', ORC_SCALE,
      BODY_W, BODY_H, BODY_OFFX, BODY_OFFY,
      b.hp, b.armor, b.speed,
      b.aggroRange, b.attack, b.attackRange, b.attackCooldown,
      b.invincibilityDuration,
      b.patrolSpeed, b.leashRange, b.patrolPause,
      b.knockbackForce,
    );
    this.animIdle   = 'orc-idle-anim';
    this.animWalk   = 'orc-walk-anim';
    this.animAttack = 'orc-attack-anim';
    this.animHit    = 'orc-hit-anim';
    this.play(this.animIdle);
  }
}

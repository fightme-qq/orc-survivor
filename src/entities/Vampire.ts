import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from './BaseEnemy';
import { SCALE } from '../utils/constants';

const BODY_W    = 10;
const BODY_H    = 8;
const BODY_OFFX = 33;
const BODY_OFFY = 58;

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
    );
    this.animIdle   = 'vampire-idle-anim';
    this.animWalk   = 'vampire-walk-anim';
    this.animAttack = 'vampire-attack-anim';
    this.animHit    = 'vampire-hit-anim';
    this.play(this.animIdle);
  }
}

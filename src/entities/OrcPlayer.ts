import Phaser from 'phaser';
import balance from '../data/balance.json';
import { calcDamage } from '../utils/combat';
import { PlayerStats } from '../systems/RunState';

// Same body setup as the Orc enemy (100×100 frame at scale 2.5)
const ORC_SCALE = 2.5;
const BODY_W    = 14;
const BODY_H    = 15;
const BODY_OFFX = 43;
const BODY_OFFY = 42;

export class OrcPlayer extends Phaser.Physics.Arcade.Sprite {
  private _hp:    number;
  private _maxHp: number;
  private _armor: number;
  private _stats: PlayerStats;

  // Auto-attack cooldown — prevents re-triggering while animation plays
  private attackTimer    = 0;
  private isAttacking    = false;
  private attackAnimTimer = 0;

  private invincible  = false;
  private invincTimer = 0;
  private blinkTimer  = 0;
  private knockTimer  = 0;

  onHpChanged: (current: number, max: number) => void = () => {};
  onDie:       () => void                            = () => {};

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up:    Phaser.Input.Keyboard.Key;
    down:  Phaser.Input.Keyboard.Key;
    left:  Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor(scene: Phaser.Scene, x: number, y: number, stats: PlayerStats) {
    super(scene, x, y, 'orc-idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this._stats = stats;
    this._maxHp = stats.maxHp;
    this._armor = stats.armor;
    this._hp    = this._maxHp;

    this.setScale(ORC_SCALE);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(BODY_W, BODY_H);
    body.setOffset(BODY_OFFX, BODY_OFFY);
    body.setCollideWorldBounds(true);

    this.play('orc-idle-anim');
  }

  get hp()    { return this._hp; }
  get maxHp() { return this._maxHp; }
  get stats() { return this._stats; }

  setupInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key },
  ): void {
    this.cursors = cursors;
    this.wasd    = wasd;
  }

  updateStats(stats: PlayerStats): void {
    this._stats = stats;
    this._maxHp = stats.maxHp;
    this._armor = stats.armor;
  }

  heal(amount: number): void {
    this._hp = Math.min(this._maxHp, this._hp + amount);
  }

  // ── Phaser hook ────────────────────────────────────────────

  preUpdate(_time: number, delta: number): void {
    super.preUpdate(_time, delta);
    if (!this.active) return;

    if (this.attackTimer > 0)     this.attackTimer -= delta;
    if (this.knockTimer  > 0)     this.knockTimer  -= delta;
    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= delta;
      if (this.attackAnimTimer <= 0) this.isAttacking = false;
    }

    this.tickMovement();
    this.tickInvincibility(delta);
    this.setDepth((this.body as Phaser.Physics.Arcade.Body).bottom);
  }

  private tickMovement(): void {
    // Freeze movement only during knockback — attacks don't block movement
    if (this.knockTimer > 0) return;

    const speed = balance.player.speed;
    let vx = 0, vy = 0;

    if      (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
    else if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  speed;
    if      (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -speed;
    else if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  speed;

    if (vx !== 0 && vy !== 0) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }

    (this.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);

    if (vx !== 0 || vy !== 0) {
      if      (vx < 0) this.setFlipX(true);
      else if (vx > 0) this.setFlipX(false);
      if (!this.isAttacking) this.play('orc-walk-anim', true);
    } else {
      if (!this.isAttacking) this.play('orc-idle-anim', true);
    }
  }

  private tickInvincibility(delta: number): void {
    if (!this.invincible) return;
    this.invincTimer -= delta;
    this.blinkTimer  -= delta;
    if (this.blinkTimer <= 0) {
      this.setAlpha(this.alpha > 0.5 ? 0.2 : 1);
      this.blinkTimer = 80;
    }
    if (this.invincTimer <= 0) {
      this.invincible = false;
      this.setAlpha(1);
    }
  }

  // ── Auto-attack ────────────────────────────────────────────
  // Called each frame by SurvivorScene with the nearest live enemy.
  // Returns true if attack was triggered.
  // onHit fires at mid-animation (~300 ms) — damage commits regardless of
  // whether the enemy moved, so player can run freely after swinging.

  tryAutoAttack(target: Phaser.Physics.Arcade.Sprite, onHit: () => void): boolean {
    if (this.attackTimer > 0) return false;

    const sv   = balance.survivor;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const tb   = target.body as Phaser.Physics.Arcade.Body;
    const dist = Phaser.Math.Distance.Between(
      body.center.x, body.center.y,
      tb.center.x,   tb.center.y,
    );
    if (dist > sv.autoAttackRange) return false;

    // cooldown = full animation (600 ms) + small gap so next swing starts clean
    this.attackTimer     = sv.autoAttackCooldown;
    this.isAttacking     = true;
    this.attackAnimTimer = 600; // orc-attack-anim: 6 frames / 10 fps

    // Face the target
    if (tb.center.x < body.center.x) this.setFlipX(true);
    else                              this.setFlipX(false);

    this.play('orc-attack-anim', true);

    // Damage commits at mid-animation — enemy position no longer matters
    this.scene.time.delayedCall(300, onHit);
    return true;
  }

  // ── Damage ─────────────────────────────────────────────────

  takeDamage(rawAtk: number, fromX: number, fromY: number, kbForce = balance.player.knockbackForce): void {
    if (this.invincible) return;

    const dmg = calcDamage(rawAtk, this._armor);
    this._hp -= dmg;
    this.onHpChanged(Math.max(0, this._hp), this._maxHp);

    if (this._hp <= 0) {
      this.setActive(false).setVisible(false);
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.onDie();
      return;
    }

    this.play('orc-hit-anim', true);

    const angle = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * kbForce,
      Math.sin(angle) * kbForce,
    );
    this.knockTimer  = balance.player.knockbackDuration;
    this.invincible  = true;
    this.invincTimer = balance.player.invincibilityDuration;
    this.blinkTimer  = 0;
  }
}

import Phaser from 'phaser';
import balance from '../data/balance.json';
import { calcDamage } from '../utils/combat';

type Key = Phaser.Input.Keyboard.Key;

// Soldier sprites are 100×100. Scale 2.5 → visual ≈ skeleton size (32×3=96px).
const SOLDIER_SCALE = 2.5;

// Body covers visible character pixels head-to-feet, full width.
// OFFX = (frameW - BODY_W) / 2, OFFY = (frameH - BODY_H) / 2
// World width = 14 * 2.5 = 35px → fits in 1-tile corridor (48px).
const BODY_W    = 10;
const BODY_H    = 15;
const BODY_OFFX = 45; // (100 - 14) / 2 = 43
const BODY_OFFY = 42; // (100 - 24) / 2 = 38

type AttackState = 'none' | 'attack1' | 'attack2' | 'attack3';

export class Player extends Phaser.Physics.Arcade.Sprite {
  private _hp: number;
  readonly maxHp: number;

  // Per-attack independent cooldown timers
  private atk1Timer = 0;
  private atk2Timer = 0;
  private atk3Timer = 0;

  // Current attack lock (blocks movement during swing)
  private attackState: AttackState = 'none';
  private attackLockTimer = 0;

  private invincible   = false;
  private invincTimer  = 0;
  private blinkTimer   = 0;
  private knockTimer   = 0;

  // Facing direction (for AOE and flip)
  private facingRight = true;
  private _facingAngle = 0; // radians, updated on movement

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Key; down: Key; left: Key; right: Key };

  onHpChanged: (current: number, max: number) => void = () => {};
  onDie: () => void = () => {};

  constructor(scene: Phaser.Scene, x: number, y: number, savedHp?: number) {
    super(scene, x, y, 'soldier-idle');
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.maxHp = balance.player.hp;
    this._hp   = savedHp ?? this.maxHp;

    this.setScale(SOLDIER_SCALE);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(BODY_W, BODY_H);
    body.setOffset(BODY_OFFX, BODY_OFFY);

    this.play('player-idle');
  }

  get hp(): number { return this._hp; }
  get facingAngle(): number { return this._facingAngle; }

  getAtk2CooldownPct(): number {
    return this.atk2Timer > 0 ? Math.min(1, this.atk2Timer / balance.player.attack2.cooldown) : 0;
  }

  getAtk3CooldownPct(): number {
    return this.atk3Timer > 0 ? Math.min(1, this.atk3Timer / balance.player.attack3.cooldown) : 0;
  }

  heal(amount: number): void {
    this._hp = Math.min(this.maxHp, this._hp + amount);
  }

  setupInput(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: { up: Key; down: Key; left: Key; right: Key },
  ): void {
    this.cursors = cursors;
    this.wasd    = wasd;
  }

  // ── Phaser hook ────────────────────────────────────────────

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    if (this.atk1Timer > 0) this.atk1Timer -= delta;
    if (this.atk2Timer > 0) this.atk2Timer -= delta;
    if (this.atk3Timer > 0) this.atk3Timer -= delta;
    if (this.knockTimer  > 0) this.knockTimer  -= delta;

    if (this.attackLockTimer > 0) {
      this.attackLockTimer -= delta;
      if (this.attackLockTimer <= 0) this.attackState = 'none';
    }

    this.tickMovement();
    this.tickInvincibility(delta);
    this.setDepth(this.y + this.displayHeight);
  }

  private tickMovement(): void {
    if (this.knockTimer > 0 || this.attackState !== 'none') return;

    const speed = balance.player.speed;
    let vx = 0, vy = 0;

    if      (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
    else if (this.cursors.right.isDown || this.wasd.right.isDown) vx =  speed;
    if      (this.cursors.up.isDown    || this.wasd.up.isDown)    vy = -speed;
    else if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy =  speed;

    if (vx !== 0 && vy !== 0) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }

    (this.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);

    if (vx !== 0 || vy !== 0) {
      if      (vx < 0) { this.setFlipX(true);  this.facingRight = false; }
      else if (vx > 0) { this.setFlipX(false); this.facingRight = true; }
      this._facingAngle = Math.atan2(vy, vx);
      this.play('player-walk', true);
    } else {
      this.play('player-idle', true);
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

  // ── Attack 1 — directional swing (LMB / Space) ─────────────

  tryAttack1(): Phaser.Geom.Rectangle | null {
    if (this.atk1Timer > 0) return null;
    this.atk1Timer = balance.player.attackCooldown;

    const { dx, dy } = this.dirToMouse();
    if (dx > 0) { this.setFlipX(false); this.facingRight = true; }
    else if (dx < 0) { this.setFlipX(true); this.facingRight = false; }

    this.lockAttack('attack1', 'player-attack1', 6, 14);

    const offset = balance.player.hitboxOffset;
    const size   = balance.player.hitboxSize;
    const hx = this.x + dx * offset;
    const hy = this.y + dy * offset;

    this.showFlash(hx, hy, size, size, 0xffffff);
    return new Phaser.Geom.Rectangle(hx - size / 2, hy - size / 2, size, size);
  }

  // ── Attack 2 — lunge (RMB / Q) ─────────────────────────────
  // Dash toward mouse + longer hitbox

  tryAttack2(): Phaser.Geom.Rectangle | null {
    if (this.atk2Timer > 0) return null;
    const b2 = balance.player.attack2;
    this.atk2Timer = b2.cooldown;

    const { dx, dy } = this.dirToMouse();
    if (dx > 0) { this.setFlipX(false); this.facingRight = true; }
    else if (dx < 0) { this.setFlipX(true); this.facingRight = false; }

    // Dash
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      dx * b2.dashForce,
      dy * b2.dashForce,
    );
    this.knockTimer = b2.dashDuration; // reuse knockTimer to block movement during dash

    this.lockAttack('attack2', 'player-attack2', 6, 14);

    const hx = this.x + dx * b2.hitboxOffset;
    const hy = this.y + dy * b2.hitboxOffset;

    this.showFlash(hx, hy, b2.hitboxSize, b2.hitboxSize * 2, 0xffaa00);
    return new Phaser.Geom.Rectangle(
      hx - b2.hitboxSize / 2,
      hy - b2.hitboxSize,
      b2.hitboxSize,
      b2.hitboxSize * 2,
    );
  }

  // ── Attack 3 — spin AOE (E) ─────────────────────────────────
  // Returns circle geometry; GameScene handles overlap check

  tryAttack3(): Phaser.Geom.Circle | null {
    if (this.atk3Timer > 0) return null;
    const b3 = balance.player.attack3;
    this.atk3Timer = b3.cooldown;

    this.lockAttack('attack3', 'player-attack3', 9, 16);

    // Visual ring
    const ring = this.scene.add.circle(this.x, this.y, b3.radius, 0xff6600, 0.3).setDepth(500);
    const outline = this.scene.add.circle(this.x, this.y, b3.radius, 0xff6600, 0).setDepth(500);
    outline.setStrokeStyle(2, 0xff6600, 0.9);
    this.scene.time.delayedCall(180, () => { ring.destroy(); outline.destroy(); });

    return new Phaser.Geom.Circle(this.x, this.y, b3.radius);
  }

  // ── Damage ──────────────────────────────────────────────────

  takeDamage(rawAtk: number, fromX: number, fromY: number): void {
    if (this.invincible) return;

    const dmg = calcDamage(rawAtk, balance.player.armor);
    this._hp -= dmg;
    this.onHpChanged(Math.max(0, this._hp), this.maxHp);

    if (this._hp <= 0) {
      this.setActive(false).setVisible(false);
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.onDie();
      return;
    }

    this.play('player-hurt', true);

    const angle   = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
    const kbForce = balance.player.knockbackForce;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * kbForce,
      Math.sin(angle) * kbForce,
    );
    this.knockTimer  = balance.player.knockbackDuration;
    this.invincible  = true;
    this.invincTimer = balance.player.invincibilityDuration;
    this.blinkTimer  = 0;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private dirToMouse(): { dx: number; dy: number } {
    const ptr   = this.scene.input.activePointer;
    const world = this.scene.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const angle = Phaser.Math.Angle.Between(this.x, this.y, world.x, world.y);
    return { dx: Math.cos(angle), dy: Math.sin(angle) };
  }

  private lockAttack(state: AttackState, animKey: string, frames: number, fps: number): void {
    this.attackState     = state;
    this.attackLockTimer = (frames / fps) * 1000;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.play(animKey, true);
  }

  private showFlash(x: number, y: number, w: number, _h: number, color: number): void {
    const startR = 3;
    const endR   = Math.max(w, 1) / 2 + 6;
    const gfx    = this.scene.add.graphics().setDepth(500);
    const t0     = this.scene.time.now;
    const dur    = 200;

    const ticker = (now: number) => {
      const pct = Math.min((now - t0) / dur, 1);
      const r   = startR + (endR - startR) * pct;
      const a   = (1 - pct) * 0.6;
      gfx.clear();
      // Expanding ring only
      gfx.lineStyle(2 * (1 - pct), color, a);
      gfx.strokeCircle(x, y, r);
      if (pct >= 1) {
        gfx.destroy();
        this.scene.events.off('update', ticker);
      }
    };
    this.scene.events.on('update', ticker);
  }
}

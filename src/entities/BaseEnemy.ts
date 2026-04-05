import Phaser from 'phaser';
import { nextStep } from '../utils/pathfind';
import { TILE_S } from '../utils/constants';
import { Room } from '../systems/DungeonGenerator';

const BAR_W = 36;
const BAR_H  = 4;

// Priority (highest first): HIT > ATTACK > CHASE > PATROL / RETURN
const enum AIState { PATROL, CHASE, ATTACK, HIT, RETURN }

export abstract class BaseEnemy extends Phaser.Physics.Arcade.Sprite {
  protected hp:                   number;
  protected maxHp:                number;
  protected armor:                number;
  protected speed:                number;
  protected aggroRange:           number;
  protected attackDamage:         number;
  protected attackRange:          number;
  protected attackCooldown:       number;
  protected invincibilityDuration:number;
  protected patrolSpeed:          number;
  protected leashRange:           number;
  protected patrolPause:          number;
  protected knockbackForce:       number;

  protected animIdle   = '';
  protected animWalk   = '';
  protected animAttack = '';
  protected animHit    = '';

  protected player!: Phaser.Physics.Arcade.Sprite;
  onDamagePlayer: ((atk: number, fromX: number, fromY: number) => void) | null = null;

  private tiles: number[][] = [];

  // ── FSM ──────────────────────────────────────────────────
  // Single source of truth for enemy state.
  // stateTimer counts DOWN; when it reaches 0 the state exits.
  // No booleans that can hang — the timer is the invariant.
  private aiState:     AIState = AIState.PATROL;
  private stateTimer   = 0;   // ms remaining in current timed state
  private atkCooldown  = 0;   // ms until next attack is allowed
  private atkHitAt     = 0;   // absolute game-time to deal hit damage
  private atkHitDealt  = false;

  // ── Navigation (RETURN) ──────────────────────────────────
  private pathNextAt = 0;
  private waypointX  = 0;
  private waypointY  = 0;

  // ── Patrol ───────────────────────────────────────────────
  private room:                Room | null = null;
  private roomCenterX          = 0;
  private roomCenterY          = 0;
  private patrolTargetX        = 0;
  private patrolTargetY        = 0;
  private patrolPauseUntil     = 0;
  private patrolReachedTarget  = true;
  private patrolTargetPickedAt = 0;

  // ── Visual ───────────────────────────────────────────────
  private blinkTimer    = 0;
  private currentAnimKey = '';
  private barVisible    = false;

  private barBg!:   Phaser.GameObjects.Rectangle;
  private barFill!: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    x: number, y: number,
    texture: string,
    spriteScale: number,
    bodyW: number, bodyH: number, bodyOffX: number, bodyOffY: number,
    hp: number, armor: number, speed: number,
    aggroRange: number, attackDamage: number, attackRange: number, attackCooldown: number,
    invincibilityDuration: number,
    patrolSpeed: number, leashRange: number, patrolPause: number,
    knockbackForce: number,
  ) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.hp = this.maxHp        = hp;
    this.armor                  = armor;
    this.speed                  = speed;
    this.aggroRange             = aggroRange;
    this.attackDamage           = attackDamage;
    this.attackRange            = attackRange;
    this.attackCooldown         = attackCooldown;
    this.invincibilityDuration  = invincibilityDuration;
    this.patrolSpeed            = patrolSpeed;
    this.leashRange             = leashRange;
    this.patrolPause            = patrolPause;
    this.knockbackForce         = knockbackForce;

    this.setScale(spriteScale);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(bodyW, bodyH);
    body.setOffset(bodyOffX, bodyOffY);

    this.barBg   = scene.add.rectangle(x, y, BAR_W, BAR_H, 0x222222).setVisible(false);
    this.barFill = scene.add.rectangle(x, y, BAR_W, BAR_H, 0x44cc44).setVisible(false);
  }

  setPlayer(p: Phaser.Physics.Arcade.Sprite) { this.player = p; }
  setTiles(t: number[][])                     { this.tiles  = t; }
  getArmor()                                  { return this.armor; }
  getKnockbackForce()                         { return this.knockbackForce; }

  setRoom(room: Room) {
    this.room        = room;
    this.roomCenterX = (room.x + room.w / 2) * TILE_S + TILE_S / 2;
    this.roomCenterY = (room.y + room.h / 2) * TILE_S + TILE_S / 2;
    this.waypointX   = this.x;
    this.waypointY   = this.y;
    this.patrolTargetX = this.x;
    this.patrolTargetY = this.y;
    this.patrolReachedTarget = true;
    this.patrolPauseUntil    = 0;
  }

  // ── Damage ───────────────────────────────────────────────
  // Entering HIT state IS the invincibility window.
  // No separate boolean needed — the state IS the invariant.

  takeDamage(amount: number, kbVx: number, kbVy: number) {
    if (this.aiState === AIState.HIT) return; // invincible
    this.hp -= amount;
    if (this.hp <= 0) {
      this.barBg.destroy();
      this.barFill.destroy();
      this.destroy();
      return;
    }
    this.redrawBar();
    if (!this.barVisible) {
      this.barBg.setVisible(true);
      this.barFill.setVisible(true);
      this.barVisible = true;
    }
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(kbVx, kbVy);
    this.blinkTimer = 0;
    this.enterState(AIState.HIT, this.invincibilityDuration);
  }

  // ── FSM core ─────────────────────────────────────────────

  /** All state transitions go through here — single place that sets state + timer. */
  private enterState(next: AIState, duration = 0) {
    this.aiState        = next;
    this.stateTimer     = duration;
    this.pathNextAt     = 0;    // force immediate nav recalculation on next tick
    this.currentAnimKey = '';   // force animation refresh
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    if (!this.active) return;

    // Tick global timers every frame
    if (this.stateTimer  > 0) this.stateTimer  -= delta;
    if (this.atkCooldown > 0) this.atkCooldown -= delta;

    if (this.player) {
      // Stop AI while player is dead/inactive (game-over screen, restart)
      if (!this.player.active) {
        (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.playAnim(this.animIdle);
      } else {
        const dist = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
        switch (this.aiState) {
          case AIState.HIT:    this.tickHit(delta);        break;
          case AIState.ATTACK: this.tickAttack(time);      break;
          case AIState.CHASE:  this.tickChase(time, dist); break;
          case AIState.PATROL: this.tickPatrol(time, dist);break;
          case AIState.RETURN: this.tickReturn(time, dist);break;
        }
      }
    }

    // Depth sorting
    const depth = this.y + this.displayHeight;
    this.setDepth(depth);
    const bx = this.x;
    const by = this.y - this.displayHeight / 2 - 4;
    this.barBg.setPosition(bx, by).setDepth(depth + 1);
    this.barFill.setPosition(bx - (BAR_W - this.barFill.width) / 2, by).setDepth(depth + 2);
  }

  // ── State handlers ────────────────────────────────────────

  private tickHit(delta: number) {
    // Physics keeps applying knockback velocity naturally — no need to set it here
    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0) {
      this.setAlpha(this.alpha > 0.5 ? 0.2 : 1);
      this.blinkTimer = 80;
    }
    if (this.animHit) this.playAnim(this.animHit);

    // Guaranteed exit via timer — animation does NOT control this
    if (this.stateTimer <= 0) {
      this.setAlpha(1);
      this.enterState(AIState.CHASE); // was hit = player is nearby
    }
  }

  private tickAttack(time: number) {
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.playAnim(this.animAttack);

    // Deal damage exactly once at the pre-calculated midpoint
    if (!this.atkHitDealt && time >= this.atkHitAt) {
      this.atkHitDealt = true;
      const d = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
      if (d <= this.attackRange * 1.3 && this.onDamagePlayer) {
        this.onDamagePlayer(this.attackDamage, this.x, this.y);
        const mx = (this.x + this.player.x) / 2;
        const my = (this.y + this.player.y) / 2;
        const flash = this.scene.add.rectangle(mx, my, 14, 14, 0xff2222, 0.85).setDepth(this.depth + 1);
        this.scene.time.delayedCall(100, () => flash.destroy());
      }
    }

    // Guaranteed exit via timer — even if animation was interrupted by takeDamage
    if (this.stateTimer <= 0) {
      this.enterState(AIState.CHASE);
    }
  }

  private tickChase(now: number, dist: number) {
    if (dist > this.leashRange) {
      this.enterState(AIState.RETURN);
      return;
    }

    this.setFlipX(this.player.x < this.x);

    if (dist <= this.attackRange && this.atkCooldown <= 0) {
      this.beginAttack(now);
      return;
    }

    // BFS pathfinding — navigates around walls instead of pressing against them
    const distToWp = Phaser.Math.Distance.Between(this.x, this.y, this.waypointX, this.waypointY);
    if (now >= this.pathNextAt || distToWp < TILE_S * 0.5) {
      this.pathNextAt = now + 350;
      const fx = Math.floor(this.x / TILE_S);
      const fy = Math.floor(this.y / TILE_S);
      const tx = Math.floor(this.player.x / TILE_S);
      const ty = Math.floor(this.player.y / TILE_S);
      const wp = this.tiles.length ? nextStep(this.tiles, fx, fy, tx, ty, TILE_S) : null;
      if (wp) {
        this.waypointX = wp.x;
        this.waypointY = wp.y;
      } else {
        // Same tile as player or no path — move directly
        this.waypointX = this.player.x;
        this.waypointY = this.player.y;
      }
    }

    const dx    = this.waypointX - this.x;
    const dy    = this.waypointY - this.y;
    const wdist = Math.sqrt(dx * dx + dy * dy);
    if (wdist < 2) { this.playAnim(this.animWalk); return; }

    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      (dx / wdist) * this.speed,
      (dy / wdist) * this.speed,
    );
    this.playAnim(this.animWalk);
  }

  private tickPatrol(now: number, dist: number) {
    if (dist <= this.aggroRange) {
      this.enterState(AIState.CHASE);
      return;
    }

    if (now < this.patrolPauseUntil) {
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.playAnim(this.animIdle);
      return;
    }

    if (this.patrolReachedTarget) {
      this.pickPatrolTarget();
      this.patrolReachedTarget    = false;
      this.patrolTargetPickedAt   = now;
    }

    const d = Phaser.Math.Distance.Between(this.x, this.y, this.patrolTargetX, this.patrolTargetY);
    if (d < TILE_S * 0.5 || now - this.patrolTargetPickedAt > 2000) {
      this.patrolReachedTarget = true;
      this.patrolPauseUntil = now + Phaser.Math.Between(
        Math.round(this.patrolPause * 0.7),
        Math.round(this.patrolPause * 1.3),
      );
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.playAnim(this.animIdle);
      return;
    }

    const spd   = this.speed * this.patrolSpeed;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, this.patrolTargetX, this.patrolTargetY);
    const vx    = Math.cos(angle) * spd;
    const vy    = Math.sin(angle) * spd;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy);
    if (Math.abs(vx) > 1) this.setFlipX(vx < 0);
    this.playAnim(this.animWalk);
  }

  private tickReturn(now: number, dist: number) {
    if (dist <= this.aggroRange) {
      this.enterState(AIState.CHASE);
      return;
    }

    const d = Phaser.Math.Distance.Between(this.x, this.y, this.roomCenterX, this.roomCenterY);
    if (d < TILE_S * 0.5) {
      this.hp = this.maxHp;
      this.redrawBar();
      this.patrolReachedTarget = true;
      this.patrolPauseUntil    = 0;
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.enterState(AIState.PATROL);
      return;
    }

    const distToWp = Phaser.Math.Distance.Between(this.x, this.y, this.waypointX, this.waypointY);
    if (now >= this.pathNextAt || distToWp < TILE_S * 0.8) {
      this.pathNextAt = now + 400;
      const fx = Math.floor(this.x / TILE_S), fy = Math.floor(this.y / TILE_S);
      const tx = Math.floor(this.roomCenterX / TILE_S), ty = Math.floor(this.roomCenterY / TILE_S);
      const wp = this.tiles.length ? nextStep(this.tiles, fx, fy, tx, ty, TILE_S) : null;
      if (wp) {
        this.waypointX = wp.x;
        this.waypointY = wp.y;
      } else {
        (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.playAnim(this.animIdle);
        return;
      }
    }

    const dx   = this.waypointX - this.x;
    const dy   = this.waypointY - this.y;
    const wdist = Math.sqrt(dx * dx + dy * dy);
    if (wdist < 2) { this.pathNextAt = 0; this.playAnim(this.animIdle); return; }

    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      (dx / wdist) * this.speed,
      (dy / wdist) * this.speed,
    );
    if (Math.abs(dx) > 1) this.setFlipX(dx < 0);
    this.playAnim(this.animWalk);
  }

  // ── Attack init ──────────────────────────────────────────

  private beginAttack(now: number) {
    const anim     = this.animAttack ? this.scene.anims.get(this.animAttack) : null;
    const totalMs  = anim ? (anim.frames.length / (anim.frameRate || 10)) * 1000 : 400;
    this.atkCooldown = this.attackCooldown;
    this.atkHitDealt = false;
    this.atkHitAt    = now + totalMs * 0.5;
    this.enterState(AIState.ATTACK, totalMs);
  }

  // ── Animation ────────────────────────────────────────────
  // State drives animation — animation never drives state.

  private playAnim(key: string) {
    if (!key || this.currentAnimKey === key) return;
    this.currentAnimKey = key;
    this.play(key, true);
  }

  // ── Patrol helpers ───────────────────────────────────────

  private pickPatrolTarget() {
    if (!this.room) return;
    const mg   = 1;
    const minX = (this.room.x + mg) * TILE_S + TILE_S / 2;
    const maxX = Math.max(minX, (this.room.x + this.room.w - 1 - mg) * TILE_S + TILE_S / 2);
    const minY = (this.room.y + mg) * TILE_S + TILE_S / 2;
    const maxY = Math.max(minY, (this.room.y + this.room.h - 1 - mg) * TILE_S + TILE_S / 2);
    for (let i = 0; i < 8; i++) {
      const tx = Phaser.Math.Between(minX, maxX);
      const ty = Phaser.Math.Between(minY, maxY);
      if (Phaser.Math.Distance.Between(this.x, this.y, tx, ty) >= TILE_S * 1.5) {
        this.patrolTargetX = tx;
        this.patrolTargetY = ty;
        return;
      }
    }
    this.patrolTargetX = this.roomCenterX;
    this.patrolTargetY = this.roomCenterY;
  }

  // ── Bar ──────────────────────────────────────────────────

  private redrawBar() {
    const pct = Math.max(0, this.hp / this.maxHp);
    this.barFill.setSize(Math.max(1, BAR_W * pct), BAR_H);
    this.barFill.setFillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xddcc22 : 0xcc2222);
  }
}

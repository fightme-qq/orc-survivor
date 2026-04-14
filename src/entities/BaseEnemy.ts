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
  protected hitKnockback:         number;
  protected knockbackResist:      number;

  protected animIdle   = '';
  protected animWalk   = '';
  protected animAttack = '';
  protected animHit    = '';
  protected barOffsetY = 0; // per-enemy vertical nudge for the HP bar

  protected player!: Phaser.Physics.Arcade.Sprite;
  onDamagePlayer: ((atk: number, fromX: number, fromY: number, kbForce: number) => void) | null = null;
  onDeath:        ((x: number, y: number) => void) | null = null;

  private tiles: number[][] = [];

  // ── FSM ──────────────────────────────────────────────────
  // Single source of truth for enemy state.
  // stateTimer counts DOWN; when it reaches 0 the state exits.
  // No booleans that can hang — the timer is the invariant.
  private aiState:     AIState = AIState.PATROL;
  private stateTimer   = 0;   // ms remaining in current timed state
  private atkCooldown  = 0;   // ms until next attack is allowed
  private atkDamageAt  = -1;  // absolute game-time to deal damage; -1 = already dealt

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
    hitKnockback: number,
    knockbackResist = 1.0,
    hpMult = 1.0,
    atkMult = 1.0,
  ) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.hp = this.maxHp        = Math.round(hp * hpMult);
    this.armor                  = armor;
    this.speed                  = speed;
    this.aggroRange             = aggroRange;
    this.attackDamage           = Math.round(attackDamage * atkMult);
    this.attackRange            = attackRange;
    this.attackCooldown         = attackCooldown;
    this.invincibilityDuration  = invincibilityDuration;
    this.patrolSpeed            = patrolSpeed;
    this.leashRange             = leashRange;
    this.patrolPause            = patrolPause;
    this.knockbackForce         = knockbackForce;
    this.hitKnockback           = hitKnockback;
    this.knockbackResist        = knockbackResist;

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
  getMaxHp()                                  { return this.maxHp; }

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
      this.onDeath?.(this.x, this.y);
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
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(kbVx * this.knockbackResist, kbVy * this.knockbackResist);
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

    // Depth sorting — use body.bottom (feet) as anchor
    const depth = (this.body as Phaser.Physics.Arcade.Body).bottom;
    this.setDepth(depth);
    const bx = this.x;
    const by = (this.body as Phaser.Physics.Arcade.Body).top - 6 + this.barOffsetY;
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
    if (this.atkDamageAt >= 0 && time >= this.atkDamageAt) {
      this.atkDamageAt = -1;
      const d = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
      if (d <= this.attackRange * 1.3 && this.onDamagePlayer) {
        this.onDamagePlayer(this.attackDamage, this.x, this.y, this.hitKnockback);
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
      const body = this.body as Phaser.Physics.Arcade.Body;
      const fx = Math.floor(body.center.x / TILE_S);
      const fy = Math.floor(body.center.y / TILE_S);
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
    this.setMoveVelocity(dx, dy, wdist, this.speed);
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
      const body2 = this.body as Phaser.Physics.Arcade.Body;
      const fx = Math.floor(body2.center.x / TILE_S), fy = Math.floor(body2.center.y / TILE_S);
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
    this.setMoveVelocity(dx, dy, wdist, this.speed);
    if (Math.abs(dx) > 1) this.setFlipX(dx < 0);
    this.playAnim(this.animWalk);
  }

  // ── Attack init ──────────────────────────────────────────

  private beginAttack(now: number) {
    const anim     = this.animAttack ? this.scene.anims.get(this.animAttack) : null;
    const totalMs  = anim ? (anim.frames.length / (anim.frameRate || 10)) * 1000 : 400;
    this.atkCooldown = this.attackCooldown;
    this.atkDamageAt = now + totalMs * 0.5;
    this.enterState(AIState.ATTACK, totalMs);
  }

  // ── Animation ────────────────────────────────────────────
  // State drives animation — animation never drives state.

  /** Called from subclass constructor: sets the four anim keys and starts idle. */
  protected setupAnimations(prefix: string): void {
    this.animIdle   = `${prefix}-idle-anim`;
    this.animWalk   = `${prefix}-walk-anim`;
    this.animAttack = `${prefix}-attack-anim`;
    this.animHit    = `${prefix}-hit-anim`;
    this.play(this.animIdle);
  }

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

  // ── Movement ─────────────────────────────────────────────

  /**
   * Axis-priority velocity toward waypoint.
   * Primary axis: full speed toward waypoint.
   * Secondary axis: corrects toward current tile center to prevent
   * corner-sticking in 1-tile-wide corridors.
   */
  private setMoveVelocity(dx: number, dy: number, dist: number, spd: number): void {
    const body     = this.body as Phaser.Physics.Arcade.Body;
    // Use body.center (not sprite origin) to determine which tile the enemy is actually in.
    // Sprite center can cross a tile boundary while the body is still in the previous tile,
    // causing tileCX to point toward the wall instead of the corridor center.
    const tileCX   = (Math.floor(body.center.x / TILE_S) + 0.5) * TILE_S;
    const tileCY   = (Math.floor(body.center.y / TILE_S) + 0.5) * TILE_S;
    const alignSpd = spd * 0.9;

    let vx: number;
    let vy: number;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Primary: horizontal. Align body center Y to tile center.
      vx = (dx / dist) * spd;
      const yErr = tileCY - body.center.y;
      vy = Math.abs(yErr) > 1 ? Math.sign(yErr) * alignSpd : 0;
    } else {
      // Primary: vertical. Align body center X to tile center.
      const xErr = tileCX - body.center.x;
      vx = Math.abs(xErr) > 1 ? Math.sign(xErr) * alignSpd : 0;
      vy = (dy / dist) * spd;
    }
    body.setVelocity(vx, vy);
  }

  // ── Bar ──────────────────────────────────────────────────

  private redrawBar() {
    const pct = Math.max(0, this.hp / this.maxHp);
    this.barFill.setSize(Math.max(1, BAR_W * pct), BAR_H);
    this.barFill.setFillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xddcc22 : 0xcc2222);
  }
}

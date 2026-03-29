import Phaser from 'phaser';
import { nextStep } from '../utils/pathfind';
import { TILE_S } from '../utils/constants';
import { Room } from '../systems/DungeonGenerator';

const BAR_W = 36;
const BAR_H = 4;

const enum AIState { PATROL, CHASE, RETURN }

export abstract class BaseEnemy extends Phaser.Physics.Arcade.Sprite {
  protected hp: number;
  protected maxHp: number;
  protected armor: number;
  protected speed: number;
  protected aggroRange: number;
  protected attackDamage: number;
  protected attackRange: number;
  protected attackCooldown: number;
  protected patrolSpeed: number;  // multiplier of speed
  protected leashRange: number;
  protected patrolPause: number;  // ms

  // Animation keys — set by subclass
  protected animIdle   = '';
  protected animWalk   = '';
  protected animAttack = '';
  protected animHit    = '';

  protected player!: Phaser.Physics.Arcade.Sprite;
  onDamagePlayer: ((atk: number, fromX: number, fromY: number) => void) | null = null;

  // Pathfinding
  private tiles: number[][] = [];
  private pathNextAt = 0;
  private waypointX = 0;
  private waypointY = 0;

  // AI state
  private aiState: AIState = AIState.PATROL;
  private room: Room | null = null;
  private roomCenterX = 0;
  private roomCenterY = 0;
  private patrolTargetX = 0;
  private patrolTargetY = 0;
  private patrolPauseUntil = 0;
  private patrolReachedTarget = true;

  // Combat
  private invincibilityDuration = 500;
  private invincible = false;
  private invincibilityTimer = 0;
  private blinkTimer = 0;
  private attackTimer = 0;
  protected isAttacking = false;

  private barBg!: Phaser.GameObjects.Rectangle;
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
  ) {
    super(scene, x, y, texture);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.hp                    = hp;
    this.maxHp                 = hp;
    this.armor                 = armor;
    this.speed                 = speed;
    this.aggroRange            = aggroRange;
    this.attackDamage          = attackDamage;
    this.attackRange           = attackRange;
    this.attackCooldown        = attackCooldown;
    this.invincibilityDuration = invincibilityDuration;
    this.patrolSpeed           = patrolSpeed;
    this.leashRange            = leashRange;
    this.patrolPause           = patrolPause;

    this.setScale(spriteScale);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(bodyW, bodyH);
    body.setOffset(bodyOffX, bodyOffY);

    this.barBg   = scene.add.rectangle(x, y, BAR_W, BAR_H, 0x222222).setVisible(false);
    this.barFill = scene.add.rectangle(x, y, BAR_W, BAR_H, 0x44cc44).setVisible(false);
  }

  setPlayer(player: Phaser.Physics.Arcade.Sprite) {
    this.player = player;
  }

  setTiles(tiles: number[][]) {
    this.tiles = tiles;
  }

  setRoom(room: Room) {
    this.room = room;
    this.roomCenterX = (room.x + room.w / 2) * TILE_S + TILE_S / 2;
    this.roomCenterY = (room.y + room.h / 2) * TILE_S + TILE_S / 2;
    this.pickPatrolTarget();
  }

  getArmor(): number { return this.armor; }

  // ── Damage & death ───────────────────────────────────────

  takeDamage(amount: number, kbVx: number, kbVy: number) {
    if (this.invincible) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.barBg.destroy();
      this.barFill.destroy();
      this.destroy();
      return;
    }
    this.updateBar();
    this.barBg.setVisible(true);
    this.barFill.setVisible(true);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(kbVx, kbVy);
    if (this.animHit) this.play(this.animHit, true);
    this.invincible = true;
    this.invincibilityTimer = this.invincibilityDuration;
    this.blinkTimer = 0;
    // Getting hit triggers chase
    if (this.aiState === AIState.PATROL) this.aiState = AIState.CHASE;
  }

  // ── preUpdate ────────────────────────────────────────────

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);

    if (this.invincible) {
      this.invincibilityTimer -= delta;
      this.blinkTimer -= delta;
      if (this.blinkTimer <= 0) {
        this.setAlpha(this.alpha > 0.5 ? 0.2 : 1);
        this.blinkTimer = 80;
      }
      if (this.invincibilityTimer <= 0) {
        this.invincible = false;
        this.setAlpha(1);
      }
    }

    if (this.attackTimer > 0) this.attackTimer -= delta;

    this.runAI(time);

    const depth = this.y + this.displayHeight;
    this.setDepth(depth);
    const bx = this.x;
    const by = this.y - this.displayHeight / 2 - 4;
    this.barBg.setPosition(bx, by).setDepth(depth + 1);
    this.barFill.setPosition(bx - (BAR_W - this.barFill.width) / 2, by).setDepth(depth + 2);
  }

  // ── State machine ────────────────────────────────────────

  private runAI(now: number) {
    if (!this.player || !this.active) return;
    if (this.isAttacking) {
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      return;
    }

    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
    this.setFlipX(this.player.x < this.x);

    switch (this.aiState) {
      case AIState.PATROL: this.doPatrol(now, distToPlayer); break;
      case AIState.CHASE:  this.doChase(now, distToPlayer);  break;
      case AIState.RETURN: this.doReturn(now, distToPlayer); break;
    }
  }

  private doPatrol(now: number, distToPlayer: number) {
    // Aggro check
    if (distToPlayer <= this.aggroRange) {
      this.aiState = AIState.CHASE;
      this.pathNextAt = 0;
      return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;

    // Pause between patrol points
    if (now < this.patrolPauseUntil) {
      body.setVelocity(0, 0);
      this.playAnim(this.animIdle);
      return;
    }

    // Pick a new target if we just arrived
    if (this.patrolReachedTarget) {
      this.pickPatrolTarget();
      this.patrolReachedTarget = false;
    }

    const distToTarget = Phaser.Math.Distance.Between(this.x, this.y, this.patrolTargetX, this.patrolTargetY);
    if (distToTarget < TILE_S * 0.5) {
      // Arrived
      body.setVelocity(0, 0);
      this.patrolReachedTarget = true;
      this.patrolPauseUntil = now + Phaser.Math.Between(this.patrolPause * 0.7, this.patrolPause * 1.3);
      this.playAnim(this.animIdle);
      return;
    }

    this.moveTo(this.patrolTargetX, this.patrolTargetY, this.speed * this.patrolSpeed, now, 600);
    this.playAnim(this.animWalk);
  }

  private doChase(now: number, distToPlayer: number) {
    // Leash check
    if (distToPlayer > this.leashRange) {
      this.aiState = AIState.RETURN;
      this.pathNextAt = 0;
      return;
    }

    if (distToPlayer <= this.attackRange) {
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.tryAttackPlayer();
      return;
    }

    this.moveTo(this.player.x, this.player.y, this.speed, now, 400);
    this.playAnim(this.animWalk);
  }

  private doReturn(now: number, distToPlayer: number) {
    // Re-aggro if player comes close again
    if (distToPlayer <= this.aggroRange) {
      this.aiState = AIState.CHASE;
      this.pathNextAt = 0;
      return;
    }

    const distToCenter = Phaser.Math.Distance.Between(this.x, this.y, this.roomCenterX, this.roomCenterY);
    if (distToCenter < TILE_S * 0.5) {
      // Arrived — heal, switch to patrol
      this.hp = this.maxHp;
      this.updateBar();
      this.aiState = AIState.PATROL;
      this.patrolReachedTarget = true;
      this.patrolPauseUntil = 0;
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.playAnim(this.animIdle);
      return;
    }

    this.moveTo(this.roomCenterX, this.roomCenterY, this.speed, now, 400);
    this.playAnim(this.animWalk);
  }

  // ── Movement helpers ─────────────────────────────────────

  /** Move toward (tx, ty) using BFS pathfinding, recalculated every `interval` ms. */
  private moveTo(tx: number, ty: number, spd: number, now: number, interval: number) {
    if (now >= this.pathNextAt) {
      this.pathNextAt = now + interval;
      if (this.tiles.length) {
        const fromTX = Math.floor(this.x / TILE_S);
        const fromTY = Math.floor(this.y / TILE_S);
        const toTX   = Math.floor(tx / TILE_S);
        const toTY   = Math.floor(ty / TILE_S);
        const wp = nextStep(this.tiles, fromTX, fromTY, toTX, toTY, TILE_S);
        this.waypointX = wp ? wp.x : tx;
        this.waypointY = wp ? wp.y : ty;
      } else {
        this.waypointX = tx;
        this.waypointY = ty;
      }
    }
    this.scene.physics.moveToObject(this, { x: this.waypointX, y: this.waypointY }, spd);
  }

  private pickPatrolTarget() {
    if (!this.room) return;
    const margin = 1;
    const minX = (this.room.x + margin) * TILE_S + TILE_S / 2;
    const maxX = (this.room.x + this.room.w - 1 - margin) * TILE_S + TILE_S / 2;
    const minY = (this.room.y + margin) * TILE_S + TILE_S / 2;
    const maxY = (this.room.y + this.room.h - 1 - margin) * TILE_S + TILE_S / 2;
    this.patrolTargetX = Phaser.Math.Between(minX, Math.max(minX, maxX));
    this.patrolTargetY = Phaser.Math.Between(minY, Math.max(minY, maxY));
  }

  // ── Animation ─────────────────────────────────────────────

  protected playAnim(key: string) {
    if (!key) return;
    if (this.anims.currentAnim?.key === key && this.anims.isPlaying) return;
    this.play(key, true);
  }

  // ── Combat ───────────────────────────────────────────────

  protected tryAttackPlayer() {
    if (!this.player || !this.onDamagePlayer) return;
    if (this.attackTimer > 0) return;
    if (this.isAttacking) return;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.player.x, this.player.y);
    if (dist > this.attackRange) return;

    this.attackTimer = this.attackCooldown;
    this.isAttacking = true;

    if (this.animAttack) {
      this.play(this.animAttack, true);
      const anim = this.scene.anims.get(this.animAttack);
      const midMs = anim ? (anim.frames.length / (anim.frameRate || 10)) * 500 : 200;
      this.scene.time.delayedCall(midMs, () => {
        if (!this.active) return;
        const d = Phaser.Math.Distance.Between(this.x, this.y, this.player!.x, this.player!.y);
        if (d <= this.attackRange * 1.5) {
          this.onDamagePlayer!(this.attackDamage, this.x, this.y);
          const mx = (this.x + this.player!.x) / 2;
          const my = (this.y + this.player!.y) / 2;
          const flash = this.scene.add.rectangle(mx, my, 14, 14, 0xff2222, 0.85);
          flash.setDepth(this.depth + 1);
          this.scene.time.delayedCall(100, () => flash.destroy());
        }
      });
      this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => { this.isAttacking = false; });
    } else {
      this.onDamagePlayer(this.attackDamage, this.x, this.y);
      this.scene.time.delayedCall(this.attackCooldown * 0.3, () => { this.isAttacking = false; });
    }
  }

  private updateBar() {
    const pct = Math.max(0, this.hp / this.maxHp);
    this.barFill.setSize(Math.max(1, BAR_W * pct), BAR_H);
    this.barFill.setFillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xddcc22 : 0xcc2222);
  }
}

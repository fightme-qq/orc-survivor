import Phaser from 'phaser';
import balance from '../data/balance.json';
import { generateDungeon, isEdgeWall, TILE_FLOOR, TILE_STAIR, TILE_WALL } from '../systems/DungeonGenerator';
import { calcDamage } from '../utils/combat';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Skeleton } from '../entities/Skeleton';
import { Vampire } from '../entities/Vampire';
import { SCALE, TILE_S } from '../utils/constants';

// Tileset frame indices (Dungeon_Tileset.png, 10-col grid of 16×16, frame = row*10+col)
const FRAME_FLOOR      = 11; // row 1 col 1 — interior floor
const FRAME_WALL_TOP   =  1; // row 0 col 1 — top wall face (brownish ledge at top)
const FRAME_WALL_LEFT  =  0; // row 0 col 0 — left wall face  (brownish strip on right)
const FRAME_WALL_RIGHT =  5; // row 0 col 5 — right wall face (brownish strip on left)
const FRAME_WALL_FILL  =  6; // row 0 col 6 — dark fill (no directional strip)

/**
 * Choose the best wall frame based on which cardinal neighbors are floor.
 * Priority: top > left > right > fill.
 */
function getWallFrame(tiles: number[][], col: number, row: number, mapW: number, mapH: number): number {
  const isFloor = (r: number, c: number) =>
    r >= 0 && r < mapH && c >= 0 && c < mapW && tiles[r][c] !== TILE_WALL;

  const floorAbove = isFloor(row - 1, col);
  const floorBelow = isFloor(row + 1, col);
  const floorLeft  = isFloor(row, col - 1);
  const floorRight = isFloor(row, col + 1);

  if (!floorAbove && floorBelow) return FRAME_WALL_TOP;   // top face of a room
  if (!floorLeft  && floorRight) return FRAME_WALL_LEFT;  // left wall, strip faces room
  if (!floorRight && floorLeft)  return FRAME_WALL_RIGHT; // right wall, strip faces room
  if (floorAbove  && !floorBelow) return FRAME_WALL_TOP;  // bottom edge — reuse top tile
  return FRAME_WALL_FILL;
}

const STAIR_RADIUS = TILE_S / 2; // how close to stair to trigger

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; };
  private spaceKey!: Phaser.Input.Keyboard.Key;

  private playerHp = balance.player.hp;
  private facingDir = { x: 1, y: 0 };
  private attackTimer = 0;
  private playerInvincible = false;
  private playerInvincibilityTimer = 0;
  private playerBlinkTimer = 0;
  private playerKnockTimer = 0;

  private stairX = 0;
  private stairY = 0;
  private stairUsed = false;
  private floor = 1;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Restore state from registry (floor transitions carry HP/floor; game over resets them)
    this.floor    = this.registry.get('floor')    ?? 1;
    this.playerHp = this.registry.get('playerHp') ?? balance.player.hp;
    // Write back so UIScene can read synchronously on its create()
    this.registry.set('floor', this.floor);
    this.registry.set('playerHp', this.playerHp);
    this.attackTimer = 0;
    this.playerInvincible = false;
    this.playerKnockTimer = 0;
    this.stairUsed = false;

    this.cameras.main.setBackgroundColor(0x25131a);
    const dungeon = generateDungeon();
    const { tiles, width, height, playerStart, stairPos } = dungeon;

    this.stairX = stairPos.x * TILE_S + TILE_S / 2;
    this.stairY = stairPos.y * TILE_S + TILE_S / 2;

    this.walls   = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const t = tiles[row][col];
        const x = col * TILE_S + TILE_S / 2;
        const y = row * TILE_S + TILE_S / 2;

        if (t === TILE_FLOOR || t === TILE_STAIR) {
          this.add.image(x, y, 'tileset', FRAME_FLOOR).setScale(SCALE).setDepth(-1);
          if (t === TILE_STAIR) {
            const stairSprite = this.add.sprite(x, y, 'stair');
            stairSprite.setScale(SCALE).setDepth(0).play('stair-anim');
          }
        } else if (isEdgeWall(tiles, col, row)) {
          const frame = getWallFrame(tiles, col, row, width, height);
          const wall = this.walls.create(x, y, 'tileset', frame) as Phaser.Physics.Arcade.Sprite;
          wall.setScale(SCALE).setDepth(0).refreshBody();
        }
      }
    }

    // Spawn player
    const px = playerStart.x * TILE_S + TILE_S / 2;
    const py = playerStart.y * TILE_S + TILE_S / 2;
    this.player = this.physics.add.sprite(px, py, 'player');
    this.player.setScale(SCALE);
    this.player.body!.setSize(10, 8);
    this.player.body!.setOffset(3, 8);

    // Spawn torches — 1-2 per normal room, on top wall face tiles
    for (const room of dungeon.rooms.filter(r => r.type !== 'start')) {
      const count = Phaser.Math.Between(1, 2);
      for (let i = 0; i < count; i++) {
        const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
        const row = room.y; // top wall row of room interior
        const tx = col * TILE_S + TILE_S / 2;
        const ty = row * TILE_S + TILE_S / 2;
        const torch = this.add.sprite(tx, ty, 'torch');
        torch.setScale(SCALE).setDepth(ty + 1).play('torch-anim');
      }
    }

    // Spawn enemies — +1 per floor, capped at maxEnemiesPerRoom
    const baseMin = balance.dungeon.enemiesPerRoom.min;
    const baseMax = balance.dungeon.enemiesPerRoom.max;
    const cap = balance.dungeon.maxEnemiesPerRoom;
    const eMin = Math.min(baseMin + this.floor - 1, cap);
    const eMax = Math.min(baseMax + this.floor - 1, cap);

    for (const room of dungeon.rooms.filter(r => r.type === 'normal')) {
      const count = Phaser.Math.Between(eMin, eMax);
      for (let e = 0; e < count; e++) {
        const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
        const row = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
        const ex = col * TILE_S + TILE_S / 2;
        const ey = row * TILE_S + TILE_S / 2;
        const enemy = Math.random() < balance.enemies.vampire.spawnChance
          ? new Vampire(this, ex, ey)
          : new Skeleton(this, ex, ey);
        enemy.setPlayer(this.player);
        enemy.setTiles(tiles);
        enemy.setRoom(room);
        enemy.onDamagePlayer = (atk, fx, fy) => this.damagePlayer(atk, fx, fy);
        this.enemies.add(enemy);
      }
    }

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.enemies, this.enemies);

    this.cameras.main.setBounds(0, 0, width * TILE_S, height * TILE_S);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.leftButtonDown()) this.doAttack();
    });

    this.scene.launch('UIScene');
    this.game.events.emit('playerHpChanged', this.playerHp, balance.player.hp);
    this.game.events.emit('floorChanged', this.floor);
    const dungeonData = {
      tiles,
      mapWidth: width,
      mapHeight: height,
      stairTileX: stairPos.x,
      stairTileY: stairPos.y,
    };
    this.registry.set('dungeonData', dungeonData);
    this.game.events.emit('dungeonReady', dungeonData);
  }

  update(_time: number, delta: number) {
    if (this.attackTimer > 0) this.attackTimer -= delta;

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.doAttack();

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    if (this.playerKnockTimer > 0) {
      this.playerKnockTimer -= delta;
    } else {
      const speed = balance.player.speed;
      let vx = 0, vy = 0;

      if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
      else if (this.cursors.right.isDown || this.wasd.right.isDown) vx = speed;
      if (this.cursors.up.isDown   || this.wasd.up.isDown)   vy = -speed;
      else if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy = speed;

      if (vx !== 0 && vy !== 0) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
      body.setVelocity(vx, vy);

      if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        this.facingDir = { x: vx / len, y: vy / len };
        if (vx < 0) this.player.setFlipX(true);
        else if (vx > 0) this.player.setFlipX(false);
        this.player.play('player-walk', true); // true = don't restart if already playing
      } else {
        if (this.player.anims.isPlaying) this.player.anims.stop();
        this.player.setFrame(0); // idle = first frame of row 0 (standing pose)
      }
    }

    // Player blink during invincibility
    if (this.playerInvincible) {
      this.playerInvincibilityTimer -= delta;
      this.playerBlinkTimer -= delta;
      if (this.playerBlinkTimer <= 0) {
        this.player.setAlpha(this.player.alpha > 0.5 ? 0.2 : 1);
        this.playerBlinkTimer = 80;
      }
      if (this.playerInvincibilityTimer <= 0) {
        this.playerInvincible = false;
        this.player.setAlpha(1);
      }
    }

    this.player.setDepth(this.player.y + this.player.displayHeight);

    const enemyTiles = this.enemies.getChildren()
      .filter(e => (e as BaseEnemy).active)
      .map(e => ({ tileX: (e as BaseEnemy).x / TILE_S, tileY: (e as BaseEnemy).y / TILE_S }));
    this.game.events.emit('playerMoved', {
      tileX: this.player.x / TILE_S,
      tileY: this.player.y / TILE_S,
      enemies: enemyTiles,
    });

    // Stair check
    if (!this.stairUsed) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.stairX, this.stairY);
      if (dist < STAIR_RADIUS) this.nextFloor();
    }
  }

  private nextFloor() {
    this.stairUsed = true;
    this.registry.set('floor', this.floor + 1);
    this.registry.set('playerHp', this.playerHp);
    this.scene.stop('UIScene');
    this.scene.restart();
  }

  private doAttack() {
    if (this.attackTimer > 0) return;
    this.attackTimer = balance.player.attackCooldown;

    // Direction toward mouse in world space
    const ptr = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, world.x, world.y);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    const hitSize   = balance.player.hitboxSize;
    const hitOffset = balance.player.hitboxOffset;
    const hx = this.player.x + dx * hitOffset;
    const hy = this.player.y + dy * hitOffset;

    const flash = this.add.rectangle(hx, hy, hitSize, hitSize, 0xffffff, 0.85);
    flash.setDepth(500);
    this.time.delayedCall(100, () => flash.destroy());

    const hitRect = new Phaser.Geom.Rectangle(hx - hitSize / 2, hy - hitSize / 2, hitSize, hitSize);
    const kbForce = balance.player.knockbackForce;

    for (const child of this.enemies.getChildren()) {
      const enemy = child as BaseEnemy;
      if (!enemy.active) continue;

      // Overlap with enemy display bounds (48x48 centered at enemy position)
      const half = enemy.displayWidth / 2;
      const enemyRect = new Phaser.Geom.Rectangle(enemy.x - half, enemy.y - half, enemy.displayWidth, enemy.displayHeight);
      if (!Phaser.Geom.Rectangle.Overlaps(hitRect, enemyRect)) continue;

      const dmg = calcDamage(balance.player.attack, enemy.getArmor());
      const kb = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      enemy.takeDamage(dmg, Math.cos(kb) * kbForce, Math.sin(kb) * kbForce);
    }
  }

  private damagePlayer(rawAtk: number, fromX: number, fromY: number) {
    if (this.playerInvincible) return;

    const dmg = calcDamage(rawAtk, balance.player.armor);
    this.playerHp -= dmg;
    this.game.events.emit('playerHpChanged', Math.max(0, this.playerHp), balance.player.hp);

    if (this.playerHp <= 0) {
      this.showGameOver();
      return;
    }

    const angle = Phaser.Math.Angle.Between(fromX, fromY, this.player.x, this.player.y);
    const kbForce = balance.player.knockbackForce;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * kbForce,
      Math.sin(angle) * kbForce
    );
    this.playerKnockTimer = balance.player.knockbackDuration;

    this.playerInvincible = true;
    this.playerInvincibilityTimer = balance.player.invincibilityDuration;
    this.playerBlinkTimer = 0;
  }

  private showGameOver() {
    this.player.setActive(false).setVisible(false);
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.enemies.getChildren().forEach(e => (e as BaseEnemy).setActive(false));

    // Reset progression
    this.registry.remove('floor');
    this.registry.remove('playerHp');

    const cam = this.cameras.main;
    this.add.rectangle(400, 300, 800, 600, 0x000000, 0.7).setDepth(900).setScrollFactor(0);
    this.add.text(400, 270, 'GAME OVER', { fontSize: '48px', color: '#ff4444', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(901).setScrollFactor(0);
    this.add.text(400, 330, 'Click to restart', { fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5).setDepth(901).setScrollFactor(0);

    // Remove attack listener so clicks go to restart
    this.input.off('pointerdown');
    this.input.once('pointerdown', () => {
      this.scene.stop('UIScene');
      this.scene.restart();
    });
    const rKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    rKey.once('down', () => {
      this.scene.stop('UIScene');
      this.scene.restart();
    });
  }
}

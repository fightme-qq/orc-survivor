import Phaser from 'phaser';
import balance from '../data/balance.json';
import { generateDungeon, isEdgeWall, TILE_FLOOR, TILE_STAIR, TILE_WALL } from '../systems/DungeonGenerator';
import { calcDamage } from '../utils/combat';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Skeleton } from '../entities/Skeleton';
import { Vampire } from '../entities/Vampire';
import { Orc } from '../entities/Orc';
import { Player } from '../entities/Player';
import { SCALE, TILE_S } from '../utils/constants';
import { FloatTextSystem } from '../systems/FloatTextSystem';
import { ArrowSystem } from '../systems/ArrowSystem';

// Tileset frame indices (Dungeon_Tileset.png, 10-col grid of 16×16, frame = row*10+col)
const FRAME_FLOOR        = 11; // row 1 col 1 — interior floor
const FRAME_WALL_TOP     =  1; // row 0 col 1 — top wall face
const FRAME_WALL_LEFT    =  0; // row 0 col 0 — left wall face  (strip on right)
const FRAME_WALL_RIGHT   =  5; // row 0 col 5 — right wall face (strip on left)
const FRAME_CORNER_TL    =  2; // row 0 col 2 — inner corner: floor below + right
const FRAME_CORNER_TR    =  4; // row 0 col 4 — inner corner: floor below + left

/**
 * Choose the best wall frame based on cardinal floor neighbors.
 * Corners (two open sides) are handled before single-side faces.
 */
function getWallFrame(tiles: number[][], col: number, row: number, mapW: number, mapH: number): number {
  const isFloor = (r: number, c: number) =>
    r >= 0 && r < mapH && c >= 0 && c < mapW && tiles[r][c] !== TILE_WALL;

  const floorAbove = isFloor(row - 1, col);
  const floorBelow = isFloor(row + 1, col);
  const floorLeft  = isFloor(row, col - 1);
  const floorRight = isFloor(row, col + 1);

  // Inner corners — check before single-direction faces
  if (floorBelow && floorRight && !floorAbove && !floorLeft) return FRAME_CORNER_TL;
  if (floorBelow && floorLeft  && !floorAbove && !floorRight) return FRAME_CORNER_TR;

  if (!floorAbove && floorBelow)  return FRAME_WALL_TOP;   // top face
  if (!floorLeft  && floorRight)  return FRAME_WALL_LEFT;  // left face
  if (!floorRight && floorLeft)   return FRAME_WALL_RIGHT; // right face
  if (floorAbove  && !floorBelow) return FRAME_WALL_TOP;   // bottom edge
  return FRAME_WALL_TOP; // fallback
}

const STAIR_RADIUS = TILE_S; // how close to stair to trigger (covers 2×2 visual)

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; };
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

  private stairX    = 0;
  private stairY    = 0;
  private stairUsed = false;
  private floor     = 1;
  private traps: Array<{ sprite: Phaser.GameObjects.Sprite; timer: number; firing: boolean }> = [];

  private coins!:   Phaser.Physics.Arcade.StaticGroup;
  private potions!: Phaser.Physics.Arcade.StaticGroup;
  private coinValue = 0;
  private floatText!: FloatTextSystem;
  private arrowSystem!: ArrowSystem; // total in silver units

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    this.floor      = this.registry.get('floor') ?? 1;
    this.coinValue  = this.registry.get('coinValue') ?? 0;
    this.stairUsed  = false;

    this.cameras.main.setBackgroundColor(0x25131a);
    const dungeon = generateDungeon();
    const { tiles, width, height, playerStart, stairPos, corridorWidths } = dungeon;

    this.stairX = stairPos.x * TILE_S + TILE_S / 2;
    this.stairY = stairPos.y * TILE_S + TILE_S / 2;

    this.walls   = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();
    this.coins   = this.physics.add.staticGroup();
    this.potions = this.physics.add.staticGroup();

    // Solid fill for ALL wall tiles — same color as camera bg so inner walls are invisible
    // and only the edge-facing tileset frames show.
    const wallFill = this.add.graphics().setDepth(-2);
    wallFill.fillStyle(0x25131a, 1);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const t = tiles[row][col];
        const x = col * TILE_S + TILE_S / 2;
        const y = row * TILE_S + TILE_S / 2;

        if (t === TILE_FLOOR) {
          this.add.image(x, y, 'tileset', FRAME_FLOOR).setScale(SCALE).setDepth(-1);
        } else if (t === TILE_STAIR) {
          this.add.image(x, y, 'tileset', FRAME_FLOOR).setScale(SCALE).setDepth(-1);
          // Ladder prop: frame 39 = top rail, 49 = bottom rail (1 tile wide × 2 tall)
          const hs = TILE_S / 2;
          this.add.image(x, y - hs, 'tileset', 39).setScale(SCALE).setDepth(0);
          this.add.image(x, y + hs, 'tileset', 49).setScale(SCALE).setDepth(0);
        } else if (t === TILE_WALL) {
          // Fill every wall tile with solid bg color (covers inner walls seamlessly)
          wallFill.fillRect(col * TILE_S, row * TILE_S, TILE_S, TILE_S);
          // Decorative face — only for edge walls (also adds physics body)
          if (isEdgeWall(tiles, col, row)) {
            const frame = getWallFrame(tiles, col, row, width, height);
            const wall = this.walls.create(x, y, 'tileset', frame) as Phaser.Physics.Arcade.Sprite;
            wall.setScale(SCALE).setDepth(0).refreshBody();
          }
        }
      }
    }

    // Spawn player
    const px = playerStart.x * TILE_S + TILE_S / 2;
    const py = playerStart.y * TILE_S + TILE_S / 2;
    this.player = new Player(this, px, py, this.registry.get('playerHp'));
    this.player.onHpChanged = (current, max) => {
      this.registry.set('playerHp', current);
      this.game.events.emit('playerHpChanged', current, max);
    };
    this.player.onDie = () => this.showGameOver();

    // Sync registry so UIScene.create() reads correct values synchronously
    this.registry.set('floor',    this.floor);
    this.registry.set('playerHp', this.player.hp);

    // Input
    this.cursors  = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.qKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.eKey     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.player.setupInput(this.cursors, this.wasd);

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.leftButtonDown())  this.processAttack1();
      if (ptr.rightButtonDown()) this.processAttack2();
    });

    // Spawn torches — 1-2 per normal room, on top wall face tiles
    for (const room of dungeon.rooms.filter(r => r.type !== 'start')) {
      const count = Phaser.Math.Between(1, 2);
      for (let i = 0; i < count; i++) {
        const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
        const row = room.y;
        const tx  = col * TILE_S + TILE_S / 2;
        const ty  = row * TILE_S + TILE_S / 2;
        this.add.sprite(tx, ty, 'torch').setScale(SCALE).setDepth(ty + 1).play('torch-anim');
      }
    }

    // ── Traps ─────────────────────────────────────────────────
    this.traps = [];
    const td = balance.trap;

    // Safe spawn — only places on actual floor tiles, never on walls
    const spawnTrap = (tc: number, tr: number) => {
      if (tr < 0 || tr >= height || tc < 0 || tc >= width) return;
      if (tiles[tr][tc] === TILE_WALL) return;
      const tx = tc * TILE_S + TILE_S / 2;
      const ty = tr * TILE_S + TILE_S / 2;
      const sprite = this.add.sprite(tx, ty, 'trap', 0);
      sprite.setScale(2.5).setDepth(0).setVisible(true);
      this.traps.push({ sprite, timer: Phaser.Math.Between(500, td.cooldown), firing: false });
    };

    const inRoom = (c: number, r: number) =>
      dungeon.rooms.some(rm => c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h);

    // ── Room trap patterns ────────────────────────────────────
    // 7 named patterns; each eligible room picks one randomly.
    type TrapPattern = (room: typeof dungeon.rooms[0]) => void;

    const patternLineH: TrapPattern = (room) => {
      if (room.w < 4) return;
      const len = Phaser.Math.Between(2, Math.min(room.w - 2, 5));
      const r   = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
      const sc  = Phaser.Math.Between(room.x + 1, room.x + room.w - 1 - len);
      for (let i = 0; i < len; i++) spawnTrap(sc + i, r);
    };

    const patternLineV: TrapPattern = (room) => {
      if (room.h < 4) return;
      const len = Phaser.Math.Between(2, Math.min(room.h - 2, 5));
      const c   = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
      const sr  = Phaser.Math.Between(room.y + 1, room.y + room.h - 1 - len);
      for (let i = 0; i < len; i++) spawnTrap(c, sr + i);
    };

    const patternSquare: TrapPattern = (room) => {
      if (room.w < 5 || room.h < 5) return patternLineH(room);
      const sc = Phaser.Math.Between(room.x + 1, room.x + room.w - 3);
      const sr = Phaser.Math.Between(room.y + 1, room.y + room.h - 3);
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++)
          spawnTrap(sc + dc, sr + dr);
    };

    const patternCross: TrapPattern = (room) => {
      if (room.w < 5 || room.h < 5) return patternLineH(room);
      const cx = Math.floor(room.x + room.w / 2);
      const cy = Math.floor(room.y + room.h / 2);
      const arm = Phaser.Math.Between(1, 2);
      for (let d = -arm; d <= arm; d++) { spawnTrap(cx + d, cy); spawnTrap(cx, cy + d); }
    };

    const patternChecker: TrapPattern = (room) => {
      if (room.w < 4 || room.h < 4) return patternLineH(room);
      const cw = Phaser.Math.Between(2, Math.min(room.w - 2, 4));
      const ch = Phaser.Math.Between(2, Math.min(room.h - 2, 4));
      const sc = Phaser.Math.Between(room.x + 1, room.x + room.w - cw);
      const sr = Phaser.Math.Between(room.y + 1, room.y + room.h - ch);
      for (let dr = 0; dr < ch; dr++)
        for (let dc = 0; dc < cw; dc++)
          if ((dr + dc) % 2 === 0) spawnTrap(sc + dc, sr + dr);
    };

    const patternDiag: TrapPattern = (room) => {
      const len = Phaser.Math.Between(2, Math.min(Math.min(room.w, room.h) - 2, 4));
      const sc  = Phaser.Math.Between(room.x + 1, room.x + room.w - 1 - len);
      const sr  = Phaser.Math.Between(room.y + 1, room.y + room.h - 1 - len);
      for (let i = 0; i < len; i++) spawnTrap(sc + i, sr + i);
    };

    const patternBorder: TrapPattern = (room) => {
      if (room.w < 6 || room.h < 6) return patternChecker(room);
      // Inner border ring (1 tile inside room walls)
      const x0 = room.x + 1, x1 = room.x + room.w - 2;
      const y0 = room.y + 1, y1 = room.y + room.h - 2;
      for (let c = x0; c <= x1; c++) { spawnTrap(c, y0); spawnTrap(c, y1); }
      for (let r = y0 + 1; r < y1; r++) { spawnTrap(x0, r); spawnTrap(x1, r); }
    };

    const patterns: TrapPattern[] = [
      patternLineH, patternLineV, patternSquare,
      patternCross, patternChecker, patternDiag, patternBorder,
    ];

    const normalRooms = dungeon.rooms.filter(r => r.type === 'normal');
    normalRooms.forEach((room, ri) => {
      if (ri % 2 !== 0) return; // every 2nd room gets traps
      const pick = patterns[Phaser.Math.Between(0, patterns.length - 1)];
      pick(room);
    });

    // ── Corridor traps — full-width barrier every N tiles ────
    // Horizontal corridors
    for (let row = 1; row < height - 1; row++) {
      let runStart = -1;
      for (let col = 1; col <= width; col++) {
        const isCorr = col < width && tiles[row][col] === TILE_FLOOR && !inRoom(col, row);
        if (isCorr) {
          if (runStart < 0) runStart = col;
        } else if (runStart >= 0) {
          const len = col - runStart;
          if (len >= 4 && Math.random() < 0.45) {
            // pick 1-2 positions inside the run and fill all corridor rows
            const cnt = Phaser.Math.Between(1, Math.min(2, Math.floor(len / 3)));
            const off = Phaser.Math.Between(1, len - cnt - 1);
            for (let i = 0; i < cnt; i++) {
              const c = runStart + off + i;
              const w = corridorWidths.get(row * width + c) ?? 1;
              for (let dw = 0; dw < w; dw++) spawnTrap(c, row + dw);
            }
          }
          runStart = -1;
        }
      }
    }
    // Vertical corridors
    for (let col = 1; col < width - 1; col++) {
      let runStart = -1;
      for (let row = 1; row <= height; row++) {
        const isCorr = row < height && tiles[row][col] === TILE_FLOOR && !inRoom(col, row);
        if (isCorr) {
          if (runStart < 0) runStart = row;
        } else if (runStart >= 0) {
          const len = row - runStart;
          if (len >= 4 && Math.random() < 0.45) {
            const cnt = Phaser.Math.Between(1, Math.min(2, Math.floor(len / 3)));
            const off = Phaser.Math.Between(1, len - cnt - 1);
            for (let i = 0; i < cnt; i++) {
              const r = runStart + off + i;
              const w = corridorWidths.get(r * width + col) ?? 1;
              for (let dw = 0; dw < w; dw++) spawnTrap(col + dw, r);
            }
          }
          runStart = -1;
        }
      }
    }

    // Spawn enemies — +1 per floor, capped at maxEnemiesPerRoom
    const baseMin = balance.dungeon.enemiesPerRoom.min;
    const baseMax = balance.dungeon.enemiesPerRoom.max;
    const cap  = balance.dungeon.maxEnemiesPerRoom;
    const eMin = Math.min(baseMin + this.floor - 1, cap);
    const eMax = Math.min(baseMax + this.floor - 1, cap);

    for (const room of dungeon.rooms.filter(r => r.type === 'normal')) {
      const count = Phaser.Math.Between(eMin, eMax);
      for (let e = 0; e < count; e++) {
        const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
        const row = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
        const ex  = col * TILE_S + TILE_S / 2;
        const ey  = row * TILE_S + TILE_S / 2;
        const r = Math.random() * (
          balance.enemies.skeleton.spawnWeight +
          balance.enemies.vampire.spawnWeight +
          balance.enemies.orc.spawnWeight
        );
        const enemy = r < balance.enemies.orc.spawnWeight
          ? new Orc(this, ex, ey)
          : r < balance.enemies.orc.spawnWeight + balance.enemies.vampire.spawnWeight
          ? new Vampire(this, ex, ey)
          : new Skeleton(this, ex, ey);
        enemy.setPlayer(this.player);
        enemy.setTiles(tiles);
        enemy.setRoom(room);
        enemy.onDamagePlayer = (atk, fx, fy) => this.player.takeDamage(atk, fx, fy);
        this.enemies.add(enemy);
      }
    }

    // ── Coins — scatter across all rooms ────────────────────────
    {
      const bc = balance.coins;
      const COIN_SZ = 12;
      const jitter  = Math.floor(TILE_S * 0.3);

      const spawnCoin = (col: number, row: number, frame: number, value: number) => {
        const wx = col * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
        const wy = row * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
        const s = this.coins.create(wx, wy, 'icons', frame) as Phaser.Physics.Arcade.Sprite;
        s.setDisplaySize(COIN_SZ, COIN_SZ).setDepth(wy + 16).refreshBody();
        (s.body as Phaser.Physics.Arcade.StaticBody).setSize(COIN_SZ, COIN_SZ);
        s.setData('value', value);
      };

      const tryDrop = (frame: number, value: number) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const room = dungeon.rooms[Phaser.Math.Between(0, dungeon.rooms.length - 1)];
          const col  = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
          const row  = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
          if (dungeon.tiles[row]?.[col] === TILE_FLOOR) {
            spawnCoin(col, row, frame, value);
            return;
          }
        }
      };

      // Silver: 4-9 per floor
      const silverCount = Phaser.Math.Between(4, 9);
      for (let i = 0; i < silverCount; i++) tryDrop(bc.silverFrame, bc.silverValue);

      // Gold: ~10x rarer than silver → p≈0.5 per floor
      if (Math.random() < 0.5) tryDrop(bc.goldFrame, bc.goldValue);

      // Red: ~100x rarer than silver → p≈0.05 per floor
      if (Math.random() < 0.05) tryDrop(bc.redFrame, bc.redValue);
    }
    this.physics.add.overlap(this.player, this.coins, (_p, coin) => {
      const c = coin as Phaser.Physics.Arcade.Sprite;
      this.coinValue += c.getData('value') as number;
      c.destroy();
      this.registry.set('coinValue', this.coinValue);
      this.game.events.emit('coinsChanged', this.coinValue);
    });

    // ── Potions — 1-5 per floor ──────────────────────────────────
    {
      const bp = balance.potions;
      const jitter = Math.floor(TILE_S * 0.3);
      const count = Phaser.Math.Between(bp.spawnMin, bp.spawnMax);
      for (let i = 0; i < count; i++) {
        const item = bp.items[Phaser.Math.Between(0, bp.items.length - 1)];
        for (let attempt = 0; attempt < 20; attempt++) {
          const room = dungeon.rooms[Phaser.Math.Between(0, dungeon.rooms.length - 1)];
          const col  = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
          const row  = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
          if (dungeon.tiles[row]?.[col] === TILE_FLOOR) {
            const wx = col * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
            const wy = row * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
            const s = this.potions.create(wx, wy, 'potions', item.frame) as Phaser.Physics.Arcade.Sprite;
            s.setDisplaySize(bp.displaySize, bp.displaySize).setDepth(wy + 16).refreshBody();
            (s.body as Phaser.Physics.Arcade.StaticBody).setSize(bp.displaySize, bp.displaySize);
            s.setData('heal', item.heal);
            break;
          }
        }
      }
    }
    this.physics.add.overlap(this.player, this.potions, (_p, pot) => {
      const p = pot as Phaser.Physics.Arcade.Sprite;
      const heal = p.getData('heal') as number;
      p.destroy();
      this.player.heal(heal);
      this.floatText.showHeal(this.player.x, this.player.y, heal);
      this.game.events.emit('playerHpChanged', this.player.hp, this.player.maxHp);
    });

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);

    this.cameras.main.setBounds(0, 0, width * TILE_S, height * TILE_S);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.floatText  = new FloatTextSystem(this);
    this.arrowSystem = new ArrowSystem(this, this.enemies, tiles,
      (x, y, dmg, isCrit) => this.floatText.showDamage(x, y, dmg, isCrit));
    this.scene.launch('UIScene');
    this.game.events.emit('playerHpChanged', this.player.hp, this.player.maxHp);
    this.game.events.emit('floorChanged', this.floor);
    const dungeonData = { tiles, mapWidth: width, mapHeight: height, stairTileX: stairPos.x, stairTileY: stairPos.y };
    this.registry.set('dungeonData', dungeonData);
    this.game.events.emit('dungeonReady', dungeonData);
  }

  update(_time: number, delta: number) {
    if (!this.player.active) return;
    this.floatText.update(delta);
    this.arrowSystem.update(delta);

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.processAttack1();
    if (Phaser.Input.Keyboard.JustDown(this.qKey))     this.processAttack2();
    if (Phaser.Input.Keyboard.JustDown(this.eKey))     this.processAttack3();

    // Minimap data
    const enemyTiles = this.enemies.getChildren()
      .filter(e => (e as BaseEnemy).active)
      .map(e => ({ tileX: (e as BaseEnemy).x / TILE_S, tileY: (e as BaseEnemy).y / TILE_S }));
    this.game.events.emit('playerMoved', {
      tileX: this.player.x / TILE_S,
      tileY: this.player.y / TILE_S,
      enemies: enemyTiles,
    });

    // Trap update
    for (const trap of this.traps) {
      if (trap.firing) continue;
      trap.timer -= delta;
      if (trap.timer <= 0) {
        trap.firing = true;
        trap.sprite.play('trap-anim');
        const dist = Phaser.Math.Distance.Between(trap.sprite.x, trap.sprite.y, this.player.x, this.player.y);
        if (dist < balance.trap.radius && this.player.active) {
          this.player.takeDamage(balance.trap.damage, trap.sprite.x, trap.sprite.y);
        }
        this.time.delayedCall(balance.trap.activeDuration, () => {
          trap.firing = false;
          trap.timer  = balance.trap.cooldown;
          trap.sprite.setFrame(0);
        });
      }
    }

    // Stair check
    if (!this.stairUsed) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.stairX, this.stairY);
      if (dist < STAIR_RADIUS) this.nextFloor();
    }
  }

  // ── Attacks ───────────────────────────────────────────────────

  private rollDamage(dmgBase: number, armor: number): [number, boolean] {
    const isCrit = Math.random() < balance.player.critChance;
    const mult   = isCrit ? balance.player.critMultiplier : 1;
    return [calcDamage(dmgBase * mult, armor), isCrit];
  }

  private hitEnemiesRect(hitRect: Phaser.Geom.Rectangle, dmgBase: number): void {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as BaseEnemy;
      if (!enemy.active) continue;
      const half = enemy.displayWidth / 2;
      const er = new Phaser.Geom.Rectangle(enemy.x - half, enemy.y - half, enemy.displayWidth, enemy.displayHeight);
      if (!Phaser.Geom.Rectangle.Overlaps(hitRect, er)) continue;
      const [dmg, isCrit] = this.rollDamage(dmgBase, enemy.getArmor());
      const kb  = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const ekb = enemy.getKnockbackForce();
      enemy.takeDamage(dmg, Math.cos(kb) * ekb, Math.sin(kb) * ekb);
      this.floatText.showDamage(enemy.x, enemy.y, dmg, isCrit);
    }
  }

  private hitEnemiesCircle(circle: Phaser.Geom.Circle, dmgBase: number): void {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as BaseEnemy;
      if (!enemy.active) continue;
      if (!Phaser.Geom.Circle.Contains(circle, enemy.x, enemy.y)) continue;
      const [dmg, isCrit] = this.rollDamage(dmgBase, enemy.getArmor());
      const kb  = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const ekb = enemy.getKnockbackForce();
      enemy.takeDamage(dmg, Math.cos(kb) * ekb, Math.sin(kb) * ekb);
      this.floatText.showDamage(enemy.x, enemy.y, dmg, isCrit);
    }
  }

  // Attack 1 — basic swing (LMB / Space)
  private processAttack1(): void {
    const hit = this.player.tryAttack1();
    if (hit) this.hitEnemiesRect(hit, balance.player.attack);
  }

  // Attack 2 — lunge (RMB / Q)
  private processAttack2(): void {
    const hit = this.player.tryAttack2();
    if (hit) this.hitEnemiesRect(hit, balance.player.attack2.damage);
  }

  // Attack 3 — arrow shot (E), aimed at mouse but clamped to facing half
  private processAttack3(): void {
    const cam     = this.cameras.main;
    const pointer = this.input.activePointer;
    const worldX  = pointer.x / cam.zoom + cam.worldView.x;
    const worldY  = pointer.y / cam.zoom + cam.worldView.y;
    const mouseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldX, worldY);

    // Clamp to facing half-circle: if facing right → [-π/2, π/2], left → [π/2, 3π/2]
    const facingRight = this.player.facingAngle > -Math.PI / 2 && this.player.facingAngle < Math.PI / 2
                     || (worldX >= this.player.x); // fallback: use mouse side
    const halfDir   = facingRight ? 0 : Math.PI;
    const diff      = Phaser.Math.Angle.Wrap(mouseAngle - halfDir);
    const clamped   = halfDir + Phaser.Math.Clamp(diff, -Math.PI / 2, Math.PI / 2);

    this.arrowSystem.shoot(this.player.x, this.player.y, clamped);
  }

  // ── Floor / Game Over ─────────────────────────────────────────

  private nextFloor() {
    this.stairUsed = true;
    this.registry.set('floor',     this.floor + 1);
    this.registry.set('playerHp',  this.player.hp);
    this.registry.set('coinValue', this.coinValue);
    this.scene.stop('UIScene');
    this.scene.restart();
  }

  private showGameOver() {
    this.enemies.getChildren().forEach(e => (e as BaseEnemy).setActive(false));

    this.registry.remove('floor');
    this.registry.remove('playerHp');
    this.registry.remove('coinValue');

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

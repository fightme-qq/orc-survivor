import Phaser from 'phaser';
import balance from '../data/balance.json';
import { calcDamage } from '../utils/combat';
import { BaseEnemy } from '../entities/BaseEnemy';
import { OrcPlayer } from '../entities/OrcPlayer';
import { WaveSystem } from '../systems/WaveSystem';
import { FloatTextSystem } from '../systems/FloatTextSystem';
import { ShopSystem, ShopItemInstance } from '../systems/ShopSystem';
import { baseStats, setStats, clearStats, PlayerStats } from '../systems/RunState';
import { Room } from '../systems/DungeonGenerator';
import { TILE_S } from '../utils/constants';
import { t } from '../lang';

// ── Arena dimensions ───────────────────────────────────────────────────────────
// 30×20 tiles → 1440×960 world pixels (viewport 1280×720, camera follows player)
const ARENA_W = 30; // tiles
const ARENA_H = 20; // tiles

// Tileset frames (Dungeon_Tileset.png)
const FRAME_FLOOR = 11;
const FRAME_WALL  =  1;

// Small coin display size on ground
const COIN_DISPLAY = 8;

type WaveState = 'active' | 'intermission' | 'gameover';

export class SurvivorScene extends Phaser.Scene {
  private player!: OrcPlayer;
  private walls!:  Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;
  private coins!:   Phaser.Physics.Arcade.StaticGroup;
  private potions!: Phaser.Physics.Arcade.StaticGroup;

  private floatText!:  FloatTextSystem;
  private waveSystem!: WaveSystem;
  private shopSystem:  ShopSystem | null = null;

  private stats!:     PlayerStats;
  private coinValue = 0;

  private waveState: WaveState   = 'active';
  private currentWave            = 0;
  private intermissionTimer      = 0;

  // Floor bounds in world pixels (wall-excluded playable area)
  private floorX = TILE_S;
  private floorY = TILE_S;
  private floorW = (ARENA_W - 2) * TILE_S;
  private floorH = (ARENA_H - 2) * TILE_S;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
  };
  private eKey!: Phaser.Input.Keyboard.Key;

  // UI overlays (world-space texts scrolled with camera)
  private gameOverOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: 'SurvivorScene' });
  }

  // ── create ─────────────────────────────────────────────────────────────────

  create() {
    // Always start fresh — no carry-over between runs
    clearStats(this.registry);
    this.stats     = baseStats();
    this.coinValue = 0;
    this.waveState = 'active';
    this.currentWave = 0;
    this.gameOverOverlay = null;

    const worldW = ARENA_W * TILE_S;
    const worldH = ARENA_H * TILE_S;

    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBackgroundColor(0x25131a);

    // ── Build arena ──────────────────────────────────────────
    this.walls = this.physics.add.staticGroup();
    this.buildArena(ARENA_W, ARENA_H);

    // ── Camera ───────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    // ── Groups ───────────────────────────────────────────────
    this.enemies = this.physics.add.group();
    this.coins   = this.physics.add.staticGroup();
    this.potions = this.physics.add.staticGroup();

    // ── Player at arena center ───────────────────────────────
    const cx = Math.floor(ARENA_W / 2) * TILE_S;
    const cy = Math.floor(ARENA_H / 2) * TILE_S;
    this.player = new OrcPlayer(this, cx, cy, this.stats);
    this.player.onHpChanged = (cur, max) => {
      this.registry.set('playerHp', cur);
      this.game.events.emit('playerHpChanged', cur, max);
    };
    this.player.onDie = () => this.onPlayerDied();

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // ── Input ────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd    = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.player.setupInput(this.cursors, this.wasd);

    // ── Physics ──────────────────────────────────────────────
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);

    // Coin pickup
    this.physics.add.overlap(this.player, this.coins, (_p, coin) => {
      const val = (coin as Phaser.GameObjects.GameObject).getData('value') as number;
      this.coinValue += val;
      (coin as Phaser.GameObjects.Sprite).destroy();
      this.game.events.emit('coinsChanged', this.coinValue);
      this.registry.set('coinValue', this.coinValue);
    });

    // Potion pickup
    this.physics.add.overlap(this.player, this.potions, (_p, pot) => {
      const heal = (pot as Phaser.GameObjects.GameObject).getData('heal') as number;
      const prev = this.player.hp;
      this.player.heal(heal);
      const gained = this.player.hp - prev;
      if (gained > 0) {
        this.floatText.showHeal(this.player.x, this.player.y - 30, gained);
        this.game.events.emit('playerHpChanged', this.player.hp, this.player.maxHp);
      }
      (pot as Phaser.GameObjects.Sprite).destroy();
    });

    // ── Systems ──────────────────────────────────────────────
    this.floatText  = new FloatTextSystem(this);
    this.waveSystem = new WaveSystem(
      this, this.enemies, this.player,
      this.floorX, this.floorY, this.floorW, this.floorH,
      (x, y) => this.onEnemyDied(x, y),
    );

    // ── Emit initial UI state ────────────────────────────────
    this.game.events.emit('playerHpChanged', this.player.hp, this.player.maxHp);
    this.game.events.emit('coinsChanged',    this.coinValue);
    this.game.events.emit('playerStatsChanged', {
      attack: this.stats.attack,
      arrowDamage: this.stats.arrowDamage,
      armor:  this.stats.armor,
    });

    // ── Launch UI ────────────────────────────────────────────
    this.scene.launch('SurvivorUIScene');

    // ── Start first wave ─────────────────────────────────────
    this.beginNextWave();
  }

  // ── update ────────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.waveState === 'gameover') return;

    this.floatText.update(delta);

    if (this.waveState === 'active') {
      this.tickActiveWave();
    } else {
      this.tickIntermission(delta);
    }

    // Minimap-like player position (UIScene compatible event)
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    this.game.events.emit('playerMoved', {
      tileX: body.center.x / TILE_S,
      tileY: body.center.y / TILE_S,
      enemies: [],
    });
  }

  // ── Wave logic ────────────────────────────────────────────────────────────

  private tickActiveWave() {
    if (!this.player.active) return;

    // Auto-attack nearest enemy.
    // Damage is committed at swing mid-point — enemy doesn't need to stay in range.
    const nearest = this.findNearestEnemy();
    if (nearest) {
      this.player.tryAutoAttack(nearest, () => {
        if (nearest.active) this.dealDamageToEnemy(nearest);
      });
    }

    // Wave cleared?
    if (this.waveSystem.allDead()) {
      this.enterIntermission();
    }
  }

  private tickIntermission(delta: number) {
    this.intermissionTimer -= delta;

    // Shop interaction (E key)
    if (this.shopSystem) {
      const purchased = this.shopSystem.update(
        this.player.x, this.player.y,
        this.coinValue,
        Phaser.Input.Keyboard.JustDown(this.eKey),
      );
      if (purchased) {
        this.coinValue -= purchased.price;
        this.applyPurchase(purchased);
        this.game.events.emit('coinsChanged', this.coinValue);
        this.registry.set('coinValue', this.coinValue);
        this.game.events.emit('itemBought', { frame: purchased.frame, name: purchased.name });
      }
    }

    // Countdown — emit both whole seconds (for text) and fraction (for bar)
    const secsLeft = Math.max(0, Math.ceil(this.intermissionTimer / 1000));
    const pct      = Math.max(0, this.intermissionTimer / balance.survivor.wavePause);
    this.game.events.emit('intermissionTick', secsLeft, pct);

    if (this.intermissionTimer <= 0) {
      this.shopSystem?.destroy();
      this.shopSystem = null;
      this.beginNextWave();
    }
  }

  private enterIntermission() {
    this.waveState        = 'intermission';
    this.intermissionTimer = balance.survivor.wavePause;
    this.game.events.emit('waveCleared');

    // Spawn shop items in arena
    const fakeRoom: Room = { x: 1, y: 1, w: ARENA_W - 2, h: ARENA_H - 2, type: 'normal' };
    this.shopSystem = new ShopSystem(this);
    this.shopSystem.spawnInRoom(fakeRoom);
  }

  private beginNextWave() {
    this.currentWave++;
    this.waveState = 'active';
    this.waveSystem.startWave(this.currentWave);
    this.game.events.emit('waveChanged', this.currentWave);
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private findNearestEnemy(): BaseEnemy | null {
    const children = this.enemies.getChildren();
    let nearest: BaseEnemy | null = null;
    let minDist = Infinity;

    for (const child of children) {
      const e = child as BaseEnemy;
      if (!e.active) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, e.x, e.y);
      if (d < minDist) { minDist = d; nearest = e; }
    }
    return nearest;
  }

  private dealDamageToEnemy(enemy: BaseEnemy): void {
    const stats = this.player.stats;
    const crit  = Math.random() < stats.critChance;
    const base  = stats.attack * (crit ? stats.critMultiplier : 1);
    const dmg   = calcDamage(base, enemy.getArmor());

    const angle  = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
    const kbForce = enemy.getKnockbackForce();
    enemy.takeDamage(dmg, Math.cos(angle) * kbForce, Math.sin(angle) * kbForce);
    this.floatText.showDamage(enemy.x, enemy.y - 20, dmg, crit);
  }

  // ── Loot ─────────────────────────────────────────────────────────────────

  private onEnemyDied(x: number, y: number): void {
    const el = balance.enemyLoot;
    const bc = balance.coins;

    // Silver coins — always drop 1, sometimes 2
    this.dropCoin(x, y, bc.silverFrame, bc.silverValue);
    if (Math.random() < el.silverChance) {
      this.dropCoin(x, y, bc.silverFrame, bc.silverValue);
    }
    // Gold coin — rare
    if (Math.random() < el.goldChance) {
      this.dropCoin(x, y, bc.goldFrame, bc.goldValue);
    }
    // Potion — small chance
    if (Math.random() < el.potionChance) {
      this.dropPotion(x, y);
    }
  }

  private dropCoin(x: number, y: number, frame: number, value: number): void {
    const jitter = 12;
    const wx = x + Phaser.Math.Between(-jitter, jitter);
    const wy = y + Phaser.Math.Between(-jitter, jitter);

    const s = this.add.sprite(wx, wy, 'icons', frame);
    s.setDisplaySize(COIN_DISPLAY, COIN_DISPLAY).setDepth(wy + 1);
    this.physics.world.enable(s, Phaser.Physics.Arcade.STATIC_BODY);
    (s.body as Phaser.Physics.Arcade.StaticBody).setSize(COIN_DISPLAY, COIN_DISPLAY);
    s.setData('value', value);
    this.coins.add(s);
  }

  private dropPotion(x: number, y: number): void {
    const items = balance.potions.items;
    const item  = items[Math.floor(Math.random() * items.length)];
    const s     = this.add.sprite(x, y, 'potions', item.frame);
    s.setDisplaySize(16, 16).setDepth(y + 1);
    this.physics.world.enable(s, Phaser.Physics.Arcade.STATIC_BODY);
    (s.body as Phaser.Physics.Arcade.StaticBody).setSize(12, 12);
    s.setData('heal', item.heal);
    this.potions.add(s);
  }

  // ── Shop purchase ─────────────────────────────────────────────────────────

  private applyPurchase(item: ShopItemInstance): void {
    for (const bonus of item.bonuses) {
      const k = bonus.statKey;
      if (k === 'critChance') {
        this.stats.critChance += bonus.value / 100;
      } else if (k === 'critMultiplier') {
        this.stats.critMultiplier += bonus.value / 100;
      } else {
        (this.stats as any)[k] += bonus.value;
      }
    }
    setStats(this.registry, this.stats);
    this.player.updateStats(this.stats);
    this.game.events.emit('playerStatsChanged', {
      attack:      this.stats.attack,
      arrowDamage: this.stats.arrowDamage,
      armor:       this.stats.armor,
    });
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  private onPlayerDied(): void {
    this.waveState = 'gameover';

    // Stop all enemies
    for (const child of this.enemies.getChildren()) {
      (child as BaseEnemy).setActive(false);
      ((child as BaseEnemy).body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }

    // Game-over overlay (fixed to camera)
    const cam  = this.cameras.main;
    const cx   = cam.scrollX + cam.width  / 2;
    const cy   = cam.scrollY + cam.height / 2;

    const bg = this.add.rectangle(0, 0, 500, 160, 0x000000, 0.8).setOrigin(0.5);
    const title = this.add.text(0, -40, t().gameOver, {
      fontSize: '40px', fontStyle: 'bold', color: '#ff4444',
      stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5);
    const sub = this.add.text(0, 20, `Wave ${this.currentWave}  •  ${t().clickRestart}`, {
      fontSize: '18px', color: '#ffffff',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);

    this.gameOverOverlay = this.add.container(cx, cy, [bg, title, sub]).setDepth(9999);

    // Click to restart
    this.input.once('pointerdown', () => {
      this.scene.stop('SurvivorUIScene');
      this.scene.restart();
    });
  }

  // ── Arena builder ─────────────────────────────────────────────────────────

  private buildArena(cols: number, rows: number): void {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = col * TILE_S + TILE_S / 2;
        const wy = row * TILE_S + TILE_S / 2;
        const isWall = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;

        if (isWall) {
          // Wall tile — add to static physics group for collision
          const w = this.walls.create(wx, wy, 'tileset', FRAME_WALL) as Phaser.Physics.Arcade.Sprite;
          w.setScale(3).refreshBody();
          w.setDepth(0);
        } else {
          // Floor tile — visual only, no physics
          const f = this.add.image(wx, wy, 'tileset', FRAME_FLOOR);
          f.setScale(3).setDepth(-1);
        }
      }
    }
  }
}

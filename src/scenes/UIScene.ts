import Phaser from 'phaser';
import balance from '../data/balance.json';
import { TILE_WALL } from '../systems/DungeonGenerator';

const MAX_HP = balance.player.hp;
const PAD    = 10;

// ── CrimsonFantasyGUI HP бар (CriticalDamage-Sheet.png) ──────────────────────
// 20 фреймов 64×16, фрейм 0 = полный, фрейм 19 = пустой
// Два слоя: пустой бар внизу + полный бар с setCrop сверху → плавное заполнение
const HP_SCALE       = 4;  // 64×4=256px широкий, 16×4=64px высокий
const BAR_H          = 16 * HP_SCALE;  // 64px
const FILL_SRC_START = 16; // источник x: до x=16 — сердце (не кропаем)
const FILL_SRC_W     = 48; // источник px: ширина зоны заполнения (x=16..63)
const FILL_SRC_H     = 16; // высота фрейма в источнике

const MM_W = 150;
const MM_H = 150;
const MM_X = 800 - PAD - MM_W;
const MM_Y = 600 - PAD - MM_H;

const REVEAL_RADIUS = 5;
const ENEMY_VISION  = 8;

// Tile colors
const C_FLOOR_DIM    = 0x333333;
const C_WALL_DIM     = 0x555555;
const C_FLOOR_BRIGHT = 0x777777;
const C_WALL_BRIGHT  = 0xaaaaaa;
const C_STAIR        = 0xddcc22;
const C_PLAYER       = 0x44ff44;
const C_ENEMY        = 0xcc2222;

export class UIScene extends Phaser.Scene {
  private hpBarEmpty!: Phaser.GameObjects.Sprite; // всегда виден (пустые слоты)
  private hpBarFill!:  Phaser.GameObjects.Sprite; // кропается по HP%
  private hpText!:    Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private prevHp      = MAX_HP;

  private coinIcons!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private coinTexts!: [Phaser.GameObjects.Text,  Phaser.GameObjects.Text,  Phaser.GameObjects.Text];
  private coinY = 0;

  // Minimap data
  private tiles:    number[][] = [];
  private revealed: boolean[][] = []; // cumulative, never resets mid-floor
  private mapW = 0;
  private mapH = 0;
  private mmScale = 1;
  private stairTX = 0;
  private stairTY = 0;

  // Visibility this frame (radius 5 around player)
  private currentVisible = new Set<number>(); // encoded row*mapW+col
  private prevPlayerTile = -1;

  // Minimap gfx layers
  private exploredGfx!: Phaser.GameObjects.Graphics; // dim explored tiles — redraws on new reveals
  private visibleGfx!:  Phaser.GameObjects.Graphics; // bright current-view — redraws every frame
  private unitGfx!:     Phaser.GameObjects.Graphics; // player + enemies

  private exploredDirty = false;

  private playerTX = 0;
  private playerTY = 0;
  private visibleEnemies: { tileX: number; tileY: number }[] = [];

  constructor() {
    super({ key: 'UIScene' });
  }

  create() {
    // ── HP бар (CrimsonFantasyGUI CriticalDamage-Sheet) ─────────────────────
    // Нижний слой: пустой бар (фрейм 19) — всегда виден полностью
    this.hpBarEmpty = this.add.sprite(PAD, PAD, 'hp-bar', 19)
      .setScale(HP_SCALE).setOrigin(0, 0)
      .setScrollFactor(0).setDepth(100);
    // Верхний слой: полный бар (фрейм 0) — кропается до текущего HP%
    this.hpBarFill = this.add.sprite(PAD, PAD, 'hp-bar', 0)
      .setScale(HP_SCALE).setOrigin(0, 0)
      .setScrollFactor(0).setDepth(101);

    // Текст HP по центру сердечка (сердечко x=0..15 → центр x≈8 → display PAD+32)
    this.hpText = this.add.text(PAD + 8 * HP_SCALE, PAD + BAR_H / 2, `${MAX_HP}`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(102);

    // Coin display — below HP bar (icons hidden until player has that coin type)
    this.coinY = PAD + BAR_H + 6;
    const iconSz = 18;
    const bc = balance.coins;
    const coinFrames = [bc.redFrame, bc.goldFrame, bc.silverFrame] as const;
    this.coinIcons = coinFrames.map(frame =>
      this.add.image(0, 0, 'icons', frame)
        .setDisplaySize(iconSz, iconSz).setScrollFactor(0).setDepth(100).setVisible(false)
    ) as unknown as [Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image];
    this.coinTexts = coinFrames.map(() =>
      this.add.text(0, 0, '0', {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101).setVisible(false)
    ) as unknown as [Phaser.GameObjects.Text, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    this.onCoinsChanged(this.registry.get('coinValue') ?? 0);

    // Floor label
    this.floorText = this.add.text(800 - PAD, PAD + BAR_H / 2, 'Floor 1', {
      fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      backgroundColor: '#00000099', padding: { x: 6, y: 3 },
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(100);

    // Minimap frame
    this.add.rectangle(MM_X + MM_W / 2, MM_Y + MM_H / 2, MM_W + 2, MM_H + 2, 0xaaaaaa)
      .setScrollFactor(0).setDepth(109);
    this.add.rectangle(MM_X + MM_W / 2, MM_Y + MM_H / 2, MM_W, MM_H, 0x000000)
      .setScrollFactor(0).setDepth(110);

    // Three gfx layers (all fixed to screen)
    this.exploredGfx = this.add.graphics().setScrollFactor(0).setDepth(111);
    this.visibleGfx  = this.add.graphics().setScrollFactor(0).setDepth(112);
    this.unitGfx     = this.add.graphics().setScrollFactor(0).setDepth(113);

    this.onFloorChanged(this.registry.get('floor') ?? 1);
    this.onHpChanged(this.registry.get('playerHp') ?? MAX_HP, MAX_HP);
    const dungeonData = this.registry.get('dungeonData');
    if (dungeonData) this.onDungeonReady(dungeonData);

    this.game.events.on('playerHpChanged', this.onHpChanged,    this);
    this.game.events.on('floorChanged',    this.onFloorChanged,  this);
    this.game.events.on('dungeonReady',    this.onDungeonReady,  this);
    this.game.events.on('playerMoved',     this.onPlayerMoved,   this);
    this.game.events.on('coinsChanged',    this.onCoinsChanged,  this);

    this.events.once('shutdown', () => {
      this.game.events.off('playerHpChanged', this.onHpChanged,    this);
      this.game.events.off('floorChanged',    this.onFloorChanged,  this);
      this.game.events.off('dungeonReady',    this.onDungeonReady,  this);
      this.game.events.off('playerMoved',     this.onPlayerMoved,   this);
      this.game.events.off('coinsChanged',    this.onCoinsChanged,  this);
    });
  }

  update(_t: number, delta: number) {
    // Redraw dim layer only when new tiles discovered
    if (this.exploredDirty) {
      this.redrawExplored();
      this.exploredDirty = false;
    }

    // Bright layer + units — every frame
    this.redrawVisible();

    this.redrawUnits();
  }

  // ── Event handlers ────────────────────────────────

  private onHpChanged(current: number, max: number) {
    const pct   = Math.max(0, Math.min(1, current / max));
    // setCrop в координатах источника (до scale): показываем сердце + pct зоны заполнения
    const cropW = FILL_SRC_START + FILL_SRC_W * pct;
    this.hpBarFill.setCrop(0, 0, cropW, FILL_SRC_H);
    this.hpText.setText(`${Math.round(current)}`);
    this.prevHp = current;
  }

  private onCoinsChanged(total: number) {
    const bc = balance.coins;
    const counts = [
      Math.floor(total / bc.redValue),
      Math.floor((total % bc.redValue) / bc.goldValue),
      total % bc.goldValue,
    ];
    const ICON_SZ  = 18;
    const GAP      = 4;  // px between icon+text groups
    const TEXT_GAP = 2;  // px between icon and number
    let curX = PAD;
    const midY = this.coinY + ICON_SZ / 2;
    for (let i = 0; i < 3; i++) {
      const visible = counts[i] > 0;
      this.coinIcons[i].setVisible(visible);
      this.coinTexts[i].setVisible(visible);
      if (visible) {
        this.coinIcons[i].setPosition(curX + ICON_SZ / 2, midY);
        this.coinTexts[i].setText(String(counts[i])).setPosition(curX + ICON_SZ + TEXT_GAP, midY);
        curX += ICON_SZ + TEXT_GAP + (this.coinTexts[i].width) + GAP;
      }
    }
  }

  private onFloorChanged(floor: number) {
    this.floorText?.setText(`Floor ${floor}`);
  }

  private onDungeonReady(data: {
    tiles: number[][];
    mapWidth: number; mapHeight: number;
    stairTileX: number; stairTileY: number;
  }) {
    this.tiles   = data.tiles;
    this.mapW    = data.mapWidth;
    this.mapH    = data.mapHeight;
    this.stairTX = data.stairTileX;
    this.stairTY = data.stairTileY;
    this.mmScale = Math.min(MM_W / this.mapW, MM_H / this.mapH);

    // Reset fog — new floor
    this.revealed = Array.from({ length: this.mapH }, () =>
      new Array<boolean>(this.mapW).fill(false)
    );
    this.currentVisible.clear();
    this.prevPlayerTile = -1;

    this.exploredGfx.clear();
    this.visibleGfx.clear();
    this.exploredDirty = false;
  }

  private onPlayerMoved(data: {
    tileX: number; tileY: number;
    enemies: { tileX: number; tileY: number }[];
  }) {
    this.playerTX = data.tileX;
    this.playerTY = data.tileY;

    const ptx = Math.floor(data.tileX);
    const pty = Math.floor(data.tileY);

    // Only recompute visibility if player moved to a different tile
    const tileKey = pty * this.mapW + ptx;
    if (tileKey === this.prevPlayerTile) {
      // Still update enemy list
      this.updateEnemyList(data.tileX, data.tileY, data.enemies);
      return;
    }
    this.prevPlayerTile = tileKey;

    // Rebuild current visible set and accumulate revealed
    this.currentVisible.clear();

    for (let dy = -REVEAL_RADIUS; dy <= REVEAL_RADIUS; dy++) {
      for (let dx = -REVEAL_RADIUS; dx <= REVEAL_RADIUS; dx++) {
        if (dx * dx + dy * dy > REVEAL_RADIUS * REVEAL_RADIUS) continue;
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) continue;
        this.currentVisible.add(ty * this.mapW + tx);
        this.revealed[ty][tx] = true; // persists forever
      }
    }

    this.exploredDirty = true; // always redraw dim layer when visible zone shifts

    this.updateEnemyList(data.tileX, data.tileY, data.enemies);
  }

  private updateEnemyList(
    px: number, py: number,
    enemies: { tileX: number; tileY: number }[]
  ) {
    this.visibleEnemies = enemies.filter(e => {
      const dx = e.tileX - px;
      const dy = e.tileY - py;
      return dx * dx + dy * dy <= ENEMY_VISION * ENEMY_VISION;
    });
  }

  // ── Draw layers ───────────────────────────────────

  /** Dim explored tiles (all revealed, not just current view). Updates only on new reveals. */
  private redrawExplored() {
    if (!this.tiles.length) return;
    this.exploredGfx.clear();
    const s = this.mmScale;

    for (let row = 0; row < this.mapH; row++) {
      for (let col = 0; col < this.mapW; col++) {
        if (!this.revealed[row][col]) continue;
        // Skip tiles currently visible — drawn bright in visibleGfx
        const key = row * this.mapW + col;
        if (this.currentVisible.has(key)) continue;

        const color = this.tiles[row][col] === TILE_WALL ? C_WALL_DIM : C_FLOOR_DIM;
        this.exploredGfx.fillStyle(color, 1);
        this.exploredGfx.fillRect(MM_X + col * s, MM_Y + row * s, Math.max(1, s), Math.max(1, s));
      }
    }
  }

  /** Bright current-view tiles. Redrawn every frame when player moves. */
  private redrawVisible() {
    if (!this.tiles.length) return;
    this.visibleGfx.clear();
    const s = this.mmScale;

    for (const key of this.currentVisible) {
      const row = Math.floor(key / this.mapW);
      const col = key % this.mapW;
      const color = this.tiles[row][col] === TILE_WALL ? C_WALL_BRIGHT : C_FLOOR_BRIGHT;
      this.visibleGfx.fillStyle(color, 1);
      this.visibleGfx.fillRect(MM_X + col * s, MM_Y + row * s, Math.max(1, s), Math.max(1, s));
    }

    // Stair — yellow, only if revealed
    if (this.revealed[this.stairTY]?.[this.stairTX]) {
      const sx = MM_X + (this.stairTX + 0.5) * s;
      const sy = MM_Y + (this.stairTY + 0.5) * s;
      this.visibleGfx.fillStyle(C_STAIR, 1);
      this.visibleGfx.fillCircle(sx, sy, Math.max(2, s * 0.8));
    }
  }

  /** Player dot + enemy dots. Redrawn every frame. */
  private redrawUnits() {
    this.unitGfx.clear();
    const s = this.mmScale;
    const r = Math.max(1.5, s * 0.6);

    // Enemies
    this.unitGfx.fillStyle(C_ENEMY, 1);
    for (const e of this.visibleEnemies) {
      this.unitGfx.fillCircle(
        MM_X + (e.tileX + 0.5) * s,
        MM_Y + (e.tileY + 0.5) * s,
        r
      );
    }

    // Player dot
    {
      this.unitGfx.fillStyle(C_PLAYER, 1);
      this.unitGfx.fillCircle(
        MM_X + (this.playerTX + 0.5) * s,
        MM_Y + (this.playerTY + 0.5) * s,
        Math.max(2, s * 0.8)
      );
    }
  }
}

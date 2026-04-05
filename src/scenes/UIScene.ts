import Phaser from 'phaser';
import balance from '../data/balance.json';
import { TILE_WALL } from '../systems/DungeonGenerator';

const MAX_HP = balance.player.hp;
const BAR_W  = 200;
const BAR_H  = 20;
const PAD    = 10;

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
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!:    Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;

  private coinTexts!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text, Phaser.GameObjects.Text];

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
    // HP bar
    this.add.rectangle(PAD + BAR_W / 2, PAD + BAR_H / 2, BAR_W + 6, BAR_H + 6, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(100);
    this.add.rectangle(PAD + BAR_W / 2, PAD + BAR_H / 2, BAR_W, BAR_H, 0x444444)
      .setScrollFactor(0).setDepth(101);
    this.hpBarFill = this.add.rectangle(PAD, PAD + BAR_H / 2, BAR_W, BAR_H, 0x44cc44)
      .setScrollFactor(0).setDepth(102).setOrigin(0, 0.5);
    this.hpText = this.add.text(PAD + BAR_W / 2, PAD + BAR_H / 2, `${MAX_HP} / ${MAX_HP}`, {
      fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(103);

    // Coin display — below HP bar
    const coinY  = PAD + BAR_H + 10;
    const iconSz = 16; // display size of each coin icon
    const bc = balance.coins;
    const coinDefs = [
      { frame: bc.redFrame,    x: PAD },
      { frame: bc.goldFrame,   x: PAD + 55 },
      { frame: bc.silverFrame, x: PAD + 110 },
    ] as const;
    this.coinTexts = coinDefs.map(def => {
      this.add.image(def.x + iconSz / 2, coinY + iconSz / 2, 'icons', def.frame)
        .setDisplaySize(iconSz, iconSz).setScrollFactor(0).setDepth(100);
      return this.add.text(def.x + iconSz + 3, coinY + iconSz / 2, '0', {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
    }) as unknown as [Phaser.GameObjects.Text, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
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
    const pct = Math.max(0, current / max);
    this.hpBarFill.setSize(BAR_W * pct, BAR_H);
    this.hpBarFill.setFillStyle(pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xddcc22 : 0xcc2222);
    this.hpText.setText(`${Math.round(current)} / ${max}`);
  }

  private onCoinsChanged(total: number) {
    const bc = balance.coins;
    const red    = Math.floor(total / bc.redValue);
    const gold   = Math.floor((total % bc.redValue) / bc.goldValue);
    const silver = total % bc.goldValue;
    this.coinTexts[0].setText(String(red));
    this.coinTexts[1].setText(String(gold));
    this.coinTexts[2].setText(String(silver));
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

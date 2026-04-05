import Phaser from 'phaser';
import balance from '../data/balance.json';
import { TILE_WALL, TILE_FLOOR, Room } from './DungeonGenerator';
import { Player } from '../entities/Player';
import { TILE_S } from '../utils/constants';

interface TrapEntry {
  sprite:  Phaser.GameObjects.Sprite;
  timer:   number;
  firing:  boolean;
}

export class TrapSystem {
  private traps: TrapEntry[] = [];

  constructor(
    private scene: Phaser.Scene,
    tiles:          number[][],
    width:          number,
    height:         number,
    corridorWidths: Map<number, number>,
    rooms:          Room[],
  ) {
    this.spawnAll(tiles, width, height, corridorWidths, rooms);
  }

  // ── Spawn ─────────────────────────────────────────────────

  private spawnTile(tiles: number[][], width: number, height: number, tc: number, tr: number): void {
    if (tr < 0 || tr >= height || tc < 0 || tc >= width) return;
    if (tiles[tr][tc] === TILE_WALL) return;
    const tx = tc * TILE_S + TILE_S / 2;
    const ty = tr * TILE_S + TILE_S / 2;
    const sprite = this.scene.add.sprite(tx, ty, 'trap', 0);
    sprite.setScale(2.5).setDepth(ty).setVisible(true);
    this.traps.push({ sprite, timer: Phaser.Math.Between(500, balance.trap.cooldown), firing: false });
  }

  private spawnAll(
    tiles: number[][], width: number, height: number,
    corridorWidths: Map<number, number>, rooms: Room[],
  ): void {
    const spawn  = (c: number, r: number) => this.spawnTile(tiles, width, height, c, r);
    const inRoom = (c: number, r: number) =>
      rooms.some(rm => c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h);

    // ── Room trap patterns ──────────────────────────────────
    type TrapPattern = (room: Room) => void;

    const patternLineH: TrapPattern = (room) => {
      if (room.w < 4) return;
      const len = Phaser.Math.Between(2, Math.min(room.w - 2, 5));
      const r   = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
      const sc  = Phaser.Math.Between(room.x + 1, room.x + room.w - 1 - len);
      for (let i = 0; i < len; i++) spawn(sc + i, r);
    };

    const patternLineV: TrapPattern = (room) => {
      if (room.h < 4) return;
      const len = Phaser.Math.Between(2, Math.min(room.h - 2, 5));
      const c   = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
      const sr  = Phaser.Math.Between(room.y + 1, room.y + room.h - 1 - len);
      for (let i = 0; i < len; i++) spawn(c, sr + i);
    };

    const patternSquare: TrapPattern = (room) => {
      if (room.w < 5 || room.h < 5) return patternLineH(room);
      const sc = Phaser.Math.Between(room.x + 1, room.x + room.w - 3);
      const sr = Phaser.Math.Between(room.y + 1, room.y + room.h - 3);
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++)
          spawn(sc + dc, sr + dr);
    };

    const patternCross: TrapPattern = (room) => {
      if (room.w < 5 || room.h < 5) return patternLineH(room);
      const cx  = Math.floor(room.x + room.w / 2);
      const cy  = Math.floor(room.y + room.h / 2);
      const arm = Phaser.Math.Between(1, 2);
      for (let d = -arm; d <= arm; d++) { spawn(cx + d, cy); spawn(cx, cy + d); }
    };

    const patternChecker: TrapPattern = (room) => {
      if (room.w < 4 || room.h < 4) return patternLineH(room);
      const cw = Phaser.Math.Between(2, Math.min(room.w - 2, 4));
      const ch = Phaser.Math.Between(2, Math.min(room.h - 2, 4));
      const sc = Phaser.Math.Between(room.x + 1, room.x + room.w - cw);
      const sr = Phaser.Math.Between(room.y + 1, room.y + room.h - ch);
      for (let dr = 0; dr < ch; dr++)
        for (let dc = 0; dc < cw; dc++)
          if ((dr + dc) % 2 === 0) spawn(sc + dc, sr + dr);
    };

    const patternDiag: TrapPattern = (room) => {
      const len = Phaser.Math.Between(2, Math.min(Math.min(room.w, room.h) - 2, 4));
      const sc  = Phaser.Math.Between(room.x + 1, room.x + room.w - 1 - len);
      const sr  = Phaser.Math.Between(room.y + 1, room.y + room.h - 1 - len);
      for (let i = 0; i < len; i++) spawn(sc + i, sr + i);
    };

    const patternBorder: TrapPattern = (room) => {
      if (room.w < 6 || room.h < 6) return patternChecker(room);
      const x0 = room.x + 1, x1 = room.x + room.w - 2;
      const y0 = room.y + 1, y1 = room.y + room.h - 2;
      for (let c = x0; c <= x1; c++) { spawn(c, y0); spawn(c, y1); }
      for (let r = y0 + 1; r < y1; r++) { spawn(x0, r); spawn(x1, r); }
    };

    const patterns: TrapPattern[] = [
      patternLineH, patternLineV, patternSquare,
      patternCross, patternChecker, patternDiag, patternBorder,
    ];

    const normalRooms = rooms.filter(r => r.type === 'normal');
    normalRooms.forEach((room, ri) => {
      if (ri % 2 !== 0) return;
      const pick = patterns[Phaser.Math.Between(0, patterns.length - 1)];
      pick(room);
    });

    // ── Corridor traps ─────────────────────────────────────
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
            const cnt = Phaser.Math.Between(1, Math.min(2, Math.floor(len / 3)));
            const off = Phaser.Math.Between(1, len - cnt - 1);
            for (let i = 0; i < cnt; i++) {
              const c = runStart + off + i;
              const w = corridorWidths.get(row * width + c) ?? 1;
              for (let dw = 0; dw < w; dw++) spawn(c, row + dw);
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
              for (let dw = 0; dw < w; dw++) spawn(col + dw, r);
            }
          }
          runStart = -1;
        }
      }
    }
  }

  // ── Update ────────────────────────────────────────────────

  update(delta: number, player: Player): void {
    for (const trap of this.traps) {
      if (trap.firing) continue;
      trap.timer -= delta;
      if (trap.timer <= 0) {
        trap.firing = true;
        trap.sprite.play('trap-anim');
        const dist = Phaser.Math.Distance.Between(trap.sprite.x, trap.sprite.y, player.x, player.y);
        if (dist < balance.trap.radius && player.active) {
          player.takeDamage(balance.trap.damage, trap.sprite.x, trap.sprite.y);
        }
        this.scene.time.delayedCall(balance.trap.activeDuration, () => {
          trap.firing = false;
          trap.timer  = balance.trap.cooldown;
          trap.sprite.setFrame(0);
        });
      }
    }
  }
}

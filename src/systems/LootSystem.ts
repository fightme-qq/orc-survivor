import Phaser from 'phaser';
import balance from '../data/balance.json';
import { TILE_FLOOR, Room } from './DungeonGenerator';
import { Player } from '../entities/Player';
import { TILE_S } from '../utils/constants';

const COIN_SCALE = 0.375; // 4x smaller than the original 1.5

export class LootSystem {
  readonly coins: Phaser.Physics.Arcade.StaticGroup;
  private coinValue: number;

  constructor(scene: Phaser.Scene, initialValue: number) {
    this.coins     = scene.physics.add.staticGroup();
    this.coinValue = initialValue;
  }

  /**
   * Spawns coins scattered across the floor.
   *  - 5-6 silver coins always
   *  - 1 gold coin  ~every 5-7 floors  (p ≈ 0.17 per floor)
   *  - 1 red  coin  ~every 20-25 floors (p ≈ 0.044 per floor)
   */
  spawnFloor(scene: Phaser.Scene, tiles: number[][], rooms: Room[]): void {
    const bc = balance.coins;

    const silverCount = Phaser.Math.Between(5, 6);
    for (let i = 0; i < silverCount; i++) {
      this.drop(scene, tiles, rooms, bc.silverFrame, bc.silverValue);
    }

    if (Math.random() < 0.17) {
      this.drop(scene, tiles, rooms, bc.goldFrame, bc.goldValue);
    }

    if (Math.random() < 0.044) {
      this.drop(scene, tiles, rooms, bc.redFrame, bc.redValue);
    }
  }

  /** Debug: puts one of each coin type in the start room. */
  spawnDebug(scene: Phaser.Scene, tiles: number[][], startRoom: Room): void {
    const bc = balance.coins;
    [bc.redFrame, bc.goldFrame, bc.silverFrame].forEach((frame, i) => {
      const col = startRoom.x + 1 + i;
      const row = startRoom.y + 1;
      const wx = col * TILE_S + TILE_S / 2;
      const wy = row * TILE_S + TILE_S / 2;
      const value = [bc.redValue, bc.goldValue, bc.silverValue][i];
      const s = this.coins.create(wx, wy, 'icons', frame) as Phaser.Physics.Arcade.Sprite;
      s.setScale(COIN_SCALE).setDepth(wy + 16).refreshBody();
      s.setData('value', value);
    });
  }

  private drop(
    scene: Phaser.Scene,
    tiles: number[][], rooms: Room[],
    frame: number, value: number,
  ): void {
    // Try up to 10 times to find a valid floor tile in a random room
    for (let attempt = 0; attempt < 10; attempt++) {
      const room = rooms[Phaser.Math.Between(0, rooms.length - 1)];
      const col  = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
      const row  = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
      if (tiles[row]?.[col] !== TILE_FLOOR) continue;

      const jitter = Math.floor(TILE_S * 0.3); // ±30% от размера тайла
      const wx = col * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
      const wy = row * TILE_S + TILE_S / 2 + Phaser.Math.Between(-jitter, jitter);
      const s  = this.coins.create(wx, wy, 'icons', frame) as Phaser.Physics.Arcade.Sprite;
      s.setScale(COIN_SCALE).setDepth(wy + 16).refreshBody();
      s.setData('value', value);
      return;
    }
  }

  setupOverlap(
    scene: Phaser.Scene,
    player: Player,
    onChange: (total: number) => void,
  ): void {
    scene.physics.add.overlap(player, this.coins, (_p, coin) => {
      this.coinValue += (coin as Phaser.Physics.Arcade.Sprite).getData('value') as number;
      (coin as Phaser.Physics.Arcade.Sprite).destroy();
      onChange(this.coinValue);
    });
  }

  getValue(): number { return this.coinValue; }
}

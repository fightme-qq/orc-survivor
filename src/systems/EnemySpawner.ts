import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Skeleton } from '../entities/Skeleton';
import { Vampire } from '../entities/Vampire';
import { Orc } from '../entities/Orc';
import { Player } from '../entities/Player';
import { Room } from './DungeonGenerator';
import { TILE_S } from '../utils/constants';

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => BaseEnemy;

interface SpawnEntry {
  ctor: EnemyCtor;
  weight: number;
  minFloor: number;
}

// Weight-based spawn table. To add a new enemy: add one entry here + balance.json.
// Weights are relative — they don't need to sum to 1.
const SPAWN_TABLE: SpawnEntry[] = [
  { ctor: Skeleton, weight: balance.enemies.skeleton.spawnWeight, minFloor: 1 },
  { ctor: Vampire,  weight: balance.enemies.vampire.spawnWeight,  minFloor: 1 },
  { ctor: Orc,      weight: balance.enemies.orc.spawnWeight,      minFloor: 1 },
];

export class EnemySpawner {
  constructor(
    private scene:  Phaser.Scene,
    private group:  Phaser.Physics.Arcade.Group,
    private tiles:  number[][],
    private player: Player,
    private floor:  number,
  ) {}

  spawnRoom(room: Room): void {
    const { min, max } = balance.dungeon.enemiesPerRoom;
    const cap  = balance.dungeon.maxEnemiesPerRoom;
    const eMin = Math.min(min + this.floor - 1, cap);
    const eMax = Math.min(max + this.floor - 1, cap);

    const count = Phaser.Math.Between(eMin, eMax);
    for (let i = 0; i < count; i++) {
      const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
      const row = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
      const ex  = col * TILE_S + TILE_S / 2;
      const ey  = row * TILE_S + TILE_S / 2;

      const enemy = this.pick(ex, ey);
      enemy.setPlayer(this.player);
      enemy.setTiles(this.tiles);
      enemy.setRoom(room);
      enemy.onDamagePlayer = (atk, fx, fy) => this.player.takeDamage(atk, fx, fy);
      this.group.add(enemy);
    }
  }

  private pick(x: number, y: number): BaseEnemy {
    const eligible = SPAWN_TABLE.filter(e => e.minFloor <= this.floor);
    const total    = eligible.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const entry of eligible) {
      r -= entry.weight;
      if (r <= 0) return new entry.ctor(this.scene, x, y);
    }
    return new Skeleton(this.scene, x, y);
  }
}

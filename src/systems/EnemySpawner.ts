import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Skeleton } from '../entities/Skeleton';
import { Vampire } from '../entities/Vampire';
import { Orc } from '../entities/Orc';
import { Player } from '../entities/Player';
import { Room } from './DungeonGenerator';
import { TILE_S } from '../utils/constants';

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number, hpMult: number, atkMult: number) => BaseEnemy;

export class EnemySpawner {
  constructor(
    private scene:   Phaser.Scene,
    private group:   Phaser.Physics.Arcade.Group,
    private tiles:   number[][],
    private player:  Player,
    private floor:   number,
    private onDeath: ((x: number, y: number) => void) | null = null,
  ) {}

  spawnRoom(room: Room): number {
    const d      = balance.dungeon;
    const hpMult  = 1 + d.scalingHpPerFloor  * (this.floor - 1);
    const atkMult = 1 + d.scalingAtkPerFloor * (this.floor - 1);
    const count  = this.pickCount();
    for (let i = 0; i < count; i++) {
      const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
      const row = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
      const ex  = col * TILE_S + TILE_S / 2;
      const ey  = row * TILE_S + TILE_S / 2;

      const enemy = new (this.pickType())(this.scene, ex, ey, hpMult, atkMult);
      enemy.setPlayer(this.player);
      enemy.setTiles(this.tiles);
      enemy.setRoom(room);
      enemy.onDamagePlayer = (atk, fx, fy, kbForce) => this.player.takeDamage(atk, fx, fy, kbForce);
      enemy.onDeath = this.onDeath;
      this.group.add(enemy);
    }
    return count;
  }

  // Returns 0–4 based on enemyCountWeights [index = count, value = weight]
  private pickCount(): number {
    const weights = balance.dungeon.enemyCountWeights;
    const total   = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  // Picks enemy type based on floor — see dungeon.enemyTypeWeights in balance.json
  private pickType(): EnemyCtor {
    const w = this.floor >= 3
      ? balance.dungeon.enemyTypeWeights.floor3plus
      : this.floor === 2
        ? balance.dungeon.enemyTypeWeights.floor2
        : balance.dungeon.enemyTypeWeights.floor1;

    const entries: [EnemyCtor, number][] = [
      [Skeleton, w.skeleton],
      [Vampire,  w.vampire],
      [Orc,      w.orc],
    ];
    const total = entries.reduce((s, [, wt]) => s + wt, 0);
    let r = Math.random() * total;
    for (const [ctor, wt] of entries) {
      r -= wt;
      if (r <= 0) return ctor;
    }
    return Skeleton;
  }
}

import Phaser from 'phaser';
import balance from '../data/balance.json';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Skeleton } from '../entities/Skeleton';
import { Vampire } from '../entities/Vampire';
import { OrcPlayer } from '../entities/OrcPlayer';
import { TILE_S } from '../utils/constants';

type EnemyCtor = new (
  scene: Phaser.Scene,
  x: number, y: number,
  hpMult: number, atkMult: number,
) => BaseEnemy;

export class WaveSystem {
  private wave = 0;

  constructor(
    private scene:    Phaser.Scene,
    private group:    Phaser.Physics.Arcade.Group,
    private player:   OrcPlayer,
    // Walkable floor area in world pixels (wall tiles excluded)
    private floorX:   number,
    private floorY:   number,
    private floorW:   number,
    private floorH:   number,
    private onDeath:  ((x: number, y: number) => void) | null = null,
  ) {}

  get currentWave() { return this.wave; }

  startWave(wave: number): void {
    this.wave = wave;
    const sv      = balance.survivor;
    const count   = sv.waveBaseCount + sv.waveCountIncrease * (wave - 1);
    const hpMult  = 1 + balance.dungeon.scalingHpPerFloor  * (wave - 1);
    const atkMult = 1 + balance.dungeon.scalingAtkPerFloor * (wave - 1);

    for (let i = 0; i < count; i++) {
      const pos   = this.randomEdgePos();
      const enemy = new (this.pickType(wave))(this.scene, pos.x, pos.y, hpMult, atkMult);
      enemy.setPlayer(this.player);
      enemy.setAlwaysChase();                                       // always chase, never patrol
      enemy.onDeath        = this.onDeath;
      enemy.onDamagePlayer = (atk, fx, fy, kbf) => this.player.takeDamage(atk, fx, fy, kbf);
      this.group.add(enemy);
    }
  }

  allDead(): boolean {
    return this.group.countActive() === 0;
  }

  // ── Private ────────────────────────────────────────────────

  private pickType(wave: number): EnemyCtor {
    if (wave <= 1) return Skeleton;
    // wave 2+: mix skeletons and vampires; vampire share grows each wave
    const skelW = 60;
    const vampW = Math.min(40, wave * 8);
    return Math.random() * (skelW + vampW) < skelW ? Skeleton : Vampire;
  }

  // Spawn near edges of the walkable floor — not at exact border to avoid wall overlap
  private randomEdgePos(): { x: number; y: number } {
    const margin = TILE_S * 1.5;
    const rw     = this.floorW - margin * 2;
    const rh     = this.floorH - margin * 2;
    const edge   = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: return { // top edge
        x: this.floorX + margin + Math.random() * rw,
        y: this.floorY + margin,
      };
      case 1: return { // bottom edge
        x: this.floorX + margin + Math.random() * rw,
        y: this.floorY + this.floorH - margin,
      };
      case 2: return { // left edge
        x: this.floorX + margin,
        y: this.floorY + margin + Math.random() * rh,
      };
      default: return { // right edge
        x: this.floorX + this.floorW - margin,
        y: this.floorY + margin + Math.random() * rh,
      };
    }
  }
}

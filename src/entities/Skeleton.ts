import balance from '../data/balance.json';
import { BaseEnemy } from './BaseEnemy';

export class Skeleton extends BaseEnemy {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    const b = balance.enemies.skeleton;
    super(scene, x, y, 'enemy', b.hp, b.speed, b.aggroRange);
  }

  protected updateAI() {
    if (!this.player || !this.active) return;

    const dist = Phaser.Math.Distance.Between(
      this.x, this.y, this.player.x, this.player.y
    );

    const body = this.body as Phaser.Physics.Arcade.Body;

    if (dist <= this.aggroRange) {
      this.scene.physics.moveToObject(this, this.player, this.speed);
    } else {
      body.setVelocity(0, 0);
    }
  }
}

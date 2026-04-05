import Phaser from 'phaser';
import { calcDamage } from '../utils/combat';
import { BaseEnemy } from '../entities/BaseEnemy';
import { Player } from '../entities/Player';

export class AttackResolver {
  constructor(
    private enemies: Phaser.Physics.Arcade.Group,
    private player:  Player,
  ) {}

  hitRect(hitRect: Phaser.Geom.Rectangle, dmgBase: number): void {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as BaseEnemy;
      if (!enemy.active) continue;
      const half = enemy.displayWidth / 2;
      const er = new Phaser.Geom.Rectangle(enemy.x - half, enemy.y - half, enemy.displayWidth, enemy.displayHeight);
      if (!Phaser.Geom.Rectangle.Overlaps(hitRect, er)) continue;
      const dmg = calcDamage(dmgBase, enemy.getArmor());
      const kb  = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const ekb = enemy.getKnockbackForce();
      enemy.takeDamage(dmg, Math.cos(kb) * ekb, Math.sin(kb) * ekb);
    }
  }

  hitCircle(circle: Phaser.Geom.Circle, dmgBase: number): void {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as BaseEnemy;
      if (!enemy.active) continue;
      if (!Phaser.Geom.Circle.Contains(circle, enemy.x, enemy.y)) continue;
      const dmg = calcDamage(dmgBase, enemy.getArmor());
      const kb  = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
      const ekb = enemy.getKnockbackForce();
      enemy.takeDamage(dmg, Math.cos(kb) * ekb, Math.sin(kb) * ekb);
    }
  }
}

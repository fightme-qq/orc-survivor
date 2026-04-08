import Phaser from 'phaser';
import balance from '../data/balance.json';
import { TILE_S } from '../utils/constants';

export class Chest extends Phaser.Physics.Arcade.Sprite {
  private hp: number;
  private opened = false;
  private blinkTimer = 0;

  onOpen: ((x: number, y: number) => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'chest');
    scene.add.existing(this);
    scene.physics.add.existing(this, true); // static body

    this.hp = balance.chest.hp;
    const sc = balance.chest.scale;
    this.setScale(sc).setFrame(0);
    // Body on bottom half so player can walk "behind" the chest
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(12, 8).setOffset(2, 8);
    this.setDepth(body.bottom);
  }

  takeDamage(amount: number): void {
    if (this.opened) return;
    this.hp -= amount;
    this.blinkTimer = 150;
    this.setTint(0xff6666);
    this.scene.time.delayedCall(80, () => this.clearTint());

    if (this.hp <= 0) this.open();
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (this.blinkTimer > 0) this.blinkTimer -= delta;
    this.setDepth((this.body as Phaser.Physics.Arcade.StaticBody).bottom);
  }

  private open(): void {
    this.opened = true;
    // Play open animation frames 0→3
    this.scene.tweens.addCounter({
      from: 0, to: 3, duration: 320,
      onUpdate: (tween) => {
        this.setFrame(Math.round(tween.getValue() as number));
      },
      onComplete: () => {
        if (this.onOpen) this.onOpen(this.x, this.y);
        // Fade out after a moment
        this.scene.time.delayedCall(400, () => {
          this.scene.tweens.add({
            targets: this,
            alpha: 0,
            duration: 300,
            onComplete: () => {
              (this.body as Phaser.Physics.Arcade.StaticBody).enable = false;
              this.destroy();
            },
          });
        });
      },
    });
  }
}

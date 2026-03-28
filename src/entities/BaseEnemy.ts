import Phaser from 'phaser';

export abstract class BaseEnemy extends Phaser.Physics.Arcade.Sprite {
  protected hp: number;
  protected speed: number;
  protected aggroRange: number;
  protected player!: Phaser.Physics.Arcade.Sprite;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    hp: number,
    speed: number,
    aggroRange: number
  ) {
    super(scene, x, y, texture);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.hp = hp;
    this.speed = speed;
    this.aggroRange = aggroRange;

    // Body: small rect at feet (same as player convention)
    this.setScale(3);
    (this.body as Phaser.Physics.Arcade.Body).setSize(10, 8);
    (this.body as Phaser.Physics.Arcade.Body).setOffset(3, 8);
  }

  setPlayer(player: Phaser.Physics.Arcade.Sprite) {
    this.player = player;
  }

  takeDamage(amount: number) {
    this.hp -= amount;
    if (this.hp <= 0) this.destroy();
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);
    this.updateAI();
    this.setDepth(this.y + this.displayHeight);
  }

  protected abstract updateAI(): void;
}

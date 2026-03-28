import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create() {
    // Generate placeholder textures programmatically
    this.makeRect('player', 0x44aa44);
    this.makeRect('enemy', 0xaa2222);
    this.makeRect('floor', 0x888888);
    this.makeRect('wall', 0x444444);
    this.makeRect('chest', 0x8b5e3c);
    this.makeRect('stair', 0xddcc22);

    this.scene.start('GameScene');
  }

  private makeRect(key: string, color: number) {
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(color, 1);
    g.fillRect(0, 0, 16, 16);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }
}

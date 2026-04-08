import Phaser from 'phaser';

interface FloatEntry {
  text: Phaser.GameObjects.Text;
  vy:   number;
  life: number;
  maxLife: number;
}

export class FloatTextSystem {
  private scene: Phaser.Scene;
  private entries: FloatEntry[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  showDamage(x: number, y: number, amount: number, isCrit: boolean): void {
    const t = this.scene.add.text(
      x + Phaser.Math.Between(-8, 8),
      y - 20,
      isCrit ? `CRIT! ${Math.round(amount)}` : `${Math.round(amount)}`,
      {
        fontSize: isCrit ? '15px' : '13px',
        fontStyle: 'bold',
        color: isCrit ? '#ffaa00' : '#ff8888',
        stroke: '#000000',
        strokeThickness: isCrit ? 4 : 3,
      }
    ).setOrigin(0.5, 1).setDepth(y + 500);

    this.entries.push({
      text: t,
      vy: isCrit ? -70 : -50,
      life: isCrit ? 850 : 650,
      maxLife: isCrit ? 850 : 650,
    });
  }

  showHeal(x: number, y: number, amount: number): void {
    const t = this.scene.add.text(x, y - 20, `+${Math.round(amount)}`, {
      fontSize: '13px', fontStyle: 'bold',
      color: '#44ff88',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(y + 500);

    this.entries.push({ text: t, vy: -50, life: 650, maxLife: 650 });
  }

  update(delta: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.life -= delta;
      e.text.y += e.vy * (delta / 1000);
      e.vy     *= 0.92;
      e.text.setAlpha(Math.max(0, e.life / e.maxLife));
      if (e.life <= 0) {
        e.text.destroy();
        this.entries.splice(i, 1);
      }
    }
  }
}

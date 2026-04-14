import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Tileset — floor, walls (16×16 grid)
    this.load.spritesheet('tileset', 'assets/tiles/Dungeon_Tileset.png', {
      frameWidth: 16, frameHeight: 16,
    });

    // Soldier player — 100×100 spritesheets (no shadow variant)
    const sol = 'assets/Characters(100x100)/Soldier/Soldier/';
    this.load.spritesheet('soldier-idle',    `${sol}Soldier-Idle.png`,    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-walk',    `${sol}Soldier-Walk.png`,    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-attack1', `${sol}Soldier-Attack01.png`,{ frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-attack2', `${sol}Soldier-Attack02.png`,{ frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-attack3', `${sol}Soldier-Attack03.png`,{ frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-hurt',    `${sol}Soldier-Hurt.png`,    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('soldier-death',   `${sol}Soldier-Death.png`,   { frameWidth: 100, frameHeight: 100 });

    // Skeleton enemy animation sheets — all 32×32 frames
    this.load.spritesheet('skeleton-idle',   'assets/enemies/Enemy_Animations_Set/enemies-skeleton1_idle.png',        { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('skeleton-walk',   'assets/enemies/Enemy_Animations_Set/enemies-skeleton1_movement.png',    { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('skeleton-attack', 'assets/enemies/Enemy_Animations_Set/enemies-skeleton1_attack.png',      { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('skeleton-hit',    'assets/enemies/Enemy_Animations_Set/enemies-skeleton1_take_damage.png', { frameWidth: 32, frameHeight: 32 });

    // Coins/items atlas (32×32 grid) — previously coins.png, renamed to images.png
    this.load.spritesheet('icons', 'assets/ui/images.png', {
      frameWidth: 32, frameHeight: 32,
    });

    // Arrow projectile (32×32)
    this.load.image('arrow', 'assets/Characters(100x100)/Soldier/Arrow(projectile)/Arrow01(32x32).png');

    // Potions strip — 16 frames of 32×32 (pre-extracted from images.png row 17)
    this.load.spritesheet('potions', 'assets/ui/potions.png', {
      frameWidth: 32, frameHeight: 32,
    });

    // CrimsonFantasyGUI — HP бар (64×16 каждый фрейм, 20 фреймов: 0=полный, 19=пустой)
    const animBase = 'assets/ui/CrimsonFantasyGUI/AnimationSheets/';
    this.load.spritesheet('hp-bar',    animBase + 'CriticalDamage/CriticalDamage-Sheet.png',         { frameWidth: 64, frameHeight: 16 });
    this.load.spritesheet('hp-damage', animBase + 'MediumDamage/MediumDamage-Sheet.png',             { frameWidth: 64, frameHeight: 16 });
    this.load.spritesheet('hp-heal',   animBase + 'HealthRegeneration/LifeHealing-Sheet.png',        { frameWidth: 64, frameHeight: 16 });

    // Orc enemy — 100×100 frames (same pack as Soldier)
    const orc = 'assets/Characters(100x100)/Orc/Orc/';
    this.load.spritesheet('orc-idle',   `${orc}Orc-Idle.png`,      { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('orc-walk',   `${orc}Orc-Walk.png`,      { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('orc-attack', `${orc}Orc-Attack01.png`,  { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('orc-hit',    `${orc}Orc-Hurt.png`,      { frameWidth: 100, frameHeight: 100 });

    // Vampire enemy animation sheets — all 32×32 frames
    this.load.spritesheet('vampire-idle',   'assets/enemies/Enemy_Animations_Set/enemies-vampire_idle.png',        { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('vampire-walk',   'assets/enemies/Enemy_Animations_Set/enemies-vampire_movement.png',    { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('vampire-attack', 'assets/enemies/Enemy_Animations_Set/enemies-vampire_attack.png',      { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('vampire-hit',    'assets/enemies/Enemy_Animations_Set/enemies-vampire_take_damage.png', { frameWidth: 32, frameHeight: 32 });

    // Chest — 4 frames 16×16 (closed → open)
    this.load.spritesheet('chest', 'assets/props/chest_01.png', { frameWidth: 16, frameHeight: 16 });

    // Props: stair (peaks), torch
    const torchBase = 'assets/props/torch/torch_';
    this.load.image('_torch1', `${torchBase}1.png`);
    this.load.image('_torch2', `${torchBase}2.png`);
    this.load.image('_torch3', `${torchBase}3.png`);
    this.load.image('_torch4', `${torchBase}4.png`);
    const peaksBase = 'assets/props/peaks/peaks_';
    this.load.image('_peaks1', `${peaksBase}1.png`);
    this.load.image('_peaks2', `${peaksBase}2.png`);
    this.load.image('_peaks3', `${peaksBase}3.png`);
    this.load.image('_peaks4', `${peaksBase}4.png`);
  }

  create() {
    // ── Soldier (player) animations ──────────────────────
    this.anims.create({
      key: 'player-idle',
      frames: this.anims.generateFrameNumbers('soldier-idle', { start: 0, end: 5 }),
      frameRate: 8, repeat: -1,
    });
    this.anims.create({
      key: 'player-walk',
      frames: this.anims.generateFrameNumbers('soldier-walk', { start: 0, end: 7 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'player-attack1',
      frames: this.anims.generateFrameNumbers('soldier-attack1', { start: 0, end: 5 }),
      frameRate: 14, repeat: 0,
    });
    this.anims.create({
      key: 'player-attack2',
      frames: this.anims.generateFrameNumbers('soldier-attack2', { start: 0, end: 5 }),
      frameRate: 14, repeat: 0,
    });
    this.anims.create({
      key: 'player-attack3',
      frames: this.anims.generateFrameNumbers('soldier-attack3', { start: 0, end: 8 }),
      frameRate: 16, repeat: 0,
    });
    this.anims.create({
      key: 'player-hurt',
      frames: this.anims.generateFrameNumbers('soldier-hurt', { start: 0, end: 3 }),
      frameRate: 10, repeat: 0,
    });

    // ── Skeleton animations ──────────────────────────────
    this.anims.create({
      key: 'skeleton-idle-anim',
      frames: this.anims.generateFrameNumbers('skeleton-idle', { start: 0, end: 5 }),
      frameRate: 8, repeat: -1,
    });
    this.anims.create({
      key: 'skeleton-walk-anim',
      frames: this.anims.generateFrameNumbers('skeleton-walk', { start: 0, end: 9 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'skeleton-attack-anim',
      frames: this.anims.generateFrameNumbers('skeleton-attack', { start: 0, end: 8 }),
      frameRate: 12, repeat: 0,
    });
    this.anims.create({
      key: 'skeleton-hit-anim',
      frames: this.anims.generateFrameNumbers('skeleton-hit', { start: 0, end: 4 }),
      frameRate: 10, repeat: 0,
    });

    // ── Orc animations ──────────────────────────────────
    this.anims.create({
      key: 'orc-idle-anim',
      frames: this.anims.generateFrameNumbers('orc-idle', { start: 0, end: 5 }),
      frameRate: 8, repeat: -1,
    });
    this.anims.create({
      key: 'orc-walk-anim',
      frames: this.anims.generateFrameNumbers('orc-walk', { start: 0, end: 7 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'orc-attack-anim',
      frames: this.anims.generateFrameNumbers('orc-attack', { start: 0, end: 5 }),
      frameRate: 10, repeat: 0,
    });
    this.anims.create({
      key: 'orc-hit-anim',
      frames: this.anims.generateFrameNumbers('orc-hit', { start: 0, end: 3 }),
      frameRate: 10, repeat: 0,
    });

    // ── Vampire animations ───────────────────────────────
    this.anims.create({
      key: 'vampire-idle-anim',
      frames: this.anims.generateFrameNumbers('vampire-idle', { start: 0, end: 5 }),
      frameRate: 8, repeat: -1,
    });
    this.anims.create({
      key: 'vampire-walk-anim',
      frames: this.anims.generateFrameNumbers('vampire-walk', { start: 0, end: 7 }),
      frameRate: 10, repeat: -1,
    });
    this.anims.create({
      key: 'vampire-attack-anim',
      frames: this.anims.generateFrameNumbers('vampire-attack', { start: 0, end: 15 }),
      frameRate: 14, repeat: 0,
    });
    this.anims.create({
      key: 'vampire-hit-anim',
      frames: this.anims.generateFrameNumbers('vampire-hit', { start: 0, end: 4 }),
      frameRate: 10, repeat: 0,
    });

    // ── Torch texture — 4-frame spritesheet (16×16 each) ─
    const torchCanvas = this.textures.createCanvas('torch', 64, 16)!;
    const tctx = (torchCanvas.getSourceImage() as HTMLCanvasElement).getContext('2d')!;
    ['_torch1', '_torch2', '_torch3', '_torch4'].forEach((key, i) => {
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
      tctx.drawImage(src, i * 16, 0, 16, 16);
    });
    torchCanvas.add(0, 0,  0, 0, 16, 16);
    torchCanvas.add(1, 0, 16, 0, 16, 16);
    torchCanvas.add(2, 0, 32, 0, 16, 16);
    torchCanvas.add(3, 0, 48, 0, 16, 16);
    torchCanvas.refresh();

    this.anims.create({
      key: 'torch-anim',
      frames: this.anims.generateFrameNumbers('torch', { start: 0, end: 3 }),
      frameRate: 6, repeat: -1,
    });

    // ── Trap texture — peaks spritesheet (16×16 each) ───
    const trapCanvas = this.textures.createCanvas('trap', 64, 16)!;
    const sctx = (trapCanvas.getSourceImage() as HTMLCanvasElement).getContext('2d')!;
    ['_peaks4', '_peaks3', '_peaks2', '_peaks1'].forEach((key, i) => {
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
      sctx.drawImage(src, i * 16, 0, 16, 16);
    });
    sctx.clearRect(0, 14, 64, 2); // strip bottom 2 rows — artifact pixels
    trapCanvas.add(0, 0,  0, 0, 16, 16);
    trapCanvas.add(1, 0, 16, 0, 16, 16);
    trapCanvas.add(2, 0, 32, 0, 16, 16);
    trapCanvas.add(3, 0, 48, 0, 16, 16);
    trapCanvas.refresh();

    this.anims.create({
      key: 'trap-anim',
      frames: this.anims.generateFrameNumbers('trap', { start: 0, end: 3 }),
      frameRate: 8, repeat: 0,
    });


    this.anims.create({
      key: 'hp-damage-anim',
      frames: this.anims.generateFrameNumbers('hp-damage', { start: 0, end: 25 }),
      frameRate: 18, repeat: 0,
    });
    this.anims.create({
      key: 'hp-heal-anim',
      frames: this.anims.generateFrameNumbers('hp-heal', { start: 0, end: 12 }),
      frameRate: 14, repeat: 0,
    });

    // Сообщаем Яндексу что BootScene завершён — ready() вызовется когда оба флага выставлены
    (window as any).__bootDone = true;
    (window as any).__trySignalReady?.();

    this.scene.start('GameScene');
  }
}

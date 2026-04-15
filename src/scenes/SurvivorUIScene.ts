import Phaser from 'phaser';
import balance from '../data/balance.json';
import { t } from '../lang';

const GAME_W = 1280;
const GAME_H = 720;
const PAD    = 10;

// ── HP bar (same setup as UIScene) ───────────────────────────────────────────
const HP_SCALE       = 4;
const BAR_H          = 16 * HP_SCALE;  // 64px
const FILL_SRC_START = 16;
const FILL_SRC_W     = 48;
const FILL_SRC_H     = 16;

export class SurvivorUIScene extends Phaser.Scene {
  // HP bar
  private hpBarEmpty!:  Phaser.GameObjects.Sprite;
  private hpBarFill!:   Phaser.GameObjects.Sprite;
  private hpBarDamage!: Phaser.GameObjects.Sprite;
  private hpBarHeal!:   Phaser.GameObjects.Sprite;
  private hpCropW      = FILL_SRC_START + FILL_SRC_W;
  private hpText!:    Phaser.GameObjects.Text;
  private prevHp      = balance.player.hp;

  // Coin display
  private coinIcons!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private coinTexts!: [Phaser.GameObjects.Text,  Phaser.GameObjects.Text,  Phaser.GameObjects.Text];
  private coinY = 0;

  // Wave label (top center)
  private waveText!: Phaser.GameObjects.Text;

  // Intermission countdown + progress bar
  private intermissionText!: Phaser.GameObjects.Text;
  private timerBarBg!:   Phaser.GameObjects.Rectangle;
  private timerBarFill!: Phaser.GameObjects.Rectangle;
  private readonly TIMER_BAR_W = 300;
  private readonly TIMER_BAR_H = 8;

  // Stats panel (attack + armor)
  private statText!:  Phaser.GameObjects.Text;
  private statIcon!:  Phaser.GameObjects.Image;
  private armorText!: Phaser.GameObjects.Text;
  private armorIcon!: Phaser.GameObjects.Image;

  // Purchased item icons row (bottom center)
  private itemIconsRow: Phaser.GameObjects.Image[] = [];

  constructor() {
    super({ key: 'SurvivorUIScene' });
  }

  create() {
    // ── HP bar ────────────────────────────────────────────────
    this.hpBarEmpty = this.add.sprite(PAD, PAD, 'hp-bar', 19)
      .setScale(HP_SCALE).setOrigin(0, 0).setScrollFactor(0).setDepth(100);
    this.hpBarFill  = this.add.sprite(PAD, PAD, 'hp-bar', 0)
      .setScale(HP_SCALE).setOrigin(0, 0).setScrollFactor(0).setDepth(101);

    this.hpBarDamage = this.add.sprite(PAD, PAD, 'hp-damage', 0)
      .setScale(HP_SCALE).setOrigin(0, 0).setScrollFactor(0).setDepth(103)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.hpBarHeal = this.add.sprite(PAD, PAD, 'hp-heal', 0)
      .setScale(HP_SCALE).setOrigin(0, 0).setScrollFactor(0).setDepth(103)
      .setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    this.hpBarDamage.on('animationupdate',   () => this.hpBarDamage.setCrop(0, 0, this.hpCropW, FILL_SRC_H));
    this.hpBarHeal.on('animationupdate',     () => this.hpBarHeal.setCrop(0, 0, this.hpCropW, FILL_SRC_H));
    this.hpBarDamage.on('animationcomplete', () => this.hpBarDamage.setVisible(false));
    this.hpBarHeal.on('animationcomplete',   () => this.hpBarHeal.setVisible(false));

    this.hpText = this.add.text(PAD + 8 * HP_SCALE, PAD + BAR_H / 2, `${balance.player.hp}`, {
      fontSize: '14px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(104);

    // ── Coin display ──────────────────────────────────────────
    this.coinY = PAD + BAR_H + 6;
    const iconSz = 18;
    const bc = balance.coins;
    const coinFrames = [bc.redFrame, bc.goldFrame, bc.silverFrame] as const;
    this.coinIcons = coinFrames.map(frame =>
      this.add.image(0, 0, 'icons', frame)
        .setDisplaySize(iconSz, iconSz).setScrollFactor(0).setDepth(100).setVisible(false)
    ) as unknown as [Phaser.GameObjects.Image, Phaser.GameObjects.Image, Phaser.GameObjects.Image];
    this.coinTexts = coinFrames.map(() =>
      this.add.text(0, 0, '0', {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101).setVisible(false)
    ) as unknown as [Phaser.GameObjects.Text, Phaser.GameObjects.Text, Phaser.GameObjects.Text];

    // ── Wave label (top center) ───────────────────────────────
    this.waveText = this.add.text(GAME_W / 2, PAD, t().wave(1), {
      fontSize: '22px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
      backgroundColor: '#00000088', padding: { x: 10, y: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    this.intermissionText = this.add.text(GAME_W / 2, PAD + 46, '', {
      fontSize: '14px', color: '#ffdd88',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100).setVisible(false);

    // ── Intermission timer bar (below countdown text) ─────────
    const barY = PAD + 46 + 20 + this.TIMER_BAR_H / 2; // below text
    this.timerBarBg = this.add.rectangle(
      GAME_W / 2, barY,
      this.TIMER_BAR_W, this.TIMER_BAR_H,
      0x444444,
    ).setScrollFactor(0).setDepth(100).setVisible(false);
    this.timerBarFill = this.add.rectangle(
      GAME_W / 2 - this.TIMER_BAR_W / 2, barY,
      this.TIMER_BAR_W, this.TIMER_BAR_H,
      0x44cc88,
    ).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101).setVisible(false);

    // ── Stats panel (top-right, below wave label) ─────────────
    {
      const iconSz2 = 20;
      const iconX   = GAME_W - PAD - iconSz2 / 2;
      const textX   = iconX - iconSz2 / 2 - 4;
      const atkY    = PAD + iconSz2 / 2;
      const armY    = atkY + iconSz2 + 4;

      this.statIcon = this.add.image(iconX, atkY, 'icons', 670)
        .setDisplaySize(iconSz2, iconSz2).setScrollFactor(0).setDepth(100);
      this.statText = this.add.text(textX, atkY, `${balance.player.attack}`, {
        fontSize: '13px', fontStyle: 'bold', color: '#ffdd88',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(100);

      this.armorIcon = this.add.image(iconX, armY, 'icons', 1818)
        .setDisplaySize(iconSz2, iconSz2).setScrollFactor(0).setDepth(100);
      this.armorText = this.add.text(textX, armY, `${balance.player.armor}`, {
        fontSize: '13px', fontStyle: 'bold', color: '#aaddff',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(100);
    }

    // ── Listen to game events ─────────────────────────────────
    this.game.events.on('playerHpChanged',    this.onHpChanged,      this);
    this.game.events.on('coinsChanged',       this.onCoinsChanged,   this);
    this.game.events.on('waveChanged',        this.onWaveChanged,    this);
    this.game.events.on('waveCleared',        this.onWaveCleared,    this);
    this.game.events.on('intermissionTick',   this.onIntermission,   this);
    this.game.events.on('playerStatsChanged', this.onStatsChanged,   this);
    this.game.events.on('itemBought',         this.onItemBought,     this);

    this.events.once('shutdown', () => {
      this.game.events.off('playerHpChanged',    this.onHpChanged,     this);
      this.game.events.off('coinsChanged',       this.onCoinsChanged,  this);
      this.game.events.off('waveChanged',        this.onWaveChanged,   this);
      this.game.events.off('waveCleared',        this.onWaveCleared,   this);
      this.game.events.off('intermissionTick',   this.onIntermission,  this);
      this.game.events.off('playerStatsChanged', this.onStatsChanged,  this);
      this.game.events.off('itemBought',         this.onItemBought,    this);
    });
  }

  // ── Event handlers ────────────────────────────────────────

  private onHpChanged(current: number, max: number) {
    const pct    = Math.max(0, Math.min(1, current / max));
    this.hpCropW = FILL_SRC_START + FILL_SRC_W * pct;
    this.hpBarFill.setCrop(0, 0, this.hpCropW, FILL_SRC_H);
    this.hpBarDamage.setCrop(0, 0, this.hpCropW, FILL_SRC_H);
    this.hpBarHeal.setCrop(0, 0, this.hpCropW, FILL_SRC_H);
    this.hpText.setText(`${Math.round(current)}`);

    if (current < this.prevHp) {
      this.hpBarDamage.setVisible(true).play('hp-damage-anim', true);
    } else if (current > this.prevHp) {
      this.hpBarHeal.setVisible(true).play('hp-heal-anim', true);
    }
    this.prevHp = current;
  }

  private onCoinsChanged(total: number) {
    const bc = balance.coins;
    const counts = [
      Math.floor(total / bc.redValue),
      Math.floor((total % bc.redValue) / bc.goldValue),
      total % bc.goldValue,
    ];
    const ICON_SZ  = 18;
    const GAP      = 4;
    const TEXT_GAP = 2;
    let curX = PAD;
    const midY = this.coinY + ICON_SZ / 2;

    for (let i = 0; i < 3; i++) {
      const visible = counts[i] > 0;
      this.coinIcons[i].setVisible(visible);
      this.coinTexts[i].setVisible(visible);
      if (visible) {
        this.coinIcons[i].setPosition(curX + ICON_SZ / 2, midY);
        this.coinTexts[i].setText(String(counts[i])).setPosition(curX + ICON_SZ + TEXT_GAP, midY);
        curX += ICON_SZ + TEXT_GAP + this.coinTexts[i].width + GAP;
      }
    }
  }

  private onWaveChanged(wave: number) {
    this.waveText.setText(t().wave(wave));
    this.intermissionText.setVisible(false);
    this.timerBarBg.setVisible(false);
    this.timerBarFill.setVisible(false);
  }

  private onWaveCleared() {
    this.waveText.setText(t().waveCleared);
    this.intermissionText.setVisible(true);
    this.timerBarBg.setVisible(true);
    this.timerBarFill.setVisible(true);
  }

  private onIntermission(secsLeft: number, pct: number) {
    if (secsLeft > 0) {
      this.intermissionText.setText(t().nextWave(secsLeft));
    } else {
      this.intermissionText.setVisible(false);
    }
    // Shrink fill from full → empty as pct goes 1 → 0
    this.timerBarFill.setDisplaySize(this.TIMER_BAR_W * pct, this.TIMER_BAR_H);
  }

  private onStatsChanged(data: { attack: number; armor: number }) {
    this.statText?.setText(String(data.attack));
    this.armorText?.setText(String(data.armor));
  }

  private onItemBought(data: { frame: number }) {
    const SZ  = 24;
    const GAP = 4;
    const y   = GAME_H - SZ / 2 - 2;

    this.itemIconsRow.push(
      this.add.image(0, y, 'icons', data.frame)
        .setDisplaySize(SZ, SZ).setScrollFactor(0).setDepth(500).setAlpha(0.9)
    );

    const totalW = this.itemIconsRow.length * (SZ + GAP) - GAP;
    const x0     = GAME_W / 2 - totalW / 2;
    this.itemIconsRow.forEach((ic, i) => ic.setX(x0 + i * (SZ + GAP) + SZ / 2));
  }
}

import Phaser from 'phaser';
import balance from '../data/balance.json';
import { Room } from './DungeonGenerator';
import { TILE_S } from '../utils/constants';

export type StatKey = 'attack' | 'arrowDamage' | 'armor' | 'critMultiplier' | 'critChance' | 'maxHp';

const RARITY_NAMES  = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const RARITY_COLORS_HEX = ['#aaaaaa', '#44cc44', '#4488ff', '#cc44ff', '#ffaa00'];
const RARITY_COLORS_INT = [0xaaaaaa,  0x44cc44,  0x4488ff,  0xcc44ff,  0xffaa00];

export interface StatBonus {
  statKey: StatKey;
  value:   number;
}

export interface ShopItemInstance {
  statKey: StatKey;    // primary — drives icon + name
  rarity:  number;     // 0-4
  bonuses: StatBonus[]; // 1 bonus for C/U/R, 2 for Epic, 3 for Legendary
  price:   number;
  name:    string;
  frame:   number;
}

interface WorldItem {
  inst:   ShopItemInstance;
  sprite: Phaser.GameObjects.Image;
  card:   Phaser.GameObjects.Container;
  prompt: Phaser.GameObjects.Text;
  active: boolean;
}

const INTERACT_R = balance.shop.interactRadius;
const W = 135, H = 70;

// ── Icon & name pools per stat ────────────────────────────────────────────────

function fr(r: number, c: number) { return r * 16 + c; }
function frRange(r0: number, r1: number, c0 = 0, c1 = 15): number[] {
  const out: number[] = [];
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) out.push(fr(r, c));
  return out;
}

const ICON_POOLS: Record<StatKey, number[]> = {
  attack:         frRange(90, 91),
  arrowDamage:    [fr(92,8),fr(92,9),fr(92,10),fr(92,11),fr(94,9),fr(94,10),fr(94,11)],
  armor:          frRange(128, 129),
  critMultiplier: frRange(105, 106),
  critChance:     frRange(107, 108),
  maxHp:          frRange(32, 33),
};

const NAME_POOLS: Record<StatKey, string[]> = {
  attack:         ['Iron Blade','War Edge','Whetstone','Razorstone','Jagged Fang','Steel Grit','Crimson Edge','Battleclaw','Warbound','Tempered Shard'],
  arrowDamage:    ['Flint Tip','Barbed Shaft','Hawk Feather','Piercing Point','Iron Nock','Wind Splitter','Quiver Shard','Eagle Eye','Notched Arrow','Bolt Head'],
  armor:          ['Iron Scale','Stone Hide','Plate Rivet','Battle Coat','Bulwark','Tempered Shell','Ironclad','Shield Shard','Forged Guard','Warplate'],
  critMultiplier: ['Death Mark','Razor Will','Killing Edge','Battle Fury','Bloodlust','Slaughter Rune','Frenzy Stone','Vein Cutter','War Scar','Warlust'],
  critChance:     ['Lucky Charm','Fortune Dice','Gambler\'s Eye','Risk Token','Fate Shard','Cursed Coin','Omen Stone','Wild Card','Chaos Mark','Trickster Eye'],
  maxHp:          ['Roast Leg','Bread Loaf','Healing Herb','Dragon Egg','Life Mushroom','Berry Tart','Sacred Fruit','War Ration','Vital Stew','Blood Apple'],
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export class ShopSystem {
  private scene: Phaser.Scene;
  private items: WorldItem[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  spawnInRoom(room: Room): void {
    const s = balance.shop;
    const count = Phaser.Math.Between(s.itemCountMin, s.itemCountMax);

    const allKeys: StatKey[] = Object.keys(s.items) as StatKey[];
    const shuffledKeys = Phaser.Utils.Array.Shuffle([...allKeys]) as StatKey[];
    const quadrants    = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]).slice(0, count) as number[];

    for (let i = 0; i < quadrants.length; i++) {
      const q  = quadrants[i];
      const qx = q % 2;               // 0 = left half, 1 = right half
      const qy = Math.floor(q / 2);   // 0 = top half,  1 = bottom half

      // Center of quadrant in world px + small random offset
      const wx = (room.x + room.w * (qx * 0.5 + 0.25)) * TILE_S
               + Phaser.Math.Between(-TILE_S / 2, TILE_S / 2);
      const wy = (room.y + room.h * (qy * 0.5 + 0.25)) * TILE_S
               + Phaser.Math.Between(-TILE_S / 2, TILE_S / 2);

      const key  = shuffledKeys[i % shuffledKeys.length];
      const inst = this.rollItem(key);
      this.createWorldItem(wx, wy, inst);
    }
  }

  // ── Update — call every frame from GameScene ──────────────────────
  // Returns the purchased item if E was pressed while in range, else null.
  update(px: number, py: number, coinValue: number, eJustDown: boolean): ShopItemInstance | null {
    let purchased: ShopItemInstance | null = null;

    for (const item of this.items) {
      if (!item.active) continue;

      // Depth-sort icon with world objects (same as player/enemies use body.bottom)
      item.sprite.setDepth(item.sprite.y + 16);

      const dist    = Phaser.Math.Distance.Between(px, py, item.sprite.x, item.sprite.y);
      const inRange = dist < INTERACT_R;
      const canAfford = coinValue >= item.inst.price;

      item.prompt.setVisible(inRange);
      item.prompt.setText(canAfford ? 'Press E to buy' : `Need ${item.inst.price} silver`);
      item.prompt.setColor(canAfford ? '#ffffff' : '#ff6666');

      if (inRange && eJustDown && canAfford && !purchased) {
        purchased = item.inst;
        item.active = false;
        item.sprite.destroy();
        item.card.destroy();
        item.prompt.destroy();
      }
    }

    this.items = this.items.filter(i => i.active);
    return purchased;
  }

  destroy(): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.sprite.destroy();
      item.card.destroy();
      item.prompt.destroy();
    }
    this.items = [];
  }

  // ── Private ───────────────────────────────────────────────────────

  private rollItem(key: StatKey): ShopItemInstance {
    const s       = balance.shop;
    const itemDef = (s.items as Record<string, { name: string; frame: number; rarities: Array<{ min: number; max: number; price: number }> }>)[key];

    // Weighted rarity roll
    const weights = s.rarityWeights;
    const total   = weights.reduce((a, b) => a + b, 0);
    let rand      = Math.random() * total;
    let rarity    = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { rarity = i; break; }
    }

    const rar   = itemDef.rarities[rarity];
    const value = Phaser.Math.Between(rar.min, rar.max);
    const frame = pick(ICON_POOLS[key]);
    const name  = pick(NAME_POOLS[key]);

    // Build bonus list — Epic gets 2, Legendary gets 3 stats
    const bonusCount = rarity >= 4 ? 3 : rarity >= 3 ? 2 : 1;
    const bonuses: StatBonus[] = [{ statKey: key, value }];

    if (bonusCount > 1) {
      const allKeys: StatKey[] = ['attack','arrowDamage','armor','critMultiplier','critChance','maxHp'];
      const extras = Phaser.Utils.Array.Shuffle(
        allKeys.filter(k => !bonuses.some(b => b.statKey === k))
      ) as StatKey[];
      for (let i = 0; i < bonusCount - 1 && i < extras.length; i++) {
        const ek    = extras[i];
        const eDef  = (s.items as Record<string, { rarities: Array<{ min: number; max: number; price: number }> }>)[ek];
        const eTier = eDef.rarities[0]; // Common tier values for secondary bonuses
        bonuses.push({ statKey: ek, value: Phaser.Math.Between(eTier.min, eTier.max) });
      }
    }

    return { statKey: key, rarity, bonuses, price: rar.price, name, frame };
  }

  private createWorldItem(wx: number, wy: number, inst: ShopItemInstance): void {
    const scene  = this.scene;
    const iconSz = 32;

    // World sprite — floating icon
    const sprite = scene.add.image(wx, wy, 'icons', inst.frame)
      .setDisplaySize(iconSz, iconSz)
      .setDepth(400);

    scene.tweens.add({
      targets:  sprite,
      y:        wy - 8,
      duration: 1000,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.InOut',
    });

    // Card container — always above player/enemies
    const card = this.buildCard(inst);
    card.setPosition(wx, wy - iconSz / 2 - 6).setDepth(1000);

    // Prompt text — always above player/enemies
    const prompt = scene.add.text(wx, wy + iconSz / 2 + 4, 'Press E to buy', {
      fontSize: '13px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
      resolution: 4,
    }).setOrigin(0.5, 0).setDepth(1000).setVisible(false);

    this.items.push({ inst, sprite, card, prompt, active: true });
  }

  private buildCard(inst: ShopItemInstance): Phaser.GameObjects.Container {
    const s    = this.scene;
    const col  = RARITY_COLORS_INT[inst.rarity];
    const colH = RARITY_COLORS_HEX[inst.rarity];
    const LINE  = 13; // px between bonus lines
    const cardH = H + (inst.bonuses.length - 1) * LINE;

    const bg = s.add.rectangle(0, 0, W, cardH, 0x111111, 0.75).setOrigin(0.5, 1);
    const border = s.add.rectangle(0, 0, W, cardH).setOrigin(0.5, 1)
      .setStrokeStyle(1.5, col).setFillStyle(0, 0);

    const iconImg = s.add.image(-W / 2 + 13, -cardH + 30, 'icons', inst.frame)
      .setDisplaySize(20, 20).setOrigin(0.5, 0.5);

    const tx = -W / 2 + 28;

    const nameText = s.add.text(tx, -cardH + 5, inst.name, {
      fontSize: '11px', fontStyle: 'bold', color: '#ffffff', resolution: 4,
    }).setOrigin(0, 0);

    const rarText = s.add.text(tx, -cardH + 20, RARITY_NAMES[inst.rarity], {
      fontSize: '10px', fontStyle: 'bold', color: colH, resolution: 4,
    }).setOrigin(0, 0);

    // One line per bonus
    const bonusObjs: Phaser.GameObjects.Text[] = inst.bonuses.map((b, i) =>
      s.add.text(tx, -cardH + 34 + i * LINE, this.formatBonus(b), {
        fontSize: '10px', fontStyle: 'bold', color: '#ffffff', resolution: 4,
      }).setOrigin(0, 0)
    );

    // Price row
    const bc      = balance.coins;
    const reds    = Math.floor(inst.price / 100);
    const golds   = Math.floor((inst.price % 100) / 10);
    const silvers = inst.price % 10;
    const groups: Array<{ frame: number; count: number }> = [];
    if (reds    > 0) groups.push({ frame: bc.redFrame,    count: reds });
    if (golds   > 0) groups.push({ frame: bc.goldFrame,   count: golds });
    if (silvers > 0) groups.push({ frame: bc.silverFrame, count: silvers });

    const priceChildren: Phaser.GameObjects.GameObject[] = [];
    let cx = -W / 2 + 6;
    for (const g of groups) {
      const icon = s.add.image(cx, -9, 'icons', g.frame).setDisplaySize(14, 14).setOrigin(0, 0.5);
      const txt  = s.add.text(cx + 16, -16, String(g.count), {
        fontSize: '11px', fontStyle: 'bold', color: '#dddddd', resolution: 4,
      }).setOrigin(0, 0);
      priceChildren.push(icon, txt);
      cx += 16 + txt.width + 4;
    }

    return s.add.container(0, 0, [bg, border, iconImg, nameText, rarText, ...bonusObjs, ...priceChildren]);
  }

  private formatBonus(b: StatBonus): string {
    switch (b.statKey) {
      case 'attack':         return `+${b.value} sword damage`;
      case 'arrowDamage':    return `+${b.value} arrow damage`;
      case 'armor':          return `+${b.value} armor`;
      case 'critMultiplier': return `+${b.value}% crit damage`;
      case 'critChance':     return `+${b.value}% crit chance`;
      case 'maxHp':          return `+${b.value} max hp`;
    }
  }
}

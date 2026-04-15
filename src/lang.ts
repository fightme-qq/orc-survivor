// Определяем язык один раз при старте
function detectLang(): 'ru' | 'en' {
  // URL-параметр ?lang=ru для локального тестирования
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang === 'ru') return 'ru';
  if (urlLang === 'en') return 'en';
  try {
    const ysdk = (window as any).ysdk;
    if (ysdk?.environment?.i18n?.lang) {
      const l = ysdk.environment.i18n.lang as string;
      if (['ru', 'be', 'kk', 'uk', 'uz'].includes(l)) return 'ru';
      return 'en';
    }
  } catch {}
  // Fallback на браузер только если SDK недоступен
  return navigator.language.startsWith('ru') ? 'ru' : 'en';
}

export let LANG: 'ru' | 'en' = detectLang();

// Перезагрузить язык после инициализации SDK
export function refreshLang(): void {
  LANG = detectLang();
}

// ── Строки ────────────────────────────────────────────────────────────────────

const STRINGS = {
  en: {
    gameOver:       'GAME OVER',
    clickRestart:   'Click to restart',
    floor:          (n: number) => `Floor ${n}`,
    wave:           (n: number) => `Wave ${n}`,
    waveCleared:    'Wave cleared!',
    nextWave:       (s: number) => `Next wave in ${s}s...`,
    pressEBuy:      'Press E to buy',
    needSilver:     (n: number) => `Need ${n} silver`,

    rarities: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'],

    statBonus: {
      attack:         (v: number) => `+${v} sword damage`,
      arrowDamage:    (v: number) => `+${v} arrow damage`,
      armor:          (v: number) => `+${v} armor`,
      critMultiplier: (v: number) => `+${v}% crit damage`,
      critChance:     (v: number) => `+${v}% crit chance`,
      maxHp:          (v: number) => `+${v} max hp`,
    },

    itemNames: {
      attack:         ['Iron Blade','War Edge','Whetstone','Razorstone','Jagged Fang','Steel Grit','Crimson Edge','Battleclaw','Warbound','Tempered Shard'],
      arrowDamage:    ['Flint Tip','Barbed Shaft','Hawk Feather','Piercing Point','Iron Nock','Wind Splitter','Quiver Shard','Eagle Eye','Notched Arrow','Bolt Head'],
      armor:          ['Iron Scale','Stone Hide','Plate Rivet','Battle Coat','Bulwark','Tempered Shell','Ironclad','Shield Shard','Forged Guard','Warplate'],
      critMultiplier: ['Death Mark','Razor Will','Killing Edge','Battle Fury','Bloodlust','Slaughter Rune','Frenzy Stone','Vein Cutter','War Scar','Warlust'],
      critChance:     ['Lucky Charm','Fortune Dice','Gambler\'s Eye','Risk Token','Fate Shard','Cursed Coin','Omen Stone','Wild Card','Chaos Mark','Trickster Eye'],
      maxHp:          ['Roast Leg','Bread Loaf','Healing Herb','Dragon Egg','Life Mushroom','Berry Tart','Sacred Fruit','War Ration','Vital Stew','Blood Apple'],
    },
  },

  ru: {
    gameOver:       'ИГРА ОКОНЧЕНА',
    clickRestart:   'Нажмите для перезапуска',
    floor:          (n: number) => `Этаж ${n}`,
    wave:           (n: number) => `Волна ${n}`,
    waveCleared:    'Волна пройдена!',
    nextWave:       (s: number) => `Следующая волна через ${s}с...`,
    pressEBuy:      'E — купить',
    needSilver:     (n: number) => `Нужно ${n} серебра`,

    rarities: ['Обычный', 'Необычный', 'Редкий', 'Эпический', 'Легендарный'],

    statBonus: {
      attack:         (v: number) => `+${v} урон мечом`,
      arrowDamage:    (v: number) => `+${v} урон стрелой`,
      armor:          (v: number) => `+${v} броня`,
      critMultiplier: (v: number) => `+${v}% крит урон`,
      critChance:     (v: number) => `+${v}% шанс крита`,
      maxHp:          (v: number) => `+${v} макс HP`,
    },

    itemNames: {
      attack:         ['Железный клинок','Боевое лезвие','Точильный камень','Бритвенный камень','Зубчатый клык','Стальная крошка','Алый клинок','Боевой коготь','Военный нож','Калёный осколок'],
      arrowDamage:    ['Кремнёвый наконечник','Зазубренное древко','Перо ястреба','Пробивной наконечник','Железное ушко','Рассекатель ветра','Осколок колчана','Орлиный глаз','Надрезанная стрела','Наконечник болта'],
      armor:          ['Железная чешуя','Каменная шкура','Заклёпка брони','Боевой плащ','Оплот','Калёная скорлупа','Железный доспех','Осколок щита','Кованая стража','Военный доспех'],
      critMultiplier: ['Знак смерти','Воля клинка','Режущий край','Боевое неистовство','Кровожадность','Руна бойни','Камень ярости','Вскрыватель вен','Боевой шрам','Жажда войны'],
      critChance:     ['Счастливый амулет','Кости удачи','Глаз игрока','Жетон риска','Осколок судьбы','Проклятая монета','Камень предзнаменования','Дикая карта','Знак хаоса','Глаз трикстера'],
      maxHp:          ['Жареная ножка','Буханка хлеба','Целебная трава','Яйцо дракона','Жизненный гриб','Ягодный пирог','Священный плод','Военный паёк','Жизненное рагу','Кровяное яблоко'],
    },
  },
} as const;

type Lang = typeof STRINGS['en'];

function t(): Lang {
  return STRINGS[LANG] as unknown as Lang;
}

export { t };

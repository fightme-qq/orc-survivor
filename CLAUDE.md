# Dungeon Crawler — Phaser 3

## Что это
2D top-down dungeon crawler на Phaser 3. Реалтайм движение и боёвка.
Процедурная генерация комнат. Один этаж = несколько комнат + коридоры.
Убил врагов → нашёл лестницу → следующий этаж.

## Стек
- Phaser 3 (движок)
- TypeScript
- Vite (сборка)
- Ассеты: Pixel_Poem "2D Pixel Dungeon Asset Pack" (16x16 пиксели)

## Структура проекта
src/
  scenes/          — BootScene (загрузка), GameScene (геймплей), UIScene (HUD)
  entities/        — Player.ts, BaseEnemy.ts, конкретные враги (Skeleton, Vampire, Orc)
  systems/         — DungeonGenerator, EnemySpawner, TrapSystem, LootSystem, AttackResolver
  utils/           — helpers, constants, combat.ts
  data/            — balance.json (ВСЯ числовая балансировка тут)
public/
  assets/
    tiles/         — тайлсеты (пол, стены)
    characters/    — спрайты игрока
    enemies/       — спрайты врагов
    props/         — объекты (сундуки, факелы, лестницы)
    ui/            — элементы интерфейса

## Размер тайла
16x16 пикселей. Масштаб отображения x3 (48px на экране).
Всё кратно 16.

## Ассеты Pixel_Poem — ВАЖНО
- Кадры анимаций в ОТДЕЛЬНЫХ файлах (не спрайтшиты!)
- Загрузка: используй Phaser spritesheet ИЛИ собери кадры в atlas
- Имена файлов: {action}_{direction}_{frame}.png
- Перед работой с ассетами — прочитай содержимое public/assets/ и разберись в именовании

## Depth Sorting (заход за объекты) — КРИТИЧЕСКИ ВАЖНО
Это ГЛАВНАЯ визуальная механика. Игрок должен корректно заходить
за объекты (столбы, сундуки, пропсы):

1. Все спрайты (игрок, враги, пропсы) используют depth = sprite.y + sprite.height
2. В каждом update() вызывай: sprite.setDepth(sprite.y + sprite.height)
3. Стены и пол — фиксированная глубина (стены = 0, пол = -1)
4. Объекты с "телом" (сундуки, столбы): коллайдер только на нижнюю часть
5. НИКОГДА не ставь фиксированный depth на движущиеся объекты

## Коллизии
- Стены: полный тайл 16x16, body на весь тайл
- Пропсы (сундуки, столбы): body ТОЛЬКО на нижнюю половину (8px)
  Это позволяет игроку визуально заходить ЗА объект сверху
- Игрок: body меньше спрайта — примерно 10x8, смещён к ногам
- Враги: аналогично игроку

## Балансировка
ВСЯ числовая балансировка в data/balance.json:
- player: speed, hp, attack, defense
- enemies: {type}: hp, attack, defense, speed, aggroRange
- dungeon: roomMin, roomMax, roomSizeMin, roomSizeMax
- НИКОГДА не хардкодить цифры в коде

## Боёвка
- Реалтайм, но простая: нажал Space/ЛКМ = удар в направлении взгляда
- Удар — хитбокс перед игроком на 1 фрейм
- Враги атакуют при контакте или на расстоянии 1 тайла
- Формула урона: DamageTaken = BaseDamage / (1 + Armor / 100)
  - Функция calcDamage(baseDamage, armor) — только в src/utils/combat.ts
  - defense в balance.json = Armor в формуле
- Knockback при получении урона (маленький отброс)
- Неуязвимость 0.5 сек после получения урона

## Команды
- npm run dev — запуск дев-сервера
- npm run build — сборка

## Архитектура систем — ОБЯЗАТЕЛЬНО СОБЛЮДАТЬ

### GameScene — тонкий оркестратор
GameScene только создаёт и соединяет системы. Вся логика — в отдельных классах.
НЕ добавляй бизнес-логику прямо в GameScene.

### Добавление нового врага
1. Создать `src/entities/NewEnemy.ts` — extends BaseEnemy
2. В конструкторе вызвать `this.setupAnimations('prefix')`
3. Добавить запись в `SPAWN_TABLE` в `EnemySpawner.ts` (одна строка: ctor + weight + minFloor)
4. Добавить секцию в `balance.json` с ТОЛЬКО числами (hp, armor, speed, spawnWeight и т.д.)
5. Загрузить спрайты в `BootScene.ts`, зарегистрировать анимации
6. Уникальная механика врага — ТОЛЬКО внутри его класса (override preUpdate или новый метод)

### BaseEnemy — расширяемая база
- `setupAnimations(prefix)` — стандартное именование анимаций для всех врагов
- `takeDamage`, `setPlayer`, `setTiles`, `setRoom` — общий контракт, не ломать
- Уникальное поведение: переопределяй `preUpdate` с вызовом `super.preUpdate(time, delta)`
- Уникальные атаки (дистанционные, AOE, спавн миньонов): добавляй в подкласс, не в BaseEnemy

### EnemySpawner — weight-based таблица
- `SPAWN_TABLE` — единственное место где перечислены все типы врагов
- `weight` — относительный вес (не проценты), `minFloor` — с какого этажа появляется
- НЕ добавляй if-цепочки или switch по типу врага

### FSM в BaseEnemy — таймер как инвариант
- Состояния: PATROL → CHASE → ATTACK → HIT → RETURN
- Смена состояний ТОЛЬКО через `enterState()`
- НЕ используй boolean-флаги для состояний — используй таймеры и числа (-1 как sentinel)

### Системы
- TrapSystem — вся логика ловушек (спавн паттернов, апдейт, урон)
- LootSystem — монеты и любой будущий лут (предметы, зелья)
- AttackResolver — хит-детекция и расчёт урона для всех атак игрока
- Новая механика = новый файл в src/systems/, не расширение GameScene

## АНТИПАТТЕРНЫ — НЕ ДЕЛАЙ ТАК
- НЕ используй Phaser physics groups для depth sorting
- НЕ ставь фиксированный setDepth() на движущиеся объекты
- НЕ делай body на весь спрайт для пропсов
- НЕ переписывай файлы целиком при мелких изменениях
- НЕ добавляй новые npm-зависимости без спроса
- НЕ меняй структуру папок без спроса
- НЕ хардкодь числа — только через balance.json
- НЕ пиши логику врага в GameScene или EnemySpawner — только в классе врага
- НЕ добавляй if/switch по типу врага нигде кроме SPAWN_TABLE

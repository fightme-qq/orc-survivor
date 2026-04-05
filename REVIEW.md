# Ревью проекта — Dungeon Crawler (29.03.2026)

## TypeScript / Build
```
npx tsc --noEmit → 0 ошибок
npm run dev      → OK, сервер стартует
```

---

## Что работает

- **BSP-генерация подземелий** — комнаты, коридоры, flood-fill связность, BFS для лестницы
- **Движение игрока** — WASD + стрелки, нормализация диагонали, flip по направлению
- **Анимации игрока** — 4-кадровая idle/walk через canvas-атлас из individual PNG
- **Анимации скелета** — idle, walk, attack, hit (spritesheet, 4 ключа)
- **ИИ скелета** — aggro range, преследование, атака, flip к игроку
- **Боёвка** — Space/ЛКМ, hitbox перед игроком, calcDamage по формуле CLAUDE.md
- **Knockback** — у игрока и врагов, временная неуязвимость с миганием
- **HP-бар врага** — появляется после первого удара, плавает над спрайтом, depth-сортировка
- **HP-бар игрока** — изменяет цвет по порогам (зелёный / жёлтый / красный)
- **Depth sorting** — `y + displayHeight` в update для игрока, в preUpdate для врагов
- **Миникарта** — fog-of-war, два слоя (explored dim / visible bright), враги в радиусе 8
- **Переходы между этажами** — HP и floor сохраняются в registry, UIScene перезапускается
- **Game Over** — экран, рестарт по клику или R

---

## Что сломано или недоделано

### Критично
1. **Стены визуально неточные** — `getWallFrame()` использует только 4 типа (top/left/right/fill), но угловые тайлы (NW, NE, SW, SE) все получают `FRAME_WALL_FILL`. Визуально выглядит неплохо, но не использует угловые тайлы из тайлсета.

2. **`knockbackForce * 3` хардкод** — в двух местах `GameScene.ts:261,291`. Значение `knockbackForce` в balance.json уже выставлено с учётом этого множителя — получается двойная балансировка.

3. **Инвинсибилити врага хардкод** — `BaseEnemy.ts:104` → `this.invincibilityTimer = 500` — должно быть в balance.json.

4. **`playerKnockTimer = 150` хардкод** — `GameScene.ts:296` — должно быть в balance.json.

5. **`MAX_ENEMIES_PER_ROOM = 5` хардкод** — `GameScene.ts:42` — максимум врагов в комнате должен быть в `balance.dungeon`.

6. **`HIT_SIZE = 40`, `HIT_OFFSET = 38` хардкод** — параметры хитбокса атаки не в balance.json.

### Архитектура (по CLAUDE.md)
7. **`Player.ts` отсутствует** — CLAUDE.md требует `entities/Player.ts`. Вся логика игрока живёт прямо в `GameScene.ts` (~160 строк). При добавлении новых механик (инвентарь, способности) это станет проблемой.

8. **`CombatSystem.ts` и `TurnManager.ts` отсутствуют** — упомянуты в CLAUDE.md как `systems/`, не созданы. Боёвка размазана между GameScene и BaseEnemy.

9. **`src/utils/` содержит только `combat.ts`** — нет `constants.ts` (TILE, SCALE, TILE_S определены прямо в GameScene).

### Мелкие проблемы
10. **UIScene захардкодила `800` и `600`** — `UIScene.ts:12,13` → `const MM_X = 800 - PAD - MM_W` и т.д. Должно быть через `this.scale.width/height` или константы.

11. **`BAR_W = 36`, `BAR_H = 4` хардкод** — `BaseEnemy.ts:3-4` — не критично, но нарушает правило.

12. **Лестница — заглушка** — рисуется программно в BootScene (жёлтый прямоугольник). В `public/assets/props/` есть реальные ассеты (chest, torch, peaks и др.).

13. **`REVEAL_RADIUS = 5`, `ENEMY_VISION = 8` хардкод** — `UIScene.ts:15-16` — UI параметры вне balance.json.

14. **`isEdgeWall` проверяет 8 направлений** (включая диагонали) — из-за этого диагональные стены в коридорных углах тоже становятся edge wall и рендерятся тайлом. Это может создавать одиночные тайлы в углах без физического тела (они через `isEdgeWall`, но коллизия для диагональных стен не нужна).

---

## Что почистить / рефакторить

| Что | Где | Приоритет |
|-----|-----|-----------|
| Вынести `knockbackForce * 3` в balance.json | GameScene, BaseEnemy | Высокий |
| Вынести `invincibilityTimer 500`, `playerKnockTimer 150` в balance.json | BaseEnemy, GameScene | Высокий |
| Вынести `HIT_SIZE`, `HIT_OFFSET`, `MAX_ENEMIES_PER_ROOM` в balance.json | GameScene | Высокий |
| TILE, SCALE, TILE_S → `src/utils/constants.ts` | GameScene | Средний |
| UIScene: заменить `800`/`600` на `this.scale.width/height` | UIScene | Средний |
| Создать `Player.ts` — вынести логику игрока из GameScene | GameScene | Средний |

---

## Что дальше по приоритету

### P1 — Исправить нарушения CLAUDE.md (хардкод)
Вынести все числа в balance.json. Это быстро, без риска.

### P2 — Контент и геймплей
- Реальный спрайт лестницы из `public/assets/props/peaks/` или `chest/`
- Факелы/декор на стенах (`torch/`)
- Второй тип врага (vampire, skeleton2 — ассеты уже есть в `characters/monsters_idle/`)

### P3 — Архитектура
- Вынести игрока в `Player.ts`
- `src/utils/constants.ts` для TILE/SCALE/TILE_S

### P4 — Полировка визуала
- Угловые wall-тайлы (NW/NE/SW/SE frames из тайлсета)
- Анимация атаки игрока (сейчас нет — только idle 4 кадра, использовались как walk)
- Экран смерти / победы с нормальным UI

### P5 — Механики
- Сундуки (pickup, drop loot)
- Несколько этажей с нарастающей сложностью (уже частично работает через `floor`)
- Звуки (Web Audio / Phaser Sound)

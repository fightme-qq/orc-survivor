import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { refreshLang } from './lang';

declare const YaGames: { init(): Promise<any> } | undefined;

// Yandex SDK — инициализируем до старта игры, но не блокируем его
(async () => {
  try {
    if (typeof YaGames !== 'undefined') {
      const ysdk = await YaGames.init();
      (window as any).ysdk = ysdk;
      refreshLang(); // язык известен только после init()
    }
  } catch {
    // SDK недоступен (локальная разработка) — продолжаем без него
  }
})();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#2a2a2a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [BootScene, GameScene, UIScene]
};

new Phaser.Game(config);

import Phaser from 'phaser';
import balance from '../data/balance.json';
import { generateDungeon, isEdgeWall, TILE_FLOOR, TILE_STAIR } from '../systems/DungeonGenerator';
import { Skeleton } from '../entities/Skeleton';

const TILE = 16;
const SCALE = 3;
const TILE_S = TILE * SCALE; // 48px on screen

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemies!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    const dungeon = generateDungeon();
    const { tiles, width, height, playerStart, stairPos } = dungeon;

    this.walls = this.physics.add.staticGroup();
    this.enemies = this.physics.add.group();

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const t = tiles[row][col];
        const x = col * TILE_S + TILE_S / 2;
        const y = row * TILE_S + TILE_S / 2;

        if (t === TILE_FLOOR || t === TILE_STAIR) {
          const key = t === TILE_STAIR ? 'stair' : 'floor';
          const img = this.add.image(x, y, key);
          img.setScale(SCALE);
          img.setDepth(-1);
        } else if (isEdgeWall(tiles, col, row)) {
          const wall = this.walls.create(x, y, 'wall') as Phaser.Physics.Arcade.Sprite;
          wall.setScale(SCALE);
          wall.setDepth(0);
          wall.refreshBody();
        }
      }
    }

    // Spawn player at center of first room
    const px = playerStart.x * TILE_S + TILE_S / 2;
    const py = playerStart.y * TILE_S + TILE_S / 2;
    this.player = this.physics.add.sprite(px, py, 'player');
    this.player.setScale(SCALE);
    // Body: 10x8, offset to feet
    this.player.body!.setSize(10, 8);
    this.player.body!.setOffset(3, 8);

    // Spawn enemies in all rooms except the first (player spawn)
    const { min: eMin, max: eMax } = balance.dungeon.enemiesPerRoom;
    for (let i = 1; i < dungeon.rooms.length; i++) {
      const room = dungeon.rooms[i];
      const count = Phaser.Math.Between(eMin, eMax);
      for (let e = 0; e < count; e++) {
        const col = Phaser.Math.Between(room.x + 1, room.x + room.w - 2);
        const row = Phaser.Math.Between(room.y + 1, room.y + room.h - 2);
        const ex = col * TILE_S + TILE_S / 2;
        const ey = row * TILE_S + TILE_S / 2;
        const skeleton = new Skeleton(this, ex, ey);
        skeleton.setPlayer(this.player);
        this.enemies.add(skeleton);
      }
    }

    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.enemies, this.walls);
    this.physics.add.collider(this.enemies, this.enemies);

    // Camera
    const mapW = width  * TILE_S;
    const mapH = height * TILE_S;
    this.cameras.main.setBounds(0, 0, mapW, mapH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.scene.launch('UIScene');
  }

  update() {
    const speed = balance.player.speed;
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown  || this.wasd.left.isDown)  vx = -speed;
    else if (this.cursors.right.isDown || this.wasd.right.isDown) vx = speed;

    if (this.cursors.up.isDown   || this.wasd.up.isDown)   vy = -speed;
    else if (this.cursors.down.isDown  || this.wasd.down.isDown)  vy = speed;

    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }

    body.setVelocity(vx, vy);

    // Depth sorting
    this.player.setDepth(this.player.y + this.player.displayHeight);
  }
}

import balance from '../data/balance.json';

export const TILE_WALL  = 0;
export const TILE_FLOOR = 1;
export const TILE_STAIR = 2;

export interface Room {
  x: number; // tile col of top-left interior
  y: number; // tile row of top-left interior
  w: number; // width in tiles (interior)
  h: number; // height in tiles (interior)
}

export interface DungeonMap {
  tiles: number[][];
  width: number;
  height: number;
  rooms: Room[];
  playerStart: { x: number; y: number }; // tile coords
  stairPos:    { x: number; y: number }; // tile coords
}

const MAP_W = 64;
const MAP_H = 64;

function rndInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roomsOverlap(a: Room, b: Room, margin = 1): boolean {
  return (
    a.x - margin < b.x + b.w + margin &&
    a.x + a.w + margin > b.x - margin &&
    a.y - margin < b.y + b.h + margin &&
    a.y + a.h + margin > b.y - margin
  );
}

function carveRoom(tiles: number[][], room: Room) {
  for (let row = room.y; row < room.y + room.h; row++) {
    for (let col = room.x; col < room.x + room.w; col++) {
      tiles[row][col] = TILE_FLOOR;
    }
  }
}

function center(room: Room): { cx: number; cy: number } {
  return {
    cx: Math.floor(room.x + room.w / 2),
    cy: Math.floor(room.y + room.h / 2),
  };
}

function carveCorridor(tiles: number[][], r1: Room, r2: Room) {
  const { cx: x1, cy: y1 } = center(r1);
  const { cx: x2, cy: y2 } = center(r2);

  // Horizontal then vertical (L-shape)
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  for (let col = minX; col <= maxX; col++) {
    tiles[y1][col] = TILE_FLOOR;
  }
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (let row = minY; row <= maxY; row++) {
    tiles[row][x2] = TILE_FLOOR;
  }
}

export function generateDungeon(): DungeonMap {
  const { roomMin, roomMax, roomSizeMin, roomSizeMax } = balance.dungeon;

  // Init all tiles as wall
  const tiles: number[][] = Array.from({ length: MAP_H }, () =>
    new Array(MAP_W).fill(TILE_WALL)
  );

  const rooms: Room[] = [];
  const targetCount = rndInt(roomMin, roomMax);

  for (let attempt = 0; rooms.length < targetCount; attempt++) {
    if (attempt > targetCount * 100) break;

    const w = rndInt(roomSizeMin, roomSizeMax);
    const h = rndInt(roomSizeMin, roomSizeMax);
    // Leave 1-tile border for walls
    const x = rndInt(1, MAP_W - w - 2);
    const y = rndInt(1, MAP_H - h - 2);

    const candidate: Room = { x, y, w, h };
    if (rooms.some(r => roomsOverlap(r, candidate))) continue;

    carveRoom(tiles, candidate);
    rooms.push(candidate);
  }

  // Connect rooms with L-corridors in order
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(tiles, rooms[i - 1], rooms[i]);
  }

  // Stair in center of last room
  const lastRoom = rooms[rooms.length - 1];
  const { cx: sx, cy: sy } = center(lastRoom);
  tiles[sy][sx] = TILE_STAIR;

  const { cx: px, cy: py } = center(rooms[0]);

  return {
    tiles,
    width: MAP_W,
    height: MAP_H,
    rooms,
    playerStart: { x: px, y: py },
    stairPos:    { x: sx, y: sy },
  };
}

/** Returns true if a wall tile borders at least one floor tile (for rendering) */
export function isEdgeWall(tiles: number[][], col: number, row: number): boolean {
  if (tiles[row][col] !== TILE_WALL) return false;
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dc, dr] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < tiles.length && nc >= 0 && nc < tiles[0].length) {
      if (tiles[nr][nc] !== TILE_WALL) return true;
    }
  }
  return false;
}

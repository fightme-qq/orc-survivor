import { TILE_WALL } from '../systems/DungeonGenerator';

/**
 * BFS on tile grid. Returns world-coords of the NEXT tile to step onto
 * (one step from `from` toward `to`), or null if no path / already adjacent.
 */
export function nextStep(
  tiles: number[][],
  fromTileX: number, fromTileY: number,
  toTileX:   number, toTileY:   number,
  tileS: number,
): { x: number; y: number } | null {
  const H = tiles.length;
  const W = tiles[0].length;
  const start = fromTileY * W + fromTileX;
  const goal  = toTileY   * W + toTileX;
  if (start === goal) return null;

  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const visited = new Uint8Array(W * H);
  const parent  = new Int32Array(W * H).fill(-1);
  const queue: number[] = [start];
  visited[start] = 1;

  let found = false;
  let head = 0;
  outer: while (head < queue.length) {
    const cur = queue[head++];
    const cy = Math.floor(cur / W);
    const cx = cur % W;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (tiles[ny][nx] === TILE_WALL) continue;
      const nk = ny * W + nx;
      if (visited[nk]) continue;
      visited[nk] = 1;
      parent[nk] = cur;
      if (nk === goal) { found = true; break outer; }
      queue.push(nk);
    }
  }

  if (!found) return null;

  // Trace back to the first step after `start`
  let cur = goal;
  while (parent[cur] !== start) {
    const p = parent[cur];
    if (p === -1) return null;
    cur = p;
  }

  return {
    x: (cur % W) * tileS + tileS / 2,
    y: Math.floor(cur / W) * tileS + tileS / 2,
  };
}

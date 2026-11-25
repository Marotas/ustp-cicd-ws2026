export const COLUMNS = 10;
export const ROWS = 20;
export const UPCOMING_SIZE = 6;

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Matrix = number[][];
export type Piece = { type: PieceType; matrix: Matrix; x: number; y: number };
export type Board = (PieceType | null)[][];

export const SHAPES: Record<PieceType, Matrix> = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
};

export const LINE_REWARDS = [0, 100, 300, 500, 800];

export function createBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<PieceType | null>(COLUMNS).fill(null));
}

export function createPiece(type: PieceType): Piece {
  const matrix = SHAPES[type].map((row) => [...row]);
  return { type, matrix, x: Math.floor((COLUMNS - matrix[0].length) / 2), y: 0 };
}

export function rotate(matrix: Matrix): Matrix {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]).reverse());
}

export function collision(board: Board, piece: Piece, dx = 0, dy = 0, matrix = piece.matrix): boolean {
  return matrix.some((row, rowIndex) => row.some((value, columnIndex) => {
    if (!value) return false;
    const x = piece.x + columnIndex + dx;
    const y = piece.y + rowIndex + dy;
    return x < 0 || x >= COLUMNS || y >= ROWS || (y >= 0 && board[y][x] !== null);
  }));
}

export function dropInterval(level: number): number {
  return Math.max(90, 800 - (level - 1) * 65);
}

export interface GameHooks {
  /** Called after a piece is locked and the score/lines were updated, before the next piece spawns. */
  onLock?: () => void;
  onGameOver?: () => void;
  /** Called whenever the hold availability changes. */
  onHoldAvailability?: (canHold: boolean) => void;
}

export class Game {
  board: Board = createBoard();
  bag: PieceType[] = [];
  upcoming: PieceType[] = [];
  active: Piece;
  held: PieceType | null = null;
  canHold = true;
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;

  constructor(private hooks: GameHooks = {}, private random: () => number = Math.random) {
    this.active = createPiece(this.drawFromBag());
    this.fillUpcoming();
  }

  private refillBag(): void {
    const types = Object.keys(SHAPES) as PieceType[];
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    this.bag.push(...types);
  }

  drawFromBag(): PieceType {
    if (this.bag.length === 0) this.refillBag();
    return this.bag.pop()!;
  }

  fillUpcoming(): void {
    while (this.upcoming.length < UPCOMING_SIZE) this.upcoming.push(this.drawFromBag());
  }

  collides(dx = 0, dy = 0, matrix = this.active.matrix): boolean {
    return collision(this.board, this.active, dx, dy, matrix);
  }

  spawnNext(): void {
    this.fillUpcoming();
    this.active = createPiece(this.upcoming.shift()!);
    this.fillUpcoming();
    this.canHold = true;
    this.hooks.onHoldAvailability?.(true);
    if (this.collides()) this.finish();
  }

  rotateActive(): void {
    if (this.paused || this.gameOver) return;
    const rotated = rotate(this.active.matrix);
    for (const offset of [0, -1, 1, -2, 2]) {
      if (!this.collides(offset, 0, rotated)) {
        this.active.matrix = rotated;
        this.active.x += offset;
        return;
      }
    }
  }

  move(dx: number, dy: number): boolean {
    if (this.paused || this.gameOver || this.collides(dx, dy)) return false;
    this.active.x += dx;
    this.active.y += dy;
    if (dy > 0) this.score += 1;
    return true;
  }

  holdPiece(): void {
    if (this.paused || this.gameOver || !this.canHold) return;
    const currentType = this.active.type;
    if (this.held) {
      this.active = createPiece(this.held);
      this.held = currentType;
      if (this.collides()) this.finish();
    } else {
      this.held = currentType;
      this.spawnNext();
    }
    this.canHold = false;
    this.hooks.onHoldAvailability?.(false);
  }

  hardDrop(): void {
    if (this.paused || this.gameOver) return;
    let distance = 0;
    while (!this.collides(0, 1)) {
      this.active.y += 1;
      distance += 1;
    }
    this.score += distance * 2;
    this.lockPiece();
  }

  lockPiece(): void {
    const { active } = this;
    for (let y = 0; y < active.matrix.length; y++) {
      for (let x = 0; x < active.matrix[y].length; x++) {
        if (!active.matrix[y][x]) continue;
        const boardY = active.y + y;
        const boardX = active.x + x;
        if (boardY >= 0) this.board[boardY][boardX] = active.type;
      }
    }

    let cleared = 0;
    this.board = this.board.filter((row) => {
      if (row.every((cell) => cell !== null)) {
        cleared += 1;
        return false;
      }
      return true;
    });
    while (this.board.length < ROWS) this.board.unshift(Array<PieceType | null>(COLUMNS).fill(null));

    if (cleared > 0) {
      this.score += (LINE_REWARDS[cleared] ?? 800) * this.level;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
    }
    this.hooks.onLock?.();
    this.spawnNext();
  }

  /** Advances gravity by one step: soft-drop, or lock if the piece cannot move. */
  tick(): void {
    if (!this.move(0, 1)) this.lockPiece();
  }

  finish(): void {
    this.gameOver = true;
    this.hooks.onGameOver?.();
  }

  reset(): void {
    this.board = createBoard();
    this.bag = [];
    this.upcoming = [];
    this.held = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.paused = false;
    this.gameOver = false;
    this.active = createPiece(this.drawFromBag());
    this.fillUpcoming();
    this.hooks.onHoldAvailability?.(true);
  }
}

import { describe, it, expect, vi } from 'vitest';
import {
  COLUMNS, ROWS, SHAPES, Game, collision, createBoard, createPiece, dropInterval, rotate,
} from '../src/game';
import type { GameHooks, PieceType } from '../src/game';

const ALL: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Game whose active piece is forced to the given type. */
function gameWith(type: PieceType, hooks: GameHooks = {}): Game {
  const g = new Game(hooks, () => 0.5);
  g.active = createPiece(type);
  return g;
}

function fillRow(g: Game, y: number, gapAt: number[] = []): void {
  for (let x = 0; x < COLUMNS; x++) g.board[y][x] = gapAt.includes(x) ? null : 'T';
}

function moveUntilBlocked(g: Game, dx: number, dy: number): void {
  let moved = true;
  while (moved) moved = g.move(dx, dy);
}

describe('piece definitions', () => {
  it('defines all seven tetrominoes with four cells each', () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...ALL].sort());
    for (const type of ALL) {
      expect(SHAPES[type].flat().filter(Boolean)).toHaveLength(4);
    }
  });

  it('spawns pieces centred at the top, as a copy of the shape', () => {
    const i = createPiece('I');
    expect(i).toMatchObject({ type: 'I', x: 3, y: 0 });
    expect(createPiece('O').x).toBe(4);
    expect(createPiece('T').x).toBe(3);
    i.matrix[0][0] = 0;
    expect(SHAPES.I[0][0]).toBe(1);
  });

  it('creates an empty 10x20 board', () => {
    const board = createBoard();
    expect(board).toHaveLength(ROWS);
    expect(board.every((row) => row.length === COLUMNS && row.every((c) => c === null))).toBe(true);
  });
});

describe('rotation', () => {
  it('rotates a matrix clockwise', () => {
    expect(rotate([[1, 1, 1, 1]])).toEqual([[1], [1], [1], [1]]);
    expect(rotate(SHAPES.T)).toEqual([[1, 0], [1, 1], [1, 0]]);
  });

  it('returns to the original after four rotations', () => {
    for (const type of ALL) {
      let m = SHAPES[type];
      for (let i = 0; i < 4; i++) m = rotate(m);
      expect(m).toEqual(SHAPES[type]);
    }
  });

  it('keeps the O piece unchanged', () => {
    expect(rotate(SHAPES.O)).toEqual(SHAPES.O);
  });

  it('rotates the active piece', () => {
    const g = gameWith('I');
    g.rotateActive();
    expect(g.active.matrix).toEqual([[1], [1], [1], [1]]);
  });

  it('kicks off the left wall when rotating', () => {
    const g = gameWith('I');
    g.rotateActive(); // vertical, 1 wide
    g.active.x = 0;
    g.rotateActive(); // horizontal, 4 wide, fits at x=0
    expect(g.active.matrix).toEqual([[1, 1, 1, 1]]);
    expect(g.active.x).toBe(0);
  });

  it('kicks off the right wall when rotating', () => {
    const g = gameWith('I');
    g.rotateActive();
    g.active.x = COLUMNS - 2;
    g.rotateActive();
    expect(g.active.matrix).toEqual([[1, 1, 1, 1]]);
    expect(g.active.x).toBe(COLUMNS - 4); // kicked by -2
    expect(g.collides()).toBe(false);
  });

  it('does not rotate when no kick offset fits', () => {
    const g = gameWith('I');
    g.rotateActive(); // vertical I
    const col = g.active.x;
    // Leave only the vertical I's own column free so the horizontal shape fits nowhere.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < COLUMNS; x++) g.board[y][x] = x === col ? null : 'O';
    }
    const before = JSON.stringify(g.active);
    g.rotateActive();
    expect(JSON.stringify(g.active)).toBe(before);
  });

  it('ignores rotation while paused or after game over', () => {
    const g = gameWith('I');
    g.paused = true;
    g.rotateActive();
    expect(g.active.matrix).toEqual(SHAPES.I);
    g.paused = false;
    g.gameOver = true;
    g.rotateActive();
    expect(g.active.matrix).toEqual(SHAPES.I);
  });
});

describe('collision detection', () => {
  it('detects no collision for a fresh piece', () => {
    expect(collision(createBoard(), createPiece('T'))).toBe(false);
  });

  it('detects walls', () => {
    const board = createBoard();
    const p = createPiece('O');
    expect(collision(board, p, -5)).toBe(true);
    expect(collision(board, p, 5)).toBe(true);
    expect(collision(board, p, -4)).toBe(false);
    expect(collision(board, p, 4)).toBe(false);
  });

  it('detects the floor', () => {
    const board = createBoard();
    const p = createPiece('O');
    expect(collision(board, p, 0, ROWS - 2)).toBe(false);
    expect(collision(board, p, 0, ROWS - 1)).toBe(true);
  });

  it('detects occupied cells', () => {
    const board = createBoard();
    board[1][4] = 'I';
    expect(collision(board, createPiece('O'))).toBe(true);
    expect(collision(board, createPiece('O'), -2)).toBe(false);
  });

  it('allows cells above the board', () => {
    const p = createPiece('I');
    p.y = -1;
    expect(collision(createBoard(), p)).toBe(false);
  });

  it('only checks filled matrix cells', () => {
    const board = createBoard();
    board[0][3] = 'I'; // empty top-left cell of T
    expect(collision(board, createPiece('T'))).toBe(false);
  });
});

describe('movement', () => {
  it('moves left and right', () => {
    const g = gameWith('O');
    expect(g.move(-1, 0)).toBe(true);
    expect(g.active.x).toBe(3);
    expect(g.move(1, 0)).toBe(true);
    expect(g.active.x).toBe(4);
  });

  it('stops at the walls', () => {
    const g = gameWith('O');
    moveUntilBlocked(g, -1, 0);
    expect(g.active.x).toBe(0);
    expect(g.move(-1, 0)).toBe(false);
    moveUntilBlocked(g, 1, 0);
    expect(g.active.x).toBe(COLUMNS - 2);
  });

  it('awards one point per soft-drop row and none for sideways moves', () => {
    const g = gameWith('O');
    g.move(0, 1);
    g.move(0, 1);
    g.move(1, 0);
    expect(g.score).toBe(2);
    expect(g.active.y).toBe(2);
  });

  it('stops at the floor without scoring further', () => {
    const g = gameWith('O');
    moveUntilBlocked(g, 0, 1);
    const score = g.score;
    expect(g.active.y).toBe(ROWS - 2);
    expect(g.move(0, 1)).toBe(false);
    expect(g.score).toBe(score);
  });

  it('does not move while paused or game over', () => {
    const g = gameWith('O');
    g.paused = true;
    expect(g.move(1, 0)).toBe(false);
    g.paused = false;
    g.gameOver = true;
    expect(g.move(1, 0)).toBe(false);
    expect(g.active.x).toBe(4);
  });
});

describe('hard drop and locking', () => {
  it('drops to the floor, scores 2 per row and locks the piece', () => {
    const g = gameWith('O');
    g.hardDrop();
    expect(g.score).toBe((ROWS - 2) * 2);
    for (const y of [ROWS - 2, ROWS - 1]) {
      expect(g.board[y][4]).toBe('O');
      expect(g.board[y][5]).toBe('O');
    }
  });

  it('lands on top of existing blocks', () => {
    const g = gameWith('O');
    g.board[ROWS - 1][4] = 'I';
    g.hardDrop();
    expect(g.board[ROWS - 2][4]).toBe('O');
    expect(g.board[ROWS - 3][4]).toBe('O');
  });

  it('spawns the next piece from the queue after locking', () => {
    const g = gameWith('O');
    const expected = g.upcoming[0];
    g.hardDrop();
    expect(g.active.type).toBe(expected);
    expect(g.active.y).toBe(0);
    expect(g.upcoming).toHaveLength(6);
  });

  it('does nothing while paused or game over', () => {
    const g = gameWith('O');
    g.paused = true;
    g.hardDrop();
    expect(g.score).toBe(0);
    expect(g.active.y).toBe(0);
    g.paused = false;
    g.gameOver = true;
    g.hardDrop();
    expect(g.active.y).toBe(0);
  });

  it('calls onLock once per lock', () => {
    const onLock = vi.fn();
    const g = gameWith('O', { onLock });
    g.hardDrop();
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('tick soft-drops, and locks when the piece cannot move', () => {
    const g = gameWith('O');
    g.tick();
    expect(g.active.y).toBe(1);
    while (g.active.y < ROWS - 2) g.tick();
    g.tick();
    expect(g.board[ROWS - 1][4]).toBe('O');
    expect(g.active.y).toBe(0);
  });
});

describe('line clearing and scoring', () => {
  const DROP_POINTS = (ROWS - 2) * 2; // O piece hard-dropping from the top

  // Fill rows except for the columns the O piece (x=4..5) will occupy.
  function setupClear(g: Game, rows: number): void {
    for (let r = 0; r < rows; r++) fillRow(g, ROWS - 1 - r, [4, 5]);
  }

  it('clears a single line for 100 points at level 1', () => {
    const g = gameWith('O');
    setupClear(g, 1);
    g.hardDrop();
    expect(g.lines).toBe(1);
    expect(g.score).toBe(DROP_POINTS + 100);
  });

  it('clears two lines for 300 points and empties the board', () => {
    const g = gameWith('O');
    setupClear(g, 2);
    g.hardDrop();
    expect(g.lines).toBe(2);
    expect(g.score).toBe(DROP_POINTS + 300);
    expect(g.board.every((row) => row.every((c) => c === null))).toBe(true);
  });

  it('awards 100/300/500/800 for 1-4 lines', () => {
    const rewards = [100, 300, 500, 800];
    for (let n = 1; n <= 4; n++) {
      const g = gameWith('I');
      g.rotateActive(); // vertical I
      const col = g.active.x;
      for (let r = 0; r < n; r++) fillRow(g, ROWS - 1 - r, [col]);
      g.hardDrop();
      expect(g.lines).toBe(n);
      expect(g.score).toBe((ROWS - 4) * 2 + rewards[n - 1]);
    }
  });

  it('shifts remaining rows down and keeps the board size', () => {
    const g = gameWith('O');
    g.board[ROWS - 3][0] = 'J'; // marker above the lines to be cleared
    setupClear(g, 2);
    g.board[ROWS - 3][4] = null;
    g.hardDrop();
    expect(g.board).toHaveLength(ROWS);
    expect(g.board[ROWS - 1][0]).toBe('J');
    expect(g.board[ROWS - 3][0]).toBeNull();
  });

  it('does not clear incomplete rows', () => {
    const g = gameWith('O');
    fillRow(g, ROWS - 1, [4, 5, 9]);
    g.hardDrop();
    expect(g.lines).toBe(0);
    expect(g.board[ROWS - 1][0]).toBe('T');
  });

  it('multiplies line rewards by the current level', () => {
    const g = gameWith('O');
    g.level = 3;
    g.lines = 20;
    setupClear(g, 1);
    g.hardDrop();
    expect(g.score).toBe(DROP_POINTS + 300);
  });
});

describe('level progression', () => {
  it('starts at level 1 and advances every ten lines', () => {
    const g = gameWith('O');
    expect(g.level).toBe(1);
    g.lines = 9;
    fillRow(g, ROWS - 1, [4, 5]);
    g.hardDrop();
    expect(g.lines).toBe(10);
    expect(g.level).toBe(2);
  });

  it('stays on the same level below the threshold', () => {
    const g = gameWith('O');
    g.lines = 7;
    fillRow(g, ROWS - 1, [4, 5]);
    g.hardDrop();
    expect(g.level).toBe(1);
  });

  it('speeds up the drop interval with a floor of 90ms', () => {
    expect(dropInterval(1)).toBe(800);
    expect(dropInterval(2)).toBe(735);
    expect(dropInterval(10)).toBe(215);
    expect(dropInterval(12)).toBe(90);
    expect(dropInterval(50)).toBe(90);
  });
});

describe('hold feature', () => {
  it('stores the active piece and spawns the next one on first hold', () => {
    const g = gameWith('T');
    const next = g.upcoming[0];
    g.holdPiece();
    expect(g.held).toBe('T');
    expect(g.active.type).toBe(next);
    expect(g.canHold).toBe(false);
  });

  it('swaps with the held piece on later holds', () => {
    const onHoldAvailability = vi.fn();
    const g = gameWith('T', { onHoldAvailability });
    g.holdPiece();
    const second = g.active.type;
    g.canHold = true; // as after a lock
    g.holdPiece();
    expect(g.active.type).toBe('T');
    expect(g.held).toBe(second);
    expect(g.active.y).toBe(0);
    expect(onHoldAvailability).toHaveBeenLastCalledWith(false);
  });

  it('allows only one hold per piece', () => {
    const g = gameWith('T');
    g.holdPiece();
    const active = g.active;
    const held = g.held;
    g.holdPiece();
    expect(g.active).toBe(active);
    expect(g.held).toBe(held);
  });

  it('re-enables hold after the piece locks', () => {
    const g = gameWith('T');
    g.holdPiece();
    g.hardDrop();
    expect(g.canHold).toBe(true);
  });

  it('is disabled while paused or game over', () => {
    const g = gameWith('T');
    g.paused = true;
    g.holdPiece();
    expect(g.held).toBeNull();
    g.paused = false;
    g.gameOver = true;
    g.holdPiece();
    expect(g.held).toBeNull();
  });

  it('ends the game when the swapped-in piece does not fit', () => {
    const onGameOver = vi.fn();
    const g = gameWith('T', { onGameOver });
    g.held = 'O';
    g.board[0][4] = 'I';
    g.holdPiece();
    expect(g.gameOver).toBe(true);
    expect(onGameOver).toHaveBeenCalledTimes(1);
  });
});

describe('next-piece queue and bag', () => {
  it('keeps six upcoming pieces', () => {
    const g = new Game();
    expect(g.upcoming).toHaveLength(6);
    g.hardDrop();
    expect(g.upcoming).toHaveLength(6);
  });

  it('draws each piece type once per bag of seven', () => {
    const g = new Game({}, () => 0.3);
    g.bag = [];
    const drawn = Array.from({ length: 7 }, () => g.drawFromBag());
    expect([...drawn].sort()).toEqual([...ALL].sort());
  });

  it('is deterministic with an injected random source', () => {
    const a = new Game({}, () => 0.42);
    const b = new Game({}, () => 0.42);
    expect(a.active.type).toBe(b.active.type);
    expect(a.upcoming).toEqual(b.upcoming);
  });

  it('serves pieces in queue order', () => {
    const g = new Game();
    const order = [...g.upcoming];
    g.spawnNext();
    expect(g.active.type).toBe(order[0]);
    g.spawnNext();
    expect(g.active.type).toBe(order[1]);
  });
});

describe('game over and reset', () => {
  it('ends the game when a new piece spawns into blocks', () => {
    const onGameOver = vi.fn();
    const g = new Game({ onGameOver });
    for (let y = 0; y < 3; y++) for (let x = 0; x < COLUMNS; x++) g.board[y][x] = 'O';
    g.spawnNext();
    expect(g.gameOver).toBe(true);
    expect(onGameOver).toHaveBeenCalledTimes(1);
  });

  it('ends the game by stacking pieces to the top', () => {
    const g = new Game();
    let guard = 0;
    while (!g.gameOver && guard++ < 100) g.hardDrop();
    expect(g.gameOver).toBe(true);
  });

  it('resets all state', () => {
    const onHoldAvailability = vi.fn();
    const g = new Game({ onHoldAvailability });
    g.score = 500;
    g.lines = 12;
    g.level = 2;
    g.held = 'I';
    g.gameOver = true;
    g.paused = true;
    g.board[ROWS - 1][0] = 'I';
    g.reset();
    expect(g).toMatchObject({ score: 0, lines: 0, level: 1, held: null, gameOver: false, paused: false, canHold: true });
    expect(g.board.flat().every((c) => c === null)).toBe(true);
    expect(g.upcoming).toHaveLength(6);
    expect(onHoldAvailability).toHaveBeenLastCalledWith(true);
  });
});

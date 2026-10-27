/**
 * tests/socketEvents.test.js
 *
 * Integration tests for Socket.IO events: room lifecycle, gameplay,
 * leave-room, rematch-request, and rematch-accepted.
 *
 * Uses the real server (no mocks) with socket.io-client.
 * Run with:  node --test tests/socketEvents.test.js
 */

"use strict";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { io: Client } = require("socket.io-client");

// Ensure test environment so server does not auto-listen
process.env.NODE_ENV = "test";

// Import the server without auto-starting it
const { server, io, rooms } = require("../server/index");

const TEST_PORT = 4567;
let serverUrl;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a connected socket.io-client instance. */
function createClient() {
  return Client(serverUrl, {
    forceNew: true,
    transports: ["websocket"],
  });
}

/** Promisified socket emit with ack callback. */
function emitWithAck(socket, event, data) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => resolve(response));
  });
}

/** Wait for a specific event from a socket. */
function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

before(() => {
  return new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      serverUrl = `http://localhost:${TEST_PORT}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    io.close();
    server.close(() => resolve());
  });
});

beforeEach(() => {
  // Clear all rooms between tests
  rooms.clear();
});

// ─── create-room ──────────────────────────────────────────────────────────────

describe("create-room", () => {
  test("creates a room and returns roomCode and color R", async () => {
    const client = createClient();
    await waitForEvent(client, "connect");

    const ack = await emitWithAck(client, "create-room", { name: "Alice" });
    assert.equal(ack.success, true);
    assert.equal(typeof ack.roomCode, "string");
    assert.equal(ack.roomCode.length, 6);
    assert.equal(ack.color, "R");

    client.disconnect();
  });

  test("rejects empty name", async () => {
    const client = createClient();
    await waitForEvent(client, "connect");

    const ack = await emitWithAck(client, "create-room", { name: "" });
    assert.equal(ack.success, false);

    client.disconnect();
  });
});

// ─── join-room ────────────────────────────────────────────────────────────────

describe("join-room", () => {
  test("second player joins and gets color Y", async () => {
    const client1 = createClient();
    const client2 = createClient();
    await Promise.all([
      waitForEvent(client1, "connect"),
      waitForEvent(client2, "connect"),
    ]);

    const createAck = await emitWithAck(client1, "create-room", { name: "Alice" });
    const joinAck = await emitWithAck(client2, "join-room", {
      roomCode: createAck.roomCode,
      name: "Bob",
    });

    assert.equal(joinAck.success, true);
    assert.equal(joinAck.color, "Y");

    client1.disconnect();
    client2.disconnect();
  });

  test("rejects joining a nonexistent room", async () => {
    const client = createClient();
    await waitForEvent(client, "connect");

    const ack = await emitWithAck(client, "join-room", {
      roomCode: "ZZZZZZ",
      name: "Bob",
    });

    assert.equal(ack.success, false);
    assert.ok(ack.message.includes("not found"));

    client.disconnect();
  });

  test("rejects a third player joining a full room", async () => {
    const c1 = createClient();
    const c2 = createClient();
    const c3 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
      waitForEvent(c3, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });

    const thirdAck = await emitWithAck(c3, "join-room", {
      roomCode: createAck.roomCode,
      name: "Charlie",
    });

    assert.equal(thirdAck.success, false);
    assert.ok(thirdAck.message.includes("full"));

    c1.disconnect();
    c2.disconnect();
    c3.disconnect();
  });
});

// ─── make-move ────────────────────────────────────────────────────────────────

describe("make-move", () => {
  test("valid move is accepted and game-state is broadcast", async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });

    // Wait for the initial game-state from join
    await waitForEvent(c1, "game-state");

    // R (Alice/c1) makes a move — also listen for the broadcast on c2
    const statePromise = waitForEvent(c2, "game-state");
    const moveAck = await emitWithAck(c1, "make-move", {
      roomCode: createAck.roomCode,
      column: 3,
    });

    assert.equal(moveAck.success, true);

    const state = await statePromise;
    assert.equal(state.board[5][3], "R"); // bottom row, col 3
    assert.equal(state.currentTurn, "Y"); // turn switched

    c1.disconnect();
    c2.disconnect();
  });

  test("wrong-turn move is rejected", async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });
    await waitForEvent(c1, "game-state");

    // Y (Bob/c2) tries to move first — should be rejected
    const moveAck = await emitWithAck(c2, "make-move", {
      roomCode: createAck.roomCode,
      column: 0,
    });

    assert.equal(moveAck.success, false);
    assert.ok(moveAck.message.includes("not your turn"));

    c1.disconnect();
    c2.disconnect();
  });

  test("non-player cannot make a move", async () => {
    const c1 = createClient();
    const c2 = createClient();
    const outsider = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
      waitForEvent(outsider, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });

    const moveAck = await emitWithAck(outsider, "make-move", {
      roomCode: createAck.roomCode,
      column: 0,
    });

    assert.equal(moveAck.success, false);
    assert.ok(moveAck.message.includes("not a player"));

    c1.disconnect();
    c2.disconnect();
    outsider.disconnect();
  });
});

// ─── leave-room ───────────────────────────────────────────────────────────────

describe("leave-room", () => {
  test("creator can leave a waiting room (room is deleted)", async () => {
    const client = createClient();
    await waitForEvent(client, "connect");

    const createAck = await emitWithAck(client, "create-room", { name: "Alice" });
    const leaveAck = await emitWithAck(client, "leave-room", {
      roomCode: createAck.roomCode,
    });

    assert.equal(leaveAck.success, true);
    assert.equal(rooms.has(createAck.roomCode), false, "room should be deleted");

    client.disconnect();
  });

  test("leaving during a game notifies the opponent", async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });
    await waitForEvent(c1, "game-state");

    // c1 (Alice, R) leaves — c2 (Bob, Y) should get player-disconnected
    const disconnectPromise = waitForEvent(c2, "player-disconnected");
    const leaveAck = await emitWithAck(c1, "leave-room", {
      roomCode: createAck.roomCode,
    });

    assert.equal(leaveAck.success, true);

    const msg = await disconnectPromise;
    assert.ok(msg.message.includes("Alice"), "should mention who left");

    // Room should now be finished
    const room = rooms.get(createAck.roomCode);
    assert.equal(room.status, "finished");

    c1.disconnect();
    c2.disconnect();
  });

  test("rejects leave from a non-member", async () => {
    const c1 = createClient();
    const outsider = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(outsider, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    const leaveAck = await emitWithAck(outsider, "leave-room", {
      roomCode: createAck.roomCode,
    });

    assert.equal(leaveAck.success, false);

    c1.disconnect();
    outsider.disconnect();
  });
});

// ─── rematch ──────────────────────────────────────────────────────────────────

describe("rematch", () => {
  /**
   * Helper: creates a room, joins, and plays a quick vertical win for R.
   * Returns { c1, c2, roomCode } with the game in "finished" status.
   */
  async function playToFinish() {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });
    await waitForEvent(c1, "game-state");

    const rc = createAck.roomCode;

    // Play a vertical win for R (col 0) with Y moves in col 1
    // R col 0, Y col 1, R col 0, Y col 1, R col 0, Y col 1, R col 0 = win
    await emitWithAck(c1, "make-move", { roomCode: rc, column: 0 }); // R
    await waitForEvent(c2, "game-state");
    await emitWithAck(c2, "make-move", { roomCode: rc, column: 1 }); // Y
    await waitForEvent(c1, "game-state");
    await emitWithAck(c1, "make-move", { roomCode: rc, column: 0 }); // R
    await waitForEvent(c2, "game-state");
    await emitWithAck(c2, "make-move", { roomCode: rc, column: 1 }); // Y
    await waitForEvent(c1, "game-state");
    await emitWithAck(c1, "make-move", { roomCode: rc, column: 0 }); // R
    await waitForEvent(c2, "game-state");
    await emitWithAck(c2, "make-move", { roomCode: rc, column: 1 }); // Y
    await waitForEvent(c1, "game-state");

    // This should be the winning move for R
    await emitWithAck(c1, "make-move", { roomCode: rc, column: 0 }); // R wins

    // Wait for game-over on both
    await waitForEvent(c2, "game-over");

    return { c1, c2, roomCode: rc };
  }

  test("rematch-request is rejected when game is not finished", async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });
    await waitForEvent(c1, "game-state");

    const ack = await emitWithAck(c1, "rematch-request", {
      roomCode: createAck.roomCode,
    });

    assert.equal(ack.success, false);
    assert.ok(ack.message.includes("not finished"));

    c1.disconnect();
    c2.disconnect();
  });

  test("rematch-request sends notification to opponent", async () => {
    const { c1, c2, roomCode } = await playToFinish();

    // c1 requests rematch, c2 should receive the event
    const rematchPromise = waitForEvent(c2, "rematch-request");
    const ack = await emitWithAck(c1, "rematch-request", { roomCode });

    assert.equal(ack.success, true);

    const notification = await rematchPromise;
    assert.equal(notification.from, "Alice");

    c1.disconnect();
    c2.disconnect();
  });

  test("rematch-accepted resets the game and swaps colors", async () => {
    const { c1, c2, roomCode } = await playToFinish();

    // Before rematch: R=Alice, Y=Bob
    const roomBefore = rooms.get(roomCode);
    assert.equal(roomBefore.status, "finished");

    // c2 (Bob) accepts the rematch
    const statePromise = waitForEvent(c1, "game-state");
    const ack = await emitWithAck(c2, "rematch-accepted", { roomCode });

    assert.equal(ack.success, true);

    const newState = await statePromise;
    assert.equal(newState.status, "playing");
    assert.equal(newState.currentTurn, "R");
    assert.equal(newState.totalMoves, 0);
    assert.equal(newState.winner, null);

    // Colors should be swapped: Bob is now R, Alice is now Y
    assert.equal(newState.players.R.name, "Bob");
    assert.equal(newState.players.Y.name, "Alice");

    // Board should be empty
    for (const row of newState.board) {
      for (const cell of row) {
        assert.equal(cell, null);
      }
    }

    c1.disconnect();
    c2.disconnect();
  });

  test("rematch-accepted fails if opponent disconnected", async () => {
    const { c1, c2, roomCode } = await playToFinish();

    // c1 disconnects
    c1.disconnect();

    // Give the server a moment to process disconnect
    await new Promise((resolve) => setTimeout(resolve, 200));

    const ack = await emitWithAck(c2, "rematch-accepted", { roomCode });
    assert.equal(ack.success, false);
    assert.ok(ack.message.includes("connected"));

    c2.disconnect();
  });
});

// ─── disconnect behavior ──────────────────────────────────────────────────────

describe("disconnect", () => {
  test("opponent is notified when a player disconnects during a game", async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([
      waitForEvent(c1, "connect"),
      waitForEvent(c2, "connect"),
    ]);

    const createAck = await emitWithAck(c1, "create-room", { name: "Alice" });
    await emitWithAck(c2, "join-room", { roomCode: createAck.roomCode, name: "Bob" });
    await waitForEvent(c1, "game-state");

    const disconnectPromise = waitForEvent(c2, "player-disconnected");

    // Alice disconnects
    c1.disconnect();

    const msg = await disconnectPromise;
    assert.ok(msg.message.includes("Alice"));

    c2.disconnect();
  });
});

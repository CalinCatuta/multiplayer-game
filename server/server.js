// server/server.js

import { createServer } from "http";
import express from "express";
import { WebSocketServer } from "ws";
// Removed: import xssClean from "xss-clean";

// --- Basic Server Setup ---
const app = express();
// Removed: app.use(xssClean()); // Removed for testing without protection
// It tells Express to serve static files from the 'client' directory.
// When a request comes in for a file like /sounds/A.mp3, it will look in client/sounds/A.mp3
app.use(express.static("client")); //

const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- In-Memory Game State ---
// This object will hold all active game sessions.
const gameSessions = {};

// --- Helper Functions ---
/**
 * Generates a unique 6-character room code.
 * @returns {string} The unique room code.
 */
const generateRoomCode = () => {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (gameSessions[code]); // Ensure code is unique
  console.log(`Generated room code: ${code}`); // ADDED FOR DEBUGGING
  return code;
};

/**
 * Broadcasts a message to all clients in a specific room.
 * @param {string} roomCode - The code of the room.
 * @param {object} message - The message object to send.
 * @param {string|null} excludeClientId - A client ID to exclude from the broadcast.
 */
const broadcastToRoom = (roomCode, message, excludeClientId = null) => {
  const session = gameSessions[roomCode];
  if (!session) return;

  session.players.forEach((player) => {
    if (
      player.clientId !== excludeClientId &&
      player.ws.readyState === player.ws.OPEN
    ) {
      player.ws.send(JSON.stringify(message));
    }
  });
};

// --- WebSocket Connection Logic ---
wss.on("connection", (ws) => {
  // A unique ID for this client connection
  ws.clientId = Math.random().toString(36).substring(2, 15);
  console.log(`Client ${ws.clientId} connected.`);

  // Send the client its own ID immediately upon connection
  ws.send(
    JSON.stringify({
      type: "YOUR_CLIENT_ID",
      payload: { clientId: ws.clientId },
    })
  ); //

  ws.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage);
      handleMessage(ws, message);
    } catch (error) {
      console.error("Failed to parse message or handle logic:", error);
      ws.send(
        JSON.stringify({
          type: "ERROR",
          payload: { message: "Invalid message format." },
        })
      );
    }
  });

  ws.on("close", () => {
    console.log(`Client ${ws.clientId} disconnected.`); // ADDED FOR DEBUGGING
    // Find which room the player was in and handle their departure
    for (const roomCode in gameSessions) {
      const session = gameSessions[roomCode];
      const playerIndex = session.players.findIndex(
        (p) => p.clientId === ws.clientId
      );
      if (playerIndex !== -1) {
        session.players.splice(playerIndex, 1);
        // If the game is in progress or lobby, notify others
        if (session.players.length === 0) {
          delete gameSessions[roomCode]; // Clean up empty room
          console.log(`Room ${roomCode} deleted as it became empty.`); // ADDED FOR DEBUGGING
        } else {
          broadcastToRoom(roomCode, {
            type: "UPDATE_GAME_STATE",
            payload: session,
          });
        }
        break;
      }
    }
  });
});

/**
 * Main message handler for all incoming WebSocket messages.
 * @param {WebSocket} ws - The WebSocket connection instance.
 * @param {object} message - The parsed message object.
 */
const handleMessage = (ws, message) => {
  const { type, payload } = message;
  const { roomCode, playerName } = payload || {};

  // Attach ws and clientId to the payload for easier access
  payload.ws = ws;
  payload.clientId = ws.clientId;

  switch (type) {
    case "CREATE_ROOM":
      createRoom(payload);
      break;
    case "JOIN_ROOM":
      joinRoom(payload);
      break;
    case "START_GAME":
      startGame(payload);
      break;
    case "SUBMIT_TEXT":
      submitText(payload);
      break;
    case "VOTE":
      handleVote(payload);
      break;
    case "NEXT_ROUND":
      startNewRound(payload);
      break;
    case "PLAY_SOUND":
      // Broadcast sound to everyone in the room, INCLUDING the sender
      broadcastToRoom(
        payload.roomCode,
        { type: "SOUND_PLAYED", payload: { sound: payload.sound } }
        // REMOVED: payload.clientId
      );
      break;
    default:
      ws.send(
        JSON.stringify({
          type: "ERROR",
          payload: { message: "Unknown message type." },
        })
      );
  }
};

// --- Game Logic Functions ---

function createRoom({ ws, clientId, playerName }) {
  const roomCode = generateRoomCode();
  gameSessions[roomCode] = {
    roomCode,
    hostId: clientId,
    players: [
      {
        clientId,
        ws,
        playerName,
        score: 0,
      },
    ],
    gameState: "LOBBY", // LOBBY, TYPING, READING, VOTING, SCORE
    rounds: {
      currentTyperId: null,
      playersWhoHaveTyped: [],
      submittedText: "",
      votes: {}, // { voterId: votedPlayerId }
    },
  };
  console.log(
    `Room created: ${roomCode}, Host: ${clientId}, Players: ${gameSessions[roomCode].players.length}`
  ); // ADDED FOR DEBUGGING
  console.log(
    "Current gameSessions (after create):",
    Object.keys(gameSessions)
  ); // ADDED FOR DEBUGGING
  ws.send(
    JSON.stringify({ type: "ROOM_CREATED", payload: gameSessions[roomCode] })
  );
}

function joinRoom({ ws, clientId, roomCode, playerName }) {
  console.log(
    `Attempting to join room: ${roomCode}, Client: ${clientId}, Player: ${playerName}`
  ); // ADDED FOR DEBUGGING
  const session = gameSessions[roomCode];
  if (!session) {
    console.log(
      `Room ${roomCode} not found for client ${clientId}. Available rooms:`,
      Object.keys(gameSessions)
    ); // ADDED FOR DEBUGGING
    return ws.send(
      JSON.stringify({ type: "ERROR", payload: { message: "Room not found." } })
    );
  }
  if (session.players.length >= 8) {
    return ws.send(
      JSON.stringify({ type: "ERROR", payload: { message: "Room is full." } })
    );
  }

  session.players.push({ clientId, ws, playerName, score: 0 });
  ws.send(JSON.stringify({ type: "JOINED_ROOM", payload: session }));

  // Notify all other players
  broadcastToRoom(
    roomCode,
    {
      type: "UPDATE_GAME_STATE",
      payload: session,
    },
    clientId
  );
}

function startGame({ roomCode, clientId }) {
  const session = gameSessions[roomCode];
  if (!session || session.hostId !== clientId) return; // Only host can start
  if (session.players.length < 3) {
    // Send error message back to host
    session.players
      .find((p) => p.clientId === clientId)
      .ws.send(
        JSON.stringify({
          type: "ERROR",
          payload: { message: "Need at least 3 players to start." },
        })
      );
    return;
  }

  session.gameState = "TYPING";
  startNewRound({ roomCode });
}

function startNewRound({ roomCode }) {
  const session = gameSessions[roomCode];
  if (!session) return;

  // Reset round-specific data
  session.rounds.submittedText = "";
  session.rounds.votes = {};
  session.gameState = "TYPING";

  // Choose the next typer
  let availablePlayers = session.players.filter(
    (p) => !session.rounds.playersWhoHaveTyped.includes(p.clientId)
  );

  // If all players have typed, reset the list
  if (availablePlayers.length === 0) {
    session.rounds.playersWhoHaveTyped = [];
    availablePlayers = session.players;
  }

  const randomPlayer =
    availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
  session.rounds.currentTyperId = randomPlayer.clientId;
  session.rounds.playersWhoHaveTyped.push(randomPlayer.clientId);

  // Corrected console.log for chosen player
  console.log(
    `Server: Room ${roomCode} - Chosen typer for new round: ${randomPlayer.playerName} (${randomPlayer.clientId})`
  ); // FIXED LOG

  broadcastToRoom(roomCode, {
    type: "NEW_ROUND",
    payload: session,
  });
}

function submitText({ roomCode, clientId, text }) {
  const session = gameSessions[roomCode];
  if (!session || session.rounds.currentTyperId !== clientId) return;

  session.rounds.submittedText = text; // No xss-clean. Ensure client-side sanitization or server-side escaping for display.
  session.gameState = "READING";

  broadcastToRoom(roomCode, {
    type: "TEXT_SUBMITTED",
    payload: session,
  });

  // Start 40-second timer
  setTimeout(() => {
    if (gameSessions[roomCode]) {
      // Check if room still exists
      gameSessions[roomCode].gameState = "VOTING";
      broadcastToRoom(roomCode, {
        type: "VOTING_STARTED",
        payload: gameSessions[roomCode],
      });
    }
  }, 40000); // 40 seconds
}

function handleVote({ roomCode, clientId, votedPlayerId }) {
  const session = gameSessions[roomCode];
  if (!session || session.gameState !== "VOTING") return;

  session.rounds.votes[clientId] = votedPlayerId;

  // Check if all players (except the typer) have voted
  const typerId = session.rounds.currentTyperId;
  const voters = session.players.filter((p) => p.clientId !== typerId);

  if (Object.keys(session.rounds.votes).length === voters.length) {
    // All votes are in, calculate score
    calculateScores(roomCode);
  }
}

function calculateScores(roomCode) {
  const session = gameSessions[roomCode];
  if (!session) return;

  const typerId = session.rounds.currentTyperId;
  const votes = session.rounds.votes;
  let gameHasWinner = false;

  session.players.forEach((player) => {
    if (votes[player.clientId] && votes[player.clientId] === typerId) {
      player.score += 1;
      if (player.score >= 10) {
        gameHasWinner = true;
      }
    }
  });

  session.gameState = gameHasWinner ? "END" : "SCORE";
  broadcastToRoom(roomCode, {
    type: "ROUND_OVER",
    payload: session,
  });
}

// --- Start Server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

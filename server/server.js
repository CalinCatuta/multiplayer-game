// server/server.js

import { createServer } from "http";
import express from "express";
import { WebSocketServer } from "ws";
import xssClean from "xss-clean";

// --- Basic Server Setup ---
const app = express();
app.use(xssClean()); // Sanitize user input

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
  console.log(`Generated room code: ${code}`); // ADD THIS LINE
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
    console.log(`Client ${ws.clientId} disconnected.`);
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
          console.log(`Room ${roomCode} deleted as it became empty.`); // ADD THIS LINE
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
      // Broadcast sound to everyone in the room except the sender
      broadcastToRoom(
        payload.roomCode,
        { type: "SOUND_PLAYED", payload: { sound: payload.sound } },
        payload.clientId
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
  console.log(`Room created: ${roomCode}, Host: ${clientId}, Players: ${gameSessions[roomCode].players.length}`); // ADD THIS LINE
  console.log('Current gameSessions (after create):', Object.keys(gameSessions)); // ADD THIS LINE
  ws.send(
    JSON.stringify({ type: "ROOM_CREATED", payload: gameSessions[roomCode] })
  );
}

function joinRoom({ ws, clientId, roomCode, playerName }) {
  console.log(`Attempting to join room: ${roomCode}, Client: ${clientId}, Player: ${playerName}`); // ADD THIS LINE
  const session = gameSessions[roomCode];
  if (!session) {
    console.log(`Room ${roomCode} not found for client ${clientId}. Available rooms:`, Object.keys(gameSessions)); // ADD THIS LINE
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

// ... rest of your server.js functions ...

// --- Start Server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

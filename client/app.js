// client/app.js

// --- WebSocket Connection ---
// In development, this connects to your local server.
// For production on Render/Netlify, use the Render URL.
const WS_URL = "https://guesswhofarted.onrender.com"; // Ensure this is YOUR Render URL and wss://
const ws = new WebSocket(WS_URL);

// --- State Management ---
let myClientId = null;
let roomCode = null;
let isHost = false;
let selectedVoteTarget = null; // Store the clientId of the player being voted for

// --- DOM Elements ---
const screens = document.querySelectorAll(".screen");
const errorPopup = document.getElementById("error-popup");
const errorMessage = document.getElementById("error-message");

// --- Navigation ---
const showScreen = (screenId) => {
  screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === screenId);
  });
};

// --- WebSocket Event Listeners ---
ws.onopen = () => {
  console.log("Connected to the server.");
  showScreen("start-screen");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const { type, payload } = message;

  console.log("Received:", type, payload);

  switch (type) {
    case "ERROR":
      showError(payload.message);
      break;
    case "YOUR_CLIENT_ID": //
      myClientId = payload.clientId; //
      console.log("My assigned Client ID:", myClientId); //
      break;
    case "ROOM_CREATED":
    case "JOINED_ROOM":
      // myClientId is now set by 'YOUR_CLIENT_ID'
      // You can remove or keep the line below, but it's redundant if set on connection
      // myClientId = payload.clientId; // This line will still be undefined based on current payload structure
      roomCode = payload.roomCode;
      isHost = payload.hostId === myClientId; // This will now correctly use the pre-set myClientId
      updateLobby(payload);
      showScreen("lobby-screen");
      break;
    case "UPDATE_GAME_STATE":
      updateLobby(payload);
      break;
    case "NEW_ROUND":
      handleNewRound(payload);
      break;
    case "TEXT_SUBMITTED":
      handleReadingPhase(payload);
      break;
    case "VOTING_STARTED":
      handleVotingPhase(payload);
      break;
    case "ROUND_OVER":
      handleScorePhase(payload);
      break;
    case "SOUND_PLAYED":
      // Broadcast sound to everyone in the room except the sender
      broadcastToRoom(
        payload.roomCode,
        { type: "SOUND_PLAYED", payload: { sound: payload.sound } }, // payload.sound will be "besina-1", etc.
        payload.clientId
      );
      break;
  }
};

ws.onclose = () => {
  showError("Connection to server lost.");
  showScreen("start-screen");
};

// --- Message Sending Function ---
const sendMessage = (type, payload = {}) => {
  // Inject state into every message automatically
  const message = {
    type,
    payload: {
      ...payload,
      // Only include the global roomCode if it's not already specifically provided
      // for the current message (like JOIN_ROOM)
      roomCode: payload.roomCode || roomCode, // Use passed roomCode or global roomCode
      clientId: myClientId, // Add our client ID
    },
  };
  ws.send(JSON.stringify(message));
};

// --- UI Update Functions ---
const showError = (message) => {
  errorMessage.textContent = message;
  errorPopup.classList.remove("hidden");
  setTimeout(() => errorPopup.classList.add("hidden"), 3000);
};

const updateLobby = (gameState) => {
  document.getElementById("room-code-display").textContent = gameState.roomCode;
  const playerList = document.getElementById("lobby-player-list");
  playerList.innerHTML = ""; // Clear previous list
  gameState.players.forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-box";
    playerDiv.textContent =
      player.playerName + (player.clientId === myClientId ? " (You)" : "");
    playerList.appendChild(playerDiv);
  });

  const startBtn = document.getElementById("start-game-btn");

  // Logic to show/hide and enable/disable the start button
  if (!isHost) {
    startBtn.style.display = "none"; // Show for host
    // Disable if less than 3 players
  }
};

const handleNewRound = (gameState) => {
  console.log("handleNewRound called. Game State:", gameState); // ADDED FOR DEBUGGING
  console.log(
    "Current Typer ID from gameState:",
    gameState.rounds.currentTyperId
  ); // ADDED FOR DEBUGGING

  const amITyper = gameState.rounds.currentTyperId === myClientId;
  console.log("My Client ID:", myClientId); // ADDED FOR DEBUGGING
  console.log("Am I the typer?", amITyper); // ADDED FOR DEBUGGING

  if (amITyper) {
    document.getElementById("text-input-area").value = "";
    showScreen("typing-screen");
  } else {
    const typer = gameState.players.find(
      (p) => p.clientId === gameState.rounds.currentTyperId
    );
    // Defensive check: ensure typer is found before accessing .playerName
    if (typer) {
      document.getElementById("current-typer-name-wait").textContent = "";
    } else {
      document.getElementById("current-typer-name-wait").textContent =
        "A player is typing...";
      console.warn("Typer player not found in gameState.players array.");
    }
    showScreen("waiting-screen");
  }
};

const handleReadingPhase = (gameState) => {
  if (gameState.rounds.currentTyperId === myClientId) {
    // If I was the typer, I just wait.
    showScreen("waiting-screen");
    document.getElementById("current-typer-name-wait").textContent = "..."; // Or some other text
  } else {
    document.getElementById("submitted-text-display").textContent =
      gameState.rounds.submittedText;
    let timeLeft = 40;
    const timerDisplay = document.getElementById("timer-display");
    timerDisplay.textContent = timeLeft;
    const timer = setInterval(() => {
      timeLeft--;
      timerDisplay.textContent = timeLeft;
      if (timeLeft <= 0) clearInterval(timer);
    }, 1000);
    showScreen("reading-screen");
  }
};

const handleVotingPhase = (gameState) => {
  // The typer does not vote
  if (gameState.rounds.currentTyperId === myClientId) {
    showScreen("waiting-screen");
    document.getElementById("current-typer-name-wait").textContent =
      "Players are voting...";
    return;
  }

  const playerList = document.getElementById("voting-player-list");
  playerList.innerHTML = "";
  selectedVoteTarget = null; // Reset selection
  document.getElementById("submit-vote-btn").disabled = true;

  gameState.players.forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-box selectable";
    playerDiv.textContent = player.playerName;
    playerDiv.dataset.clientId = player.clientId;

    playerDiv.addEventListener("click", () => {
      // Remove 'selected' from all others
      document
        .querySelectorAll("#voting-player-list .player-box")
        .forEach((box) => box.classList.remove("selected"));
      // Add 'selected' to the clicked one
      playerDiv.classList.add("selected");
      selectedVoteTarget = player.clientId;
      document.getElementById("submit-vote-btn").disabled = false;
    });
    playerList.appendChild(playerDiv);
  });
  showScreen("voting-screen");
};

const handleScorePhase = (gameState) => {
  const { players, rounds, gameState: state } = gameState;
  const typer = players.find((p) => p.clientId === rounds.currentTyperId);
  const scoreListContainer =
    state === "END"
      ? document.getElementById("final-score-list")
      : document.getElementById("score-board-list");

  document.getElementById("correct-typer-name").textContent = typer.playerName;
  scoreListContainer.innerHTML = "";
  players
    .sort((a, b) => b.score - a.score)
    .forEach((player) => {
      const scoreDiv = document.createElement("div");
      scoreDiv.textContent = `${player.playerName}: ${player.score} points`;
      scoreListContainer.appendChild(scoreDiv);
    });

  if (state === "END") {
    const winner = players[0];
    document.getElementById("winner-name").textContent = winner.playerName;
    showScreen("end-screen");
  } else {
    const nextRoundBtn = document.getElementById("next-round-btn");
    nextRoundBtn.style.display = isHost ? "block" : "none";
    showScreen("score-screen");
  }
};

// --- DOM Event Listeners ---
function setupEventListeners() {
  // Screen navigation
  document
    .getElementById("host-btn")
    .addEventListener("click", () => showScreen("host-screen"));
  document
    .getElementById("join-btn")
    .addEventListener("click", () => showScreen("join-screen"));

  // Actions
  document.getElementById("create-room-btn").addEventListener("click", () => {
    const playerName = document
      .getElementById("host-player-name-input")
      .value.trim();
    if (playerName.match(/^[a-zA-Z]+$/)) {
      sendMessage("CREATE_ROOM", { playerName });
    } else {
      showError("Name must contain only letters.");
    }
    // Correctly target sound buttons and ensure the path is accurate
    document.querySelectorAll(".sound-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // The `data-sound` attribute now holds "besina-1", "besina-2", etc.
        const soundName = btn.dataset.sound;
        sendMessage("PLAY_SOUND", { sound: soundName }); // Send the specific sound name
      });
    });
  });

  document.getElementById("find-room-btn").addEventListener("click", () => {
    const roomCodeInput = document
      .getElementById("room-code-input")
      .value.trim()
      .toUpperCase();
    const playerName = document
      .getElementById("join-player-name-input")
      .value.trim();
    if (playerName.match(/^[a-zA-Z]+$/)) {
      sendMessage("JOIN_ROOM", { roomCode: roomCodeInput, playerName });
    } else {
      showError("Name must contain only letters.");
    }
  });

  document.getElementById("start-game-btn").addEventListener("click", () => {
    sendMessage("START_GAME");
  });

  document.getElementById("submit-text-btn").addEventListener("click", () => {
    const text = document.getElementById("text-input-area").value;
    sendMessage("SUBMIT_TEXT", { text });
  });

  document.querySelectorAll(".sound-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendMessage("PLAY_SOUND", { sound: btn.dataset.sound });
    });
  });

  document.getElementById("submit-vote-btn").addEventListener("click", () => {
    if (selectedVoteTarget) {
      sendMessage("VOTE", { votedPlayerId: selectedVoteTarget });
      showScreen("waiting-screen"); // Wait for others to vote
      document.getElementById("current-typer-name-wait").textContent =
        "Waiting for results...";
    }
  });

  document.getElementById("next-round-btn").addEventListener("click", () => {
    sendMessage("NEXT_ROUND");
  });

  document.getElementById("play-again-btn").addEventListener("click", () => {
    // Reset local state and go to start screen
    myClientId = null;
    roomCode = null;
    isHost = false;
    showScreen("start-screen");
  });
}

// Initialize the app
document.addEventListener("DOMContentLoaded", setupEventListeners);

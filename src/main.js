// Main entry point for Spicy Card Game - Sandbox Mode with Pan/Zoom
import PartySocket from 'partysocket';

// Server host
const PARTYKIT_HOST = window.location.hostname === 'localhost'
    ? 'localhost:1999'
    : 'spicy.kennyphan123.partykit.dev';

// Generate random 4-letter room code
function generateRoomCode(length = 4) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// App State
const state = {
    socket: null,
    playerId: null,
    playerName: '',
    roomCode: '',
    isHost: false,
    myHand: [],
    pointsZone: [],
    pingInterval: null,

    gameState: {
        players: [],
        phase: 'LOBBY',
        hostId: null,
        gameStarted: false,
        spiceItUpMode: false,
        spiceItUpCards: [],
        deckCount: 0,
        worldsEndTriggered: false,
        stackCount: 0,
        stack: [], // Full stack data from server
        trophies: []
    },

    // Local trophy flip states (for visual only)
    trophyFlips: {},

    // Trophies that have been taken to points zone
    trophiesTaken: {},

    // Stack card flip states (for revealing during challenges)
    stackCardFlips: {},

    // Pan/Zoom state
    pan: { x: 0, y: 0 },
    zoom: 0.8,
    isPanning: false,
    lastPanPoint: null,

    // Drag state
    isDragging: false,
    dragCard: null,
    dragCardData: null,
    dragSource: null, // 'hand' or 'stack'
    dragClone: null,
    dragStartX: 0,
    dragStartY: 0,
    dragOffsetX: 0,
    dragOffsetY: 0,
    hasMoved: false,
    dragThreshold: 5
};

// DOM Elements
const elements = {
    lobby: document.getElementById('lobby'),
    game: document.getElementById('game'),
    mainMenu: document.getElementById('mainMenu'),
    showCreate: document.getElementById('showCreate'),
    showJoin: document.getElementById('showJoin'),
    createForm: document.getElementById('createForm'),
    joinForm: document.getElementById('joinForm'),
    createName: document.getElementById('createName'),
    joinName: document.getElementById('joinName'),
    roomCode: document.getElementById('roomCode'),
    createRoom: document.getElementById('createRoom'),
    joinRoom: document.getElementById('joinRoom'),
    roomInfo: document.getElementById('roomInfo'),
    displayRoomCode: document.getElementById('displayRoomCode'),
    playerCount: document.getElementById('playerCount'),
    playerList: document.getElementById('playerList'),
    startGame: document.getElementById('startGame'),
    waitingText: document.querySelector('.waiting-text'),
    spiceItUpCheck: document.getElementById('spiceItUpCheck'),
    spiceItUpContainer: document.getElementById('spiceItUpContainer'),

    gameCanvas: document.getElementById('gameCanvas'),
    gameWorld: document.getElementById('gameWorld'),
    deck: document.getElementById('deck'),
    deckCount: document.getElementById('deckCount'),
    worldsEndIndicator: document.getElementById('worldsEndIndicator'),
    stackContainer: document.getElementById('stackContainer'),
    stackCount: document.getElementById('stackCount'),
    lastDeclaration: document.getElementById('lastDeclaration'),
    trophies: document.getElementById('trophies'),
    spiceItUpDisplay: document.getElementById('spiceItUpDisplay'),
    otherPlayersArea: document.getElementById('otherPlayersArea'),
    myHandArea: document.querySelector('.my-hand-area'),
    myPlayerInfo: document.getElementById('myPlayerInfo'),
    myHand: document.getElementById('myHand'),
    pointsButton: document.getElementById('pointsButton'),
    pointsCount: document.getElementById('pointsCount'),
    restartButton: document.getElementById('restartButton'),
    takeAllStackBtn: document.getElementById('takeAllStackBtn'),

    pointsPopup: document.getElementById('pointsPopup'),
    pointsCards: document.getElementById('pointsCards'),
    closePoints: document.getElementById('closePoints'),

    errorModal: document.getElementById('errorModal'),
    errorMessage: document.getElementById('errorMessage'),
    errorOk: document.getElementById('errorOk'),
    worldsEndModal: document.getElementById('worldsEndModal'),
    worldsEndOk: document.getElementById('worldsEndOk'),
    restartModal: document.getElementById('restartModal'),
    restartConfirm: document.getElementById('restartConfirm'),
    restartCancel: document.getElementById('restartCancel')
};

// === INITIALIZATION ===
function init() {
    setupLobbyHandlers();
    setupGameHandlers();
    setupPanZoom();
    setupDragHandlers();

    // Prevent right-click context menu on images
    document.addEventListener('contextmenu', (e) => {
        if (e.target.tagName === 'IMG') {
            e.preventDefault();
        }
    });
}

// === LOBBY ===
function setupLobbyHandlers() {
    elements.showCreate.addEventListener('click', () => {
        elements.mainMenu.classList.add('hidden');
        elements.createForm.classList.remove('hidden');
    });

    elements.showJoin.addEventListener('click', () => {
        elements.mainMenu.classList.add('hidden');
        elements.joinForm.classList.remove('hidden');
    });

    elements.createRoom.addEventListener('click', () => {
        const name = elements.createName.value.trim();
        if (!name) {
            showError('Please enter your name');
            return;
        }
        state.playerName = name;
        state.roomCode = generateRoomCode(4);
        state.isHost = true;
        connectToRoom();
    });

    elements.joinRoom.addEventListener('click', () => {
        const name = elements.joinName.value.trim();
        const code = elements.roomCode.value.trim().toUpperCase();
        if (!name) {
            showError('Please enter your name');
            return;
        }
        if (!code || code.length !== 4) {
            showError('Please enter 4-letter room code');
            return;
        }
        state.playerName = name;
        state.roomCode = code;
        state.isHost = false;
        connectToRoom();
    });

    elements.startGame.addEventListener('click', () => {
        if (state.socket && state.isHost) {
            state.socket.send(JSON.stringify({ type: 'start' }));
        }
    });

    document.getElementById('backFromCreate')?.addEventListener('click', () => {
        elements.createForm.classList.add('hidden');
        elements.mainMenu.classList.remove('hidden');
    });

    document.getElementById('backFromJoin')?.addEventListener('click', () => {
        elements.joinForm.classList.add('hidden');
        elements.mainMenu.classList.remove('hidden');
    });

    document.getElementById('copyCodeBtn')?.addEventListener('click', copyRoomCode);

    elements.spiceItUpCheck.addEventListener('change', () => {
        if (state.socket && state.isHost) {
            state.socket.send(JSON.stringify({ type: 'toggleSpiceItUp' }));
        }
    });
}

function copyRoomCode() {
    const code = elements.displayRoomCode.textContent;
    const copyBtn = document.getElementById('copyCodeBtn');
    navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Tap to Copy'; }, 2000);
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Tap to Copy'; }, 2000);
    });
}

function connectToRoom() {
    state.socket = new PartySocket({
        host: PARTYKIT_HOST,
        room: state.roomCode
    });

    state.socket.addEventListener('open', () => {
        state.playerId = state.socket.id;
        state.socket.send(JSON.stringify({
            type: 'join',
            name: state.playerName,
            isCreator: state.isHost
        }));

        if (state.isHost) showRoomInfo();

        if (state.pingInterval) clearInterval(state.pingInterval);
        state.pingInterval = setInterval(() => {
            if (state.socket?.readyState === WebSocket.OPEN) {
                state.socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    });

    state.socket.addEventListener('message', (event) => {
        handleServerMessage(JSON.parse(event.data));
    });

    state.socket.addEventListener('error', (error) => {
        console.error('Connection error:', error);
    });

    state.socket.addEventListener('close', () => {
        if (state.pingInterval) {
            clearInterval(state.pingInterval);
            state.pingInterval = null;
        }
    });
}

function showRoomInfo() {
    elements.displayRoomCode.textContent = state.roomCode;
    elements.roomInfo.classList.remove('hidden');
    elements.mainMenu.classList.add('hidden');
    elements.createForm.classList.add('hidden');
    elements.joinForm.classList.add('hidden');
}

function updatePlayerList() {
    const players = state.gameState.players;
    elements.playerCount.textContent = players.length;

    elements.playerList.innerHTML = players
        .map(p => {
            const isHost = p.id === state.gameState.hostId;
            return `<span class="player-tag${isHost ? ' host' : ''}">${p.name}${isHost ? ' (Host)' : ''}</span>`;
        })
        .join('');

    state.isHost = state.gameState.hostId === state.playerId;

    if (state.isHost) {
        elements.spiceItUpContainer.style.pointerEvents = 'auto';
        elements.spiceItUpContainer.style.opacity = '1';

        if (players.length >= 2) {
            elements.startGame.classList.remove('hidden');
            elements.waitingText.classList.add('hidden');
        } else {
            elements.startGame.classList.add('hidden');
            elements.waitingText.textContent = 'Need at least 2 players to start...';
            elements.waitingText.classList.remove('hidden');
        }
    } else {
        elements.spiceItUpContainer.style.pointerEvents = 'none';
        elements.spiceItUpContainer.style.opacity = '0.6';
        elements.startGame.classList.add('hidden');
        elements.waitingText.textContent = 'Waiting for host to start...';
        elements.waitingText.classList.remove('hidden');
    }
}

// === SERVER MESSAGES ===
function handleServerMessage(data) {
    console.log('Server:', data.type, data);

    switch (data.type) {
        case 'state':
            syncGameState(data.state);
            if (data.state.gameStarted) startGame();
            break;

        case 'playerJoined':
            state.gameState.players = data.players;
            state.gameState.hostId = data.hostId;
            if (data.hostId === state.playerId) state.isHost = true;
            if (!state.isHost && data.player?.id === state.playerId) showRoomInfo();
            updatePlayerList();
            break;

        case 'playerLeft':
            state.gameState.players = data.players;
            state.gameState.hostId = data.hostId;
            if (data.hostId === state.playerId) state.isHost = true;
            updatePlayerList();
            if (state.gameState.gameStarted) renderOtherPlayers();
            break;

        case 'spiceItUpToggled':
            state.gameState.spiceItUpMode = data.spiceItUpMode;
            elements.spiceItUpCheck.checked = data.spiceItUpMode;
            break;

        case 'gameStarted':
            syncGameState(data.state);
            if (data.myHand) state.myHand = data.myHand;
            startGame();
            break;

        case 'cardDrawn':
            state.myHand = data.myHand;
            renderMyHand();
            break;

        case 'deckUpdated':
            state.gameState.deckCount = data.deckCount;
            if (data.players) state.gameState.players = data.players;
            renderDeck();
            renderOtherPlayers();
            break;

        case 'cardPlayed':
            state.myHand = data.myHand;
            renderMyHand();
            break;

        case 'stackUpdated':
            state.gameState.stackCount = data.stackCount;
            state.gameState.stack = data.stack || [];
            if (data.players) state.gameState.players = data.players;
            if (data.lastActivePlayerId !== undefined) state.gameState.lastActivePlayerId = data.lastActivePlayerId;
            if (data.stackCardFlips) state.stackCardFlips = data.stackCardFlips;
            renderStack();
            renderOtherPlayers();
            // Also re-render my hand to show active glow if it's me
            renderMyHand();
            break;

        case 'pointsUpdated':
            state.pointsZone = data.pointsZone;
            elements.pointsCount.textContent = calculateScore(state.pointsZone);
            break;

        case 'trophyClaimed':
            state.gameState.trophies = data.trophies;
            renderTrophies();
            break;

        case 'trophyTaken':
            state.gameState.trophies = data.trophies;
            // Update local trophiesTaken from server state
            data.trophies.forEach(t => {
                if (t.taken) {
                    state.trophiesTaken[t.id] = true;
                }
            });
            if (data.players) {
                state.gameState.players = data.players;
                renderOtherPlayers();
            }
            renderTrophies();
            break;

        case 'stackCardFlipped':
            state.stackCardFlips = data.stackCardFlips;
            renderStack();
            break;

        case 'trophyFlipped':
            state.trophyFlips = data.trophyFlips;
            renderTrophies();
            break;

        case 'worldsEndRevealed':
            // Just mark as triggered - deck is now blocked
            state.gameState.worldsEndTriggered = true;
            renderDeck();
            break;

        case 'gameReset':
            syncGameState(data.state);
            state.pointsZone = [];
            state.trophiesTaken = {};  // Clear trophy taken tracking
            state.stackCardFlips = {}; // Clear stack card flips
            elements.pointsCount.textContent = '0';
            if (elements.pointsCards) elements.pointsCards.innerHTML = '';
            elements.game.classList.remove('active');
            elements.lobby.classList.add('active');
            elements.mainMenu.classList.add('hidden');
            elements.roomInfo.classList.remove('hidden');
            updatePlayerList();
            break;

        case 'error':
            showError(data.message);
            if (data.message.includes('Room not found')) {
                state.socket?.close();
                state.socket = null;
                elements.roomInfo.classList.add('hidden');
                elements.mainMenu.classList.add('hidden');
                elements.joinForm.classList.remove('hidden');
            }
            break;
    }
}

function syncGameState(serverState) {
    state.gameState.players = serverState.players || [];
    state.gameState.phase = serverState.phase;
    state.gameState.hostId = serverState.hostId;
    state.gameState.gameStarted = serverState.gameStarted;
    state.gameState.lastActivePlayerId = serverState.lastActivePlayerId;
    state.gameState.spiceItUpMode = serverState.spiceItUpMode;
    state.gameState.spiceItUpCards = serverState.spiceItUpCards || [];
    state.gameState.deckCount = serverState.deckCount;
    state.gameState.worldsEndTriggered = serverState.worldsEndTriggered;
    state.gameState.stackCount = serverState.stackCount;
    state.gameState.stack = serverState.stack || [];
    state.gameState.trophies = serverState.trophies || [];

    // Sync flip states
    if (serverState.stackCardFlips) state.stackCardFlips = serverState.stackCardFlips;
    if (serverState.trophyFlips) state.trophyFlips = serverState.trophyFlips;
}

function calculateScore(pointsZone) {
    if (!pointsZone || !Array.isArray(pointsZone)) return 0;
    return pointsZone.reduce((total, item) => {
        // Trophies are worth 10 points
        if (item.type === 'trophy' || (item.id && item.id.startsWith('trophy'))) {
            return total + 10;
        }
        // Regular cards are worth 1 point
        return total + 1;
    }, 0);
}

// === GAME ===
function startGame() {
    elements.lobby.classList.remove('active');
    elements.game.classList.add('active');
    state.pan = { x: 0, y: 0 };
    state.zoom = 1;
    updateWorldTransform();
    renderGame();
}

function renderGame() {
    renderDeck();
    renderStack();
    renderTrophies();
    renderSpiceItUp();
    renderOtherPlayers();
    renderMyHand();
    updateZoomInfo();
}

function renderDeck() {
    const count = state.gameState.deckCount;
    const isBlocked = state.gameState.worldsEndTriggered;
    elements.deckCount.textContent = count;

    // Apply disabled state if World's End was revealed
    if (isBlocked) {
        elements.deck.classList.add('disabled');
    } else {
        elements.deck.classList.remove('disabled');
    }

    const stackLayers = Math.min(4, Math.max(1, Math.ceil(count / 20)));
    let html = '';

    if (isBlocked) {
        // Show World's End card on top
        html = `<div class="deck-card" style="top: 0; left: 0; z-index: 5;">
            <img src="/cards/worlds end card.png" alt="World's End" draggable="false">
        </div>`;
    } else {
        for (let i = stackLayers - 1; i >= 0; i--) {
            html += `<div class="deck-card" style="top: ${i * 3}px; left: ${i * 3}px; z-index: ${stackLayers - i};">
                <img src="/cards/back number.png" alt="Card back" draggable="false">
            </div>`;
        }
    }
    elements.deck.innerHTML = html;

    // World's End indicator
    if (isBlocked) {
        elements.worldsEndIndicator.textContent = "World's End!";
        elements.worldsEndIndicator.classList.remove('hidden');
        elements.worldsEndIndicator.classList.add('triggered');
    } else if (count <= 15 && count > 0) {
        elements.worldsEndIndicator.textContent = "World's End Near!";
        elements.worldsEndIndicator.classList.remove('hidden');
        elements.worldsEndIndicator.classList.remove('triggered');
    } else {
        elements.worldsEndIndicator.classList.add('hidden');
    }
}

function renderStack() {
    // Show stack with CARD BACKS (face down) unless flipped
    const stack = state.gameState.stack;

    if (stack.length > 0) {
        const showCount = Math.min(stack.length, 4);
        let html = '';

        for (let i = 0; i < showCount; i++) {
            const stackIndex = stack.length - showCount + i;
            const card = stack[stackIndex];
            const offset = (showCount - 1 - i) * 3;
            const isFlipped = state.stackCardFlips[card.id] || false;
            const imgSrc = isFlipped ? `/cards/${card.image}` : '/cards/back number.png';

            html += `<div class="stack-card-layer" style="top: ${offset}px; left: ${offset}px; z-index: ${i + 1};" 
                data-stack-index="${stackIndex}" 
                data-card-id="${card.id}"
                data-flipped="${isFlipped}">
                <img src="${imgSrc}" alt="Card" draggable="false">
            </div>`;
        }
        elements.stackContainer.innerHTML = html;

        // Add double-click/tap handlers for flipping
        elements.stackContainer.querySelectorAll('.stack-card-layer').forEach(el => {
            el.addEventListener('dblclick', () => flipStackCard(el.dataset.cardId));
            // For mobile double-tap
            let lastTap = 0;
            el.addEventListener('touchend', (e) => {
                const now = Date.now();
                if (now - lastTap < 300) {
                    flipStackCard(el.dataset.cardId);
                    e.preventDefault();
                }
                lastTap = now;
            });
        });
    } else {
        elements.stackContainer.innerHTML = '';
    }

    elements.stackCount.textContent = stack.length;
}

function flipStackCard(cardId) {
    if (state.socket && state.gameState.gameStarted) {
        state.socket.send(JSON.stringify({
            type: 'flipStackCard',
            cardId: cardId
        }));
    }
}

function renderTrophies() {
    const trophies = state.gameState.trophies;
    elements.trophies.innerHTML = trophies.map(t => {
        // Check if trophy has been taken (from server or local state)
        const isTaken = t.taken || state.trophiesTaken[t.id] || false;
        // Check flip state (from server or local)
        const isFlipped = state.trophyFlips[t.id] || false;
        // Front = trophy.png, Back = trophy back.png
        const imgSrc = isFlipped ? '/cards/trophy back.png' : '/cards/trophy.png';
        const takenClass = isTaken ? 'taken' : '';
        return `<div class="trophy-card ${takenClass}" data-trophy-id="${t.id}" data-flipped="${isFlipped}" draggable="false">
            <img src="${imgSrc}" alt="Trophy" draggable="false">
        </div>`;
    }).join('');

    // Add double-click/tap handlers for flipping
    elements.trophies.querySelectorAll('.trophy-card').forEach(el => {
        el.addEventListener('dblclick', () => flipTrophy(el.dataset.trophyId));
        // For mobile double-tap
        let lastTap = 0;
        el.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTap < 300) {
                flipTrophy(el.dataset.trophyId);
                e.preventDefault();
            }
            lastTap = now;
        });
    });
}

function flipTrophy(trophyId) {
    if (state.socket && state.gameState.gameStarted) {
        state.socket.send(JSON.stringify({
            type: 'flipTrophy',
            trophyId: trophyId
        }));
    }
}

function renderSpiceItUp() {
    if (state.gameState.spiceItUpMode && state.gameState.spiceItUpCards.length > 0) {
        const card = state.gameState.spiceItUpCards[0];
        elements.spiceItUpDisplay.innerHTML = `<img src="/cards/${card.image}" alt="${card.name}" draggable="false">`;
        elements.spiceItUpDisplay.classList.remove('hidden');
    } else {
        elements.spiceItUpDisplay.classList.add('hidden');
    }
}

function renderOtherPlayers() {
    const otherPlayers = state.gameState.players.filter(p => p.id !== state.playerId);

    elements.otherPlayersArea.innerHTML = otherPlayers.map((p, index) => {
        // Calculate position around the circle
        // ... (existing position logic if any, simplified here since CSS handles layout via flex/gap for now or basic index mapping)

        // Use fixed positions if needed, but current CSS uses flex gap
        // Just render them in order

        const isFlipped = state.spiceItUpMode ? 'flipped' : '';
        const activeClass = (p.id === state.gameState.lastActivePlayerId) ? 'active-glow' : '';

        return `
            <div class="other-player" data-id="${p.id}">
                <div class="other-player-name ${activeClass}">${p.name} (${p.handCount})</div>
                <div class="other-player-hand">
                    ${Array(p.handCount).fill(0).map((_, i) => `
                        <div class="other-player-card">
                            <img src="/cards/back number.png" alt="Card Back">
                        </div>
                    `).join('')}
                </div>
                <div class="other-player-info" style="font-size: 0.75rem; color: #777; margin-top: 4px;">
                    Points: ${p.pointsCount}
                </div>
            </div>
        `;
    }).join('');
}

function renderMyHand() {
    if (!state.myHand) return;

    // Update my info
    elements.myPlayerInfo.textContent = `${state.playerName} (${state.myHand.length})`;

    // Toggle active glow
    if (state.socket && state.socket.id === state.gameState.lastActivePlayerId) {
        elements.myPlayerInfo.classList.add('active-glow');
    } else {
        elements.myPlayerInfo.classList.remove('active-glow');
    }

    elements.myHand.innerHTML = state.myHand.map((card, index) => {
        return `<div class="hand-card" data-card-id="${card.id}" data-card-index="${index}">
            <img src="/cards/${card.image}" alt="${card.type}" draggable="false">
        </div>`;
    }).join('');
}

// === PAN/ZOOM ===
function setupPanZoom() {
    const canvas = elements.gameCanvas;

    canvas.addEventListener('mousedown', (e) => {
        if (state.isDragging) return;
        if (e.target.closest('.hand-card, .trophy-card, .deck, .points-button, .stack-container')) return;

        state.isPanning = true;
        state.lastPanPoint = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mousemove', (e) => {
        if (state.isPanning && state.lastPanPoint && !state.isDragging) {
            const dx = e.clientX - state.lastPanPoint.x;
            const dy = e.clientY - state.lastPanPoint.y;
            state.pan.x += dx;
            state.pan.y += dy;
            state.lastPanPoint = { x: e.clientX, y: e.clientY };
            updateWorldTransform();
        }
    });

    document.addEventListener('mouseup', () => {
        state.isPanning = false;
        state.lastPanPoint = null;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.85 : 1.15;
        state.zoom = Math.min(Math.max(state.zoom * delta, 0.7), 3.0);
        updateWorldTransform();
    }, { passive: false });

    let touchStart = null;
    let initialDistance = null;
    let initialZoom = 1;

    canvas.addEventListener('touchstart', (e) => {
        if (state.isDragging) return;

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            if (!touch.target.closest('.hand-card, .trophy-card, .deck, .points-button, .stack-container')) {
                touchStart = { x: touch.clientX, y: touch.clientY };
            }
        } else if (e.touches.length === 2) {
            initialDistance = getTouchDistance(e.touches);
            initialZoom = state.zoom;
            touchStart = null;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (state.isDragging) return;

        if (e.touches.length === 1 && touchStart) {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStart.x;
            const dy = touch.clientY - touchStart.y;
            state.pan.x += dx;
            state.pan.y += dy;
            touchStart = { x: touch.clientX, y: touch.clientY };
            updateWorldTransform();
        } else if (e.touches.length === 2 && initialDistance) {
            e.preventDefault();
            const newDistance = getTouchDistance(e.touches);
            const scale = newDistance / initialDistance;
            state.zoom = Math.min(Math.max(initialZoom * scale, 0.7), 3.0);
            updateWorldTransform();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        touchStart = null;
        initialDistance = null;
    });
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function updateWorldTransform() {
    // Pan limits - prevent going too far off screen (dynamic based on zoom)
    // Board size is 1200x900. Allow panning to edge + a bit of margin
    const maxPanX = (600 * state.zoom) + 150;
    const maxPanY = (450 * state.zoom) + 150;

    state.pan.x = Math.max(-maxPanX, Math.min(maxPanX, state.pan.x));
    state.pan.y = Math.max(-maxPanY, Math.min(maxPanY, state.pan.y));

    const world = elements.gameWorld;
    world.style.transform = `translate(calc(-50% + ${state.pan.x}px), calc(-50% + ${state.pan.y}px)) scale(${state.zoom})`;
}

function updateZoomInfo() {
    const zoomPercent = Math.round(state.zoom * 100);
    if (elements.zoomInfo) {
        elements.zoomInfo.textContent = `Zoom: ${zoomPercent}%`;
    }
}

// === GAME HANDLERS ===
function setupGameHandlers() {
    elements.deck.addEventListener('click', () => {
        // Block deck if World's End was triggered
        if (state.gameState.worldsEndTriggered) return;
        if (state.socket && state.gameState.gameStarted && !state.isDragging) {
            state.socket.send(JSON.stringify({ type: 'drawCard' }));
        }
    });

    elements.pointsButton.addEventListener('click', () => {
        if (!state.isDragging) showPointsPopup();
    });

    elements.closePoints.addEventListener('click', () => {
        elements.pointsPopup.classList.add('hidden');
    });

    elements.worldsEndOk.addEventListener('click', () => {
        elements.worldsEndModal.classList.add('hidden');
        state.socket?.send(JSON.stringify({ type: 'reset' }));
    });

    elements.errorOk.addEventListener('click', () => {
        elements.errorModal.classList.add('hidden');
    });

    // Restart button - shows in-game modal
    elements.restartButton.addEventListener('click', () => {
        if (state.socket && state.gameState.gameStarted) {
            elements.restartModal.classList.remove('hidden');
        }
    });

    // Restart modal confirm
    elements.restartConfirm.addEventListener('click', () => {
        elements.restartModal.classList.add('hidden');
        state.socket?.send(JSON.stringify({ type: 'reset' }));
    });

    // Restart modal cancel
    elements.restartCancel.addEventListener('click', () => {
        elements.restartModal.classList.add('hidden');
    });

    // Take all stack to points button
    elements.takeAllStackBtn.addEventListener('click', () => {
        if (state.socket && state.gameState.gameStarted && state.gameState.stackCount > 0) {
            state.socket.send(JSON.stringify({
                type: 'addToPoints',
                fromStack: true
            }));
        }
    });
}

// === DRAG HANDLERS ===
function setupDragHandlers() {
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);

    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
}

function getDraggableElement(target) {
    const handCard = target.closest('.hand-card');
    if (handCard) return { el: handCard, source: 'hand' };

    const stackCard = target.closest('.stack-card-layer');
    if (stackCard) return { el: stackCard, source: 'stack' };

    const trophyCard = target.closest('.trophy-card:not(.claimed)');
    if (trophyCard) return { el: trophyCard, source: 'trophy' };

    return null;
}

function onPointerDown(e) {
    const draggable = getDraggableElement(e.target);
    if (!draggable) return;

    e.preventDefault();
    e.stopPropagation();

    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.dragCard = draggable.el;
    state.dragSource = draggable.source;
    state.hasMoved = false;

    // Get card data based on source
    if (draggable.source === 'hand') {
        const cardId = draggable.el.dataset.cardId;
        state.dragCardData = state.myHand.find(c => c.id === cardId);
    } else if (draggable.source === 'stack') {
        // Stack cards - just mark for taking
        state.dragCardData = { fromStack: true };
    } else if (draggable.source === 'trophy') {
        state.dragCardData = { trophyId: draggable.el.dataset.trophyId };
    }
}

function onTouchStart(e) {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const draggable = getDraggableElement(touch.target);
    if (!draggable) return;

    e.preventDefault();

    state.dragStartX = touch.clientX;
    state.dragStartY = touch.clientY;
    state.dragCard = draggable.el;
    state.dragSource = draggable.source;
    state.hasMoved = false;

    if (draggable.source === 'hand') {
        const cardId = draggable.el.dataset.cardId;
        state.dragCardData = state.myHand.find(c => c.id === cardId);
    } else if (draggable.source === 'stack') {
        state.dragCardData = { fromStack: true };
    } else if (draggable.source === 'trophy') {
        state.dragCardData = { trophyId: draggable.el.dataset.trophyId };
    }
}

function onPointerMove(e) {
    if (!state.dragCard) return;

    const dx = Math.abs(e.clientX - state.dragStartX);
    const dy = Math.abs(e.clientY - state.dragStartY);

    if (!state.isDragging && (dx > state.dragThreshold || dy > state.dragThreshold)) {
        startDrag(state.dragCard, state.dragStartX, state.dragStartY);
    }

    if (state.isDragging) {
        moveDrag(e.clientX, e.clientY);
    }
}

function onTouchMove(e) {
    if (!state.dragCard || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - state.dragStartX);
    const dy = Math.abs(touch.clientY - state.dragStartY);

    if (!state.isDragging && (dx > state.dragThreshold || dy > state.dragThreshold)) {
        startDrag(state.dragCard, state.dragStartX, state.dragStartY);
    }

    if (state.isDragging) {
        e.preventDefault();
        moveDrag(touch.clientX, touch.clientY);
    }
}

function startDrag(card, x, y) {
    const rect = card.getBoundingClientRect();

    state.isDragging = true;
    state.hasMoved = true;
    state.dragOffsetX = x - rect.left;
    state.dragOffsetY = y - rect.top;

    state.dragClone = card.cloneNode(true);
    state.dragClone.className = 'drag-clone';
    state.dragClone.style.width = `${rect.width}px`;
    state.dragClone.style.height = `${rect.height}px`;
    state.dragClone.style.left = `${rect.left}px`;
    state.dragClone.style.top = `${rect.top}px`;
    document.body.appendChild(state.dragClone);

    card.classList.add('dragging');
}

function moveDrag(x, y) {
    if (!state.dragClone) return;

    state.dragClone.style.left = `${x - state.dragOffsetX}px`;
    state.dragClone.style.top = `${y - state.dragOffsetY}px`;

    // Check drop targets
    const pointsRect = elements.pointsButton.getBoundingClientRect();
    const isOverPoints = x >= pointsRect.left && x <= pointsRect.right &&
        y >= pointsRect.top && y <= pointsRect.bottom;

    if (isOverPoints) {
        elements.pointsButton.classList.add('drag-over');
    } else {
        elements.pointsButton.classList.remove('drag-over');
    }

    const stackRect = elements.stackContainer.getBoundingClientRect();
    const isOverStack = x >= stackRect.left && x <= stackRect.right &&
        y >= stackRect.top && y <= stackRect.bottom;

    if (isOverStack && state.dragSource === 'hand') {
        elements.stackContainer.style.outline = '3px dashed var(--pastel-orange)';
    } else {
        elements.stackContainer.style.outline = '';
    }

    // Check if over my hand area (for taking from stack)
    const handRect = elements.myHand.getBoundingClientRect();
    // Expand the hand area a bit for easier dropping
    const expandedHandRect = {
        left: handRect.left - 50,
        right: handRect.right + 50,
        top: handRect.top - 100,
        bottom: handRect.bottom + 50
    };
    const isOverHand = x >= expandedHandRect.left && x <= expandedHandRect.right &&
        y >= expandedHandRect.top && y <= expandedHandRect.bottom;

    if (isOverHand && state.dragSource === 'stack') {
        elements.myHand.style.outline = '3px dashed var(--pastel-green)';
    } else {
        elements.myHand.style.outline = '';
    }
}

function onPointerUp(e) {
    if (state.isDragging) {
        endDrag(e.clientX, e.clientY);
    }
    resetDragState();
}

function onTouchEnd(e) {
    if (state.isDragging) {
        const touch = e.changedTouches[0];
        endDrag(touch.clientX, touch.clientY);
    }
    resetDragState();
}

function endDrag(x, y) {
    // Clean up visuals
    state.dragCard?.classList.remove('dragging');
    state.dragClone?.remove();
    elements.pointsButton.classList.remove('drag-over');
    elements.stackContainer.style.outline = '';
    elements.myHand.style.outline = '';

    if (!state.hasMoved) return;

    const cardData = state.dragCardData;
    if (!cardData) return;

    // Check drop targets
    const pointsRect = elements.pointsButton.getBoundingClientRect();
    const isOverPoints = x >= pointsRect.left && x <= pointsRect.right &&
        y >= pointsRect.top && y <= pointsRect.bottom;

    const stackRect = elements.stackContainer.getBoundingClientRect();
    const isOverStack = x >= stackRect.left && x <= stackRect.right &&
        y >= stackRect.top && y <= stackRect.bottom;

    const handRect = elements.myHand.getBoundingClientRect();
    const expandedHandRect = {
        left: handRect.left - 50,
        right: handRect.right + 50,
        top: handRect.top - 100,
        bottom: handRect.bottom + 50
    };
    const isOverHand = x >= expandedHandRect.left && x <= expandedHandRect.right &&
        y >= expandedHandRect.top && y <= expandedHandRect.bottom;

    // Handle drops based on source
    if (state.dragSource === 'hand') {
        if (isOverStack && cardData.id) {
            // Play card to stack
            state.socket?.send(JSON.stringify({
                type: 'playCard',
                cardId: cardData.id
            }));
        } else if (isOverPoints && cardData.id) {
            // Move to points - Send to server
            state.socket?.send(JSON.stringify({
                type: 'addToPoints',
                cardId: cardData.id
            }));
        }
    } else if (state.dragSource === 'stack') {
        if (isOverHand) {
            // Take card from stack to hand
            state.socket?.send(JSON.stringify({
                type: 'takeFromStack'
            }));
        } else if (isOverPoints) {
            // Move entire stack to points
            state.socket?.send(JSON.stringify({
                type: 'addToPoints',
                fromStack: true
            }));
        }
    } else if (state.dragSource === 'trophy') {
        if (isOverPoints && cardData.trophyId) {
            // Add trophy to local points zone 
            state.pointsZone.push({
                id: cardData.trophyId,
                type: 'trophy',
                image: 'trophy.png'
            });
            elements.pointsCount.textContent = calculateScore(state.pointsZone);

            // Send to server so all players see trophy is taken
            state.socket?.send(JSON.stringify({
                type: 'takeTrophy',
                trophyId: cardData.trophyId
            }));
        }
    }
}

function resetDragState() {
    state.isDragging = false;
    state.dragCard = null;
    state.dragCardData = null;
    state.dragSource = null;
    state.dragClone = null;
    state.hasMoved = false;
}

function showPointsPopup() {
    elements.pointsCards.innerHTML = state.pointsZone.map(card => {
        // Show trophies face up, everything else (cards) face down
        const imgSrc = (card.type === 'trophy')
            ? `/cards/${card.image}`
            : '/cards/back number.png';

        return `<div class="card-mini"><img src="${imgSrc}" alt="Card" draggable="false"></div>`;
    }).join('') || '<p style="color: #777;">No cards yet</p>';

    elements.pointsPopup.classList.remove('hidden');
}

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorModal.classList.remove('hidden');
}

// Start app
init();

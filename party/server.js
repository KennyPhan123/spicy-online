// PartyKit Server for Spicy Card Game - Sandbox Mode
// Handles room management and game state sync

// Fisher-Yates shuffle
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Generate card ID
function generateCardId() {
    return Math.random().toString(36).substring(2, 9);
}

// Create the 100-card Spicy deck
function createSpicyDeck() {
    const cards = [];
    const spices = ['chilli', 'pepper', 'wasabi'];

    // 30 cards each spice (1-10, 3 of each number)
    for (const spice of spices) {
        for (let num = 1; num <= 10; num++) {
            for (let i = 0; i < 3; i++) {
                cards.push({
                    id: generateCardId(),
                    type: 'number',
                    spice: spice,
                    number: num,
                    image: `${num} ${spice}.png`
                });
            }
        }
    }

    // 5 Numbers Wild cards
    for (let i = 0; i < 5; i++) {
        cards.push({
            id: generateCardId(),
            type: 'wild_numbers',
            spice: null,
            number: null,
            image: 'numbers wild.png'
        });
    }

    // 5 Spices Wild cards
    for (let i = 0; i < 5; i++) {
        cards.push({
            id: generateCardId(),
            type: 'wild_spices',
            spice: null,
            number: null,
            image: 'spices wild.png'
        });
    }

    return cards;
}

// Create Spice It Up cards
function createSpiceItUpCards() {
    return [
        { id: generateCardId(), type: 'spice_it_up', name: 'we_love_chilli', image: 'we love chilli.png' },
        { id: generateCardId(), type: 'spice_it_up', name: 'start_it_up', image: 'start it up.png' },
        { id: generateCardId(), type: 'spice_it_up', name: 'spice_raider', image: 'spice raider.png' },
        { id: generateCardId(), type: 'spice_it_up', name: 'change_your_luck', image: 'change your luck.png' },
        { id: generateCardId(), type: 'spice_it_up', name: 'turn_it_up', image: 'turn it up.png' },
        { id: generateCardId(), type: 'spice_it_up', name: 'copycat', image: 'copycat.png' }
    ];
}

export default class SpicyServer {
    constructor(room) {
        this.room = room;
        this.gameState = this.createInitialState();
    }

    createInitialState() {
        return {
            players: [],
            phase: 'LOBBY',
            hostId: null,
            gameStarted: false,
            spiceItUpMode: false,
            spiceItUpMode: false,
            spiceItUpCards: [],
            lastActivePlayerId: null, // Track who played last on the stack (for glow)

            // Deck - World's End is inserted INTO the deck at a specific position
            deck: [],
            worldsEndTriggered: false,
            cardsDrawnBeforeWorldsEnd: 0, // Track how many cards until World's End

            // Game areas
            spicyStack: [], // Center pile where cards are played (synced to all clients)
            stackCardFlips: {}, // Track flipped state of stack cards
            trophyFlips: {}, // Track flipped state of trophies
            trophies: [
                { id: 'trophy1', available: true, ownerId: null },
                { id: 'trophy2', available: true, ownerId: null },
                { id: 'trophy3', available: true, ownerId: null }
            ]
        };
    }

    onConnect(connection, ctx) {
        connection.send(JSON.stringify({
            type: 'state',
            state: this.getPublicState(connection.id)
        }));
    }

    onMessage(message, sender) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join':
                    this.handleJoin(data, sender);
                    break;
                case 'leave':
                    this.handleLeave(sender);
                    break;
                case 'toggleSpiceItUp':
                    this.handleToggleSpiceItUp(sender);
                    break;
                case 'start':
                    this.handleStart(sender);
                    break;
                case 'drawCard':
                    this.handleDrawCard(sender);
                    break;
                case 'playCard':
                    this.handlePlayCard(data, sender);
                    break;
                case 'takeFromStack':
                    this.handleTakeFromStack(data, sender);
                    break;
                case 'addToPoints':
                    this.handleAddToPoints(data, sender);
                    break;
                case 'claimTrophy':
                    this.handleClaimTrophy(data, sender);
                    break;
                case 'takeTrophy':
                    this.handleTakeTrophy(data, sender);
                    break;
                case 'flipStackCard':
                    this.handleFlipStackCard(data, sender);
                    break;
                case 'flipTrophy':
                    this.handleFlipTrophy(data, sender);
                    break;
                case 'reset':
                    this.handleReset(sender);
                    break;
                case 'ping':
                    sender.send(JSON.stringify({ type: 'pong' }));
                    break;
            }
        } catch (e) {
            console.error('Message parse error:', e);
        }
    }

    onClose(connection) {
        this.handleLeave(connection);
    }

    // === HANDLERS ===

    handleJoin(data, sender) {
        if (this.gameState.gameStarted) {
            sender.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
            return;
        }

        if (this.gameState.players.length >= 6) {
            sender.send(JSON.stringify({ type: 'error', message: 'Room is full (max 6 players)' }));
            return;
        }

        const existingPlayer = this.gameState.players.find(p => p.id === sender.id);

        if (!existingPlayer && this.gameState.players.length === 0 && !data.isCreator) {
            sender.send(JSON.stringify({
                type: 'error',
                message: 'Room not found. Please check the room code and try again.'
            }));
            return;
        }

        if (!existingPlayer) {
            const player = {
                id: sender.id,
                name: data.name,
                hand: [],
                pointsZone: []
            };
            this.gameState.players.push(player);
        }

        if (this.gameState.players.length === 1) {
            this.gameState.hostId = sender.id;
        }

        this.broadcast({
            type: 'playerJoined',
            player: this.gameState.players.find(p => p.id === sender.id),
            hostId: this.gameState.hostId,
            players: this.getPublicPlayers()
        });
    }

    handleLeave(sender) {
        const index = this.gameState.players.findIndex(p => p.id === sender.id);
        if (index !== -1) {
            this.gameState.players.splice(index, 1);

            if (this.gameState.hostId === sender.id && this.gameState.players.length > 0) {
                this.gameState.hostId = this.gameState.players[0].id;
            }

            this.broadcast({
                type: 'playerLeft',
                playerId: sender.id,
                hostId: this.gameState.hostId,
                players: this.getPublicPlayers()
            });
        }
    }

    handleToggleSpiceItUp(sender) {
        if (sender.id !== this.gameState.hostId) return;
        if (this.gameState.gameStarted) return;

        this.gameState.spiceItUpMode = !this.gameState.spiceItUpMode;

        this.broadcast({
            type: 'spiceItUpToggled',
            spiceItUpMode: this.gameState.spiceItUpMode
        });
    }

    handleStart(sender) {
        if (sender.id !== this.gameState.hostId) return;
        if (this.gameState.players.length < 2) {
            sender.send(JSON.stringify({ type: 'error', message: 'Need at least 2 players' }));
            return;
        }

        this.gameState.gameStarted = true;
        this.gameState.phase = 'PLAYING';

        // Create and shuffle deck (100 cards)
        let deck = shuffleArray(createSpicyDeck());
        const playerCount = this.gameState.players.length;

        // Deal 6 cards to each player FIRST
        for (const player of this.gameState.players) {
            player.hand = deck.splice(0, 6);
        }

        // Now calculate World's End position in REMAINING deck
        const remainingCount = deck.length;

        // World's End is placed at a position based on player count
        // 2 players: 3/4 from bottom (so 1/4 from top)
        // 3-4 players: 1/2 from bottom (so 1/2 from top)
        // 5-6 players: 1/4 from bottom (so 3/4 from top)
        let positionFromTop;
        if (playerCount === 2) {
            positionFromTop = Math.floor(remainingCount * 0.25);
        } else if (playerCount <= 4) {
            positionFromTop = Math.floor(remainingCount * 0.5);
        } else {
            positionFromTop = Math.floor(remainingCount * 0.75);
        }

        // World's End card (marker)
        const worldsEndCard = {
            id: 'worlds_end',
            type: 'worlds_end',
            image: 'worlds end card.png'
        };

        // Insert World's End into deck at calculated position
        deck.splice(positionFromTop, 0, worldsEndCard);

        this.gameState.deck = deck;
        this.gameState.worldsEndTriggered = false;

        // If Spice It Up mode, select a random card
        if (this.gameState.spiceItUpMode) {
            const spiceItUpCards = shuffleArray(createSpiceItUpCards());
            this.gameState.spiceItUpCards = [spiceItUpCards[0]];
        }

        // Reset spicy stack
        this.gameState.spicyStack = [];

        // Send personalized state to each player
        for (const player of this.gameState.players) {
            const conn = this.getConnection(player.id);
            if (conn) {
                conn.send(JSON.stringify({
                    type: 'gameStarted',
                    state: this.getPublicState(player.id),
                    myHand: player.hand
                }));
            }
        }
    }

    handleDrawCard(sender) {
        if (!this.gameState.gameStarted) return;
        if (this.gameState.worldsEndTriggered) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        if (this.gameState.deck.length === 0) {
            sender.send(JSON.stringify({ type: 'error', message: 'Deck is empty' }));
            return;
        }

        // Draw the top card
        const card = this.gameState.deck.shift();

        // Check if it's World's End
        if (card.type === 'worlds_end') {
            this.gameState.worldsEndTriggered = true;
            this.broadcast({
                type: 'worldsEndRevealed',
                message: "World's End card revealed! Game ends!"
            });
            return;
        }

        // Add to player's hand
        player.hand.push(card);

        // Send updated hand to player
        sender.send(JSON.stringify({
            type: 'cardDrawn',
            myHand: player.hand
        }));

        // Broadcast deck update and player hand count update to all
        this.broadcast({
            type: 'deckUpdated',
            deckCount: this.gameState.deck.length,
            players: this.getPublicPlayers()
        });
    }

    handlePlayCard(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
        if (cardIndex === -1) return;

        // Remove from hand and add to spicy stack
        const card = player.hand.splice(cardIndex, 1)[0];
        this.gameState.spicyStack.push({
            ...card,
            playedBy: sender.id,
            playedByName: player.name
        });

        // Update active player glow
        this.gameState.lastActivePlayerId = sender.id;

        // RESET FLIP STATE: Card played to stack is always face down
        delete this.gameState.stackCardFlips[data.cardId];

        // Send updated hand to player
        sender.send(JSON.stringify({
            type: 'cardPlayed',
            myHand: player.hand
        }));

        // Broadcast stack update with full stack data
        this.broadcast({
            type: 'stackUpdated',
            stackCount: this.gameState.spicyStack.length,
            stack: this.gameState.spicyStack,
            players: this.getPublicPlayers()
        });
    }

    handleTakeFromStack(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        if (this.gameState.spicyStack.length === 0) return;

        // Take the top card from stack
        const card = this.gameState.spicyStack.pop();

        // Clean up the card (remove playedBy info) and add to player's hand
        const cleanCard = {
            id: card.id,
            type: card.type,
            spice: card.spice,
            number: card.number,
            image: card.image
        };
        player.hand.push(cleanCard);

        // Send updated hand to player
        sender.send(JSON.stringify({
            type: 'cardDrawn',
            myHand: player.hand
        }));

        // Broadcast stack update
        this.broadcast({
            type: 'stackUpdated',
            stackCount: this.gameState.spicyStack.length,
            stack: this.gameState.spicyStack,
            players: this.getPublicPlayers()
        });
    }

    handleAddToPoints(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        if (data.fromStack && this.gameState.spicyStack.length > 0) {
            const cards = this.gameState.spicyStack.splice(0);
            player.pointsZone.push(...cards);
        }

        sender.send(JSON.stringify({
            type: 'pointsUpdated',
            pointsZone: player.pointsZone
        }));

        this.broadcast({
            type: 'stackUpdated',
            stackCount: this.gameState.spicyStack.length,
            stack: this.gameState.spicyStack,
            players: this.getPublicPlayers()
        });
    }

    handleClaimTrophy(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        const trophy = this.gameState.trophies.find(t => t.id === data.trophyId && t.available);
        if (!trophy) return;

        trophy.available = false;
        trophy.ownerId = sender.id;

        this.broadcast({
            type: 'trophyClaimed',
            trophyId: trophy.id,
            ownerId: sender.id,
            ownerName: player.name,
            trophies: this.gameState.trophies
        });
    }

    handleTakeTrophy(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        const trophy = this.gameState.trophies.find(t => t.id === data.trophyId);
        if (!trophy) return;

        // Mark trophy as taken (hidden from table)
        trophy.taken = true;
        trophy.takenBy = sender.id;

        // Add to player's points zone so it persist
        player.pointsZone.push({
            id: trophy.id,
            type: 'trophy',
            image: 'trophy.png'
        });

        this.broadcast({
            type: 'trophyTaken',
            trophyId: trophy.id,
            takenBy: sender.id,
            takenByName: player.name,
            trophies: this.gameState.trophies
        });
    }

    handleFlipStackCard(data, sender) {
        if (!this.gameState.gameStarted) return;

        const cardId = data.cardId;
        // Toggle state
        this.gameState.stackCardFlips[cardId] = !this.gameState.stackCardFlips[cardId];

        this.broadcast({
            type: 'stackCardFlipped',
            cardId: cardId,
            isFlipped: this.gameState.stackCardFlips[cardId],
            stackCardFlips: this.gameState.stackCardFlips
        });
    }

    handleFlipTrophy(data, sender) {
        if (!this.gameState.gameStarted) return;

        const trophyId = data.trophyId;
        // Toggle state
        this.gameState.trophyFlips[trophyId] = !this.gameState.trophyFlips[trophyId];

        this.broadcast({
            type: 'trophyFlipped',
            trophyId: trophyId,
            isFlipped: this.gameState.trophyFlips[trophyId],
            trophyFlips: this.gameState.trophyFlips
        });
    }

    handleReset(sender) {
        // Any player can restart the game
        const existingPlayers = this.gameState.players.map(p => ({
            id: p.id,
            name: p.name
        }));
        const hostId = this.gameState.hostId;
        const spiceItUpMode = this.gameState.spiceItUpMode;

        this.gameState = this.createInitialState();
        this.gameState.hostId = hostId;
        this.gameState.spiceItUpMode = spiceItUpMode;

        for (const p of existingPlayers) {
            this.gameState.players.push({
                id: p.id,
                name: p.name,
                hand: [],
                pointsZone: []
            });
        }

        this.broadcast({
            type: 'gameReset',
            state: this.getPublicState(null)
        });
    }

    // === HELPERS ===

    getConnection(playerId) {
        for (const conn of this.room.getConnections()) {
            if (conn.id === playerId) return conn;
        }
        return null;
    }

    broadcast(message) {
        for (const conn of this.room.getConnections()) {
            conn.send(JSON.stringify(message));
        }
    }

    getPublicPlayers() {
        return this.gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            handCount: p.hand.length,
            pointsCount: p.pointsZone.length
        }));
    }

    getPublicState(requesterId) {
        return {
            players: this.getPublicPlayers(),
            phase: this.gameState.phase,
            hostId: this.gameState.hostId,
            gameStarted: this.gameState.gameStarted,
            lastActivePlayerId: this.gameState.lastActivePlayerId,
            spiceItUpMode: this.gameState.spiceItUpMode,
            spiceItUpCards: this.gameState.spiceItUpCards,
            deckCount: this.gameState.deck.length,
            worldsEndTriggered: this.gameState.worldsEndTriggered,
            stackCount: this.gameState.spicyStack.length,
            stackCount: this.gameState.spicyStack.length,
            stack: this.gameState.spicyStack,
            stackCardFlips: this.gameState.stackCardFlips,
            trophies: this.gameState.trophies,
            trophyFlips: this.gameState.trophyFlips
        };
    }
}

// Spicy card game rules and state. The Durable Object supplies room connections.

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

export default class SpicyGame {
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

    onMessage(data, sender) {
        switch (data.type) {
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
        }
    }

    // === HANDLERS ===

    handleLeave(playerId) {
        const index = this.gameState.players.findIndex(p => p.id === playerId);
        if (index === -1) return;

        this.gameState.players.splice(index, 1);

        if (this.gameState.players.length === 0) {
            // A room code can be reused once its last player has left.
            this.gameState = this.createInitialState();
        } else if (this.gameState.hostId === playerId) {
            this.gameState.hostId = (this.gameState.players.find(p => !p.disconnectedUntil)
                || this.gameState.players[0]).id;
        }

        this.broadcast({
            type: 'playerLeft',
            playerId,
            hostId: this.gameState.hostId,
            players: this.getPublicPlayers()
        });
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
        if (sender.id !== this.gameState.hostId || this.gameState.gameStarted) return;
        if (this.gameState.players.some(p => p.disconnectedUntil)) {
            sender.send(JSON.stringify({ type: 'error', message: 'Wait for disconnected players to reconnect.' }));
            return;
        }
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
                    state: this.getPublicState(),
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
            players: this.getPublicPlayers(),
            drawnBy: sender.id
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
            players: this.getPublicPlayers(),
            lastActivePlayerId: this.gameState.lastActivePlayerId,
            stackCardFlips: this.gameState.stackCardFlips
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
            players: this.getPublicPlayers(),
            lastActivePlayerId: this.gameState.lastActivePlayerId,
            stackCardFlips: this.gameState.stackCardFlips,
            takenBy: sender.id
        });
    }

    handleAddToPoints(data, sender) {
        if (!this.gameState.gameStarted) return;

        const player = this.gameState.players.find(p => p.id === sender.id);
        if (!player) return;

        let addedFromStack = false;

        if (data.fromStack && this.gameState.spicyStack.length > 0) {
            const cards = this.gameState.spicyStack.splice(0);
            player.pointsZone.push(...cards);
            addedFromStack = true;
        } else if (data.cardId) {
            // Move specific card from hand to points
            const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
            if (cardIndex !== -1) {
                const card = player.hand.splice(cardIndex, 1)[0];
                player.pointsZone.push(card);

                // Send updated hand to player
                sender.send(JSON.stringify({
                    type: 'cardPlayed', // Reuse cardPlayed to update hand
                    myHand: player.hand
                }));
            }
        }

        sender.send(JSON.stringify({
            type: 'pointsUpdated',
            pointsZone: player.pointsZone
        }));

        this.broadcast({
            type: 'stackUpdated',
            stackCount: this.gameState.spicyStack.length,
            stack: this.gameState.spicyStack,
            players: this.getPublicPlayers(),
            lastActivePlayerId: this.gameState.lastActivePlayerId,
            stackCardFlips: this.gameState.stackCardFlips,
            ...(addedFromStack && { addedToPointsBy: sender.id })
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
        if (!trophy || trophy.taken) return;

        // Mark trophy as taken (hidden from table)
        trophy.taken = true;
        trophy.takenBy = sender.id;

        // Add to player's points zone so it persist
        player.pointsZone.push({
            id: trophy.id,
            type: 'trophy',
            image: 'trophy.png'
        });

        sender.send(JSON.stringify({
            type: 'pointsUpdated',
            pointsZone: player.pointsZone
        }));

        this.broadcast({
            type: 'trophyTaken',
            trophyId: trophy.id,
            takenBy: sender.id,
            takenByName: player.name,
            trophies: this.gameState.trophies,
            players: this.getPublicPlayers()
        });
    }

    handleFlipStackCard(data, sender) {
        if (!this.gameState.gameStarted) return;

        const cardId = data.cardId;
        if (!this.gameState.spicyStack.some(card => card.id === cardId)) return;
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
        if (!this.gameState.trophies.some(trophy => trophy.id === trophyId)) return;
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
            name: p.name,
            sessionToken: p.sessionToken,
            connectionId: p.connectionId,
            disconnectedUntil: p.disconnectedUntil,
            hand: [],
            pointsZone: []
        }));
        const hostId = this.gameState.hostId;
        const spiceItUpMode = this.gameState.spiceItUpMode;

        this.gameState = this.createInitialState();
        this.gameState.hostId = hostId;
        this.gameState.spiceItUpMode = spiceItUpMode;

        this.gameState.players = existingPlayers;

        this.broadcast({
            type: 'gameReset',
            state: this.getPublicState()
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
            connected: !p.disconnectedUntil,
            handCount: p.hand.length,
            pointsCount: p.pointsZone.reduce((total, item) => {
                if (item.type === 'trophy' || (item.id && item.id.startsWith('trophy'))) {
                    return total + 10;
                }
                return total + 1;
            }, 0)
        }));
    }

    getPublicState() {
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
            stack: this.gameState.spicyStack,
            stackCardFlips: this.gameState.stackCardFlips,
            trophies: this.gameState.trophies,
            trophyFlips: this.gameState.trophyFlips
        };
    }
}

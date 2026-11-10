import { DurableObject } from 'cloudflare:workers';
import SpicyGame from './game.js';

const STATE_KEY = 'gameState';
const RECONNECT_GRACE_MS = 60_000;
const MAX_MESSAGE_LENGTH = 4096;
const GAME_COMMANDS = new Set([
    'toggleSpiceItUp', 'start', 'drawCard', 'playCard', 'takeFromStack',
    'addToPoints', 'claimTrophy', 'takeTrophy', 'flipStackCard', 'flipTrophy', 'reset'
]);

// One Durable Object owns one room, including its hibernatable WebSockets.
export class GameRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.game = new SpicyGame({ getConnections: () => this.getConnections() });

        // Heartbeats keep connections alive without waking an idle room.
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(
            '{"type":"ping"}', '{"type":"pong"}'
        ));

        ctx.blockConcurrencyWhile(async () => {
            const saved = await ctx.storage.get(STATE_KEY);
            if (!saved) return;
            this.game.gameState = saved;

            // A deployment or crash may end sockets without delivering close events.
            // Reconcile them with the sockets that survived hibernation.
            const connectedIds = new Set(this.getConnections().map(conn => conn.id));
            let changed = false;
            for (const player of saved.players) {
                if (!player.disconnectedUntil && !connectedIds.has(player.id)) {
                    player.connectionId = null;
                    player.disconnectedUntil = Date.now() + RECONNECT_GRACE_MS;
                    changed = true;
                }
            }
            if (changed) {
                this.chooseConnectedHost();
                await this.saveStateAndAlarm();
                this.broadcastConnections();
            }
        });
    }

    async fetch(request) {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        }

        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        // Attachments survive hibernation; unjoined sockets cannot receive room data.
        server.serializeAttachment({ playerId: null });
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, message) {
        if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
            ws.close(1009, 'Message too large or not text');
            return;
        }

        let data;
        try {
            data = JSON.parse(message);
        } catch {
            this.send(ws, { type: 'error', message: 'Invalid message.' });
            return;
        }
        if (!data || Array.isArray(data) || typeof data !== 'object' || typeof data.type !== 'string') {
            this.send(ws, { type: 'error', message: 'Invalid message.' });
            return;
        }

        const attachment = ws.deserializeAttachment();
        const playerId = attachment?.playerId;
        if (data.type === 'join') {
            if (playerId) return;
            const messages = this.captureMessages(queue => {
                this.expireDisconnectedPlayers();
                this.join(ws, data, queue);
            });
            await this.saveStateAndAlarm();
            this.flushMessages(messages);
            return;
        }

        const player = this.game.gameState.players.find(p => p.id === playerId);
        if (!player || player.disconnectedUntil || player.connectionId !== attachment.connectionId) {
            this.reject(ws, 'NOT_JOINED', 'Join a room before sending game actions.');
            return;
        }

        if (data.type === 'ping') {
            this.send(ws, { type: 'pong' });
        } else if (data.type === 'leave') {
            ws.serializeAttachment({ playerId: null });
            const messages = this.captureMessages(() => this.game.handleLeave(playerId));
            await this.saveStateAndAlarm();
            this.flushMessages(messages);
            ws.close(1000, 'Left room');
        } else if (GAME_COMMANDS.has(data.type)) {
            const messages = this.captureMessages(queue => this.game.onMessage(data, {
                id: playerId,
                send: message => queue(ws, message)
            }));
            await this.saveState();
            this.flushMessages(messages);
        }
    }

    join(ws, data, queue) {
        let player;
        if (data.sessionToken !== undefined) {
            player = typeof data.sessionToken === 'string'
                ? this.game.gameState.players.find(p => p.sessionToken === data.sessionToken)
                : null;
            if (!player) {
                this.reject(ws, 'SESSION_EXPIRED', 'Your session has expired. Please join the room again.');
                return;
            }

            // A page reload can reconnect before the previous socket closes. Retire
            // the old socket first so its eventual close cannot remove this player.
            for (const oldSocket of this.ctx.getWebSockets()) {
                if (oldSocket !== ws && oldSocket.deserializeAttachment()?.playerId === player.id) {
                    oldSocket.serializeAttachment({ playerId: null });
                    try { oldSocket.close(4001, 'Session continued elsewhere'); } catch { /* already closed */ }
                }
            }
            player.disconnectedUntil = null;
        } else {
            const name = typeof data.name === 'string' ? data.name.trim() : '';
            if (!name || name.length > 12) {
                this.reject(ws, 'INVALID_NAME', 'Please enter a name of up to 12 characters.');
                return;
            }
            const { players, gameStarted } = this.game.gameState;
            if (data.isCreator === true && players.length > 0) {
                this.reject(ws, 'ROOM_EXISTS', 'Room code already in use. Please create a new room.');
                return;
            }
            if (players.length === 0 && data.isCreator !== true) {
                this.reject(ws, 'ROOM_NOT_FOUND', 'Room not found. Please check the room code and try again.');
                return;
            }
            if (gameStarted) {
                this.reject(ws, 'GAME_STARTED', 'Game already started.');
                return;
            }
            if (players.length >= 6) {
                this.reject(ws, 'ROOM_FULL', 'Room is full (max 6 players).');
                return;
            }

            player = {
                id: crypto.randomUUID(),
                sessionToken: crypto.randomUUID(),
                name,
                disconnectedUntil: null,
                hand: [],
                pointsZone: []
            };
            players.push(player);
            if (players.length === 1) this.game.gameState.hostId = player.id;
        }

        player.connectionId = crypto.randomUUID();
        ws.serializeAttachment({ playerId: player.id, connectionId: player.connectionId });
        this.chooseConnectedHost();
        const players = this.game.getPublicPlayers();
        // The reconnect token, hand and points are sent only to their owner.
        queue(ws, JSON.stringify({
            type: 'joined',
            playerId: player.id,
            sessionToken: player.sessionToken,
            state: this.game.getPublicState(),
            myHand: player.hand,
            pointsZone: player.pointsZone
        }));
        this.game.broadcast({
            type: 'playerJoined',
            player: players.find(p => p.id === player.id),
            hostId: this.game.gameState.hostId,
            players
        });
    }

    async webSocketClose(ws) {
        await this.disconnect(ws);
    }

    async webSocketError(ws, error) {
        console.error('WebSocket error:', error);
        await this.disconnect(ws);
        try { ws.close(1011, 'Connection error'); } catch { /* already closed */ }
    }

    async disconnect(ws) {
        const attachment = ws.deserializeAttachment();
        const player = this.game.gameState.players.find(p => p.id === attachment?.playerId);
        // Close/error events from a replaced socket must not disconnect its successor.
        if (!player || player.disconnectedUntil || player.connectionId !== attachment.connectionId) return;

        player.connectionId = null;
        player.disconnectedUntil = Date.now() + RECONNECT_GRACE_MS;
        this.chooseConnectedHost();
        await this.saveStateAndAlarm();
        this.broadcastConnections();
    }

    async alarm() {
        const messages = this.captureMessages(() => this.expireDisconnectedPlayers());
        await this.saveStateAndAlarm();
        this.flushMessages(messages);
    }

    expireDisconnectedPlayers() {
        const now = Date.now();
        const expired = this.game.gameState.players
            .filter(p => p.disconnectedUntil && p.disconnectedUntil <= now)
            .map(p => p.id);
        for (const playerId of expired) this.game.handleLeave(playerId);
    }

    chooseConnectedHost() {
        const state = this.game.gameState;
        const host = state.players.find(p => p.id === state.hostId);
        if (host?.disconnectedUntil) {
            const replacement = state.players.find(p => !p.disconnectedUntil);
            if (replacement) state.hostId = replacement.id;
        }
    }

    broadcastConnections() {
        this.game.broadcast({
            type: 'playerConnectionChanged',
            hostId: this.game.gameState.hostId,
            players: this.game.getPublicPlayers()
        });
    }

    getConnections() {
        return this.ctx.getWebSockets().flatMap(ws => {
            const attachment = ws.deserializeAttachment();
            const player = this.game.gameState.players.find(p => p.id === attachment?.playerId);
            if (!player || player.disconnectedUntil || player.connectionId !== attachment.connectionId ||
                ws.readyState !== WebSocket.OPEN) return [];
            return [{ id: player.id, send: message => this.sendText(ws, message) }];
        });
    }

    // Collect game messages synchronously, then send only after the state is durable.
    captureMessages(action) {
        const messages = [];
        const originalRoom = this.game.room;
        this.game.room = {
            getConnections: () => this.getConnections().map(connection => ({
                id: connection.id,
                send: message => messages.push(() => connection.send(message))
            }))
        };
        try {
            action((ws, message) => messages.push(() => this.sendText(ws, message)));
        } finally {
            this.game.room = originalRoom;
        }
        return messages;
    }

    flushMessages(messages) {
        for (const send of messages) send();
    }

    send(ws, data) {
        this.sendText(ws, JSON.stringify(data));
    }

    sendText(ws, message) {
        // A client can disconnect between listing sockets and sending a broadcast.
        try {
            if (ws.readyState === WebSocket.OPEN) ws.send(message);
        } catch (error) {
            console.error('Could not send WebSocket message:', error);
        }
    }

    reject(ws, code, message) {
        this.send(ws, { type: 'error', code, message, fatal: true });
        ws.close(1008, message);
    }

    async saveState() {
        if (this.game.gameState.players.length) {
            await this.ctx.storage.put(STATE_KEY, this.game.gameState);
        } else {
            await this.ctx.storage.delete(STATE_KEY);
        }
    }

    async saveStateAndAlarm() {
        const deadlines = this.game.gameState.players
            .map(p => p.disconnectedUntil)
            .filter(Boolean);
        // Issue both writes before awaiting so SQLite can commit them atomically.
        const stateWrite = this.saveState();
        const alarmWrite = deadlines.length
            ? this.ctx.storage.setAlarm(Math.min(...deadlines))
            : this.ctx.storage.deleteAlarm();
        await Promise.all([stateWrite, alarmWrite]);
    }
}

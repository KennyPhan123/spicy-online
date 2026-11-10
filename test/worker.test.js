import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

const peers = [];

class Peer {
    constructor(socket) {
        this.socket = socket;
        this.messages = [];
        this.waiters = [];
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            const index = this.waiters.findIndex(waiter => waiter.matches(message));
            if (index === -1) this.messages.push(message);
            else {
                const [waiter] = this.waiters.splice(index, 1);
                clearTimeout(waiter.timer);
                waiter.resolve(message);
            }
        });
        socket.accept();
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    receive(type, predicate = () => true) {
        const matches = message => message.type === type && predicate(message);
        const index = this.messages.findIndex(matches);
        if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = { matches, resolve };
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(item => item !== waiter);
                reject(new Error(`Timed out waiting for ${type}; received ${this.messages.map(m => m.type).join(', ')}`));
            }, 3000);
            this.waiters.push(waiter);
        });
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'Test finished');
    }
}

async function connect(code) {
    const response = await exports.default.fetch(`https://example.com/api/rooms/${code}`, {
        headers: { Upgrade: 'websocket' }
    });
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeTruthy();
    const peer = new Peer(response.webSocket);
    peers.push(peer);
    return peer;
}

async function join(code, name, isCreator = false) {
    const peer = await connect(code);
    peer.send({ type: 'join', name, isCreator });
    return [peer, await peer.receive('joined')];
}

function room(code) {
    return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
}

afterEach(() => {
    for (const peer of peers.splice(0)) peer.close();
});

describe('Cloudflare Worker rooms', () => {
    it('validates routes and rejects joining a missing room', async () => {
        expect((await exports.default.fetch('https://example.com/api/rooms/ABC')).status).toBe(404);
        expect((await exports.default.fetch('https://example.com/api/rooms/ABC1')).status).toBe(404);
        expect((await exports.default.fetch('https://example.com/api/rooms/ABCD')).status).toBe(426);
        expect((await exports.default.fetch('https://example.com/api/rooms/ABCD', { method: 'POST' })).status).toBe(405);

        const peer = await connect('NONE');
        peer.send({ type: 'join', name: 'Guest', isCreator: false });
        const error = await peer.receive('error');
        expect(error.code).toBe('ROOM_NOT_FOUND');
        expect(error.fatal).toBe(true);
    });

    it('isolates rooms, deals private hands and synchronizes game actions', async () => {
        const [host, hostJoined] = await join('GAME', 'Host', true);
        const [guest, guestJoined] = await join('game', 'Guest');
        const [other, otherJoined] = await join('OTHR', 'Other', true);
        expect(guestJoined.state.players).toHaveLength(2);
        expect(otherJoined.state.players).toHaveLength(1);
        expect(JSON.stringify(guestJoined.state)).not.toContain(hostJoined.sessionToken);
        expect(JSON.stringify(hostJoined.state)).not.toContain(guestJoined.sessionToken);

        const collision = await connect('GAME');
        collision.send({ type: 'join', name: 'Creator', isCreator: true });
        expect((await collision.receive('error')).code).toBe('ROOM_EXISTS');

        host.send({ type: 'start' });
        const hostStart = await host.receive('gameStarted');
        const guestStart = await guest.receive('gameStarted');
        expect(hostStart.myHand).toHaveLength(6);
        expect(guestStart.myHand).toHaveLength(6);
        expect(hostStart.state.deckCount).toBe(89);
        expect(hostStart.state.players.every(p => !('hand' in p) && !('sessionToken' in p))).toBe(true);
        expect(hostStart.myHand.map(c => c.id)).not.toEqual(guestStart.myHand.map(c => c.id));

        host.send({ type: 'drawCard' });
        const drawn = await host.receive('cardDrawn');
        expect(drawn.myHand).toHaveLength(7);
        expect((await guest.receive('deckUpdated')).deckCount).toBe(88);

        const card = drawn.myHand[0];
        host.send({ type: 'playCard', cardId: card.id });
        expect((await host.receive('cardPlayed')).myHand).toHaveLength(6);
        expect((await guest.receive('stackUpdated', m => m.stackCount === 1)).stack[0].id).toBe(card.id);

        guest.send({ type: 'flipStackCard', cardId: card.id });
        expect((await host.receive('stackCardFlipped')).isFlipped).toBe(true);
        guest.send({ type: 'addToPoints', fromStack: true });
        expect((await guest.receive('pointsUpdated')).pointsZone.map(c => c.id)).toContain(card.id);
        expect((await host.receive('stackUpdated', m => m.stackCount === 0)).addedToPointsBy).toBe(guestJoined.playerId);

        guest.send({ type: 'takeTrophy', trophyId: 'trophy1' });
        const points = await guest.receive('pointsUpdated');
        expect(points.pointsZone.map(c => c.id)).toContain('trophy1');
        expect((await host.receive('trophyTaken')).players.find(p => p.id === guestJoined.playerId).pointsCount).toBe(11);

        guest.send({ type: 'reset' });
        expect((await host.receive('gameReset')).state.gameStarted).toBe(false);
        expect((await guest.receive('gameReset')).state.players).toHaveLength(2);
        other.send({ type: 'ping' });
        expect((await other.receive('pong')).type).toBe('pong');
    });

    it('preserves state and sockets when a Durable Object hibernates', async () => {
        const [host] = await join('SLIP', 'Host', true);
        const [guest] = await join('SLIP', 'Guest');
        host.send({ type: 'start' });
        const hostStart = await host.receive('gameStarted');
        await guest.receive('gameStarted');
        const cardId = hostStart.myHand[0].id;
        host.send({ type: 'playCard', cardId });
        await host.receive('cardPlayed');
        await guest.receive('stackUpdated', m => m.stackCount === 1);

        await evictDurableObject(room('SLIP'));
        guest.send({ type: 'flipStackCard', cardId });
        expect((await host.receive('stackCardFlipped')).cardId).toBe(cardId);
        host.send({ type: 'drawCard' });
        expect((await host.receive('cardDrawn')).myHand).toHaveLength(6);
        const updated = await guest.receive('deckUpdated');
        expect(updated.deckCount).toBe(88);
        expect(updated.players).toHaveLength(2);
    });

    it('reconnects with the same private hand and points and retires an old socket', async () => {
        const [host, hostJoined] = await join('BACK', 'Host', true);
        const [guest, guestJoined] = await join('BACK', 'Guest');
        host.send({ type: 'start' });
        const start = await host.receive('gameStarted');
        await guest.receive('gameStarted');
        host.send({ type: 'addToPoints', cardId: start.myHand[0].id });
        const hand = (await host.receive('cardPlayed')).myHand;
        const points = (await host.receive('pointsUpdated')).pointsZone;

        host.close();
        const disconnected = await guest.receive('playerConnectionChanged');
        expect(disconnected.players.find(p => p.id === hostJoined.playerId).connected).toBe(false);
        expect(disconnected.hostId).toBe(guestJoined.playerId);

        const reconnected = await connect('BACK');
        reconnected.send({ type: 'join', sessionToken: hostJoined.sessionToken });
        const resumed = await reconnected.receive('joined');
        expect(resumed.playerId).toBe(hostJoined.playerId);
        expect(resumed.myHand).toEqual(hand);
        expect(resumed.pointsZone).toEqual(points);
        expect(resumed.state.gameStarted).toBe(true);
        expect(resumed.state.hostId).toBe(guestJoined.playerId);
        await guest.receive('playerJoined', m => m.player.id === hostJoined.playerId);

        const replacement = await connect('BACK');
        const oldClosed = new Promise(resolve => reconnected.socket.addEventListener('close', resolve, { once: true }));
        replacement.send({ type: 'join', sessionToken: hostJoined.sessionToken });
        expect((await replacement.receive('joined')).myHand).toEqual(hand);
        expect((await oldClosed).code).toBe(4001);
        replacement.send({ type: 'drawCard' });
        expect((await replacement.receive('cardDrawn')).myHand).toHaveLength(6);
        const player = await runInDurableObject(room('BACK'), instance =>
            instance.game.gameState.players.find(p => p.id === hostJoined.playerId)
        );
        expect(player.disconnectedUntil).toBeNull();
    });

    it('keeps a disconnected creator reserved and promotes a newly connected player', async () => {
        const [host, hostJoined] = await join('WAIT', 'Host', true);
        host.close();
        await vi.waitFor(async () => {
            const player = await runInDurableObject(room('WAIT'), instance => instance.game.gameState.players[0]);
            expect(player.disconnectedUntil).toBeTruthy();
        });

        const collision = await connect('WAIT');
        collision.send({ type: 'join', name: 'Creator', isCreator: true });
        expect((await collision.receive('error')).code).toBe('ROOM_EXISTS');
        const [, guestJoined] = await join('WAIT', 'Guest');
        expect(guestJoined.state.hostId).toBe(guestJoined.playerId);
        expect(guestJoined.state.players.find(p => p.id === hostJoined.playerId).connected).toBe(false);
    });

    it('does not let unjoined or expired sessions control a game', async () => {
        const [host] = await join('SAFE', 'Host', true);
        const [guest] = await join('SAFE', 'Guest');
        host.send({ type: 'start' });
        await host.receive('gameStarted');
        await guest.receive('gameStarted');

        const outsider = await connect('SAFE');
        outsider.send({ type: 'reset' });
        expect((await outsider.receive('error')).code).toBe('NOT_JOINED');
        const imposter = await connect('SAFE');
        imposter.send({ type: 'join', sessionToken: 'wrong-token' });
        expect((await imposter.receive('error')).code).toBe('SESSION_EXPIRED');
        const started = await runInDurableObject(room('SAFE'), instance => instance.game.gameState.gameStarted);
        expect(started).toBe(true);
    });

    it('keeps disconnected sessions through reset and expires them with an alarm', async () => {
        const [host, hostJoined] = await join('TIME', 'Host', true);
        const [guest, guestJoined] = await join('TIME', 'Guest');
        host.close();
        await guest.receive('playerConnectionChanged');
        guest.send({ type: 'start' });
        expect((await guest.receive('error')).message).toMatch(/reconnect/i);
        guest.send({ type: 'reset' });
        await guest.receive('gameReset');

        const returning = await connect('TIME');
        returning.send({ type: 'join', sessionToken: hostJoined.sessionToken });
        expect((await returning.receive('joined')).playerId).toBe(hostJoined.playerId);
        await guest.receive('playerJoined', m => m.player.id === hostJoined.playerId);
        returning.close();
        await guest.receive('playerConnectionChanged');

        const stub = room('TIME');
        await runInDurableObject(stub, async (instance, ctx) => {
            instance.game.gameState.players.find(p => p.id === hostJoined.playerId).disconnectedUntil = Date.now() - 1;
            await ctx.storage.put('gameState', instance.game.gameState);
        });
        expect(await runDurableObjectAlarm(stub)).toBe(true);
        const left = await guest.receive('playerLeft');
        expect(left.playerId).toBe(hostJoined.playerId);
        expect(left.hostId).toBe(guestJoined.playerId);
        expect(left.players).toHaveLength(1);

        const guestClosed = new Promise(resolve => guest.socket.addEventListener('close', resolve, { once: true }));
        guest.send({ type: 'leave' });
        await guestClosed;
        // The explicit leave finishes after storage is cleaned up.
        await runInDurableObject(stub, async (_instance, ctx) => {
            expect(await ctx.storage.get('gameState')).toBeUndefined();
        });
        const missing = await connect('TIME');
        missing.send({ type: 'join', name: 'Late', isCreator: false });
        expect((await missing.receive('error')).code).toBe('ROOM_NOT_FOUND');
        const [, newRoom] = await join('TIME', 'New host', true);
        expect(newRoom.state.players).toHaveLength(1);
    });

    it('enforces the six-player limit and rejects new players after starting', async () => {
        const [host] = await join('FULL', 'Host', true);
        for (let i = 0; i < 5; i++) await join('FULL', `Guest${i}`);
        const seventh = await connect('FULL');
        seventh.send({ type: 'join', name: 'Seventh' });
        expect((await seventh.receive('error')).code).toBe('ROOM_FULL');
        host.send({ type: 'start' });
        await host.receive('gameStarted');
        const late = await connect('FULL');
        late.send({ type: 'join', name: 'Late' });
        expect((await late.receive('error')).code).toBe('GAME_STARTED');
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

vi.mock('../src/audio.js', () => ({ initAudio: vi.fn(), playSound: vi.fn() }));

let sockets;

class FakeWebSocket extends EventTarget {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
        super();
        this.url = String(url);
        this.readyState = 0;
        this.sent = [];
        sockets.push(this);
    }

    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatchEvent(new Event('open'));
    }

    send(message) {
        this.sent.push(JSON.parse(message));
    }

    receive(message) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    }

    close(code = 1000) {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code }));
    }
}

const player = (id, name, connected = true) => ({ id, name, connected, handCount: 0, pointsCount: 0 });
const roomState = (changes = {}) => ({
    players: [player('host', 'Host')],
    phase: 'LOBBY',
    hostId: 'host',
    gameStarted: false,
    lastActivePlayerId: null,
    spiceItUpMode: false,
    spiceItUpCards: [],
    deckCount: 0,
    worldsEndTriggered: false,
    stackCount: 0,
    stack: [],
    stackCardFlips: {},
    trophies: [],
    trophyFlips: {},
    ...changes
});

function joined(socket, changes = {}) {
    socket.receive({
        type: 'joined',
        playerId: 'host',
        sessionToken: 'secret-token',
        state: roomState(),
        myHand: [],
        pointsZone: [],
        ...changes
    });
}

function element(id) {
    return document.getElementById(id);
}

async function loadClient() {
    await import('../src/main.js');
}

function createRoom() {
    element('showCreate').click();
    element('createName').value = 'Host';
    element('createRoom').click();
    const socket = sockets.at(-1);
    socket.open();
    return socket;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    sessionStorage.clear();
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    sockets = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
});

describe('browser room connection', () => {
    it('connects on the page origin and shows the room only after joining', async () => {
        await loadClient();
        const socket = createRoom();
        expect(socket.url).toMatch(/^wss:\/\/spicy\.example\.test\/api\/rooms\/[A-Z]{4}$/);
        expect(socket.sent[0]).toMatchObject({ type: 'join', name: 'Host', isCreator: true });
        expect(element('roomInfo').classList.contains('hidden')).toBe(true);
        joined(socket);
        expect(element('roomInfo').classList.contains('hidden')).toBe(false);
        expect(element('displayRoomCode').textContent).toBe(socket.url.slice(-4));
        expect(JSON.parse(sessionStorage.getItem('spicy-online-session')).sessionToken).toBe('secret-token');

        const players = [player('host', 'Host'), player('guest', '<b>A</b>')];
        socket.receive({ type: 'playerJoined', players, hostId: 'host' });
        expect(element('playerCount').textContent).toBe('2');
        expect(element('playerList').textContent).toContain('<b>A</b>');
        expect(element('playerList').querySelector('b')).toBeNull();
        expect(element('startGame').classList.contains('hidden')).toBe(false);
        element('startGame').click();
        expect(socket.sent.at(-1)).toEqual({ type: 'start' });
    });

    it('restores the hand, points and game view after a dropped connection', async () => {
        await loadClient();
        const socket = createRoom();
        joined(socket);
        const playing = roomState({
            players: [player('host', 'Host'), player('guest', 'Guest')],
            phase: 'PLAYING',
            gameStarted: true,
            deckCount: 89
        });
        const cards = [{ id: 'card-1', type: 'number', image: '1 chilli.png' }];
        socket.receive({ type: 'gameStarted', state: playing, myHand: cards });
        expect(element('game').classList.contains('active')).toBe(true);
        expect(element('myHand').querySelectorAll('.hand-card')).toHaveLength(1);

        const sentBeforeDrop = socket.sent.length;
        socket.close(1006);
        expect(element('connectionStatus').textContent).toMatch(/reconnecting/i);
        element('deck').click();
        expect(socket.sent).toHaveLength(sentBeforeDrop);
        await vi.advanceTimersByTimeAsync(1000);
        const retry = sockets[1];
        retry.open();
        expect(retry.sent[0]).toMatchObject({ type: 'join', sessionToken: 'secret-token' });
        joined(retry, {
            state: playing,
            myHand: cards,
            pointsZone: [{ id: 'trophy1', type: 'trophy', image: 'trophy.png' }]
        });
        expect(element('connectionStatus').classList.contains('hidden')).toBe(true);
        expect(element('game').classList.contains('active')).toBe(true);
        expect(element('myHand').querySelectorAll('.hand-card')).toHaveLength(1);
        expect(element('pointsCount').textContent).toBe('10');
        element('deck').click();
        expect(retry.sent.at(-1)).toEqual({ type: 'drawCard' });
    });

    it('handles a rejected join without retrying and validates room codes', async () => {
        await loadClient();
        element('showJoin').click();
        element('joinName').value = 'Guest';
        element('roomCode').value = 'A1BC';
        element('joinRoom').click();
        expect(element('errorMessage').textContent).toMatch(/4-letter/);
        expect(sockets).toHaveLength(0);
        element('errorOk').click();

        element('roomCode').value = 'abcd';
        element('joinRoom').click();
        const socket = sockets[0];
        socket.open();
        expect(socket.url.endsWith('/ABCD')).toBe(true);
        socket.receive({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found.', fatal: true });
        expect(element('errorMessage').textContent).toBe('Room not found.');
        expect(element('joinForm').classList.contains('hidden')).toBe(false);
        expect(element('joinRoom').disabled).toBe(false);
        await vi.advanceTimersByTimeAsync(30000);
        expect(sockets).toHaveLength(1);
    });

    it('retries when a connection or join acknowledgement times out', async () => {
        await loadClient();
        element('showCreate').click();
        element('createName').value = 'Host';
        element('createRoom').click();
        const stalled = sockets[0];
        await vi.advanceTimersByTimeAsync(10000);
        expect(stalled.readyState).toBe(FakeWebSocket.CLOSED);
        expect(element('connectionStatus').textContent).toMatch(/reconnecting/i);
        await vi.advanceTimersByTimeAsync(1000);
        const retry = sockets[1];
        retry.open();
        joined(retry);
        await vi.advanceTimersByTimeAsync(10000);
        expect(sockets).toHaveLength(2);
        expect(element('connectionStatus').classList.contains('hidden')).toBe(true);
    });

    it('resumes a saved session on reload', async () => {
        sessionStorage.setItem('spicy-online-session', JSON.stringify({
            roomCode: 'ABCD', playerName: 'Host', sessionToken: 'saved-token'
        }));
        await loadClient();
        const socket = sockets[0];
        expect(socket.url).toBe('wss://spicy.example.test/api/rooms/ABCD');
        socket.open();
        expect(socket.sent[0]).toMatchObject({ type: 'join', sessionToken: 'saved-token' });
        joined(socket, { sessionToken: 'saved-token' });
        expect(element('roomInfo').classList.contains('hidden')).toBe(false);
    });
});

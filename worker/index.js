import { GameRoom } from './game-room.js';

export { GameRoom };

export default {
    async fetch(request, env) {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/api' || pathname.startsWith('/api/')) {
            const match = /^\/api\/rooms\/([a-zA-Z]{4})$/.exec(pathname);
            if (!match) return new Response('Not found', { status: 404 });
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
            }
            if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
                return new Response('Expected a WebSocket upgrade', {
                    status: 426,
                    headers: { Upgrade: 'websocket' }
                });
            }

            const id = env.GAME_ROOMS.idFromName(match[1].toUpperCase());
            return env.GAME_ROOMS.get(id).fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};

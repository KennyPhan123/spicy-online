# Spicy Online

A real-time, sandbox-style multiplayer implementation of the Spicy card game for 2–6 players. The frontend uses Vite and vanilla JavaScript; Cloudflare Workers and Durable Objects handle rooms and WebSockets.

## Bắt đầu nhanh

Yêu cầu: Node.js **22.12+ (nhánh 22 LTS) hoặc 24+**, npm và một tài khoản Cloudflare nếu muốn triển khai.

```bash
npm ci
npm run dev
```

Mở `http://localhost:5173` trong hai tab hoặc hai trình duyệt để tạo phòng và tham gia. Một lệnh `dev` chạy cả giao diện và Worker/Durable Object cục bộ; không cần chạy PartyKit hoặc cấu hình địa chỉ server riêng.

Để đưa game lên Cloudflare Workers:

```bash
npx wrangler login
npm run deploy
```

Lệnh deploy tự build giao diện rồi triển khai Worker cùng các file tĩnh. Wrangler sẽ in URL dạng `https://spicy-online.<workers-subdomain>.workers.dev`. Nếu cần, đổi tên Worker trong `wrangler.jsonc` trước khi triển khai lần đầu. Tài khoản phải được thiết lập Workers/`workers.dev` và có quyền sử dụng Durable Objects; xem giới hạn và chi phí của gói Cloudflare đang dùng.

**Lưu ý chuyển đổi:** URL `partykit.dev` cũ không tự chuyển hướng sang Workers, và phòng/ván chơi cũ không được chuyển dữ liệu. Chia sẻ URL Workers mới hoặc cấu hình tên miền riêng trong Cloudflare sau khi deploy.

## Development

```bash
npm ci                 # Install dependencies (Node.js 22.12+ LTS or 24+)
npm run dev            # Vite + local Workers runtime and Durable Objects
npm test               # Worker integration tests and browser-client tests
npm run build          # Build Worker and static assets
npm run preview        # Preview the built Worker and assets locally
```

The Cloudflare Vite plugin runs the Worker locally and routes the room WebSocket on the **same origin** as the page. Local Durable Object data is stored in the ignored `.wrangler/` directory, separately from production. Development and preview use separate local storage, so rooms do not carry over between them. To preview a production build, run `npm run build` before `npm run preview`.

## Deployment

1. Sign in with `npx wrangler login` and select the intended Cloudflare account if prompted. Set up a `workers.dev` subdomain in the Cloudflare dashboard if you do not already have one.
2. Run `npm run deploy`. It builds both Vite environments, then invokes `wrangler deploy` with the generated configuration. The SQLite-backed `GameRoom` migration is applied on first deployment; the static assets and WebSocket endpoint are deployed together.
3. Open the URL printed by Wrangler in two browsers, create a room in one, and join with the four-letter code in the other. Optionally attach a custom domain in the Cloudflare dashboard.

For Cloudflare Workers Builds, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command, with Node.js 22.12+ LTS or 24+. Durable Objects are subject to the limits and pricing of your Cloudflare plan. After deployment, retain the `GameRoom` class and its migration in `wrangler.jsonc` unless you deliberately migrate the namespace.

### Rooms and reconnecting

- Each four-letter code maps to a separate SQLite-backed Durable Object. Game state is saved in Durable Object storage, and WebSockets use the hibernation API to avoid waking idle rooms for heartbeats.
- If a connection drops, the player has 60 seconds to reconnect with their hand and points intact. The browser stores a session token in `sessionStorage`, so refreshing the same tab can resume the game. If the host disconnects, another connected player becomes host.
- Disconnected players are removed after the grace period; when the last player leaves or expires, the room state is cleared and the code can be reused. New players cannot join a game that has already started.
- PartyKit sessions and its old hostname are separate from this deployment and cannot be automatically restored or redirected by this Worker.

## How to Play

1. Create a new game or join an existing room with its four-letter code.
2. Wait for at least two players and start the game.
3. Drag cards from your hand to the spicy stack. Double-click or double-tap stack cards to reveal them for a challenge.
4. Collect cards and trophies in your points zone. Cards are worth one point each and trophies are worth ten points each.
5. Pan by dragging the background and zoom with the mouse wheel or a pinch gesture.

## Project Structure

```text
spicy-online/
├── src/                 # Browser game, styles and audio
├── worker/
│   ├── index.js         # Worker: assets and WebSocket room routing
│   ├── game-room.js     # Durable Object: connections, persistence and cleanup
│   └── game.js          # Spicy game state and actions
├── test/                # Worker and browser-client tests
├── public/              # Card images and sounds
├── index.html
├── vite.config.js
└── wrangler.jsonc       # Worker, static assets and Durable Object migration
```

## License

This project is for educational and entertainment purposes.

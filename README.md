# Spicy Online

A real-time multiplayer online implementation of the Spicy card game, built with PartyKit and Vite.

## About

Spicy is a hot bluffing card game for 2-6 players. This online version allows players to create rooms and play together in real-time with a fully interactive sandbox-style interface featuring pan and zoom controls.

## Features

- Real-time multiplayer gameplay using WebSockets
- Room-based system with 4-letter room codes
- Support for 2-6 players per game
- Spice It Up mode toggle (visual only - variant rules not yet implemented)
- Interactive drag-and-drop card mechanics
- Pan and zoom controls for optimal viewing
- Trophy system with 10-point scoring
- World's End card mechanic
- Card flip feature for challenges
- Responsive design for desktop and mobile

## Tech Stack

- **Frontend**: Vite, Vanilla JavaScript, CSS
- **Backend**: PartyKit (WebSocket server)
- **Deployment**: PartyKit platform

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/KennyPhan123/spicy-online.git
cd spicy-online
```

2. Install dependencies:
```bash
npm install
```

### Development

Run the development server:
```bash
npm run dev
```

The game will be available at `http://localhost:5173`

To run the PartyKit server locally:
```bash
npm run dev:party
```

### Building

Build for production:
```bash
npm run build
```

### Deployment

Deploy to PartyKit:
```bash
npx partykit deploy
```

## How to Play

1. Create a new game or join an existing room with a 4-letter code
2. Wait for at least 2 players to join
3. The host can optionally toggle "Spice It Up" mode (note: variant rules are not yet implemented - this only displays a random Spice It Up card)
4. Start the game and play cards by dragging them to the spicy stack
5. Double-click/tap cards in the stack to flip and reveal them (for challenges)
6. Challenge other players or collect trophies to win
7. Score points by collecting cards (1 point each) and trophies (10 points each)

## Game Controls

- **Drag Cards**: Click and drag cards from your hand to play them
- **Pan View**: Click and drag the background to move around
- **Zoom**: Use mouse wheel to zoom in/out
- **Touch Controls**: Pinch to zoom on mobile devices

## Project Structure

```
spicy-online/
├── src/
│   ├── main.js        # Client-side game logic
│   └── styles.css     # Game styling
├── party/
│   └── server.js      # PartyKit server logic
├── public/
│   └── cards/         # Card images
├── index.html         # Main HTML file
├── package.json
└── partykit.json      # PartyKit configuration
```

## License

This project is for educational and entertainment purposes.

## Live Demo

Play online at: [https://spicy-game-server.kennyphan123.partykit.dev](https://spicy-game-server.kennyphan123.partykit.dev)

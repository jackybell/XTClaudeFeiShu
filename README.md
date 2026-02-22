# XT Claude Code with Feishu

A bridge service connecting Feishu Bot to Claude Code CLI, enabling seamless interaction with Claude Code through Feishu messaging platform.

## Features

- Bidirectional communication between Feishu Bot and Claude Code CLI
- Real-time message handling and response streaming
- File watching and automatic synchronization
- Secure authentication and session management
- Structured logging with Pino

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Feishu App credentials (App ID and App Secret)
- Claude API key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd XTClaudeFeiShu
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:
- `CLAUDE_API_KEY`: Your Claude API key
- `FEISHU_APP_ID`: Your Feishu App ID
- `FEISHU_APP_SECRET`: Your Feishu App Secret
- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (default: info)

## Development

Start the development server with hot reload:
```bash
npm run dev
```

## Build

Build the TypeScript code:
```bash
npm run build
```

## Production

Start the production server:
```bash
npm start
```

## Project Structure

```
.
├── src/              # Source code
│   ├── index.ts      # Entry point
├── dist/            # Compiled JavaScript
├── .env.example     # Environment variables template
├── package.json     # Project configuration
├── tsconfig.json    # TypeScript configuration
└── README.md        # This file
```

## License

MIT

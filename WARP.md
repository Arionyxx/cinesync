# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Quick Start

```bash
# Install dependencies
npm install

# Start the development server
npm start

# Server runs on http://localhost:3001
```

## Development Commands

### Server Management
- **Start server**: `npm start` - Launches the Node.js server on port 3001 (or PORT env var)
- **Manual start**: `node server.js` - Direct server execution
- **Health check**: Visit `http://localhost:3001/health` or `curl http://localhost:3001/health`

### File Operations
- **Upload endpoint**: `POST /api/upload` - Accepts video files up to 500MB
- **Static files**: Videos served from `/uploads/` directory, frontend from `/public/`

## Architecture Overview

### Server-Side Architecture (`server.js`)
- **Express.js** web server with **Socket.IO** for real-time communication
- **Multer** handles file uploads with disk storage in `uploads/` directory
- **In-memory room management** - rooms stored in JavaScript Map (not persistent)
- **Host-based control model** - only room host can control video playback

#### Room Structure
```javascript
room = {
  id: string,           // 6-character alphanumeric room code
  hostId: string,       // Socket ID of the room host
  participants: Map,    // socketId -> {id, name}
  source: {            // Currently playing video
    type: 'youtube'|'video',
    url: string,
    videoId?: string   // For YouTube videos
  },
  playback: {          // Synchronization state
    status: 'paused'|'playing',
    at: number,        // Current time position
    rate: number,      // Playback rate (1.0 = normal)
    ts: number         // Timestamp for sync calculations
  }
}
```

### Client-Side Architecture (`public/app.js`)

#### Unified Player System
- **YouTube Player**: Uses YouTube IFrame API for YouTube videos
- **HTML5 Video Player**: Native `<video>` element for uploaded/direct URL videos  
- **Player abstraction**: Common interface (`play()`, `pause()`, `seek()`, `setRate()`, etc.)
- **Event suppression**: Prevents infinite loops when applying remote state changes

#### Real-time Synchronization
- **Host propagation**: Host's player events broadcast to all participants
- **Latency compensation**: Time calculations account for network delay using timestamps
- **Drift correction**: Non-host clients periodically request sync updates (15s intervals)
- **Auto-sync tolerance**: Seeks only if time difference > 0.5 seconds

#### Socket.IO Events
**Room Management:**
- `room:join`, `room:leave`, `room:welcome`
- `room:participants`, `room:state`

**Playback Control:**
- `player:set-source`, `player:play`, `player:pause`
- `player:seek`, `player:rate`

**Synchronization:**
- `sync:request`, `sync:state`

**Communication:**
- `chat:message`

### Frontend Structure (`public/`)
- **`index.html`**: Single-page application with embedded player area and chat sidebar
- **`app.js`**: Main application logic, Socket.IO client, player management
- **`styles.css`**: Glass morphism UI design with CSS custom properties
- **Responsive design**: Grid layout collapses to single column on mobile

## Key Technical Details

### Video Support
- **YouTube**: Full YouTube URL parsing (youtube.com, youtu.be, shorts, live)
- **Direct videos**: MP4, WebM, OGG files via HTML5 video element
- **Upload limits**: 500MB max file size, basic filename sanitization

### Synchronization Strategy
The app uses a **timestamp-based synchronization** approach:
1. Host actions include server timestamp (`ts`)
2. Clients calculate target position: `at + (currentTime - ts) / 1000`
3. Auto-correction only triggers if drift > threshold (0.5s for seeks, 0.35s for play sync)

### State Management
- **Client state**: `me` object tracks user identity and role, `current` object tracks video state
- **Server state**: Rooms Map with participant tracking and playback state
- **Host reassignment**: Automatic when host leaves (first remaining participant becomes host)

### Security Considerations
- **File upload validation**: MIME type checking, size limits, filename sanitization
- **CORS**: Currently permissive (`*`) - should be restricted for production
- **Input sanitization**: Chat messages truncated to 1000 characters
- **YouTube ToS**: Uses official IFrame API, preserves controls and ads

## Development Notes

### Local Development Setup
1. Videos uploaded to `uploads/` directory (auto-created)
2. Static frontend served from `public/` directory
3. Socket.IO endpoint automatically available at `/socket.io/`

### Testing Video Sources
- **YouTube**: Use any valid YouTube URL or video ID
- **Direct URLs**: Must end with `.mp4`, `.webm`, or `.ogg`
- **File uploads**: Drag & drop or click "Upload video" button

### Room Code System
- 6-character alphanumeric codes (excludes confusing characters like 0, O, I, 1)
- Shareable via URL parameter: `?room=ABC123`
- Case-insensitive input, stored as uppercase
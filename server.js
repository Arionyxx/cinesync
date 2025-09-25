/* Minimal Watch-Party backend
 * - Serves static frontend (public/)
 * - Handles file uploads for normal videos
 * - Manages "rooms" and real-time sync via Socket.IO
 *
 * HOW TO RUN:
 *   1) npm install
 *   2) npm start
 *   3) Open http://localhost:3001
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// --- Basic config ---
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// CORS (loose for starter; tighten for production)
app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded videos
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// --- Multer upload (simple, not for production scale) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}_${Math.round(Math.random()*1e9)}_${safeName}`);
  }
});

const allowed = new Set(['video/mp4', 'video/webm', 'video/ogg', 'application/octet-stream']);
const upload = multer({
  storage,
  limits: { fileSize: 1024*1024*500 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only MP4/WebM/OGG are allowed for this starter.'));
  }
});

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

app.get('/health', (_, res) => res.json({ ok: true }));

// --- Rooms in memory (demo only) ---
/**
 * room = {
 *  id, hostId, participants: Map(socketId -> {id, name}),
 *  source: { type:'youtube'|'video', url, videoId? },
 *  playback: { status:'paused'|'playing', at:0, rate:1, ts: Date.now() }
 * }
 */
const rooms = new Map();

function makeRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random()*alphabet.length)];
  return id;
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId || makeRoomId(),
      hostId: null,
      participants: new Map(),
      source: null,
      playback: { status: 'paused', at: 0, rate: 1, ts: Date.now() }
    };
    rooms.set(room.id, room);
  }
  return room;
}

function summarizeRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    source: room.source,
    playback: room.playback
  };
}

function listParticipants(room) {
  return Array.from(room.participants.values()).map(p => ({ id: p.id, name: p.name }));
}

// Compute the "current" time of the video stream based on last play head & timestamp
function effectiveTime(playback) {
  if (playback.status !== 'playing') return playback.at;
  const dt = (Date.now() - playback.ts) / 1000;
  return playback.at + dt * (playback.rate || 1);
}

// --- Socket.IO ---
io.on('connection', (socket) => {
  let joinedRoomId = null;

  socket.on('room:join', ({ roomId, name }) => {
    const rid = (roomId && roomId.trim()) || makeRoomId();
    const room = getOrCreateRoom(rid);

    socket.join(room.id);
    joinedRoomId = room.id;

    room.participants.set(socket.id, { id: socket.id, name: name || 'Guest' });
    if (!room.hostId) room.hostId = socket.id;

    // Send current state to the new client
    socket.emit('room:welcome', { room: summarizeRoom(room), participants: listParticipants(room) });
    // Notify everyone
    io.to(room.id).emit('room:participants', listParticipants(room));
    io.to(room.id).emit('room:state', summarizeRoom(room));
  });

  socket.on('room:leave', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;
    room.participants.delete(socket.id);
    // Host reassignment
    if (room.hostId === socket.id) {
      const next = room.participants.keys().next();
      room.hostId = next && !next.done ? next.value : null;
    }
    io.to(room.id).emit('room:participants', listParticipants(room));
    io.to(room.id).emit('room:state', summarizeRoom(room));
    socket.leave(joinedRoomId);
    joinedRoomId = null;
  });

  socket.on('role:become-host', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;
    // Simple rule: allow anyone to take host if current host is null
    if (!room.hostId) {
      room.hostId = socket.id;
      io.to(room.id).emit('room:state', summarizeRoom(room));
    } else {
      // Or require host confirmation in real app
      // For starter, ignore.
    }
  });

  socket.on('player:set-source', (payload) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || room.hostId !== socket.id) return; // only host
    // Validate basic shape
    if (!payload || !payload.type || !payload.url) return;
    room.source = { type: payload.type, url: payload.url, videoId: payload.videoId || null };
    room.playback = { status: 'paused', at: 0, rate: 1, ts: Date.now() };
    io.to(room.id).emit('player:set-source', { source: room.source, playback: room.playback });
  });

  socket.on('player:play', ({ at, rate, ts }) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || room.hostId !== socket.id) return;
    room.playback = { status: 'playing', at: Number(at) || 0, rate: Number(rate) || 1, ts: Number(ts) || Date.now() };
    io.to(room.id).emit('player:play', { at: room.playback.at, rate: room.playback.rate, ts: room.playback.ts });
  });

  socket.on('player:pause', ({ at, ts }) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || room.hostId !== socket.id) return;
    room.playback = { ...room.playback, status: 'paused', at: Number(at) || 0, ts: Number(ts) || Date.now() };
    io.to(room.id).emit('player:pause', { at: room.playback.at, ts: room.playback.ts });
  });

  socket.on('player:seek', ({ to, ts }) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || room.hostId !== socket.id) return;
    room.playback = { ...room.playback, at: Number(to) || 0, ts: Number(ts) || Date.now() };
    io.to(room.id).emit('player:seek', { to: room.playback.at, ts: room.playback.ts });
  });

  socket.on('player:rate', ({ rate, ts }) => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room || room.hostId !== socket.id) return;
    room.playback = { ...room.playback, rate: Number(rate) || 1, ts: Number(ts) || Date.now() };
    io.to(room.id).emit('player:rate', { rate: room.playback.rate, ts: room.playback.ts });
  });

  socket.on('sync:request', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;
    const nowPlayback = {
      status: room.playback.status,
      at: effectiveTime(room.playback),
      rate: room.playback.rate,
      ts: Date.now(),
      source: room.source,
      hostId: room.hostId
    };
    socket.emit('sync:state', nowPlayback);
  });

  socket.on('chat:message', ({ text, name }) => {
    if (!joinedRoomId || !text) return;
    const safe = String(text).slice(0, 1000);
    io.to(joinedRoomId).emit('chat:message', {
      text: safe,
      name: name || 'Anon',
      at: Date.now(),
      from: socket.id
    });
  });

  socket.on('disconnect', () => {
    if (!joinedRoomId) return;
    const room = rooms.get(joinedRoomId);
    if (!room) return;
    room.participants.delete(socket.id);
    if (room.hostId === socket.id) {
      const next = room.participants.keys().next();
      room.hostId = next && !next.done ? next.value : null;
    }
    io.to(room.id).emit('room:participants', listParticipants(room));
    io.to(room.id).emit('room:state', summarizeRoom(room));
  });
});

server.listen(PORT, () => {
  console.log(`Watch Party server running at http://localhost:${PORT}`);
});

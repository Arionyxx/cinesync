// Vercel-compatible CineSync server
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// In-memory storage (will reset on serverless function restart)
let rooms = new Map();

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function makeRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random()*alphabet.length)];
  return id;
}

function getOrCreateRoom(roomId) {
  if (!roomId) roomId = makeRoomId();
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      hostId: null,
      participants: new Map(),
      source: null,
      playback: { status: 'paused', at: 0, rate: 1, ts: Date.now() },
      messages: []
    });
  }
  return rooms.get(roomId);
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Join a room
app.post('/api/room/join', (req, res) => {
  const { roomId, name, userId } = req.body;
  const room = getOrCreateRoom(roomId);
  
  room.participants.set(userId, { id: userId, name: name || 'Guest', lastSeen: Date.now() });
  if (!room.hostId) room.hostId = userId;
  
  res.json({
    room: {
      id: room.id,
      hostId: room.hostId,
      source: room.source,
      playback: room.playback
    },
    participants: Array.from(room.participants.values())
  });
});

// Get room state
app.get('/api/room/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    room: {
      id: room.id,
      hostId: room.hostId,
      source: room.source,
      playback: room.playback
    },
    participants: Array.from(room.participants.values()),
    messages: room.messages.slice(-20) // Last 20 messages
  });
});

// Set video source (host only)
app.post('/api/room/:roomId/source', (req, res) => {
  const { userId, source } = req.body;
  const room = rooms.get(req.params.roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.hostId !== userId) {
    return res.status(403).json({ error: 'Only host can set source' });
  }
  
  room.source = source;
  room.playback = { status: 'paused', at: 0, rate: 1, ts: Date.now() };
  
  res.json({ success: true });
});

// Control playback (host only)
app.post('/api/room/:roomId/playback', (req, res) => {
  const { userId, action, ...data } = req.body;
  const room = rooms.get(req.params.roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  if (room.hostId !== userId) {
    return res.status(403).json({ error: 'Only host can control playback' });
  }
  
  switch (action) {
    case 'play':
      room.playback = { status: 'playing', at: data.at, rate: data.rate || 1, ts: Date.now() };
      break;
    case 'pause':
      room.playback = { status: 'paused', at: data.at, rate: room.playback.rate, ts: Date.now() };
      break;
    case 'seek':
      room.playback = { ...room.playback, at: data.to, ts: Date.now() };
      break;
    case 'rate':
      room.playback = { ...room.playback, rate: data.rate, ts: Date.now() };
      break;
  }
  
  res.json({ success: true });
});

// Send chat message
app.post('/api/room/:roomId/chat', (req, res) => {
  const { userId, text, name } = req.body;
  const room = rooms.get(req.params.roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const message = {
    id: Date.now().toString(),
    text: String(text).slice(0, 1000),
    name: name || 'Anon',
    userId,
    timestamp: Date.now()
  };
  
  room.messages.push(message);
  if (room.messages.length > 100) {
    room.messages = room.messages.slice(-50); // Keep last 50
  }
  
  res.json({ success: true });
});

// Serve static files
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

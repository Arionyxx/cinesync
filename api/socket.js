/* Vercel-compatible Socket.IO handler
 * Simplified version that works reliably on serverless
 * Uses in-memory storage for room state (good for small scale)
 */

const { Server } = require('socket.io');

// Simple in-memory storage for rooms
let rooms = new Map();

function makeRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += alphabet[Math.floor(Math.random()*alphabet.length)];
  return id;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function setRoom(room) {
  rooms.set(room.id, room);
}

function getOrCreateRoom(roomId) {
  let room = getRoom(roomId);
  if (!room) {
    room = {
      id: roomId || makeRoomId(),
      hostId: null,
      participants: new Map(),
      source: null,
      playback: { status: 'paused', at: 0, rate: 1, ts: Date.now() }
    };
    setRoom(room);
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

function effectiveTime(playback) {
  if (playback.status !== 'playing') return playback.at;
  const dt = (Date.now() - playback.ts) / 1000;
  return playback.at + dt * (playback.rate || 1);
}

let io;

export default function handler(req, res) {
  if (!res.socket.server.io) {
    console.log('Initializing Socket.IO server...');
    
    io = new Server(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
      cors: { origin: '*' },
      transports: ['polling', 'websocket']
    });

    io.on('connection', (socket) => {
      let joinedRoomId = null;

      socket.on('room:join', ({ roomId, name }) => {
        const rid = (roomId && roomId.trim()) || makeRoomId();
        const room = getOrCreateRoom(rid);

        socket.join(room.id);
        joinedRoomId = room.id;

        room.participants.set(socket.id, { id: socket.id, name: name || 'Guest' });
        if (!room.hostId) room.hostId = socket.id;

        setRoom(room);

        socket.emit('room:welcome', { room: summarizeRoom(room), participants: listParticipants(room) });
        io.to(room.id).emit('room:participants', listParticipants(room));
        io.to(room.id).emit('room:state', summarizeRoom(room));
      });

      socket.on('player:set-source', (payload) => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
        if (!room || room.hostId !== socket.id) return;
        
        if (!payload || !payload.type || !payload.url) return;
        
        // Only allow YouTube for Vercel deployment (no file uploads)
        if (payload.type !== 'youtube') {
          socket.emit('error', { message: 'Only YouTube videos are supported in this deployment' });
          return;
        }

        room.source = { type: payload.type, url: payload.url, videoId: payload.videoId || null };
        room.playback = { status: 'paused', at: 0, rate: 1, ts: Date.now() };
        
        setRoom(room);
        io.to(room.id).emit('player:set-source', { source: room.source, playback: room.playback });
      });

      socket.on('player:play', ({ at, rate, ts }) => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
        if (!room || room.hostId !== socket.id) return;
        
        room.playback = { status: 'playing', at: Number(at) || 0, rate: Number(rate) || 1, ts: Number(ts) || Date.now() };
        setRoom(room);
        io.to(room.id).emit('player:play', { at: room.playback.at, rate: room.playback.rate, ts: room.playback.ts });
      });

      socket.on('player:pause', ({ at, ts }) => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
        if (!room || room.hostId !== socket.id) return;
        
        room.playback = { ...room.playback, status: 'paused', at: Number(at) || 0, ts: Number(ts) || Date.now() };
        setRoom(room);
        io.to(room.id).emit('player:pause', { at: room.playback.at, ts: room.playback.ts });
      });

      socket.on('player:seek', ({ to, ts }) => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
        if (!room || room.hostId !== socket.id) return;
        
        room.playback = { ...room.playback, at: Number(to) || 0, ts: Number(ts) || Date.now() };
        setRoom(room);
        io.to(room.id).emit('player:seek', { to: room.playback.at, ts: room.playback.ts });
      });

      socket.on('player:rate', ({ rate, ts }) => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
        if (!room || room.hostId !== socket.id) return;
        
        room.playback = { ...room.playback, rate: Number(rate) || 1, ts: Number(ts) || Date.now() };
        setRoom(room);
        io.to(room.id).emit('player:rate', { rate: room.playback.rate, ts: room.playback.ts });
      });

      socket.on('sync:request', () => {
        if (!joinedRoomId) return;
        const room = getRoom(joinedRoomId);
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
        const room = getRoom(joinedRoomId);
        if (!room) return;
        
        room.participants.delete(socket.id);
        if (room.hostId === socket.id) {
          const next = room.participants.keys().next();
          room.hostId = next && !next.done ? next.value : null;
        }
        
        setRoom(room);
        io.to(room.id).emit('room:participants', listParticipants(room));
        io.to(room.id).emit('room:state', summarizeRoom(room));
      });
    });

    res.socket.server.io = io;
  }

  res.end();
}
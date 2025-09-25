/* Frontend for CineSync Watch Party Starter
 * - Handles room join, chat, source selection
 * - Unified player that supports YouTube or normal <video>
 * - Real-time sync via socket.io
 */

const els = {
  displayName: document.getElementById('displayName'),
  roomCode: document.getElementById('roomCode'),
  btnJoin: document.getElementById('btnJoin'),
  hostBadge: document.getElementById('hostBadge'),
  currentRoom: document.getElementById('currentRoom'),
  sourceType: document.getElementById('sourceType'),
  playerMount: document.getElementById('playerMount'),
  btnSetSource: document.getElementById('btnSetSource'),
  btnUpload: document.getElementById('btnUpload'),
  fileInput: document.getElementById('fileInput'),
  sourceUrl: document.getElementById('sourceUrl'),
  btnPlay: document.getElementById('btnPlay'),
  btnPause: document.getElementById('btnPause'),
  seek: document.getElementById('seek'),
  rate: document.getElementById('rate'),
  volume: document.getElementById('volume'),
  timeLabel: document.getElementById('timeLabel'),
  btnCopyLink: document.getElementById('btnCopyLink'),
  chatLog: document.getElementById('chatLog'),
  chatInput: document.getElementById('chatInput'),
  btnSend: document.getElementById('btnSend'),
  tabs: document.querySelectorAll('.tab'),
  panes: {
    chat: document.getElementById('paneChat'),
    people: document.getElementById('panePeople')
  },
  peopleList: document.getElementById('peopleList')
};

// --- Utilities ---
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h>0? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`);
}

function parseYouTubeId(input) {
  if (!input) return null;
  try {
    // Try full URLs
    const url = new URL(input, window.location.href);
    if (/^(www\.)?youtube\.com$/.test(url.hostname)) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2];
      if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2];
    }
    if (/^(www\.)?youtu\.be$/.test(url.hostname)) {
      return url.pathname.slice(1);
    }
  } catch(e) {
    // not a URL, maybe it's just an ID
    if (/^[a-zA-Z0-9_-]{6,}$/.test(input)) return input;
  }
  return null;
}

function nowMs(){ return Date.now(); }

// Load/save identity
els.displayName.value = localStorage.getItem('cinesync:name') || '';
els.displayName.addEventListener('change', () => {
  localStorage.setItem('cinesync:name', els.displayName.value.trim());
});

// Tabs
els.tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    els.tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.getElementById('pane' + tab.charAt(0).toUpperCase()+tab.slice(1)).classList.add('active');
  });
});

// --- HTTP Polling System (Vercel-compatible) ---
let me = { id: generateUserId(), name: null, roomId: null, isHost: false };
let current = { source: null, playback: null };
let pollingInterval = null;

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  if (!me.roomId) return;
  
  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/room/${me.roomId}`);
      if (response.ok) {
        const data = await response.json();
        updateRoomState(data);
      }
    } catch (error) {
      console.warn('Polling error:', error);
    }
  }, 2000); // Poll every 2 seconds
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function updateRoomState(data) {
  const { room, participants, messages } = data;
  
  // Update host status
  me.isHost = room.hostId === me.id;
  els.hostBadge.hidden = !me.isHost;
  
  // Update source and playback if changed
  if (JSON.stringify(current.source) !== JSON.stringify(room.source)) {
    updateSource(room.source, room.playback, { applyImmediately: true });
  } else if (JSON.stringify(current.playback) !== JSON.stringify(room.playback)) {
    applyPlayback(room.playback);
  }
  
  current.source = room.source;
  current.playback = room.playback;
  
  // Update participants
  updateParticipants(participants);
  
  // Update messages
  if (messages) {
    updateMessages(messages);
  }
}

function updateMessages(messages) {
  // Simple approach: clear and rebuild (could be optimized)
  const currentCount = els.chatLog.children.length;
  if (messages.length !== currentCount) {
    els.chatLog.innerHTML = '';
    messages.forEach(msg => {
      addMsg(msg.name, msg.text, msg.timestamp, msg.userId === me.id);
    });
  }
}

// HTTP-based event handling is now done through polling
// updateRoomState() handles all state updates

// --- Room Join ---
els.btnJoin.addEventListener('click', async () => {
  const name = (els.displayName.value || '').trim() || 'Guest';
  const roomId = (els.roomCode.value || '').trim().toUpperCase();
  me.name = name;
  
  try {
    const response = await fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, name, userId: me.id })
    });
    
    if (response.ok) {
      const data = await response.json();
      me.roomId = data.room.id;
      els.currentRoom.textContent = data.room.id;
      
      updateRoomState(data);
      updateInviteLink();
      log('system', `Joined room ${data.room.id}`);
      startPolling();
    } else {
      const error = await response.json();
      toast('Failed to join room: ' + error.error);
    }
  } catch (error) {
    toast('Network error: ' + error.message);
  }
});

function updateHost(hostId) {
  me.isHost = hostId === socket.id;
  els.hostBadge.hidden = !me.isHost;
}

function updateInviteLink() {
  if (!me.roomId) return;
  const link = `${location.origin}?room=${me.roomId}`;
  els.btnCopyLink.onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch (e) {
      prompt('Copy this link:', link);
    }
  };
}

function updateParticipants(list) {
  els.peopleList.innerHTML = '';
  list.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(p.name)}</span> ${p.id===me.id?'<span class="you">you</span>':''}`;
    els.peopleList.appendChild(li);
  });
}

// Deep-ish compare equality
function deepEq(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

// --- Unified Player ---
let player = null;
let _suppress = false;
function suppress(fn){
  _suppress = true;
  try { fn(); } finally { setTimeout(()=>{_suppress=false;}, 0); }
}

function makePlayer() {
  const mount = els.playerMount;
  mount.innerHTML = ''; // clear
  const api = {
    type: 'none',
    el: null,
    play(){}, pause(){}, seek(_t){}, setRate(_r){}, getTime(){ return 0; },
    getDuration(){ return 0; }, setVolume(_v){}
  };
  return api;
}

function loadYouTube(videoId) {
  const mount = els.playerMount;
  mount.innerHTML = '';
  const container = document.createElement('div');
  container.id = 'yt-frame';
  container.style.width = '100%';
  container.style.height = '100%';
  mount.appendChild(container);

  return new Promise((resolve) => {
    const init = () => {
      const p = new YT.Player('yt-frame', {
        videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          // For ToS compliance, keep controls visible (you can style around)
          controls: 1
        },
        events: {
          onReady: () => resolve(p),
          onStateChange: (e) => {
            if (_suppress) return;
            if (!me.isHost) return; // only host propagates
            if (e.data === YT.PlayerState.PLAYING) {
              const at = e.target.getCurrentTime();
              const rate = e.target.getPlaybackRate();
              socket.emit('player:play', { at, rate, ts: Date.now() });
            } else if (e.data === YT.PlayerState.PAUSED) {
              const at = e.target.getCurrentTime();
              socket.emit('player:pause', { at, ts: Date.now() });
            } else if (e.data === YT.PlayerState.BUFFERING) {
              // ignore
            } else if (e.data === YT.PlayerState.ENDED) {
              // pause at end
              const at = e.target.getDuration();
              socket.emit('player:pause', { at, ts: Date.now() });
            }
          }
        }
      });
    };
    if (window._ytReady && window.YT && window.YT.Player) init();
    else {
      // Poll until API ready
      const iv = setInterval(() => {
        if (window._ytReady && window.YT && window.YT.Player) {
          clearInterval(iv);
          init();
        }
      }, 50);
    }
  });
}

function loadHtml5Video(url) {
  const mount = els.playerMount;
  mount.innerHTML = '';
  const v = document.createElement('video');
  v.id = 'html5video';
  v.style.width = '100%';
  v.style.height = '100%';
  v.controls = true; // show default controls; you may build custom UI later
  v.src = url;
  v.preload = 'metadata';
  v.playsInline = true;
  v.crossOrigin = 'anonymous';
  mount.appendChild(v);

  return new Promise((resolve) => {
    v.addEventListener('loadedmetadata', () => resolve(v), { once: true });
  });
}

function updateSource(source, playback, opts={}){
  current.source = source || null;
  current.playback = playback || current.playback;
  els.sourceType.textContent = 'Source: ' + (source? (source.type.toUpperCase()): '—');

  if (!source) return;

  // Instantiate correct player type if changed
  const needType = source.type;
  if (!player || player.type !== needType || opts.applyImmediately) {
    if (player && player.destroy) try { player.destroy(); } catch(e){}
    player = null;
    if (needType === 'youtube') {
      loadYouTube(source.videoId).then(yt => {
        player = {
          type: 'youtube',
          el: yt.getIframe(),
          play: () => yt.playVideo(),
          pause: () => yt.pauseVideo(),
          seek: (t) => yt.seekTo(t, true),
          setRate: (r) => yt.setPlaybackRate(r),
          getTime: () => yt.getCurrentTime(),
          getDuration: () => yt.getDuration(),
          setVolume: (v) => yt.setVolume(Math.round(v*100)),
          destroy: () => yt.destroy()
        };
        applyPlayback(playback);
      });
    } else if (needType === 'video') {
      loadHtml5Video(source.url).then(v => {
        // Listen for host's local interactions to propagate
        v.addEventListener('play', () => {
          if (_suppress || !me.isHost) return;
          socket.emit('player:play', { at: v.currentTime, rate: v.playbackRate, ts: Date.now() });
        });
        v.addEventListener('pause', () => {
          if (_suppress || !me.isHost) return;
          socket.emit('player:pause', { at: v.currentTime, ts: Date.now() });
        });
        v.addEventListener('ratechange', () => {
          if (_suppress || !me.isHost) return;
          socket.emit('player:rate', { rate: v.playbackRate, ts: Date.now() });
        });
        v.addEventListener('seeked', () => {
          if (_suppress || !me.isHost) return;
          socket.emit('player:seek', { to: v.currentTime, ts: Date.now() });
        });

        player = {
          type: 'video',
          el: v,
          play: () => v.play(),
          pause: () => v.pause(),
          seek: (t) => { v.currentTime = t; },
          setRate: (r) => { v.playbackRate = r; },
          getTime: () => v.currentTime || 0,
          getDuration: () => v.duration || 0,
          setVolume: (val) => { v.volume = val; },
          destroy: () => { v.pause(); v.src=''; v.load(); }
        };
        applyPlayback(playback);
      });
    }
  } else {
    // Same player type already exists; just apply state
    applyPlayback(playback);
  }
}

// Apply playback state (play/pause/seek/rate) with latency compensation
function applyPlayback(pb){
  if (!player || !pb) return;
  const { status, at, rate, ts } = pb;
  suppress(() => {
    player.setRate(rate || 1);
    const target = status === 'playing' ? (at + (nowMs()-ts)/1000) : at;
    const cur = player.getTime();
    if (Math.abs(cur - target) > 0.5) player.seek(target);
    if (status === 'playing') player.play(); else player.pause();
  });
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}

function log(who, text){
  const div = document.createElement('div');
  div.className = 'msg';
  if (who === 'system') {
    div.innerHTML = `<span class="who">System</span> ${escapeHtml(text)}`;
  } else {
    div.innerHTML = `<span class="who">${escapeHtml(who)}</span> ${escapeHtml(text)}`;
  }
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function addMsg(name, text, at, isMine){
  const div = document.createElement('div');
  div.className = 'msg';
  const time = new Date(at).toLocaleTimeString();
  div.innerHTML = `<span class="who">${escapeHtml(name)}</span> <span class="muted">(${time})</span>: ${escapeHtml(text)}`;
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function toast(text){
  log('system', text);
}

// --- Controls ---
els.btnSetSource.addEventListener('click', async () => {
  if (!me.isHost) { toast('Only the host can set the source'); return; }
  if (!me.roomId) { toast('Join a room first'); return; }
  
  const val = (els.sourceUrl.value || '').trim();
  if (!val) return;
  
  let source = null;
  
  // YouTube?
  const vid = parseYouTubeId(val);
  if (vid) {
    source = { type: 'youtube', url: `https://www.youtube.com/watch?v=${vid}`, videoId: vid };
  }
  // For Vercel deployment, only allow YouTube
  else {
    toast('Only YouTube videos are supported in this deployment.');
    return;
  }
  
  try {
    const response = await fetch(`/api/room/${me.roomId}/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, source })
    });
    
    if (!response.ok) {
      const error = await response.json();
      toast('Failed to set source: ' + error.error);
    }
  } catch (error) {
    toast('Network error: ' + error.message);
  }
});

els.btnUpload.addEventListener('click', () => {
  toast('File uploads are not supported in this deployment. Use YouTube videos instead.');
  // els.fileInput.click(); // Disabled for Vercel
});
els.fileInput.addEventListener('change', async () => {
  if (!me.isHost) { toast('Only the host can upload'); return; }
  const f = els.fileInput.files[0];
  if (!f) return;
  const body = new FormData();
  body.append('video', f);
  toast('Uploading… (this demo uses basic uploads; large files will take time)');
  try {
    const res = await fetch('/api/upload', { method: 'POST', body });
    const json = await res.json();
    if (json.url) {
      els.sourceUrl.value = json.url;
      socket.emit('player:set-source', { type: 'video', url: json.url });
      toast('Video uploaded and set as source.');
    } else {
      toast('Upload failed.');
    }
  } catch (e) {
    toast('Upload error: ' + e.message);
  } finally {
    els.fileInput.value = '';
  }
});

els.btnPlay.addEventListener('click', async () => {
  if (!player || !me.roomId) return;
  if (me.isHost) {
    try {
      await fetch(`/api/room/${me.roomId}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: me.id, 
          action: 'play', 
          at: player.getTime(), 
          rate: Number(els.rate.value||1) 
        })
      });
    } catch (error) {
      toast('Network error: ' + error.message);
    }
  } else {
    toast('Only host can control playback.');
  }
});

els.btnPause.addEventListener('click', async () => {
  if (!player || !me.roomId) return;
  if (me.isHost) {
    try {
      await fetch(`/api/room/${me.roomId}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: me.id, 
          action: 'pause', 
          at: player.getTime()
        })
      });
    } catch (error) {
      toast('Network error: ' + error.message);
    }
  } else {
    toast('Only host can control playback.');
  }
});
els.seek.addEventListener('input', () => {
  if (!player) return;
  const dur = player.getDuration() || 0;
  const pos = dur * (Number(els.seek.value)/1000);
  els.timeLabel.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
});
els.seek.addEventListener('change', () => {
  if (!player) return;
  if (!me.isHost) { toast('Only host can seek in this starter.'); return; }
  const dur = player.getDuration() || 0;
  const pos = dur * (Number(els.seek.value)/1000);
  socket.emit('player:seek', { to: pos, ts: nowMs() });
});
els.rate.addEventListener('change', () => {
  if (!player) return;
  if (!me.isHost) { toast('Only host can change speed in this starter.'); return; }
  socket.emit('player:rate', { rate: Number(els.rate.value||1), ts: nowMs() });
});
els.volume.addEventListener('input', () => {
  if (!player) return;
  player.setVolume(Number(els.volume.value||1));
});

els.btnCopyLink.addEventListener('click', updateInviteLink);

// Periodic progress + drift correction
setInterval(() => {
  if (!player) return;
  const dur = player.getDuration() || 0;
  const cur = player.getTime() || 0;
  if (dur > 0) {
    els.seek.value = String(Math.max(0, Math.min(1000, Math.floor((cur/dur)*1000))));
  } else {
    els.seek.value = '0';
  }
  els.timeLabel.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}, 250);

// Sync is now handled by HTTP polling in startPolling()

// --- Chat ---
els.btnSend.addEventListener('click', sendChat);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

async function sendChat() {
  const text = (els.chatInput.value || '').trim();
  if (!text || !me.roomId) return;
  
  try {
    const response = await fetch(`/api/room/${me.roomId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: me.id, 
        text, 
        name: me.name || 'Guest' 
      })
    });
    
    if (response.ok) {
      els.chatInput.value = '';
    } else {
      const error = await response.json();
      toast('Failed to send message: ' + error.error);
    }
  } catch (error) {
    toast('Network error: ' + error.message);
  }
}

// Try auto-join via URL ?room=
(function(){
  const params = new URLSearchParams(location.search);
  const r = params.get('room');
  if (r) {
    els.roomCode.value = r.toUpperCase();
  }
})();

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

// --- Socket ---
const socket = io();
let me = { id: null, name: null, roomId: null, isHost: false };
let current = { source: null, playback: null };

socket.on('connect', () => {
  me.id = socket.id;
});

socket.on('room:welcome', ({ room, participants }) => {
  me.roomId = room.id;
  els.currentRoom.textContent = room.id;
  updateHost(room.hostId);
  updateSource(room.source, room.playback);
  updateParticipants(participants);
  updateInviteLink();
  log('system', `Joined room ${room.id}`);
});

socket.on('room:participants', (list) => updateParticipants(list));
socket.on('room:state', (room) => {
  updateHost(room.hostId);
  updateSource(room.source, room.playback);
});

socket.on('player:set-source', ({ source, playback }) => {
  updateSource(source, playback, { applyImmediately: true });
});

socket.on('player:play', ({ at, rate, ts }) => {
  if (!player) return;
  suppress(() => {
    player.setRate(rate || 1);
    const target = at + (nowMs()-ts)/1000;
    const cur = player.getTime();
    if (Math.abs(cur - target) > 0.5) player.seek(target);
    player.play();
  });
});

socket.on('player:pause', ({ at }) => {
  if (!player) return;
  suppress(() => {
    player.pause();
    player.seek(at);
  });
});

socket.on('player:seek', ({ to, ts }) => {
  if (!player) return;
  suppress(() => {
    const target = to + (nowMs()-ts)/1000;
    player.seek(target);
  });
});

socket.on('player:rate', ({ rate }) => {
  if (!player) return;
  suppress(() => player.setRate(rate || 1));
});

socket.on('sync:state', ({ status, at, rate, ts, source, hostId }) => {
  // Drift correction for non-hosts
  if (me.isHost || !player) return;
  if (source) {
    // If our source mismatches, reload
    if (!current.source || JSON.stringify(source) !== JSON.stringify(current.source)) {
      updateSource(source, { status, at, rate, ts }, { applyImmediately: true });
      return;
    }
  }
  if (status === 'playing') {
    const target = at + (nowMs()-ts)/1000;
    const cur = player.getTime();
    if (Math.abs(cur - target) > 0.35) {
      suppress(() => { player.seek(target); player.play(); });
    } else {
      player.play();
    }
    player.setRate(rate || 1);
  } else {
    suppress(() => { player.pause(); player.seek(at); });
  }
});

socket.on('chat:message', ({ text, name, at, from }) => {
  addMsg(name || 'Anon', text, at, from === me.id);
});

// --- Room Join ---
els.btnJoin.addEventListener('click', () => {
  const name = (els.displayName.value || '').trim() || 'Guest';
  const roomId = (els.roomCode.value || '').trim().toUpperCase();
  me.name = name;
  socket.emit('room:join', { roomId, name });
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
  const val = (els.sourceUrl.value || '').trim();
  if (!val) return;
  // YouTube?
  const vid = parseYouTubeId(val);
  if (vid) {
    socket.emit('player:set-source', { type: 'youtube', url: `https://www.youtube.com/watch?v=${vid}`, videoId: vid });
    return;
  }
  // Direct video URL?
  if (/^https?:\/\/.+\.(mp4|webm|ogg)($|\?)/i.test(val)) {
    socket.emit('player:set-source', { type: 'video', url: val });
    return;
  }
  toast('Enter a YouTube link or a direct .mp4/.webm/.ogg URL.');
});

els.btnUpload.addEventListener('click', () => {
  els.fileInput.click();
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

els.btnPlay.addEventListener('click', () => {
  if (!player) return;
  if (me.isHost) {
    socket.emit('player:play', { at: player.getTime(), rate: Number(els.rate.value||1), ts: nowMs() });
  } else {
    toast('Only host can control playback in this starter.');
  }
});
els.btnPause.addEventListener('click', () => {
  if (!player) return;
  if (me.isHost) {
    socket.emit('player:pause', { at: player.getTime(), ts: nowMs() });
  } else {
    toast('Only host can control playback in this starter.');
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

setInterval(() => {
  if (!player || me.isHost || !me.roomId) return;
  socket.emit('sync:request');
}, 15000);

// --- Chat ---
els.btnSend.addEventListener('click', sendChat);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const text = (els.chatInput.value || '').trim();
  if (!text) return;
  socket.emit('chat:message', { text, name: me.name || 'Guest' });
  els.chatInput.value = '';
}

// Try auto-join via URL ?room=
(function(){
  const params = new URLSearchParams(location.search);
  const r = params.get('room');
  if (r) {
    els.roomCode.value = r.toUpperCase();
  }
})();

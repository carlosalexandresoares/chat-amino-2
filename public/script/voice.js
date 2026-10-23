import state from './state.js';

const $ = id => document.getElementById(id);
const peers = new Map();
const pendingCandidates = new Map();
let stream = null;
let active = null;
let participants = [];
let muted = false;
let forcedMuted = false;
let canModerate = false;
let audioContext = null;
let speakingTimer = null;
let speaking = false;
let creating = false;
const audioContainer = document.createElement('div');
audioContainer.hidden = true;
$('voice-dock-body').append(audioContainer);
const status = text => { $('voice-section-status').textContent = text || ''; };
const dockStatus = text => { $('voice-dock-status').textContent = text || ''; };
const element = (tag, text, className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
function emit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    state.socket.timeout(8000).emit(event, payload, (error, result) => {
      if (error) reject(new Error('A conexão demorou a responder. Tente novamente.'));
      else if (!result?.success) reject(new Error(result?.message || 'Não foi possível concluir a ação.'));
      else resolve(result);
    });
  });
}
function syncProjectionOption() {
  const linked = !!state.liveActive && !!state.currentLiveId;
  $('voice-link-wrap').classList.toggle('hidden', !linked);
  if (!linked) $('voice-link-projection').checked = false;
  $('voice-video-volume-wrap').classList.toggle('hidden',
    !(active?.room.linkedLiveId && active.room.linkedLiveId === state.currentLiveId));
}
async function loadRooms() {
  if (!state.roomId || !state.socket.connected) return;
  try {
    const result = await emit('voice:list', { roomId: state.roomId });
    const list = $('voice-room-list'); list.replaceChildren();
    $('voice-room-count').textContent = result.rooms.length ? `${result.rooms.length} aberta(s)` : '';
    if (!result.rooms.length) list.append(element('p', 'Nenhuma sala de voz aberta.'));
    for (const room of result.rooms) {
      const card = element('div', '', 'voice-room-card');
      const copy = element('div', '');
      copy.append(element('strong', room.name),
        element('small', `${room.participantCount}/${room.maxParticipants} na chamada${room.projectionActive ? ' · Projeção' : ''}`));
      const actions = element('div', '', 'voice-room-actions');
      const join = element('button', active?.room.id === room.id ? 'Na chamada' : 'Entrar');
      join.type = 'button'; join.disabled = !!active || room.participantCount >= room.maxParticipants;
      join.addEventListener('click', () => joinVoice(room.id));
      actions.append(join);
      if (canModerate) {
        const close = element('button', 'Encerrar'); close.type = 'button';
        close.addEventListener('click', async () => {
          if (!confirm('Encerrar esta sala de voz para todos?')) return;
          close.disabled = true;
          try { await emit('voice:close', { voiceRoomId: room.id }); await loadRooms(); }
          catch (error) { status(error.message); close.disabled = false; }
        });
        actions.append(close);
      }
      card.append(copy, actions); list.append(card);
    }
    status('');
  } catch (error) { status(error.message); }
}
function stopMedia() {
  if (speakingTimer) clearInterval(speakingTimer);
  speakingTimer = null; speaking = false;
  audioContext?.close().catch(() => {});
  audioContext = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
}
function closePeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  peer.audio.remove();
  peers.delete(id);
  pendingCandidates.delete(id);
}
function endVoice(send = true, message = '') {
  if (send && active && state.socket.connected)
    state.socket.emit('voice:leave', {});
  for (const id of [...peers.keys()]) closePeer(id);
  stopMedia();
  active = null; participants = []; muted = false; forcedMuted = false;
  $('voice-dock').classList.add('hidden');
  document.body.classList.remove('voice-active');
  dockStatus('');
  if (message) status(message);
  void loadRooms();
}
function sendSignal(to, type, data) {
  if (active) state.socket.emit('voice:signal', { to, type, data });
}
function createPeer(id) {
  if (peers.has(id)) return peers.get(id);
  if (!active || !stream) return null;
  const pc = new RTCPeerConnection({ iceServers: active.iceServers });
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.playsInline = true;
  audio.setAttribute('aria-label', 'Áudio da chamada');
  audioContainer.append(audio);
  const peer = { pc, audio, volume: 100, locallyMuted: false };
  peers.set(id, peer);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.onicecandidate = event => {
    if (event.candidate) sendSignal(id, 'candidate', event.candidate.toJSON());
  };
  pc.ontrack = event => {
    audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    audio.muted = peer.locallyMuted || !!participants.find(item => item.socketId === id)?.forcedMuted;
    audio.play().catch(() => dockStatus('Toque em Expandir para ativar o áudio desta chamada.'));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') dockStatus('Conexão de áudio instável. Saia e entre novamente.');
  };
  return peer;
}
async function offerTo(id) {
  const peer = createPeer(id);
  if (!peer) return;
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  sendSignal(id, 'offer', { sdp: peer.pc.localDescription.sdp });
}
async function flushCandidates(id) {
  const peer = peers.get(id);
  if (!peer?.pc.remoteDescription) return;
  for (const candidate of pendingCandidates.get(id) || [])
    await peer.pc.addIceCandidate(candidate).catch(() => {});
  pendingCandidates.delete(id);
}
async function receiveSignal({ from, type, data } = {}) {
  if (!active || typeof from !== 'string' || !['offer', 'answer', 'candidate'].includes(type)) return;
  try {
    if (type === 'candidate') {
      const peer = peers.get(from);
      if (!peer?.pc.remoteDescription) {
        if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
        if (pendingCandidates.get(from).length < 30) pendingCandidates.get(from).push(data);
      } else await peer.pc.addIceCandidate(data);
      return;
    }
    const peer = createPeer(from);
    if (!peer) return;
    await peer.pc.setRemoteDescription({ type, sdp: data.sdp });
    await flushCandidates(from);
    if (type === 'offer') {
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sendSignal(from, 'answer', { sdp: peer.pc.localDescription.sdp });
    }
  } catch (error) { dockStatus('Falha ao conectar o áudio de um participante.'); }
}
function startSpeakingMeter() {
  if (!window.AudioContext || !stream) return;
  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    speakingTimer = setInterval(() => {
      if (!active || !state.socket.connected) return;
      analyser.getByteTimeDomainData(samples);
      let power = 0;
      for (const sample of samples) power += ((sample - 128) / 128) ** 2;
      const next = !muted && !forcedMuted && Math.sqrt(power / samples.length) > 0.04;
      speaking = next;
      state.socket.emit('voice:speaking', { speaking: next });
    }, 350);
  } catch { /* A chamada funciona mesmo sem indicador de fala. */ }
}
function renderParticipants() {
  const list = $('voice-participant-list'); list.replaceChildren();
  $('voice-dock-count').textContent = `${participants.length} ${participants.length === 1 ? 'participante' : 'participantes'}`;
  for (const person of participants) {
    const row = element('div', '', 'voice-participant');
    row.classList.toggle('speaking', !!person.speaking);
    const avatar = element('span', person.username.slice(0, 1).toUpperCase(), 'voice-avatar');
    if (person.avatar) { const img = document.createElement('img'); img.src = person.avatar;
      img.alt = ''; avatar.replaceChildren(img); }
    const name = element('div', '', 'voice-person');
    name.append(element('strong', person.username), element('small',
      person.forcedMuted ? 'Silenciado pela moderação' : person.muted ? 'Microfone desligado' :
        person.speaking ? 'Falando' : 'Ouvindo'));
    row.append(avatar, name);
    if (person.socketId !== state.socket.id) {
      const peer = peers.get(person.socketId);
      if (peer) peer.audio.muted = peer.locallyMuted || !!person.forcedMuted;
      const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0';
      volume.max = '100'; volume.value = String(peer?.volume ?? 100);
      volume.setAttribute('aria-label', `Volume de ${person.username}`);
      volume.addEventListener('input', () => {
        const current = peers.get(person.socketId); if (!current) return;
        current.volume = Number(volume.value); current.audio.volume = current.volume / 100;
      });
      const volumeLabel = element('label', 'Volume'); volumeLabel.append(volume);
      const localMute = element('button', peer?.locallyMuted ? 'Ouvir' : 'Silenciar');
      localMute.type = 'button';
      localMute.addEventListener('click', () => {
        const current = peers.get(person.socketId); if (!current) return;
        current.locallyMuted = !current.locallyMuted;
        current.audio.muted = current.locallyMuted || !!person.forcedMuted;
        localMute.textContent = current.locallyMuted ? 'Ouvir' : 'Silenciar';
      });
      row.append(volumeLabel, localMute);
      if (canModerate) {
        const force = element('button', person.forcedMuted ? 'Liberar mic' : 'Moderar mic');
        force.type = 'button';
        force.addEventListener('click', () => moderate(person.socketId,
          person.forcedMuted ? 'unmute' : 'mute', force));
        const remove = element('button', 'Remover'); remove.type = 'button';
        remove.addEventListener('click', () => moderate(person.socketId, 'remove', remove));
        row.append(force, remove);
      }
    }
    list.append(row);
  }
}
async function moderate(targetSocketId, action, button) {
  button.disabled = true;
  try { await emit('voice:moderate', { voiceRoomId: active.room.id, targetSocketId, action }); dockStatus(''); }
  catch (error) { dockStatus(error.message); button.disabled = false; }
}
function showDock(room) {
  $('voice-dock-title').textContent = room.name;
  $('voice-dock').classList.remove('hidden');
  document.body.classList.add('voice-active');
  syncProjectionOption();
  updateMuteButton();
}
function updateMuteButton() {
  const button = $('voice-dock-mute');
  button.textContent = forcedMuted ? 'Mic bloqueado' : muted ? '🔇 Ativar mic' : '🎙 Desligar mic';
  button.disabled = forcedMuted;
  button.setAttribute('aria-pressed', String(muted || forcedMuted));
  stream?.getAudioTracks().forEach(track => { track.enabled = !muted && !forcedMuted; });
}
async function joinVoice(voiceRoomId) {
  if (active || creating) return;
  creating = true;
  status('Solicitando acesso ao microfone...');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error('Seu navegador não permite chamadas de voz neste contexto.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const joined = await emit('voice:join', { voiceRoomId });
    active = { room: joined.room, iceServers: joined.iceServers || [] };
    muted = joined.self.muted; forcedMuted = joined.self.forcedMuted;
    participants = [joined.self, ...joined.peers];
    showDock(joined.room); renderParticipants(); startSpeakingMeter();
    for (const peer of joined.peers) await offerTo(peer.socketId);
    status(''); dockStatus('');
    await loadRooms();
  } catch (error) {
    if (active) endVoice();
    else stopMedia();
    status(error.name === 'NotAllowedError' ? 'Permita o microfone para entrar na chamada.' : error.message);
  } finally { creating = false; }
}
export function initializeVoice() {
  $('voice-create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const result = await emit('voice:create', { roomId: state.roomId,
        name: $('voice-room-name').value.trim(), linkProjection: $('voice-link-projection').checked });
      $('voice-room-name').value = ''; $('voice-link-projection').checked = false;
      await loadRooms(); await joinVoice(result.voiceRoomId);
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  });
  $('voice-dock-mute').addEventListener('click', async () => {
    if (!active || forcedMuted) return;
    const button = $('voice-dock-mute'); button.disabled = true;
    try { const result = await emit('voice:self-mute', { muted: !muted });
      muted = result.muted; updateMuteButton(); dockStatus(''); }
    catch (error) { dockStatus(error.message); button.disabled = false; }
  });
  $('voice-dock-leave').addEventListener('click', () => endVoice());
  $('voice-dock-expand').addEventListener('click', () => {
    const expanded = $('voice-dock-body').classList.toggle('hidden') === false;
    $('voice-dock-expand').textContent = expanded ? 'Recolher' : 'Expandir';
    $('voice-dock-expand').setAttribute('aria-expanded', String(expanded));
    if (expanded) for (const peer of peers.values()) peer.audio.play().catch(() => {});
  });
  $('voice-video-volume').addEventListener('input', event => {
    if (active?.room.linkedLiveId === state.currentLiveId && state.player?.setVolume)
      state.player.setVolume(Number(event.target.value));
  });
  state.socket.on('room-permissions', ({ roomId, role }) => {
    if (roomId !== state.roomId) return;
    canModerate = role === 'OWNER' || role === 'CO_ADMIN';
    $('voice-create-form').classList.toggle('hidden', !canModerate);
    void loadRooms();
  });
  state.socket.on('voice:rooms-updated', ({ roomId }) => {
    if (roomId === state.roomId) void loadRooms();
  });
  state.socket.on('voice:participants', ({ voiceRoomId, participants: members }) => {
    if (!active || active.room.id !== voiceRoomId || !Array.isArray(members)) return;
    participants = members;
    renderParticipants();
  });
  state.socket.on('voice:speaking', ({ voiceRoomId, socketId, speaking }) => {
    if (!active || active.room.id !== voiceRoomId) return;
    const person = participants.find(item => item.socketId === socketId);
    if (person) { person.speaking = speaking; renderParticipants(); }
  });
  state.socket.on('voice:signal', payload => { void receiveSignal(payload); });
  state.socket.on('voice:peer-left', ({ voiceRoomId, socketId }) => {
    if (active?.room.id === voiceRoomId) { closePeer(socketId);
      participants = participants.filter(item => item.socketId !== socketId); renderParticipants(); }
  });
  state.socket.on('voice:force-mute', ({ voiceRoomId, forcedMuted: force }) => {
    if (active?.room.id !== voiceRoomId) return;
    forcedMuted = !!force;
    if (forcedMuted) muted = true;
    updateMuteButton();
    dockStatus(forcedMuted ? 'A moderação desligou seu microfone.' : 'Seu microfone foi liberado.');
  });
  state.socket.on('voice:removed', ({ voiceRoomId, message }) => {
    if (active?.room.id === voiceRoomId) endVoice(false, message);
  });
  state.socket.on('voice:closed', ({ voiceRoomId }) => {
    if (active?.room.id === voiceRoomId) endVoice(false, 'A sala de voz foi encerrada.');
  });
  state.socket.on('disconnect', () => {
    if (active) endVoice(false, 'Conexão perdida. Entre novamente na chamada.');
  });
  for (const event of ['live-state', 'live-started', 'live-ended'])
    state.socket.on(event, () => setTimeout(syncProjectionOption, 0));
  window.addEventListener('beforeunload', () => { stopMedia(); });
}

import state from './state.js';

const $ = id => document.getElementById(id);
const peers = new Map();
const pendingCandidates = new Map();
const pendingScreenSignals = new Map();
let stream = null;
let screenStream = null;
let nativeSharing = false;
let nativeStarting = false;
const nativeScreen = window.PurpNativeScreenShare || null;
let sharingInProgress = false;
let viewerDismissed = false;
let viewerMinimized = false;
let lastSharerId = null;
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
      const watch = element('button', 'Só assistir');
      watch.type = 'button'; watch.disabled = !!active || room.participantCount >= room.maxParticipants;
      watch.addEventListener('click', () => joinVoice(room.id, true));
      actions.append(watch);
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
  peer.screenPc?.close();
  if (nativeSharing) void nativeScreen?.removeViewer(id);
  peer.audio.remove();
  peer.screenStream?.getTracks().forEach(track => track.stop());
  peers.delete(id);
  pendingCandidates.delete(id);
}
function endVoice(send = true, message = '') {
  if (send && active && state.socket.connected)
    state.socket.emit('voice:leave', {});
  stopScreenShare(false);
  for (const id of [...peers.keys()]) closePeer(id);
  pendingScreenSignals.clear();
  stopMedia();
  active = null; participants = []; muted = false; forcedMuted = false;
  viewerDismissed = false; viewerMinimized = false; lastSharerId = null;
  updateScreenView();
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
  const peer = { pc, audio, volume: 100, locallyMuted: false, screenStream: null,
    screenSender: null, videoTask: Promise.resolve(), makingOffer: false,
    ignoreOffer: false, settingRemoteAnswer: false, needsNegotiation: false,
    incoming: Promise.resolve() };
  peers.set(id, peer);
  if (!stream.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.addTransceiver('video', { direction: 'recvonly' });
  if (screenStream) {
    peer.screenSender = pc.addTrack(screenStream.getVideoTracks()[0], screenStream);
    void configureVideoSender(peer.screenSender);
  }
  pc.onnegotiationneeded = () => { void offerTo(id); };
  pc.onicecandidate = event => {
    if (event.candidate) sendSignal(id, 'candidate', event.candidate.toJSON());
  };
  pc.ontrack = event => {
    if (event.track.kind === 'video') {
      peer.screenStream = new MediaStream([event.track]);
      const clearVideo = () => {
        if (peer.screenStream?.getVideoTracks()[0] === event.track) peer.screenStream = null;
        updateScreenView();
      };
      event.track.addEventListener('ended', clearVideo);
      event.track.addEventListener('mute', () => updateScreenView());
      event.track.addEventListener('unmute', () => updateScreenView());
      updateScreenView();
      return;
    }
    audio.srcObject = event.streams[0] || new MediaStream([event.track]);
    audio.muted = peer.locallyMuted || !!participants.find(item => item.socketId === id)?.forcedMuted;
    audio.play().catch(() => dockStatus('Toque em Expandir para ativar o áudio desta chamada.'));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') dockStatus('Conexão de áudio instável. Saia e entre novamente.');
  };
  return peer;
}
function updateScreenView() {
  const sharer = participants.find(person => person.sharing);
  if (sharer?.socketId !== lastSharerId) {
    lastSharerId = sharer?.socketId || null;
    viewerDismissed = false;
    viewerMinimized = false;
  }
  const peer = sharer && peers.get(sharer.socketId);
  const visibleStream = sharer?.socketId === state.socket.id ? screenStream : peer?.screenStream;
  const view = $('voice-screen-view');
  const video = $('voice-screen-video');
  view.classList.toggle('hidden', !sharer || viewerDismissed);
  view.classList.toggle('minimized', viewerMinimized);
  $('voice-screen-watch').classList.toggle('hidden', !sharer || !viewerDismissed);
  $('voice-screen-minimize').textContent = viewerMinimized ? 'Expandir vídeo' : 'Minimizar';
  $('voice-screen-label').textContent = sharer ? `Tela de ${sharer.username}` : '';
  const playingStream = visibleStream?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted)
    ? visibleStream : null;
  if (video.srcObject !== playingStream) video.srcObject = playingStream;
  if (playingStream) void video.play().catch(() => {});
  $('voice-screen-waiting').textContent = nativeSharing && sharer?.socketId === state.socket.id
    ? 'Sua tela está sendo transmitida pelo Android.' : 'Aguardando vídeo...';
  $('voice-screen-waiting').classList.toggle('hidden', !!playingStream || !sharer);
  const button = $('voice-screen-share');
  button.textContent = screenStream || nativeSharing ? 'Parar compartilhamento' : 'Compartilhar tela';
  button.disabled = !active || sharingInProgress || nativeStarting || (!screenStream && !nativeSharing &&
    ((!nativeScreen && !navigator.mediaDevices?.getDisplayMedia) ||
      !!(sharer && sharer.socketId !== state.socket.id)));
  if (!screenStream && !nativeSharing && !nativeScreen && !navigator.mediaDevices?.getDisplayMedia)
    button.title = 'Compartilhamento de tela indisponível neste dispositivo.';
  else if (!screenStream && sharer && sharer.socketId !== state.socket.id)
    button.title = 'Aguarde o compartilhamento atual terminar.';
  else button.removeAttribute('title');
}
function stopScreenShare(announce = true) {
  if (nativeSharing || nativeStarting) {
    nativeSharing = false; nativeStarting = false;
    void nativeScreen?.stop();
    if (announce && active && state.socket.connected)
      state.socket.emit('voice:share', { sharing: false });
    updateScreenView();
    return;
  }
  if (!screenStream) return;
  const oldStream = screenStream;
  screenStream = null;
  oldStream.getTracks().forEach(track => track.stop());
  if (announce && active && state.socket.connected)
    state.socket.emit('voice:share', { sharing: false });
  for (const peer of peers.values()) {
    if (peer.screenSender) {
      peer.videoTask = peer.videoTask.then(() => peer.screenSender.replaceTrack(null)).catch(() => {});
    }
  }
  updateScreenView();
}
async function configureVideoSender(sender) {
  try {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = 5000000;
    parameters.degradationPreference = 'maintain-resolution';
    await sender.setParameters(parameters);
  } catch { /* O WebRTC ainda adapta a qualidade quando este ajuste não é aceito. */ }
}
async function startScreenShare() {
  if (!active || screenStream || nativeSharing || sharingInProgress) return;
  sharingInProgress = true;
  updateScreenView();
  let captured;
  try {
    if (nativeScreen) {
      nativeStarting = true;
      await nativeScreen.start({ iceServers: active.iceServers,
        microphone: !!stream?.getAudioTracks().length });
      if (!active || !state.socket.connected) throw new Error('A chamada foi encerrada.');
      await emit('voice:share', { sharing: true });
      nativeSharing = true; nativeStarting = false;
      for (const person of participants) if (person.socketId !== state.socket.id)
        void nativeScreen.addViewer(person.socketId);
      $('voice-dock-body').classList.remove('hidden');
      $('voice-dock-expand').textContent = 'Recolher';
      $('voice-dock-expand').setAttribute('aria-expanded', 'true');
      return;
    }
    captured = await navigator.mediaDevices.getDisplayMedia({ video: {
      width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 } }, audio: false });
    const track = captured.getVideoTracks()[0];
    if (!track) throw new Error('Nenhuma imagem de tela foi recebida.');
    if (!active || !state.socket.connected) throw new Error('A chamada foi encerrada.');
    await emit('voice:share', { sharing: true });
    if (!active || !state.socket.connected) throw new Error('A chamada foi encerrada.');
    screenStream = captured;
    track.addEventListener('ended', () => stopScreenShare());
    for (const peer of peers.values()) {
      if (peer.screenSender) {
        peer.videoTask = peer.videoTask.then(() => peer.screenSender.replaceTrack(track));
        await peer.videoTask;
      } else {
        peer.screenSender = peer.pc.addTrack(track, captured);
        void configureVideoSender(peer.screenSender);
      }
    }
    $('voice-dock-body').classList.remove('hidden');
    $('voice-dock-expand').textContent = 'Recolher';
    $('voice-dock-expand').setAttribute('aria-expanded', 'true');
    updateScreenView();
  } catch (error) {
    if (screenStream || nativeStarting || nativeSharing) stopScreenShare();
    else captured?.getTracks().forEach(track => track.stop());
    dockStatus(error.name === 'NotAllowedError' ? 'Compartilhamento de tela cancelado.' :
      error.message || 'Não foi possível compartilhar a tela.');
  } finally { sharingInProgress = false; updateScreenView(); }
}
async function receiveNativeScreenSignal({ from, type, data }) {
  if (typeof from !== 'string' || !active) return;
  if (!participants.some(person => person.socketId === from)) {
    if (!pendingScreenSignals.has(from)) pendingScreenSignals.set(from, []);
    if (pendingScreenSignals.get(from).length < 30)
      pendingScreenSignals.get(from).push({ from, type, data });
    return;
  }
  if (nativeSharing) {
    if (['screen-answer', 'screen-candidate'].includes(type))
      await nativeScreen.signal(from, type, data).catch(() => {});
    return;
  }
  if (type !== 'screen-offer' && type !== 'screen-candidate') return;
  const peer = createPeer(from);
  if (!peer) return;
  if (!peer.screenPc) {
    peer.screenPc = new RTCPeerConnection({ iceServers: active.iceServers });
    peer.screenCandidates = [];
    peer.screenPc.addTransceiver('video', { direction: 'recvonly' });
    peer.screenPc.ontrack = event => {
      peer.screenStream = new MediaStream([event.track]);
      event.track.addEventListener('ended', () => {
        if (peer.screenStream?.getVideoTracks()[0] === event.track) peer.screenStream = null;
        updateScreenView();
      });
      event.track.addEventListener('unmute', updateScreenView);
      updateScreenView();
    };
    peer.screenPc.onicecandidate = event => {
      if (event.candidate) sendSignal(from, 'screen-candidate', event.candidate.toJSON());
    };
  }
  if (type === 'screen-candidate') {
    if (peer.screenPc.remoteDescription) await peer.screenPc.addIceCandidate(data).catch(() => {});
    else if (peer.screenCandidates.length < 30) peer.screenCandidates.push(data);
    return;
  }
  if (peer.screenPc.signalingState !== 'stable') {
    peer.screenPc.close(); peer.screenPc = null;
    return receiveNativeScreenSignal({ from, type, data });
  }
  await peer.screenPc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
  for (const candidate of peer.screenCandidates.splice(0))
    await peer.screenPc.addIceCandidate(candidate).catch(() => {});
  await peer.screenPc.setLocalDescription(await peer.screenPc.createAnswer());
  sendSignal(from, 'screen-answer', { sdp: peer.screenPc.localDescription.sdp });
}
function flushScreenSignals() {
  for (const [id, queued] of pendingScreenSignals) {
    if (!participants.some(person => person.socketId === id)) continue;
    pendingScreenSignals.delete(id);
    for (const signal of queued) void receiveNativeScreenSignal(signal)
      .catch(() => dockStatus('Falha ao receber a tela do Android.'));
  }
}
async function offerTo(id) {
  const peer = createPeer(id);
  if (!peer) return;
  if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
    peer.needsNegotiation = true;
    return;
  }
  peer.makingOffer = true;
  peer.needsNegotiation = false;
  try {
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    if (peers.get(id) === peer && active && peer.pc.signalingState === 'have-local-offer')
      sendSignal(id, 'offer', { sdp: peer.pc.localDescription.sdp });
  } catch {
    if (peer.pc.signalingState !== 'closed') dockStatus('Não foi possível atualizar a transmissão.');
  } finally {
    peer.makingOffer = false;
  }
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
  if (type === 'candidate' && !peers.has(from)) {
    if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
    if (pendingCandidates.get(from).length < 30) pendingCandidates.get(from).push(data);
    return;
  }
  const peer = createPeer(from);
  if (!peer) return;
  peer.incoming = peer.incoming.then(async () => {
    if (peers.get(from) !== peer || peer.pc.signalingState === 'closed') return;
    if (type === 'candidate') {
      if (peer.ignoreOffer) return;
      if (!peer.pc.remoteDescription) {
        if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
        if (pendingCandidates.get(from).length < 30) pendingCandidates.get(from).push(data);
      } else await peer.pc.addIceCandidate(data);
      return;
    }
    const collision = type === 'offer' &&
      (peer.makingOffer || (peer.pc.signalingState !== 'stable' && !peer.settingRemoteAnswer));
    const polite = state.socket.id < from;
    peer.ignoreOffer = !polite && collision;
    if (peer.ignoreOffer) return;
    peer.settingRemoteAnswer = type === 'answer';
    await peer.pc.setRemoteDescription({ type, sdp: data.sdp });
    peer.settingRemoteAnswer = false;
    await flushCandidates(from);
    if (type === 'offer') {
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      sendSignal(from, 'answer', { sdp: peer.pc.localDescription.sdp });
    }
    if (peer.needsNegotiation && peer.pc.signalingState === 'stable') void offerTo(from);
  }).catch(() => { peer.settingRemoteAnswer = false;
    dockStatus('Falha ao conectar a mídia de um participante.'); });
  await peer.incoming;
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
      person.sharing ? 'Compartilhando a tela' : person.forcedMuted ? 'Silenciado pela moderação' : person.muted ? 'Microfone desligado' :
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
  updateScreenView();
}
function updateMuteButton() {
  const button = $('voice-dock-mute');
  button.textContent = !stream?.getAudioTracks().length ? 'Só ouvindo' :
    forcedMuted ? 'Mic bloqueado' : muted ? '🔇 Ativar mic' : '🎙 Desligar mic';
  button.disabled = forcedMuted || !stream?.getAudioTracks().length;
  button.setAttribute('aria-pressed', String(muted || forcedMuted));
  stream?.getAudioTracks().forEach(track => { track.enabled = !muted && !forcedMuted; });
}
async function joinVoice(voiceRoomId, listenOnly = false) {
  if (active || creating) return;
  creating = true;
  status(listenOnly ? 'Entrando para assistir...' : 'Solicitando acesso ao microfone...');
  try {
    if (!window.RTCPeerConnection || (!listenOnly && !navigator.mediaDevices?.getUserMedia))
      throw new Error('Seu navegador não permite chamadas de voz neste contexto.');
    stream = listenOnly ? new MediaStream() : await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const joined = await emit('voice:join', { voiceRoomId });
    active = { room: joined.room, iceServers: joined.iceServers || [] };
    muted = joined.self.muted; forcedMuted = joined.self.forcedMuted;
    if (listenOnly) {
      await emit('voice:self-mute', { muted: true });
      muted = true;
      joined.self.muted = true;
    }
    participants = [joined.self, ...joined.peers];
    showDock(joined.room); renderParticipants(); startSpeakingMeter();
    for (const peer of joined.peers) await offerTo(peer.socketId);
    flushScreenSignals();
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
    if (!active || forcedMuted || !stream?.getAudioTracks().length) return;
    const button = $('voice-dock-mute'); button.disabled = true;
    try { const result = await emit('voice:self-mute', { muted: !muted });
      muted = result.muted; updateMuteButton(); dockStatus(''); }
    catch (error) { dockStatus(error.message); button.disabled = false; }
  });
  $('voice-dock-leave').addEventListener('click', () => endVoice());
  $('voice-screen-share').addEventListener('click', () => {
    if (screenStream || nativeSharing) stopScreenShare();
    else void startScreenShare();
  });
  $('voice-screen-watch').addEventListener('click', () => {
    viewerDismissed = false; viewerMinimized = false;
    updateScreenView();
  });
  $('voice-screen-close').addEventListener('click', () => {
    viewerDismissed = true;
    if (document.fullscreenElement === $('voice-screen-view')) void document.exitFullscreen();
    updateScreenView();
  });
  $('voice-screen-minimize').addEventListener('click', () => {
    viewerMinimized = !viewerMinimized;
    if (viewerMinimized && document.fullscreenElement === $('voice-screen-view'))
      void document.exitFullscreen();
    updateScreenView();
  });
  $('voice-screen-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === $('voice-screen-view')) await document.exitFullscreen();
      else {
        viewerMinimized = false;
        updateScreenView();
        await $('voice-screen-view').requestFullscreen();
      }
    } catch { dockStatus('Tela cheia indisponível neste dispositivo.'); }
  });
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
    flushScreenSignals();
    for (const [id, peer] of peers) {
      if (peer.screenPc && !members.some(person => person.socketId === id && person.sharing)) {
        peer.screenPc.close(); peer.screenPc = null; peer.screenStream = null;
      }
    }
    if (nativeSharing) for (const person of members)
      if (person.socketId !== state.socket.id) void nativeScreen.addViewer(person.socketId);
    renderParticipants();
    updateScreenView();
  });
  state.socket.on('voice:speaking', ({ voiceRoomId, socketId, speaking }) => {
    if (!active || active.room.id !== voiceRoomId) return;
    const person = participants.find(item => item.socketId === socketId);
    if (person) { person.speaking = speaking; renderParticipants(); }
  });
  state.socket.on('voice:signal', payload => {
    if (typeof payload?.type === 'string' && payload.type.startsWith('screen-'))
      void receiveNativeScreenSignal(payload).catch(() => dockStatus('Falha ao receber a tela do Android.'));
    else void receiveSignal(payload);
  });
  state.socket.on('voice:peer-left', ({ voiceRoomId, socketId }) => {
    if (active?.room.id === voiceRoomId) { closePeer(socketId);
      participants = participants.filter(item => item.socketId !== socketId); renderParticipants(); updateScreenView(); }
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
  nativeScreen?.onStopped(() => {
    if (nativeSharing || nativeStarting) {
      nativeSharing = false; nativeStarting = false;
      if (active && state.socket.connected) state.socket.emit('voice:share', { sharing: false });
      updateScreenView();
      dockStatus('O compartilhamento de tela foi encerrado no Android.');
    }
  });
  nativeScreen?.onSignal(({ to, type, data }) => sendSignal(to, type, data));
  for (const event of ['live-state', 'live-started', 'live-ended'])
    state.socket.on(event, () => setTimeout(syncProjectionOption, 0));
  window.addEventListener('beforeunload', () => { stopScreenShare(false); stopMedia(); });
}

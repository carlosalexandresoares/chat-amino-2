const $ = id => document.getElementById(id);
const nativeScreen = window.PurpNativeScreenShare || null;

function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host))
      id = url.pathname === '/watch' ? url.searchParams.get('v') :
        url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}

let youtubeReady;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve();
  if (!youtubeReady) youtubeReady = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('Não foi possível carregar o YouTube.'));
    document.head.append(script);
  });
  return youtubeReady;
}

export function initDirectMedia(socket, getConversation) {
  let conversationId = null;
  let participants = [];
  let iceServers = [];
  let watch = null;
  let player = null;
  let loadedId = null;
  let peer = null;
  let peerId = null;
  let remoteCandidates = [];
  let screenStream = null;
  let nativeSharing = false;
  let screenStarting = false;
  let screenPeer = null;
  let nativeAudioContext = null;
  let nativeAudioTime = 0;
  const status = message => { $('dm-media-status').textContent = message || ''; };
  const emit = (name, payload = {}) => new Promise((resolve, reject) => {
    socket.timeout(8000).emit(`direct-media:${name}`, payload, (error, result) => {
      if (error) reject(new Error('A conexão demorou a responder.'));
      else if (!result?.success) reject(new Error(result?.message || 'Ação indisponível.'));
      else resolve(result);
    });
  });
  function panel(open) {
    $('dm-media').classList.toggle('hidden', !open);
    $('dm-media-toggle').setAttribute('aria-expanded', String(open));
  }
  function sendSignal(to, type, data) {
    socket.emit('direct-media:signal', { to, type, data });
  }
  function closePeer() {
    peer?.close(); peer = null; peerId = null; remoteCandidates = [];
    screenPeer?.close(); screenPeer = null;
    if (nativeAudioContext) void nativeAudioContext.close().catch(() => {});
    nativeAudioContext = null; nativeAudioTime = 0;
    $('dm-screen-video').srcObject = null;
  }
  function setVideo(stream) {
    const video = $('dm-screen-video');
    video.srcObject = stream;
    video.classList.toggle('hidden', !stream);
    if (stream) void video.play().catch(() => status('Toque no vídeo para iniciar a reprodução.'));
  }
  function createPeer(id) {
    if (peer && peerId === id) return peer;
    closePeer();
    peerId = id;
    peer = new RTCPeerConnection({ iceServers });
    peer.onicecandidate = event => {
      if (event.candidate) sendSignal(id, 'candidate', event.candidate.toJSON());
    };
    peer.ontrack = event => {
      if (event.track.kind === 'video') {
        const remote = new MediaStream([event.track]);
        setVideo(remote);
        event.track.addEventListener('ended', () => setVideo(null));
      } else {
        const audio = document.createElement('audio');
        audio.autoplay = true; audio.srcObject = new MediaStream([event.track]);
        audio.hidden = true; $('dm-media').append(audio);
        event.track.addEventListener('ended', () => audio.remove());
        void audio.play().catch(() => {});
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === 'failed') status('Conexão de tela instável. Tente compartilhar novamente.');
    };
    return peer;
  }
  async function offerScreen(id) {
    if (!screenStream || !id) return;
    const pc = createPeer(id);
    for (const track of screenStream.getTracks()) pc.addTrack(track, screenStream);
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal(id, 'offer', { sdp: pc.localDescription.sdp });
  }
  async function stopShare(announce = true) {
    const wasSharing = !!screenStream || nativeSharing;
    screenStream?.getTracks().forEach(track => track.stop());
    screenStream = null;
    if (nativeSharing) await nativeScreen?.stop();
    nativeSharing = false;
    if (wasSharing && announce && socket.connected) socket.emit('direct-media:share', { sharing: false });
    closePeer();
    updateShare();
  }
  function updateShare() {
    const sharer = participants.find(item => item.sharing);
    $('dm-screen-share').textContent = screenStream || nativeSharing ? 'Parar compartilhamento' : 'Compartilhar tela';
    $('dm-screen-share').disabled = !conversationId || screenStarting ||
      (!screenStream && !nativeSharing && (!!sharer || (!nativeScreen && !navigator.mediaDevices?.getDisplayMedia)));
    $('dm-screen-label').textContent = sharer ? `Tela de ${sharer.username}` : '';
    $('dm-media-participants').textContent = `${participants.length}/2 na sessão`;
    if (!sharer && !screenStream) setVideo(null);
  }
  async function startShare() {
    if (!conversationId || screenStarting || screenStream || nativeSharing) return;
    screenStarting = true; updateShare();
    let captured;
    try {
      if (nativeScreen) {
        const result = await nativeScreen.start({ iceServers, microphone: false });
        if (!conversationId || !socket.connected) throw new Error('A sessão foi encerrada.');
        await emit('share', { sharing: true });
        nativeSharing = true;
        for (const member of participants) if (member.socketId !== socket.id)
          void nativeScreen.addViewer(member.socketId);
        if (!result?.audioAvailable) status('Tela compartilhada sem áudio do dispositivo.');
      } else {
        captured = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' });
        if (!captured.getVideoTracks().length) throw new Error('Nenhuma imagem de tela foi recebida.');
        if (!conversationId || !socket.connected) throw new Error('A sessão foi encerrada.');
        await emit('share', { sharing: true });
        screenStream = captured;
        captured.getVideoTracks()[0].addEventListener('ended', () => { void stopShare(); });
        setVideo(captured);
        const other = participants.find(item => item.socketId !== socket.id);
        if (other) await offerScreen(other.socketId);
      }
      panel(true); status('');
    } catch (error) {
      captured?.getTracks().forEach(track => track.stop());
      if (nativeScreen && !nativeSharing) await nativeScreen.stop();
      if (screenStream || nativeSharing) await stopShare();
      status(error.name === 'NotAllowedError' ? 'Compartilhamento cancelado.' : error.message);
    } finally { screenStarting = false; updateShare(); }
  }
  async function applyWatch(next) {
    watch = next;
    $('dm-watch-controls').classList.toggle('hidden', !watch);
    $('dm-watch-player').classList.toggle('hidden', !watch);
    if (!watch) { player?.destroy(); player = null; loadedId = null; return; }
    panel(true);
    try {
      await loadYouTube();
      if (!watch || watch !== next || !conversationId) return;
      const position = watch.position + (watch.playing ? (Date.now() - watch.changedAt) / 1000 : 0);
      if (!player) {
        $('dm-watch-player').replaceChildren();
        const mount = document.createElement('div'); $('dm-watch-player').append(mount);
        player = new YT.Player(mount, { videoId: watch.videoId, playerVars: { playsinline: 1, controls: 0 },
          events: { onReady: () => { if (watch) {
            player.seekTo(position, true);
            if (watch.playing) player.playVideo(); else player.pauseVideo();
          } } } });
        loadedId = watch.videoId;
      } else if (loadedId !== watch.videoId) {
        loadedId = watch.videoId;
        player.cueVideoById({ videoId: watch.videoId, startSeconds: position });
        if (watch.playing) player.playVideo();
      } else {
        player.seekTo(position, true);
        if (watch.playing) player.playVideo(); else player.pauseVideo();
      }
      $('dm-watch-position').value = String(Math.floor(position));
    } catch (error) { status(error.message); }
  }
  async function receiveNative({ from, type, data }) {
    if (nativeSharing) {
      if (['screen-answer', 'screen-candidate'].includes(type))
        await nativeScreen.signal(from, type, data).catch(() => {});
      return;
    }
    if (type === 'screen-offer') {
      screenPeer?.close();
      screenPeer = new RTCPeerConnection({ iceServers });
      screenPeer.onicecandidate = event => {
        if (event.candidate) sendSignal(from, 'screen-candidate', event.candidate.toJSON());
      };
      screenPeer.ontrack = event => setVideo(new MediaStream([event.track]));
      screenPeer.ondatachannel = event => {
        if (event.channel.label !== 'screen-audio') { event.channel.close(); return; }
        event.channel.binaryType = 'arraybuffer';
        event.channel.onmessage = message => {
          if (!(message.data instanceof ArrayBuffer) || message.data.byteLength !== 1920) return;
          try {
            const context = nativeAudioContext ||= new AudioContext();
            const buffer = context.createBuffer(1, 960, 48000);
            const samples = new DataView(message.data);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < 960; i++) output[i] = samples.getInt16(i * 2, true) / 32768;
            const source = context.createBufferSource(); source.buffer = buffer;
            source.connect(context.destination);
            nativeAudioTime = Math.max(context.currentTime + 0.06,
              Math.min(nativeAudioTime || 0, context.currentTime + 0.2));
            source.start(nativeAudioTime); nativeAudioTime += buffer.duration;
            if (context.state === 'suspended') void context.resume().catch(() => {});
          } catch { /* O vídeo continua se o áudio não estiver disponível. */ }
        };
      };
      await screenPeer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await screenPeer.setLocalDescription(await screenPeer.createAnswer());
      sendSignal(from, 'screen-answer', { sdp: screenPeer.localDescription.sdp });
    } else if (type === 'screen-candidate' && screenPeer) {
      await screenPeer.addIceCandidate(data).catch(() => {});
    }
  }
  async function leave() {
    await stopShare();
    if (conversationId && socket.connected) socket.emit('direct-media:leave', {});
    conversationId = null; participants = []; watch = null;
    closePeer(); player?.destroy(); player = null; loadedId = null;
    panel(false); updateShare();
  }
  async function open(conversation) {
    await leave();
    if (!conversation || conversation.status !== 'ACTIVE' || conversation.incomingRequest || conversation.outgoingRequest) {
      $('dm-media-toggle').classList.add('hidden'); return;
    }
    $('dm-media-toggle').classList.remove('hidden');
    try {
      const result = await emit('join', { conversationId: conversation.id });
      conversationId = conversation.id;
      participants = result.participants; iceServers = result.iceServers || [];
      updateShare();
      await applyWatch(result.watch);
      if (participants.some(item => item.sharing)) panel(true);
    } catch (error) { status(error.message); }
  }
  socket.on('direct-media:state', payload => {
    if (payload.conversationId !== conversationId) return;
    const previous = participants.find(item => item.sharing);
    participants = payload.participants;
    const other = participants.find(item => item.socketId !== socket.id);
    if (!other || previous && previous.socketId !== other.socketId && !screenStream && !nativeSharing) closePeer();
    if (screenStream && other && peerId !== other.socketId) void offerScreen(other.socketId).catch(error => status(error.message));
    if (nativeSharing && other) void nativeScreen.addViewer(other.socketId);
    if (!payload.participants.some(item => item.sharing)) closePeer();
    updateShare();
    if (payload.watch?.changedAt !== watch?.changedAt || payload.watch?.videoId !== watch?.videoId)
      void applyWatch(payload.watch);
    if (payload.participants.some(item => item.sharing)) panel(true);
  });
  socket.on('direct-media:peer-left', payload => {
    if (payload.conversationId !== conversationId) return;
    if (peerId === payload.socketId) closePeer();
    if (nativeSharing) void nativeScreen.removeViewer(payload.socketId);
  });
  socket.on('direct-media:closed', payload => {
    if (payload.conversationId === conversationId) {
      void leave(); status('Sessão encerrada.');
    }
  });
  socket.on('direct-media:signal', async payload => {
    if (payload.conversationId !== conversationId) return;
    try {
      if (payload.type.startsWith('screen-')) return await receiveNative(payload);
      const pc = createPeer(payload.from);
      if (payload.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.data.sdp });
        for (const candidate of remoteCandidates.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
        await pc.setLocalDescription(await pc.createAnswer());
        sendSignal(payload.from, 'answer', { sdp: pc.localDescription.sdp });
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.data.sdp });
        for (const candidate of remoteCandidates.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
      } else if (pc.remoteDescription) await pc.addIceCandidate(payload.data).catch(() => {});
      else if (remoteCandidates.length < 30) remoteCandidates.push(payload.data);
    } catch (error) { status(`Falha na conexão de tela: ${error.message}`); }
  });
  socket.on('disconnect', () => { void stopShare(false); closePeer(); participants = []; updateShare(); });
  socket.on('connect', () => { if (getConversation()?.id === conversationId) void open(getConversation()); });
  nativeScreen?.onSignal(({ to, type, data }) => {
    if (nativeSharing) sendSignal(to, type, data);
  });
  nativeScreen?.onStopped(() => { if (nativeSharing) void stopShare(); });
  $('dm-media-toggle').addEventListener('click', () => panel($('dm-media').classList.contains('hidden')));
  $('dm-media-close').addEventListener('click', () => panel(false));
  $('dm-watch-form').addEventListener('submit', async event => {
    event.preventDefault();
    const videoId = youtubeId($('dm-watch-url').value);
    if (!videoId) return status('Cole um link válido do YouTube.');
    try { await emit('watch', { action: 'load', videoId }); status('Vídeo aberto para as duas pessoas.'); }
    catch (error) { status(error.message); }
  });
  for (const action of ['play', 'pause', 'stop', 'seek'])
    $(`dm-watch-${action}`).addEventListener('click', async () => {
      try { await emit('watch', { action, position: Number($('dm-watch-position').value) }); status(''); }
      catch (error) { status(error.message); }
    });
  $('dm-screen-share').addEventListener('click', () => {
    if (screenStream || nativeSharing) void stopShare(); else void startShare();
  });
  window.addEventListener('beforeunload', () => { void stopShare(); if (conversationId) socket.emit('direct-media:leave', {}); });
  updateShare();
  return { open, leave };
}

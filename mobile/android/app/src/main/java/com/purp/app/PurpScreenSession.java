package com.purp.app;

import android.content.Context;
import android.content.Intent;
import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpParameters;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpSender;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

final class PurpScreenSession {
    interface Listener {
        void onSignal(String viewer, String type, JSONObject data);
        void onStopped();
    }

    private static final PurpScreenSession INSTANCE = new PurpScreenSession();
    static PurpScreenSession get() { return INSTANCE; }

    private final Map<String, PeerConnection> peers = new HashMap<>();
    private final Map<String, DataChannel> audioChannels = new HashMap<>();
    private final Object audioLock = new Object();
    private final Map<String, List<IceCandidate>> pending = new HashMap<>();
    private Listener listener;
    private Context context;
    private EglBase egl;
    private PeerConnectionFactory factory;
    private VideoSource source;
    private VideoTrack track;
    private SurfaceTextureHelper surface;
    private ScreenCapturerAndroid capturer;
    private AudioRecord playbackRecord;
    private Thread playbackThread;
    private volatile boolean playbackRunning;
    private static final int AUDIO_RATE = 48000;
    private static final int AUDIO_FRAME_BYTES = AUDIO_RATE / 50 * 2;
    private List<PeerConnection.IceServer> iceServers = Collections.emptyList();
    private boolean active;
    private static boolean factoryInitialized;

    synchronized void setListener(Listener value) { listener = value; }
    synchronized boolean isActive() { return active; }

    synchronized void start(Context appContext, Intent permission, String serversJson) throws Exception {
        if (active) throw new IllegalStateException("A tela já está sendo transmitida.");
        if (permission == null) throw new IllegalArgumentException("Permissão de captura ausente.");
        context = appContext.getApplicationContext();
        iceServers = parseServers(serversJson);
        try {
            if (!factoryInitialized) {
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions
                    .builder(context).createInitializationOptions());
                factoryInitialized = true;
            }
            egl = EglBase.create();
            factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
                .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
                .createPeerConnectionFactory();
            source = factory.createVideoSource(true);
            track = factory.createVideoTrack("purp-android-screen", source);
            capturer = new ScreenCapturerAndroid(permission, new MediaProjection.Callback() {
                @Override public void onStop() {
                    new Handler(Looper.getMainLooper()).post(() -> PurpScreenSession.this.stop());
                }
            });
            surface = SurfaceTextureHelper.create("PurpScreenCapture", egl.getEglBaseContext());
            capturer.initialize(surface, context, source.getCapturerObserver());
            int[] size = size(context);
            capturer.startCapture(size[0], size[1], 30);
            active = true;
            startPlaybackCapture();
        } catch (Exception error) {
            stop();
            throw error;
        }
    }

    synchronized boolean hasPlaybackAudio() { return playbackRunning; }

    private void startPlaybackCapture() {
        if (Build.VERSION.SDK_INT < 29 || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) return;
        try {
            MediaProjection projection = capturer.getMediaProjection();
            if (projection == null) return;
            AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();
            int minimum = AudioRecord.getMinBufferSize(AUDIO_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
            playbackRecord = new AudioRecord.Builder()
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(AUDIO_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                .setBufferSizeInBytes(Math.max(AUDIO_FRAME_BYTES * 4, minimum))
                .setAudioPlaybackCaptureConfig(config).build();
            if (playbackRecord.getState() != AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("Captura de áudio indisponível.");
            playbackRecord.startRecording();
            playbackRunning = true;
            playbackThread = new Thread(this::sendPlaybackAudio, "PurpScreenAudio");
            playbackThread.start();
        } catch (Exception error) {
            Log.w("PurpScreenShare", "Áudio da tela indisponível", error);
            playbackRunning = false;
            if (playbackRecord != null) {
                playbackRecord.release();
                playbackRecord = null;
            }
        }
    }

    private void sendPlaybackAudio() {
        byte[] frame = new byte[AUDIO_FRAME_BYTES];
        while (playbackRunning) {
            int offset = 0;
            while (offset < frame.length && playbackRunning) {
                int count = playbackRecord.read(frame, offset, frame.length - offset);
                if (count <= 0) { playbackRunning = false; break; }
                offset += count;
            }
            if (offset != frame.length) break;
            byte[] packet = frame.clone();
            synchronized (audioLock) {
                for (DataChannel channel : audioChannels.values()) {
                    if (channel.state() == DataChannel.State.OPEN && channel.bufferedAmount() < AUDIO_RATE * 2)
                        channel.send(new DataChannel.Buffer(ByteBuffer.wrap(packet), true));
                }
            }
        }
    }

    private static List<PeerConnection.IceServer> parseServers(String json) throws Exception {
        JSONArray input = new JSONArray(json == null ? "[]" : json);
        if (input.length() > 5) throw new IllegalArgumentException("Lista de servidores ICE inválida.");
        List<PeerConnection.IceServer> result = new ArrayList<>();
        for (int i = 0; i < input.length(); i++) {
            JSONObject row = input.getJSONObject(i);
            Object urls = row.get("urls");
            List<String> addresses = new ArrayList<>();
            if (urls instanceof JSONArray) {
                JSONArray items = (JSONArray) urls;
                for (int j = 0; j < items.length(); j++) addresses.add(items.getString(j));
            } else addresses.add(String.valueOf(urls));
            for (String address : addresses) {
                if (!address.matches("^(stun:|turn:|turns:)[^\\s]{3,250}$"))
                    throw new IllegalArgumentException("Servidor ICE inválido.");
                result.add(PeerConnection.IceServer.builder(address)
                    .setUsername(row.optString("username", ""))
                    .setPassword(row.optString("credential", "")).createIceServer());
            }
        }
        return result;
    }

    private static int[] size(Context context) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int width = Math.max(1, metrics.widthPixels);
        int height = Math.max(1, metrics.heightPixels);
        double scale = Math.min(1.0, Math.min(1920.0 / Math.max(width, height),
            1080.0 / Math.min(width, height)));
        return new int[] { Math.max(2, (int) (width * scale) & ~1),
            Math.max(2, (int) (height * scale) & ~1) };
    }

    synchronized void resize(Context context) {
        if (!active || capturer == null) return;
        int[] size = size(context);
        try { capturer.changeCaptureFormat(size[0], size[1], 30); }
        catch (Exception ignored) { /* O quadro anterior permanece até a próxima atualização. */ }
    }

    synchronized void addViewer(String id) {
        if (!active || peers.containsKey(id)) return;
        PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(iceServers);
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        PeerConnection pc = factory.createPeerConnection(config, new PeerConnection.Observer() {
            @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
            @Override public void onIceConnectionReceivingChange(boolean receiving) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}
            @Override public void onIceCandidate(IceCandidate candidate) {
                JSONObject data = new JSONObject();
                try {
                    data.put("candidate", candidate.sdp);
                    data.put("sdpMid", candidate.sdpMid);
                    data.put("sdpMLineIndex", candidate.sdpMLineIndex);
                } catch (Exception ignored) { return; }
                emit(id, "screen-candidate", data);
            }
            @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
            @Override public void onAddStream(MediaStream stream) {}
            @Override public void onRemoveStream(MediaStream stream) {}
            @Override public void onDataChannel(DataChannel channel) {}
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
        });
        if (pc == null) throw new IllegalStateException("Não foi possível criar a conexão de vídeo.");
        peers.put(id, pc);
        if (playbackRunning) {
            DataChannel.Init options = new DataChannel.Init();
            options.ordered = true;
            options.maxRetransmits = 0;
            DataChannel audioChannel = pc.createDataChannel("screen-audio", options);
            if (audioChannel != null) synchronized (audioLock) { audioChannels.put(id, audioChannel); }
        }
        RtpSender sender = pc.addTrack(track, Collections.singletonList("purp-screen"));
        if (sender != null) {
            RtpParameters parameters = sender.getParameters();
            if (!parameters.encodings.isEmpty()) {
                parameters.encodings.get(0).maxBitrateBps = 5000000;
                sender.setParameters(parameters);
            }
        }
        pc.createOffer(new BaseSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription offer) {
                pc.setLocalDescription(new BaseSdpObserver() {
                    @Override public void onSetSuccess() {
                        JSONObject data = new JSONObject();
                        try { data.put("sdp", offer.description); }
                        catch (Exception ignored) { return; }
                        emit(id, "screen-offer", data);
                    }
                }, offer);
            }
        }, new MediaConstraints());
    }

    synchronized void signal(String id, String type, JSONObject data) {
        PeerConnection pc = peers.get(id);
        if (pc == null || data == null) return;
        if ("screen-answer".equals(type)) {
            String sdp = data.optString("sdp", "");
            if (sdp.isEmpty() || sdp.length() > 32000) return;
            pc.setRemoteDescription(new BaseSdpObserver() {
                @Override public void onSetSuccess() {
                    synchronized (PurpScreenSession.this) {
                        List<IceCandidate> queued = pending.remove(id);
                        if (queued != null) for (IceCandidate candidate : queued) pc.addIceCandidate(candidate);
                    }
                }
            }, new SessionDescription(SessionDescription.Type.ANSWER, sdp));
        } else if ("screen-candidate".equals(type)) {
            IceCandidate candidate = new IceCandidate(data.optString("sdpMid", ""),
                data.optInt("sdpMLineIndex", 0), data.optString("candidate", ""));
            if (pc.getRemoteDescription() != null) pc.addIceCandidate(candidate);
            else {
                List<IceCandidate> queued = pending.computeIfAbsent(id, unused -> new ArrayList<>());
                if (queued.size() < 30) queued.add(candidate);
            }
        }
    }

    synchronized void removeViewer(String id) {
        PeerConnection pc = peers.remove(id);
        DataChannel channel;
        synchronized (audioLock) { channel = audioChannels.remove(id); }
        pending.remove(id);
        if (channel != null) { channel.close(); channel.dispose(); }
        if (pc != null) { pc.close(); pc.dispose(); }
    }

    synchronized void stop() {
        boolean wasActive = active;
        active = false;
        playbackRunning = false;
        if (playbackRecord != null) {
            try { playbackRecord.stop(); } catch (IllegalStateException ignored) {}
        }
        if (playbackThread != null) {
            try { playbackThread.join(1000); } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            playbackThread = null;
        }
        if (playbackRecord != null) { playbackRecord.release(); playbackRecord = null; }
        for (String id : new ArrayList<>(peers.keySet())) removeViewer(id);
        if (capturer != null) {
            try { capturer.stopCapture(); } catch (Exception ignored) {}
            capturer.dispose(); capturer = null;
        }
        if (surface != null) { surface.dispose(); surface = null; }
        if (track != null) { track.dispose(); track = null; }
        if (source != null) { source.dispose(); source = null; }
        if (factory != null) { factory.dispose(); factory = null; }
        if (egl != null) { egl.release(); egl = null; }
        if (wasActive && listener != null) listener.onStopped();
    }

    private synchronized void emit(String id, String type, JSONObject data) {
        if (active && peers.containsKey(id) && listener != null) listener.onSignal(id, type, data);
    }

    private static class BaseSdpObserver implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription sdp) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }
}

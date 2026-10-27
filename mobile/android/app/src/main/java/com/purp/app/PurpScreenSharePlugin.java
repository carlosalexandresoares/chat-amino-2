package com.purp.app;

import android.app.Activity;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(name = "PurpScreenShare", permissions = {
    @Permission(alias = "screenAudio", strings = { Manifest.permission.RECORD_AUDIO })
})
public class PurpScreenSharePlugin extends Plugin {
    private final PurpScreenSession session = PurpScreenSession.get();

    @Override public void load() {
        session.setListener(new PurpScreenSession.Listener() {
            @Override public void onSignal(String viewer, String type, JSONObject data) {
                JSObject event = new JSObject();
                event.put("to", viewer);
                event.put("type", type);
                event.put("data", data);
                notifyListeners("signal", event);
            }
            @Override public void onStopped() {
                notifyListeners("stopped", new JSObject());
                PurpProjectionService.requestStop(getContext());
            }
        });
    }

    @PluginMethod public void start(PluginCall call) {
        if (session.isActive()) {
            call.reject("A tela já está sendo transmitida.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 29 && getPermissionState("screenAudio") != PermissionState.GRANTED) {
            requestPermissionForAlias("screenAudio", call, "onAudioPermission");
            return;
        }
        requestCaptureConsent(call);
    }

    @PermissionCallback private void onAudioPermission(PluginCall call) {
        if (call != null) requestCaptureConsent(call);
    }

    private void requestCaptureConsent(PluginCall call) {
        try {
            MediaProjectionManager manager = (MediaProjectionManager)
                getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            startActivityForResult(call, manager.createScreenCaptureIntent(), "onCaptureConsent");
        } catch (Exception error) {
            call.reject("Não foi possível pedir autorização para capturar a tela.", error);
        }
    }

    @ActivityCallback private void onCaptureConsent(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Compartilhamento de tela cancelado.", "NOT_ALLOWED");
            return;
        }
        try {
            Intent permission = result.getData();
            boolean needsAudioService = call.getBoolean("microphone", false) ||
                (Build.VERSION.SDK_INT >= 29 && getPermissionState("screenAudio") == PermissionState.GRANTED);
            PurpProjectionService.start(getContext(), needsAudioService, () -> execute(() -> {
                try {
                    session.start(getContext(), permission, call.getString("iceServersJson", "[]"));
                    JSObject response = new JSObject();
                    response.put("audioAvailable", session.hasPlaybackAudio());
                    call.resolve(response);
                } catch (Exception error) {
                    PurpProjectionService.requestStop(getContext());
                    call.reject("Não foi possível iniciar a captura da tela.", error);
                }
            }));
        } catch (Exception error) {
            call.reject("Não foi possível iniciar o serviço de compartilhamento.", error);
        }
    }

    @PluginMethod public void stop(PluginCall call) {
        session.stop();
        PurpProjectionService.requestStop(getContext());
        call.resolve();
    }

    @PluginMethod public void addViewer(PluginCall call) {
        String id = call.getString("socketId");
        if (!validId(id) || !session.isActive()) {
            call.reject("Participante ou transmissão indisponível.");
            return;
        }
        try { session.addViewer(id); call.resolve(); }
        catch (Exception error) { call.reject("Não foi possível conectar o espectador.", error); }
    }

    @PluginMethod public void removeViewer(PluginCall call) {
        String id = call.getString("socketId");
        if (!validId(id)) { call.reject("Participante inválido."); return; }
        session.removeViewer(id);
        call.resolve();
    }

    @PluginMethod public void signal(PluginCall call) {
        String id = call.getString("socketId");
        String type = call.getString("type");
        JSObject data = call.getObject("data");
        if (!validId(id) || data == null ||
            !("screen-answer".equals(type) || "screen-candidate".equals(type))) {
            call.reject("Sinal de vídeo inválido.");
            return;
        }
        session.signal(id, type, data);
        call.resolve();
    }

    private static boolean validId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,100}");
    }
}

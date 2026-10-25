package com.purp.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "PurpUpdate")
public class PurpUpdatePlugin extends Plugin {
    private static final long MAX_APK_BYTES = 100L * 1024L * 1024L;

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            result.put("versionName", info.versionName);
            result.put("canInstall", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível consultar a versão instalada.", error);
        }
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível abrir as permissões de instalação.", error);
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        if (url == null || !url.matches("https://github\\.com/carlosalexandresoares/chat-amino-2/releases/download/[^/]+/Purp-Android-teste\\.apk")
            || sha256 == null || !sha256.matches("[a-fA-F0-9]{64}")) {
            call.reject("Pacote de atualização inválido.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Autorize a instalação de apps pelo Purp e tente novamente.", "INSTALL_PERMISSION_REQUIRED");
            return;
        }
        execute(() -> {
            File directory = new File(getContext().getCacheDir(), "updates");
            File apk = new File(directory, "Purp-update.apk");
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Sem espaço para atualização.");
                downloadAndVerify(url, sha256, apk);
                getActivity().runOnUiThread(() -> {
                    try {
                        Uri contentUri = FileProvider.getUriForFile(getContext(),
                            getContext().getPackageName() + ".fileprovider", apk);
                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        getActivity().startActivity(intent);
                        call.resolve();
                    } catch (Exception error) {
                        call.reject("Não foi possível abrir o instalador do Android.", error);
                    }
                });
            } catch (Exception error) {
                apk.delete();
                call.reject("Falha ao baixar ou verificar o APK: " + error.getMessage(), error);
            }
        });
    }

    private static void downloadAndVerify(String source, String expectedHash, File destination) throws Exception {
        URL url = new URL(source);
        HttpURLConnection connection = null;
        for (int redirect = 0; redirect < 6; redirect++) {
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                if (location == null) throw new Exception("Redirecionamento sem destino.");
                URL next = new URL(url, location);
                if (!"https".equals(next.getProtocol())) throw new Exception("Download inseguro.");
                connection.disconnect();
                url = next;
                continue;
            }
            if (status != 200) throw new Exception("Servidor retornou HTTP " + status);
            if (connection.getContentLengthLong() > MAX_APK_BYTES) throw new Exception("APK excede o tamanho permitido.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[16384];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    total += length;
                    if (total > MAX_APK_BYTES) throw new Exception("APK excede o tamanho permitido.");
                    digest.update(buffer, 0, length);
                    output.write(buffer, 0, length);
                }
            } finally {
                connection.disconnect();
            }
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            if (!actual.toString().equalsIgnoreCase(expectedHash)) throw new Exception("Assinatura SHA-256 não confere.");
            return;
        }
        throw new Exception("Redirecionamentos em excesso.");
    }
}

package com.purp.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.IBinder;
import androidx.core.content.ContextCompat;

public class PurpProjectionService extends Service {
    private static final String CHANNEL = "purp-screen-share";
    private static final String STOP = "com.purp.app.STOP_SCREEN_SHARE";
    private static Runnable ready;
    private static boolean microphone;
    private static volatile PurpProjectionService running;

    static synchronized void start(Context context, boolean withMicrophone, Runnable callback) {
        ready = callback;
        microphone = withMicrophone;
        ContextCompat.startForegroundService(context,
            new Intent(context, PurpProjectionService.class));
    }

    static void requestStop(Context context) {
        PurpProjectionService service = running;
        if (service != null) service.stopSelf();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            PurpScreenSession.get().stop();
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                "Compartilhamento de tela", NotificationManager.IMPORTANCE_LOW);
            manager.createNotificationChannel(channel);
        }
        Intent stop = new Intent(this, PurpProjectionService.class).setAction(STOP);
        PendingIntent action = PendingIntent.getService(this, 0, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this,
            Build.VERSION.SDK_INT >= 26 ? CHANNEL : "")
            .setSmallIcon(R.drawable.purp_notification)
            .setContentTitle("Purp está compartilhando sua tela")
            .setContentText("A transmissão continua ao sair do aplicativo.")
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Parar transmissão", action).build())
            .build();
        if (Build.VERSION.SDK_INT >= 29) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            if (microphone && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(19001, notification, types);
        }
        else startForeground(19001, notification);
        running = this;
        Runnable callback;
        synchronized (PurpProjectionService.class) { callback = ready; ready = null; }
        if (callback != null) callback.run();
        return START_NOT_STICKY;
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        PurpScreenSession.get().resize(this);
    }

    @Override public void onDestroy() {
        running = null;
        PurpScreenSession.get().stop();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}

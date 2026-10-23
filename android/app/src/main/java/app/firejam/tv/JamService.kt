package app.firejam.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps FireJam's process alive while Prime Video is in front, so the jam's
 * connection and [PrimeSync] keep running. It does no work of its own.
 */
class JamService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Jam sync", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setContentTitle("FireJam")
            .setContentText("Keeping Prime Video in step with your jam")
            .setSmallIcon(R.mipmap.ic_launcher)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(ID, notification)
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "jam"
        private const val ID = 1

        fun start(ctx: Context) {
            val intent = Intent(ctx, JamService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
            } catch (e: RuntimeException) {
                // Starting from the background can be refused; the activity just started it from the foreground anyway.
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, JamService::class.java))
        }
    }
}

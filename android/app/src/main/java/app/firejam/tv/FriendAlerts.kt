package app.firejam.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * "🔥 Ma is watching Sintel": pops up over whatever is on the TV when a friend
 * starts watching something, like a phone notification for your living room.
 *
 * Runs inside [PrimeSessionListener], which Android keeps bound in the background,
 * so alerts arrive even when FireJam isn't open. Every 30 s it asks the server for
 * new alerts (`GET /api/tv/inbox`), draws a bubble with [JamOverlay] and posts a
 * notification that opens FireJam straight into the friend's jam.
 */
object FriendAlerts {
    private const val POLL_MS = 30_000L
    private const val CHANNEL = "friends"
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var ctx: Context? = null
    private var overlay: JamOverlay? = null
    private var cursor = -1L
    private var cursorUser: String? = null
    private var running = false

    private val loop = object : Runnable {
        override fun run() {
            if (!running) return
            poll()
            handler.postDelayed(this, POLL_MS)
        }
    }

    fun start(context: Context) {
        ctx = context.applicationContext
        overlay = JamOverlay(context.applicationContext)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Friends watching", NotificationManager.IMPORTANCE_HIGH))
        }
        if (!running) {
            running = true
            handler.post(loop)
        }
    }

    fun stop() {
        running = false
        handler.removeCallbacks(loop)
    }

    private fun poll() {
        val c = ctx ?: return
        val id = Identity.load(c) ?: return
        val server = id.server
        val user = id.userId
        val token = id.token
        // A different person after a Fire TV profile switch starts from their own inbox.
        if (user != cursorUser) {
            cursorUser = user
            cursor = -1
        }
        val since = cursor
        io.execute {
            try {
                val q = "userId=${enc(user)}&token=${enc(token)}&since=${maxOf(since, 0)}"
                val conn = URL("$server/api/tv/inbox?$q").openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val body = try {
                    if (conn.responseCode != 200) return@execute
                    conn.inputStream.bufferedReader().use { it.readText() }
                } finally {
                    conn.disconnect()
                }
                val o = JSONObject(body)
                handler.post { show(o, firstPoll = since < 0, server = server) }
            } catch (e: Exception) {
                // Offline: try again next time.
            }
        }
    }

    private fun show(o: JSONObject, firstPoll: Boolean, server: String) {
        cursor = o.getLong("cursor")
        if (firstPoll) return // only alerts that happen from now on
        val items = o.getJSONArray("items")
        for (i in 0 until items.length()) {
            val a = items.getJSONObject(i)
            val name = a.optString("name")
            val title = a.optString("title")
            val app = a.optString("app")
            val jamId = if (a.isNull("jamId")) null else a.optString("jamId")
            val text = if (jamId != null) "🔥 $name is watching $title. Open FireJam to join" else "🔥 $name is watching $title on $app"
            // FireJam's own screen shows these as toasts; over other apps, a bubble.
            if (!AppState.foreground) overlay?.show(text, 8000L)
            notify(a.optInt("id"), name, title, app, jamId, server)
        }
    }

    private fun notify(id: Int, name: String, title: String, app: String, jamId: String?, server: String) {
        val c = ctx ?: return
        val open = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (jamId != null) open.putExtra("join", jamId)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        val pending = PendingIntent.getActivity(c, id, open, flags)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(c, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(c)
        val n = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("$name is watching $title")
            .setContentText(if (jamId != null) "Join them on FireJam" else "On $app")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1000 + id, n)
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}

/** Whether FireJam's own screen is in front (its web app then shows alerts itself). */
object AppState {
    @Volatile var foreground = false
}

package app.firejam.tv

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Tells the FireJam server what this TV is playing outside FireJam, so friends
 * see "Aiko is watching Fallout on Prime Video" like Spotify's friend activity.
 *
 * Runs inside [PrimeSessionListener], which Android keeps bound in the
 * background, so it works even when FireJam isn't open. It only reports for the
 * person signed in on this TV, and only while they share their activity
 * (both set by the web app through [FireJamBridge.setIdentity]).
 */
object ActivityReporter {
    private val io = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var ctx: Context? = null
    private var sessions: MediaSessionManager? = null
    private var watched: MediaController? = null
    private var lastSent = ""
    private var lastSentAt = 0L

    private val onSessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> follow(list.orEmpty()) }
    private val onChange = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = report()
        override fun onMetadataChanged(metadata: MediaMetadata?) = report()
        override fun onSessionDestroyed() = follow(emptyList())
    }
    private val heartbeat = object : Runnable {
        override fun run() {
            report(force = true)
            handler.postDelayed(this, 60_000)
        }
    }

    fun start(service: PrimeSessionListener) {
        ctx = service.applicationContext
        val msm = service.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
        sessions = msm
        val me = ComponentName(service, PrimeSessionListener::class.java)
        try {
            msm.addOnActiveSessionsChangedListener(onSessions, me, handler)
            follow(msm.getActiveSessions(me))
        } catch (e: SecurityException) {
            return
        }
        handler.removeCallbacks(heartbeat)
        handler.postDelayed(heartbeat, 60_000)
    }

    fun stop() {
        sessions?.removeOnActiveSessionsChangedListener(onSessions)
        watched?.unregisterCallback(onChange)
        watched = null
        handler.removeCallbacks(heartbeat)
    }

    /** Called when the person signs in or changes sharing, so the first report goes out straight away. */
    fun identityChanged() = handler.post { report(force = true) }

    private fun follow(list: List<MediaController>) {
        val own = ctx?.packageName
        // Prefer whatever is actually playing; ignore FireJam's own player.
        val next = list.filter { it.packageName != own }
            .sortedByDescending { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            .firstOrNull()
        if (next?.sessionToken == watched?.sessionToken) return report()
        watched?.unregisterCallback(onChange)
        watched = next
        next?.registerCallback(onChange, handler)
        report(force = true)
    }

    private fun report(force: Boolean = false) {
        val c = ctx ?: return
        // Whoever is on the TV's current Fire TV profile; nobody is reported for a profile FireJam hasn't met.
        val id = Identity.load(c) ?: return
        if (!id.share) return
        val server = id.server
        val userId = id.userId
        val token = id.token

        val body = JSONObject().put("userId", userId).put("token", token)
        val m = watched
        val state = m?.playbackState?.state
        val title = m?.metadata?.let {
            it.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: it.getString(MediaMetadata.METADATA_KEY_TITLE)
        }
        // Prime Video (tested on Fire OS 8.1) doesn't put the title in its session, so a playing
        // app without a title is still reported: friends see "watching Prime Video".
        val active = state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_PAUSED ||
            (state == PlaybackState.STATE_STOPPED && (m?.playbackState?.position ?: 0L) > 0)
        if (m == null || !active) {
            body.put("stopped", true)
        } else {
            val st = m.playbackState!!
            val playing = st.state == PlaybackState.STATE_PLAYING
            val pos = st.position + if (playing) ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong() else 0L
            body.put("package", m.packageName)
                .put("app", appLabel(c, m.packageName))
                .put("title", title ?: "")
                .put("playing", playing)
                .put("position", pos / 1000.0)
        }
        // Only send changes, plus a heartbeat so the server knows it's still playing.
        val key = "${body.optString("title")}:${body.optBoolean("playing")}:${body.optBoolean("stopped")}"
        val now = System.currentTimeMillis()
        if (!force && key == lastSent && now - lastSentAt < 30_000) return
        lastSent = key
        lastSentAt = now
        io.execute { post("$server/api/activity", body.toString()) }
    }

    private fun appLabel(c: Context, pkg: String): String = try {
        c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }

    private fun post(url: String, json: String) {
        try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(json.toByteArray()) }
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            // Offline or server down: the next change or heartbeat tries again.
        }
    }
}

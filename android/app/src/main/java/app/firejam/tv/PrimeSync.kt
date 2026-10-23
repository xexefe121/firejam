package app.firejam.tv

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Keeps this TV's Prime Video on the jam's shared playhead.
 *
 * Once a second this compares the jam with Prime Video's media session and
 * plays, pauses or seeks Prime Video to match. Changes nobody asked for (someone
 * pressed pause on the remote while Prime Video was in front) go back to the jam
 * so everyone follows.
 *
 * While Prime Video is in front, Fire OS freezes the hidden web app's timers, so
 * its socket can't be relied on. This talks to the FireJam server itself: it
 * polls `GET /api/tv/jam` for the jam, the server clock and what happened (shown
 * as [bubble]s over Prime Video), and sends remote presses to `POST /api/tv/control`.
 * Jam state the web app passes in ([update]) is used too while it's awake.
 *
 * Reading another app's media session needs FireJam to be an enabled
 * notification listener ([PrimeSessionListener]); [hasAccess] says whether it is.
 *
 * Measured on a Fire TV Stick 4K Max (Fire OS 8.1.8.5): Prime Video's session
 * reports position 0 and no title while an ad plays, Prime ignores seeks and the
 * remote's pause then, and once the title itself plays it reports real positions.
 * So:
 *  - While this TV plays an ad, the jam waits: it's paused for everyone, and
 *    when the title comes back the jam resumes from this TV's spot ("ad hold").
 *  - Until a session reports a position, play and pause stay linked but nothing
 *    seeks ("loose"); bubbles carry the jam clock so people can line up by hand.
 *  - Prime is never jumped more than [MAX_AUTO_SEEK_MS]; a big gap is shown instead.
 */
class PrimeSync(
    private val ctx: Context,
    private val emit: (JSONObject) -> Unit,
    private val bubble: (String) -> Unit,
) {

    private data class Jam(
        val playing: Boolean,
        val position: Double,
        val updatedAt: Long,
        val loop: Boolean,
        val runtime: Double,
        /** serverClock - localClock, ms. */
        val offset: Long,
    )

    private data class Seen(val playing: Boolean, val positionMs: Long, val at: Long)

    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val sessions = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    private val listener = ComponentName(ctx, PrimeSessionListener::class.java)

    private var jam: Jam? = null
    private var running = false
    private var seen: Seen? = null
    private var lastCommandAt = 0L
    private var lastSeekAt = 0L
    /** How far ahead to aim a seek; learned from how long Prime Video takes to land. */
    private var seekLeadMs = 1500L
    private var checkLeadAt = 0L
    /** After reporting a remote-control press, give the jam a moment to catch up before enforcing. */
    private var holdUntil = 0L
    private var lastStatus = ""
    private var lastStatusAt = 0L
    /** The session we're following, and whether it has ever reported a real position. */
    private var following: Any? = null
    private var positionTrusted = false
    /** Seeks Prime Video ignored in a row (ads, live, …); each one doubles the wait before the next. */
    private var refusedSeeks = 0
    private var lastSeekTarget = 0L
    /** This TV paused the jam for an ad and will resume it when the title comes back. */
    private var adHold = false
    private var lastGapBubbleAt = 0L
    // Server link.
    private var polling = false
    private var feedCursor = -1L
    private var missedPolls = 0

    private val loop = object : Runnable {
        override fun run() {
            if (!running) return
            poll()
            tick()
            handler.postDelayed(this, TICK_MS)
        }
    }

    fun hasAccess(): Boolean {
        val enabled = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return enabled.split(':').mapNotNull { ComponentName.unflattenFromString(it) }.any { it == listener }
    }

    /** Jam state from the web app (while it's awake). */
    fun update(json: String) {
        val o = JSONObject(json)
        accept(
            Jam(
                playing = o.getBoolean("playing"),
                position = o.getDouble("position"),
                updatedAt = o.getLong("updatedAt"),
                loop = o.optBoolean("loop"),
                runtime = o.optDouble("runtime", 0.0),
                offset = o.optLong("offset"),
            ),
        )
        start()
    }

    fun start() {
        if (running) return
        running = true
        feedCursor = -1
        handler.post(loop)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(loop)
        jam = null
        seen = null
    }

    fun reportNow(state: String) = status(state, null, null, force = true)

    private fun accept(next: Jam) {
        val cur = jam
        holdUntil = 0
        // Whichever source saw the newer change wins; the clock offset always refreshes.
        jam = if (cur == null || next.updatedAt >= cur.updatedAt) next else cur.copy(offset = next.offset)
    }

    // ---------- server link ----------

    private fun identity(): Identity? = Identity.load(ctx)

    private fun poll() {
        if (polling) return
        val id = identity() ?: return
        polling = true
        val since = feedCursor
        io.execute {
            try {
                val q = "userId=${enc(id.userId)}&token=${enc(id.token)}&since=${maxOf(since, 0)}"
                val t0 = System.currentTimeMillis()
                val body = get("${id.server}/api/tv/jam?$q")
                val t1 = System.currentTimeMillis()
                val o = JSONObject(body)
                val offset = o.getLong("serverNow") - (t0 + t1) / 2
                handler.post { onPoll(o, offset, firstPoll = since < 0, me = id.userId) }
            } catch (e: Exception) {
                handler.post { missedPolls++ }
            } finally {
                polling = false
            }
        }
    }

    private fun onPoll(o: JSONObject, offset: Long, firstPoll: Boolean, me: String) {
        if (!running) return
        missedPolls = 0
        feedCursor = o.getLong("cursor")
        val j = o.optJSONObject("jam")
        val media = o.optJSONObject("media")
        if (j == null || media == null) {
            // Left the jam somewhere else (or it ended): stop driving Prime Video.
            stop()
            emit(JSONObject().put("type", "status").put("state", "left"))
            return
        }
        accept(
            Jam(
                playing = j.getBoolean("playing"),
                position = j.getDouble("position"),
                updatedAt = j.getLong("updatedAt"),
                loop = j.optBoolean("loop"),
                runtime = media.optDouble("runtime", 0.0),
                offset = offset,
            ),
        )
        if (firstPoll) return // don't replay what happened before Prime Video opened
        val people = o.optJSONObject("people") ?: JSONObject()
        val feed = o.getJSONArray("feed")
        for (i in 0 until feed.length()) bubble(describe(feed.getJSONObject(i), people, me, media.optString("title")))
    }

    private fun describe(f: JSONObject, people: JSONObject, me: String, title: String): String {
        val from = f.optString("from")
        val who = if (from == me) "You" else people.optJSONObject(from)?.optString("name") ?: "Someone"
        return when (f.optString("kind")) {
            "reaction" -> "$who ${f.optString("emoji")}"
            "chat" -> "$who: ${f.optString("text")}"
            "member" ->
                if (f.optBoolean("joined")) "$who joined from ${people.optJSONObject(from)?.optString("city") ?: "somewhere"}"
                else "$who left"
            else -> {
                val verb = when (f.optString("control")) {
                    "play" -> "pressed play ▶"
                    "pause" -> "paused ⏸"
                    "seek" -> "skipped ⏩"
                    else -> "switched to $title"
                }
                "$who $verb · jam at ${clock(jam?.let { expectedMs(it, System.currentTimeMillis()) } ?: 0L)}"
            }
        }
    }

    private fun sendControl(kind: String, positionMs: Long) {
        val id = identity() ?: return
        val body = JSONObject().put("userId", id.userId).put("token", id.token).put("kind", kind).put("position", positionMs / 1000.0)
        io.execute {
            try {
                post("${id.server}/api/tv/control", body.toString())
            } catch (e: Exception) {
                // The next poll shows the jam as it is; nothing to retry.
            }
        }
    }

    // ---------- keeping Prime Video in step ----------

    private fun controller(): MediaController? = try {
        sessions.getActiveSessions(listener).firstOrNull { it.packageName in PrimeVideo.PACKAGES }
    } catch (e: SecurityException) {
        null
    }

    private fun expectedMs(j: Jam, wall: Long): Long {
        var pos = j.position + if (j.playing) (wall + j.offset - j.updatedAt) / 1000.0 else 0.0
        if (j.loop && j.runtime > 0) pos %= j.runtime
        return (pos * 1000).toLong()
    }

    private fun tick() {
        val j = jam ?: return
        if (!hasAccess()) return status("no-access")
        val c = controller()
        val st = c?.playbackState
        if (c == null || st == null || looksLikeTrailer(c, j)) {
            seen = null
            return status("waiting")
        }
        if (c.sessionToken != following) {
            following = c.sessionToken
            positionTrusted = false
            refusedSeeks = 0
        }
        if (st.position > 0) positionTrusted = true

        // Ad hold: Prime plays ads at position 0. Everyone waits for this TV's ad; when the
        // title comes back the jam picks up from wherever this TV is.
        val inAd = st.state == PlaybackState.STATE_PLAYING && st.position == 0L
        if (inAd && j.playing && !adHold && System.currentTimeMillis() - lastCommandAt > COMMAND_GRACE_MS) {
            adHold = true
            bubble("📺 Ad on this TV. The jam waits for you.")
            return local("pause", expectedMs(j, System.currentTimeMillis()))
        }
        if (adHold) {
            if (inAd || st.state != PlaybackState.STATE_PLAYING) return status("loose", null, null)
            adHold = false
            val at = st.position
            sendControl("seek", at)
            bubble("▶ Back to the film. The jam carries on from here.")
            return local("play", at)
        }

        val now = SystemClock.elapsedRealtime()
        val wall = System.currentTimeMillis()
        val playing = st.state == PlaybackState.STATE_PLAYING
        // Prime Video reports a paused title as STOPPED (with its position kept) a moment after pausing.
        val settled = playing || st.state == PlaybackState.STATE_PAUSED ||
            (st.state == PlaybackState.STATE_STOPPED && st.position > 0)
        val positionMs = st.position + if (playing) ((now - st.lastPositionUpdateTime) * st.playbackSpeed).toLong() else 0L
        val expected = expectedMs(j, wall)
        val title = c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)

        // 1. A change on Prime Video that FireJam didn't ask for came from this TV's remote.
        val prev = seen
        seen = Seen(playing, positionMs, now)
        if (prev != null && settled && wall - lastCommandAt > COMMAND_GRACE_MS) {
            if (prev.playing != playing && playing != j.playing) {
                return local(if (playing) "play" else "pause", positionMs)
            }
            val predicted = prev.positionMs + if (prev.playing) now - prev.at else 0L
            val jumped = abs(positionMs - predicted) > LOCAL_SEEK_MS && abs(positionMs - expected) > LOCAL_SEEK_MS
            if (positionTrusted && jumped) return local("seek", positionMs)
        }
        if (wall < holdUntil) return status(if (positionTrusted) "catching" else "loose", positionMs - expected, title)

        // 2. Otherwise Prime Video follows the jam.
        if (j.playing && !playing && settled) command { c.transportControls.play() }
        if (!j.playing && playing) command { c.transportControls.pause() }

        if (!positionTrusted) return status(if (!j.playing) "paused" else "loose", null, title)

        val drift = positionMs - expected
        if (checkLeadAt in 1..wall && playing) {
            if (abs(positionMs - lastSeekTarget) > LOCAL_SEEK_MS) {
                refusedSeeks++ // it didn't move: an ad, or a title that can't seek
            } else {
                refusedSeeks = 0
                // Learn from the last seek: landed behind means aim further ahead next time.
                seekLeadMs = (seekLeadMs - drift / 2).coerceIn(0L, 5000L)
            }
            checkLeadAt = 0
        }
        if (abs(drift) > MAX_AUTO_SEEK_MS) {
            // Too far apart to jump someone's own Prime Video without asking: show the gap instead.
            if (wall - lastGapBubbleAt > 30_000) {
                lastGapBubbleAt = wall
                bubble("Jam is at ${clock(expected)}, you're at ${clock(positionMs)}. Skip there to line up.")
            }
            return status("loose", drift, title)
        }
        val cooldown = (SEEK_COOLDOWN_MS shl refusedSeeks.coerceAtMost(4)).coerceAtMost(60_000L)
        if (abs(drift) > MAX_DRIFT_MS && wall - lastSeekAt > cooldown && settled) {
            val target = (expected + if (j.playing) seekLeadMs else 0L).coerceAtLeast(0L)
            command { c.transportControls.seekTo(target) }
            lastSeekAt = wall
            lastSeekTarget = target + 3000
            checkLeadAt = wall + 3000
            return status("catching", drift, title)
        }
        status(if (!j.playing) "paused" else if (abs(drift) > MAX_DRIFT_MS) "catching" else "synced", drift, title)
    }

    /** Prime Video plays trailers on detail pages; don't drag those around. */
    private fun looksLikeTrailer(c: MediaController, j: Jam): Boolean {
        val duration = c.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
        return duration in 1 until minOf((j.runtime * 1000 * 0.4).toLong(), 10 * 60_000L)
    }

    private inline fun command(block: () -> Unit) {
        try {
            block()
        } catch (e: RuntimeException) {
            // Prime Video may refuse a transport control mid-transition; try again next tick.
        }
        lastCommandAt = System.currentTimeMillis()
    }

    /** Someone used this TV's remote on Prime Video: the whole jam follows. */
    private fun local(kind: String, positionMs: Long) {
        holdUntil = System.currentTimeMillis() + HOLD_MS
        sendControl(kind, positionMs)
        emit(JSONObject().put("type", "local").put("kind", kind).put("position", positionMs / 1000.0))
    }

    private fun status(state: String, driftMs: Long? = null, title: String? = null, force: Boolean = false) {
        val key = "$state:${driftMs?.let { it / 500 }}:$title"
        val wall = System.currentTimeMillis()
        if (!force && key == lastStatus && wall - lastStatusAt < 3000) return
        lastStatus = key
        lastStatusAt = wall
        val o = JSONObject().put("type", "status").put("state", state)
        if (driftMs != null) o.put("drift", driftMs / 1000.0)
        if (title != null) o.put("title", title)
        emit(o)
    }

    private companion object {
        const val TICK_MS = 1000L
        /** Prime Video can't nudge playback speed, so small drift is left alone. */
        const val MAX_DRIFT_MS = 2000L
        const val SEEK_COOLDOWN_MS = 6000L
        const val COMMAND_GRACE_MS = 2500L
        const val LOCAL_SEEK_MS = 5000L
        const val HOLD_MS = 3000L
        const val MAX_AUTO_SEEK_MS = 5 * 60_000L

        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

        fun clock(ms: Long): String {
            val s = (ms / 1000).coerceAtLeast(0)
            val h = s / 3600
            val m = (s % 3600) / 60
            val sec = s % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
        }

        fun get(url: String): String {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            try {
                if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
                return conn.inputStream.bufferedReader().use { it.readText() }
            } finally {
                conn.disconnect()
            }
        }

        fun post(url: String, json: String) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            try {
                conn.outputStream.use { it.write(json.toByteArray()) }
                conn.responseCode
            } finally {
                conn.disconnect()
            }
        }
    }
}

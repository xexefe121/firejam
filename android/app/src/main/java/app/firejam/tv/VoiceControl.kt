package app.firejam.tv

import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.SystemClock
import org.json.JSONObject

/**
 * "Alexa, pause", "Alexa, rewind 30 seconds", "Alexa, restart" for a FireJam film jam.
 *
 * Fire TV sends Alexa's transport commands (from the remote's mic or a paired Echo) to the app's
 * media session, so FireJam keeps one that mirrors the jam it's showing and hands each command to
 * the web app, which applies it to the whole jam. Prime Video jams don't need this: Alexa talks to
 * Prime Video directly and [PrimeSync] carries the result to everyone.
 */
class VoiceControl(private val activity: MainActivity, private val send: (String) -> Unit) {

    private val session = MediaSession(activity, "FireJam").apply {
        // Always on from Android 8; Fire OS 5 and 6 (Android 5.1 / 7.1) still need asking.
        @Suppress("DEPRECATION")
        setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
        setCallback(object : MediaSession.Callback() {
            override fun onPlay() = command("play")
            override fun onPause() = command("pause")
            // Alexa has no stop: "stop" arrives as pause. Other controllers may still send it.
            override fun onStop() = command("pause")
            // Rewind / fast-forward / restart arrive as an absolute position worked out from our state.
            override fun onSeekTo(pos: Long) = command("seek", pos / 1000.0)
            override fun onRewind() = command("seek", (positionMs() - SKIP_MS).coerceAtLeast(0) / 1000.0)
            override fun onFastForward() = command("seek", (positionMs() + SKIP_MS) / 1000.0)
        })
    }
    private var state: PlaybackState? = null

    private fun command(kind: String, position: Double? = null) {
        // Fire OS pauses the app in front when you press Home or switch profiles. That's this TV
        // stepping away, not someone pausing the jam, so only Alexa (and only on screen) drives it.
        if (Build.VERSION.SDK_INT >= 28 && session.currentControllerInfo.packageName == "android") return
        if (!activity.inForeground) return
        val json = JSONObject().put("kind", kind)
        if (position != null) json.put("position", position)
        send(json.toString())
    }

    private fun positionMs(): Long {
        val s = state ?: return 0
        if (s.state != PlaybackState.STATE_PLAYING) return s.position
        return s.position + ((SystemClock.elapsedRealtime() - s.lastPositionUpdateTime) * s.playbackSpeed).toLong()
    }

    /** `{title, playing, position (s), duration (s)}` for the jam on screen, or empty when there is none. */
    fun update(json: String) {
        if (json.isEmpty()) {
            session.isActive = false
            state = null
            return
        }
        val o = JSONObject(json)
        val playing = o.optBoolean("playing")
        val next = PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_REWIND or PlaybackState.ACTION_FAST_FORWARD or
                    PlaybackState.ACTION_STOP,
            )
            .setState(
                if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                (o.optDouble("position", 0.0) * 1000).toLong(),
                if (playing) 1f else 0f,
                SystemClock.elapsedRealtime(),
            )
            .build()
        state = next
        session.setPlaybackState(next)
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, o.optString("title"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (o.optDouble("duration", 0.0) * 1000).toLong())
                .build(),
        )
        session.isActive = true
    }

    fun release() = session.release()

    private companion object {
        const val SKIP_MS = 10_000L
    }
}

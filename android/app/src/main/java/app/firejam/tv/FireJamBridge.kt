package app.firejam.tv

import android.content.ComponentName
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * `window.FireJamNative` inside the web app (see web/src/lib/native.ts).
 * JavaScript calls arrive on a background thread; everything touching
 * Android state is posted to the main thread.
 */
class FireJamBridge(private val activity: MainActivity, private val web: WebView) {
    private val overlay = JamOverlay(activity)
    private var syncing = false
    private val voice = VoiceControl(activity) { command ->
        web.post { web.evaluateJavascript("window.firejamVoice && window.firejamVoice($command)", null) }
    }
    private val sync = PrimeSync(
        activity,
        emit = { event -> web.post { web.evaluateJavascript("window.firejamPrime && window.firejamPrime($event)", null) } },
        // Bubbles only while something else (Prime Video) is in front; FireJam's own screen shows these itself.
        bubble = { text -> if (!activity.inForeground) overlay.show(text) },
    )

    @JavascriptInterface
    fun info(): String = JSONObject()
        .put("primeInstalled", PrimeVideo.installed(activity).isNotEmpty())
        .put("sessionAccess", sync.hasAccess())
        .put("overlayAccess", overlay.canDraw())
        .put("listener", ComponentName(activity, PrimeSessionListener::class.java).flattenToString())
        .put("settingsAvailable", accessSettings() != null)
        .put("overlaySettingsAvailable", overlaySettings() != null)
        .toString()

    /**
     * Android TVs (Sony, TCL, Mi, …) have a "Notification access" screen where the viewer can let
     * FireJam follow Prime Video with one click. Fire TV hides it (adb only), so there this is null.
     */
    private fun accessSettings(): android.content.Intent? {
        if (Build.MANUFACTURER.equals("Amazon", ignoreCase = true)) return null
        val intent = android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (intent.resolveActivity(activity.packageManager) != null) intent else null
    }

    @JavascriptInterface
    fun openAccessSettings(): Boolean {
        val intent = accessSettings() ?: return false
        activity.runOnUiThread { activity.startActivity(intent) }
        return true
    }

    /**
     * Android TVs also list FireJam under "Display over other apps", which friend pop-ups need when
     * FireJam isn't in front (TVs don't pop notifications up). Fire TV only has a placeholder there.
     */
    private fun overlaySettings(): android.content.Intent? {
        if (Build.MANUFACTURER.equals("Amazon", ignoreCase = true) || Build.VERSION.SDK_INT < 23) return null
        val intent = android.content.Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:${activity.packageName}"))
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (intent.resolveActivity(activity.packageManager) != null) intent else null
    }

    @JavascriptInterface
    fun openOverlaySettings(): Boolean {
        val intent = overlaySettings() ?: return false
        activity.runOnUiThread { activity.startActivity(intent) }
        return true
    }

    /**
     * What FireJam can learn about this TV without asking, so first launch needs no setup:
     * the owner's first name from the TV's name ("Dhanusha's Fire TV"), the time zone (for the
     * city), whether Prime Video is installed, and a stable id to keep profiles with this TV.
     * Fire TV's own profile list is only readable by Amazon's apps.
     */
    @JavascriptInterface
    fun device(): String {
        val cr = activity.contentResolver
        val name = (if (Build.VERSION.SDK_INT >= 25) Settings.Global.getString(cr, Settings.Global.DEVICE_NAME) else null)
            ?: Settings.Secure.getString(cr, "bluetooth_name")
            ?: ""
        val owner = Regex("^(.+?)['’]s\\b").find(name)?.groupValues?.get(1)?.trim()
        return JSONObject()
            .put("deviceId", Settings.Secure.getString(cr, Settings.Secure.ANDROID_ID) ?: "")
            .put("deviceName", name)
            .put("ownerName", owner ?: JSONObject.NULL)
            .put("timezone", java.util.TimeZone.getDefault().id)
            .put("primeInstalled", PrimeVideo.installed(activity).isNotEmpty())
            // Which Fire TV profile is active (hashed), so FireJam can follow profile switches.
            .put("tvProfile", Identity.tvProfile(activity) ?: JSONObject.NULL)
            .toString()
    }

    /** Who's signed in on this TV, so [ActivityReporter] can share what it plays outside FireJam. */
    @JavascriptInterface
    fun setIdentity(server: String, userId: String, token: String, share: Boolean) {
        Identity.save(activity, server, userId, token, share)
        ActivityReporter.identityChanged()
    }

    @JavascriptInterface
    fun openPrime(link: String, title: String): Boolean {
        val opened = PrimeVideo.open(activity, link)
        activity.runOnUiThread {
            if (!opened) {
                sync.reportNow("no-app")
            } else {
                JamService.start(activity)
                sync.start()
                sync.reportNow("opening")
                // Without a direct link, Prime Video opens on its home screen.
                val hint = if (link.isBlank()) "Find “$title” in Prime Video and press play" else "Press play"
                overlay.show("🔥 FireJam: $hint. Play and pause stay linked with the jam.", 12_000L)
            }
        }
        return opened
    }

    @JavascriptInterface
    fun syncJam(json: String) {
        activity.runOnUiThread {
            if (!syncing) {
                syncing = true
                JamService.start(activity)
            }
            sync.update(json)
        }
    }

    @JavascriptInterface
    fun stopSync() {
        activity.runOnUiThread {
            syncing = false
            sync.stop()
            overlay.clear()
            JamService.stop(activity)
        }
    }

    /** The FireJam film jam on screen (`{title, playing, position, duration}`), or "" when none: Alexa controls it. */
    @JavascriptInterface
    fun mediaState(json: String) {
        activity.runOnUiThread { voice.update(json) }
    }

    /** Kept for the web app's API; jam bubbles over Prime Video now come from [PrimeSync]'s own server link. */
    @JavascriptInterface
    fun overlay(text: String) {
        if (!activity.inForeground) overlay.show(text)
    }

    /** Drop the current jam's links before the page reloads as someone else (a Fire TV profile switch). */
    fun reset() {
        voice.update("")
        stopSync()
    }

    fun release() {
        voice.release()
        sync.stop()
        overlay.clear()
        JamService.stop(activity)
    }
}

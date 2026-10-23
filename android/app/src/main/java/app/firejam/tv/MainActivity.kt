package app.firejam.tv

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.text.InputType
import android.text.TextUtils
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import org.json.JSONObject

/**
 * FireJam for Fire TV.
 *
 * A full-screen WebView around the FireJam TV app served by the FireJam
 * server. The web app does its own D-pad navigation; this shell forwards the
 * remote buttons a WebView doesn't deliver to JavaScript (Back and the media
 * keys), lets you point the TV at a different server (hold Menu), and exposes
 * [FireJamBridge] so Prime Video jams can open and follow Prime Video.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var bridge: FireJamBridge
    /** False while another app (Prime Video) is in front of FireJam. */
    @Volatile var inForeground = false
        private set
    private val prefs by lazy { getSharedPreferences("firejam", MODE_PRIVATE) }
    private val serverUrl: String
        get() = prefs.getString(KEY_URL, null) ?: BuildConfig.FIREJAM_URL

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Developer override, e.g. over USB with `adb reverse tcp:3000 tcp:3000`:
        //   adb shell am start -n app.firejam.tv/.MainActivity --es server http://localhost:3000
        intent.getStringExtra("server")?.let { prefs.edit().putString(KEY_URL, it).apply() }
        // Started for a friend alert, the listener service may never have run yet: start alerts here too.
        FriendAlerts.start(this)
        // Lets you debug the TV build from desktop Chrome at chrome://inspect over adb.
        WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this).apply {
            setBackgroundColor(BACKGROUND)
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) showOffline(error.description?.toString() ?: "unknown error")
                }
            }
        }
        bridge = FireJamBridge(this, web)
        web.addJavascriptInterface(bridge, "FireJamNative")
        setContentView(web)
        web.requestFocus()
        web.loadUrl(startUrl(intent))
        // Switching Fire TV profiles switches FireJam too: the page signs in again as that profile's person.
        profileWatch = Identity.watchTvProfile(this) {
            bridge.reset()
            web.loadUrl(serverUrl)
        }
    }

    private var profileWatch: android.database.ContentObserver? = null

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("server")?.let { prefs.edit().putString(KEY_URL, it).apply() }
        if (intent.hasExtra("server") || intent.hasExtra("join")) web.loadUrl(startUrl(intent))
    }

    /** The app's address, plus `?join=<jam>` when opened from a friend alert. */
    private fun startUrl(intent: android.content.Intent): String {
        val join = intent.getStringExtra("join") ?: return serverUrl
        return serverUrl.trimEnd('/') + "/?join=" + java.net.URLEncoder.encode(join, "UTF-8")
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val down = event.action == KeyEvent.ACTION_DOWN
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                // The web app closes dialogs / leaves screens itself; only exit when it says it didn't.
                if (down && event.repeatCount == 0) {
                    web.evaluateJavascript("window.firejamBack ? window.firejamBack() : false") { handled ->
                        if (handled != "true") finish()
                    }
                }
                return true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE ->
                return forward(event, "playpause")
            KeyEvent.KEYCODE_MEDIA_REWIND -> return forward(event, "rewind")
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> return forward(event, "ffwd")
            KeyEvent.KEYCODE_MENU -> {
                // Tap: the web app's menu action. Hold: change which server this TV talks to.
                if (down) {
                    if (event.repeatCount == LONG_PRESS_REPEATS) {
                        menuHeld = true
                        askForServer()
                    }
                } else {
                    if (!menuHeld) js("menu")
                    menuHeld = false
                }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private var menuHeld = false

    private fun forward(event: KeyEvent, key: String): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) js(key)
        return true
    }

    private fun js(key: String) {
        web.evaluateJavascript("window.firejamKey && window.firejamKey('$key')", null)
    }

    private fun showOffline(reason: String) {
        val url = TextUtils.htmlEncode(serverUrl)
        val target = JSONObject.quote(serverUrl)
        val why = TextUtils.htmlEncode(reason)
        val html = """
            <html><body style="margin:0;height:100vh;display:grid;place-content:center;gap:16px;
              background:#0c0a14;color:#f7f4ff;font-family:sans-serif;text-align:center">
              <div style="font-size:64px">🔥</div>
              <h1 style="margin:0">Can't reach FireJam</h1>
              <p style="color:#a69ec0;margin:0">Tried <b>$url</b> ($why)</p>
              <p style="color:#a69ec0;margin:0">Press <b>Select</b> to retry · hold <b>Menu</b> to change server</p>
              <script>addEventListener('keydown', e => { if (e.key === 'Enter') location.href = $target; });</script>
            </body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    private fun askForServer() {
        val input = EditText(this).apply {
            setText(serverUrl)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("FireJam server")
            .setMessage("Address of the computer running the FireJam server")
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val url = input.text.toString().trim().let { if (it.startsWith("http")) it else "http://$it" }
                prefs.edit().putString(KEY_URL, url).apply()
                web.loadUrl(url)
            }
            .setNeutralButton("Reset") { _, _ ->
                prefs.edit().remove(KEY_URL).apply()
                web.loadUrl(serverUrl)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // The WebView keeps running while Prime Video is in front: the jam's
    // connection lives in it, and JamService keeps the process alive.
    override fun onStart() {
        super.onStart()
        inForeground = true
        AppState.foreground = true
    }

    override fun onStop() {
        inForeground = false
        AppState.foreground = false
        super.onStop()
    }

    override fun onDestroy() {
        profileWatch?.let { contentResolver.unregisterContentObserver(it) }
        bridge.release()
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val KEY_URL = "serverUrl"
        const val BACKGROUND = 0xFF0C0A14.toInt()
        /** Key repeats arrive every ~50 ms; ~20 of them is a deliberate one-second hold. */
        const val LONG_PRESS_REPEATS = 20
    }
}

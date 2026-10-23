package app.firejam.tv

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Reaction and chat bubbles drawn on top of Prime Video, so the jam stays
 * social while another app owns the screen. Needs "display over other apps"
 * ([canDraw]); on Fire TV grant it once with
 *   adb shell appops set app.firejam.tv SYSTEM_ALERT_WINDOW allow
 */
class JamOverlay(private val ctx: Context) {
    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var column: LinearLayout? = null

    fun canDraw(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    fun show(text: String, durationMs: Long = SHOW_MS) = handler.post {
        if (!canDraw()) return@post
        val col = column ?: attach() ?: return@post
        val bubble = TextView(ctx).apply {
            this.text = text
            setTextColor(0xFFF7F4FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setPadding(dp(18), dp(10), dp(18), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(22).toFloat()
                setColor(0xE61E192E.toInt())
                setStroke(dp(2), 0xFFFF6A1F.toInt())
            }
            alpha = 0f
        }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(8)
        lp.gravity = Gravity.END
        col.addView(bubble, lp)
        while (col.childCount > MAX_BUBBLES) col.removeViewAt(0)
        bubble.animate().alpha(1f).setDuration(200).start()
        handler.postDelayed({
            bubble.animate().alpha(0f).setDuration(400).withEndAction { col.removeView(bubble) }.start()
        }, durationMs)
    }

    fun clear() = handler.post {
        column?.let { runCatching { wm.removeView(it) } }
        column = null
    }

    private fun attach(): LinearLayout? {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        @Suppress("DEPRECATION")
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(40)
            y = dp(32)
        }
        return try {
            wm.addView(col, lp)
            column = col
            col
        } catch (e: RuntimeException) {
            null
        }
    }

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

    private companion object {
        const val SHOW_MS = 4000L
        const val MAX_BUBBLES = 4
    }
}

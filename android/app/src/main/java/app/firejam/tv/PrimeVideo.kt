package app.firejam.tv

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/**
 * Finding and opening the Prime Video app on this TV.
 *
 * FireJam never plays Prime Video itself: each TV opens the title in its own
 * Prime Video app, on its owner's account, and [PrimeSync] keeps it in step.
 */
object PrimeVideo {
    /** Package names Prime Video has shipped under on Fire TV and Android TV. */
    val PACKAGES = listOf(
        "com.amazon.amazonvideo.livingroom",
        "com.amazon.firebat",
        "com.amazon.avod.thirdpartyclient",
        "com.amazon.avod",
    )

    /** Activity reported to start Prime Video on Fire TV when no launcher intent is exposed. */
    private val IGNITION = ComponentName("com.amazon.amazonvideo.livingroom", "com.amazon.ignition.IgnitionActivity")

    fun installed(ctx: Context): List<String> = PACKAGES.filter {
        try {
            ctx.packageManager.getPackageInfo(it, 0)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    /**
     * Opens [link] (an `https://app.primevideo.com/detail?gti=…` link) in Prime Video, or
     * Prime Video's home screen when there's no link or the app doesn't take it.
     */
    fun open(ctx: Context, link: String): Boolean {
        val packages = installed(ctx)
        if (link.isNotBlank()) {
            for (pkg in packages) {
                if (start(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(pkg))) return true
            }
        }
        if (IGNITION.packageName in packages && start(ctx, Intent(Intent.ACTION_MAIN).setComponent(IGNITION))) return true
        for (pkg in packages) {
            val launch = ctx.packageManager.getLeanbackLaunchIntentForPackage(pkg)
                ?: ctx.packageManager.getLaunchIntentForPackage(pkg)
            if (launch != null && start(ctx, launch)) return true
        }
        return false
    }

    private fun start(ctx: Context, intent: Intent): Boolean = try {
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        false
    }
}

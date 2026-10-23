package app.firejam.tv

import android.service.notification.NotificationListenerService

/**
 * Exists so FireJam can be granted notification-listener access, which is what
 * Android requires before one app may read and control another app's media
 * session. FireJam uses it to keep Prime Video in step during a jam
 * ([PrimeSync]) and to tell friends what this TV is watching ([ActivityReporter]).
 * Because Android keeps it running, it also hosts [FriendAlerts].
 * FireJam never reads notifications.
 *
 * Fire TV has no settings screen for this; grant it once over adb:
 *   adb shell cmd notification allow_listener app.firejam.tv/app.firejam.tv.PrimeSessionListener
 */
class PrimeSessionListener : NotificationListenerService() {
    private var profileWatch: android.database.ContentObserver? = null

    override fun onListenerConnected() {
        ActivityReporter.start(this)
        FriendAlerts.start(this)
        // A Fire TV profile switch changes who's watching: report for the new person straight away.
        profileWatch = Identity.watchTvProfile(this) { ActivityReporter.identityChanged() }
    }

    override fun onListenerDisconnected() {
        profileWatch?.let { contentResolver.unregisterContentObserver(it) }
        profileWatch = null
        ActivityReporter.stop()
        FriendAlerts.stop()
    }
}

package app.firejam.tv

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import java.security.MessageDigest

/**
 * Who FireJam is signed in as on this TV, kept per Fire TV profile.
 *
 * Fire TV profiles aren't Android users and their list is only readable by Amazon's apps, but the
 * active profile's id is in secure settings (`cev_pid`) and changes the moment someone switches
 * profiles. FireJam remembers which FireJam profile goes with each Fire TV profile, so switching
 * on the Fire TV switches FireJam at once: the app ([MainActivity]) and everything that runs while
 * it's closed ([ActivityReporter], [FriendAlerts], [PrimeSync]).
 */
class Identity(val server: String, val userId: String, val token: String, val share: Boolean) {
    companion object {
        private const val PREFS = "firejam"
        private const val TV_PROFILE_KEY = "cev_pid"

        /**
         * The active Fire TV profile, hashed with this TV's id so the server never sees Amazon's
         * ids, or null where there's no such thing (Android TVs, older Fire OS).
         */
        fun tvProfile(c: Context): String? {
            val cr = c.contentResolver
            val pid = try { Settings.Secure.getString(cr, TV_PROFILE_KEY) } catch (e: SecurityException) { null }
            if (pid.isNullOrEmpty()) return null
            val salt = Settings.Secure.getString(cr, Settings.Secure.ANDROID_ID) ?: ""
            val digest = MessageDigest.getInstance("SHA-256").digest("$salt:$pid".toByteArray())
            return digest.take(8).joinToString("") { "%02x".format(it) }
        }

        /** Calls [onChange] on the main thread whenever someone switches Fire TV profiles. */
        fun watchTvProfile(c: Context, onChange: () -> Unit): ContentObserver {
            val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
                private var last = tvProfile(c)
                override fun onChange(selfChange: Boolean) {
                    val now = tvProfile(c)
                    if (now != last) {
                        last = now
                        onChange()
                    }
                }
            }
            c.contentResolver.registerContentObserver(Settings.Secure.getUriFor(TV_PROFILE_KEY), false, observer)
            return observer
        }

        private fun suffix(c: Context) = tvProfile(c)?.let { "@$it" } ?: ""

        /** The FireJam profile for whoever is using the TV right now, if they've opened FireJam before. */
        fun load(c: Context): Identity? {
            val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val s = suffix(c)
            return Identity(
                p.getString("identityServer$s", null) ?: return null,
                p.getString("identityUser$s", null) ?: return null,
                p.getString("identityToken$s", null) ?: return null,
                p.getBoolean("identityShare$s", true),
            )
        }

        fun save(c: Context, server: String, userId: String, token: String, share: Boolean) {
            val s = suffix(c)
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("identityServer$s", server)
                .putString("identityUser$s", userId)
                .putString("identityToken$s", token)
                .putBoolean("identityShare$s", share)
                .apply()
        }
    }
}

package com.solvit.smssender

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log

class CallReceiver : BroadcastReceiver() {

    companion object {
        private var lastState: String? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        Log.d("Solvit", "CallReceiver: State changed to $state. Previous state: $lastState")

        if (state == TelephonyManager.EXTRA_STATE_IDLE) {
            // Act if it's the first time we see IDLE or if it changed from something else
            if (lastState != TelephonyManager.EXTRA_STATE_IDLE) {
                Log.d("Solvit", "Phone is now IDLE, triggering check...")

                val serviceIntent = Intent(context, SolvitService::class.java).apply {
                    action = "CHECK_LAST_CALL"
                }

                try {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent)
                    } else {
                        context.startService(serviceIntent)
                    }
                } catch (e: Exception) {
                    Log.e("Solvit", "Failed to start service from Receiver: ${e.message}")
                }
            }
        }

        lastState = state
    }
}
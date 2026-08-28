package com.solvit.smssender;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        // This logs to your Logcat so you can see if it's working
        Log.d(TAG, "Boot event received: " + action);

        // Check for standard boot AND "Direct Boot" (before PIN entry)
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
                "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)) {

            // 1. Create the intent to open your app
            Intent i = new Intent(context, MainActivity.class);

            // 2. This flag is mandatory when starting an app from the background
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // 3. Attempt to launch the app
            try {
                context.startActivity(i);
                Log.d(TAG, "Solvit App launched successfully.");
            } catch (Exception e) {
                Log.e(TAG, "Failed to launch app: " + e.getMessage());
            }
        }
    }
}
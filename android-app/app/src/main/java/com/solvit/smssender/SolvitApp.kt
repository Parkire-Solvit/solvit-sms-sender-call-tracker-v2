package com.solvit.smssender

import android.app.Application
import android.util.Log
import com.google.android.gms.security.ProviderInstaller

class SolvitApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.d("Solvit", "SolvitApp onCreate")
        updateSecurityProvider()
    }

    private fun updateSecurityProvider() {
        // This is crucial for Android 6 to support modern HTTPS/TLS
        ProviderInstaller.installIfNeededAsync(this, object : ProviderInstaller.ProviderInstallListener {
            override fun onProviderInstalled() {
                Log.d("Solvit", "Security provider installed successfully in App")
            }

            override fun onProviderInstallFailed(errorCode: Int, recoveryIntent: android.content.Intent?) {
                Log.e("Solvit", "Security provider installation failed in App: $errorCode")
            }
        })
    }
}
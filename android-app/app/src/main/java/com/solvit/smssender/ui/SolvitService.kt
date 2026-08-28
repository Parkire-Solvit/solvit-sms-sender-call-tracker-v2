package com.solvit.smssender

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.*
import android.provider.CallLog
import android.telephony.SmsManager
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.solvit.smssender.ui.theme.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class SolvitService : Service() {
    private lateinit var windowManager: WindowManager
    private var overlayView: View? = null
    private var countDownTimer: CountDownTimer? = null
    private val handler = Handler(Looper.getMainLooper())
    private val configRefresh = object : Runnable {
        override fun run() {
            CoroutineScope(Dispatchers.IO).launch { refreshAppConfig() }
            handler.postDelayed(this, 15 * 60 * 1000L)
        }
    }

    private companion object {
        private var lastReportedNumber: String = ""
        private var lastReportedStatus: String = ""
        private var lastReportTime: Long = 0
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d("Solvit", "Service onCreate")
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()

        val notification = NotificationCompat.Builder(this, "solvit_channel")
            .setContentTitle("Solvit SMS Service")
            .setContentText("Monitoring calls...")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setOngoing(true)
            .build()

        startForeground(1, notification)

        // Refresh the dashboard-controlled name and SMS settings whenever the
        // long-running service starts. Cached values remain available offline.
        handler.post(configRefresh)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        Log.d("Solvit", "Service onStartCommand: $action")
        when (action) {
            "SHOW_OVERLAY" -> {
                val number = intent.getStringExtra("PHONE_NUMBER") ?: ""
                showOverlay(number)
            }
            "CHECK_LAST_CALL" -> {
                handler.postDelayed({ checkCallLogAndReport() }, 3000)
            }
        }
        return START_STICKY
    }

    private fun checkCallLogAndReport() {
        Log.d("Solvit", "Checking call log...")
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            Log.e("Solvit", "Permission denied: READ_CALL_LOG")
            return
        }

        try {
            val cursor = contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                null, null, null,
                CallLog.Calls.DATE + " DESC"
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    val type = it.getInt(it.getColumnIndexOrThrow(CallLog.Calls.TYPE))
                    val duration = it.getLong(it.getColumnIndexOrThrow(CallLog.Calls.DURATION))
                    val number = it.getString(it.getColumnIndexOrThrow(CallLog.Calls.NUMBER))

                    Log.d("Solvit", "Last Call: $number, Type: $type, Duration: $duration")

                    // SAFE STATUS DETERMINATION (Avoids REJECTED_TYPE crash on Android 6)
                    val status = when (type) {
                        CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        CallLog.Calls.INCOMING_TYPE -> "INCOMING"
                        CallLog.Calls.MISSED_TYPE -> "MISSED"
                        else -> {
                            // REJECTED_TYPE is 5, available from API 24
                            if (type == 5) "MISSED" else "CALL"
                        }
                    }

                    pushToDashboard("CALL", number, status)

                    if (duration > 0) {
                        pushToDashboard("CALL", number, "CONNECTED")
                    }

                    // Show overlay for missed outgoing calls
                    if (type == CallLog.Calls.OUTGOING_TYPE && duration == 0L) {
                        Log.d("Solvit", "Missed outgoing call detected, showing overlay")
                        showOverlay(number)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("Solvit", "Error reading call log: ${e.message}")
        }
    }

    private fun showOverlay(phoneNumber: String) {
        handler.post {
            if (overlayView != null) {
                Log.d("Solvit", "Overlay already visible, removing old one")
                removeOverlay()
            }

            Log.d("Solvit", "Showing overlay for $phoneNumber")

            val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP
                y = 150
                // For Android 6, we might need to set a specific width if MATCH_PARENT behaves weirdly
                width = (resources.displayMetrics.widthPixels * 0.95).toInt()
            }

            val container = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(40, 40, 40, 40)
                background = GradientDrawable().apply {
                    cornerRadius = 30f
                    setColor(Color.WHITE)
                    setStroke(4, 0xFF10B981.toInt())
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    elevation = 20f
                }
            }

            val timerText = TextView(this).apply {
                text = "60s"
                textSize = 12f
                setTextColor(Color.GRAY)
                gravity = Gravity.END
                setTypeface(null, Typeface.BOLD)
            }
            container.addView(timerText)

            val title = TextView(this).apply {
                text = "Send \"Not Picking SMS\" to client on $phoneNumber"
                textSize = 18f
                setTextColor(Color.BLACK)
                setPadding(0, 10, 0, 30)
                gravity = Gravity.CENTER
                setTypeface(null, Typeface.BOLD)
            }

            val regInput = EditText(this).apply {
                hint = "Enter Vehicle Reg No"
                setSingleLine(true)
                setTextColor(Color.BLACK)
                setHintTextColor(Color.GRAY)
                // Ensure keyboard pops up
                isFocusableInTouchMode = true
                requestFocus()
            }

            val sendBtn = Button(this).apply {
                text = "SEND SMS"
                setBackgroundColor(0xFF10B981.toInt())
                setTextColor(Color.WHITE)
                setOnClickListener {
                    val regNo = regInput.text.toString().trim()
                    if (regNo.isNotEmpty()) {
                        sendSms(phoneNumber, regNo)
                        removeOverlay()
                    } else {
                        regInput.error = "Required"
                    }
                }
            }

            val dismissBtn = TextView(this).apply {
                text = "Dismiss"
                setTextColor(Color.GRAY)
                gravity = Gravity.CENTER
                setPadding(0, 30, 0, 0)
                setOnClickListener { removeOverlay() }
            }

            container.addView(title)
            container.addView(regInput)
            container.addView(sendBtn)
            container.addView(dismissBtn)

            overlayView = container
            try {
                windowManager.addView(overlayView, params)
                countDownTimer = object : CountDownTimer(60000, 1000) {
                    override fun onTick(millisUntilFinished: Long) {
                        timerText.text = "${millisUntilFinished / 1000}s"
                    }
                    override fun onFinish() { removeOverlay() }
                }.start()
            } catch (e: Exception) {
                Log.e("Solvit", "Failed to add overlay view: ${e.message}")
            }
        }
    }

    private fun sendSms(number: String, regNo: String) {
        CoroutineScope(Dispatchers.IO).launch {
            val dataStore = DataStoreManager(applicationContext)
            refreshAppConfig()
            val agentName = dataStore.agentName.first() ?: "Agent"
            val followupEnabled = dataStore.smsFollowupEnabled.first()
            val template = dataStore.smsTemplate.first()?.trim().orEmpty()

            if (!followupEnabled) {
                handler.post {
                    Toast.makeText(applicationContext, "SMS follow-up is disabled in Master Settings", Toast.LENGTH_LONG).show()
                }
                return@launch
            }

            if (template.isEmpty()) {
                handler.post {
                    Toast.makeText(applicationContext, "No SMS template is configured in Master Settings", Toast.LENGTH_LONG).show()
                }
                return@launch
            }

            val message = template
                .replace("{agent_name}", agentName)
                .replace("{reg_no}", regNo)
                .replace("{phone_number}", number)

            try {
                val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    applicationContext.getSystemService(SmsManager::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    SmsManager.getDefault()
                }

                val parts = smsManager.divideMessage(message)
                smsManager.sendMultipartTextMessage(number, null, parts, null, null)

                pushToDashboard("SMS", number, "SENT", regNo)

                handler.post { Toast.makeText(applicationContext, "SMS Sent to $number", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) {
                Log.e("Solvit", "SMS Error: ${e.message}")
                handler.post { Toast.makeText(applicationContext, "Error: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }
    }

    private fun pushToDashboard(type: String, phoneNumber: String, status: String, regNo: String = "") {
        val currentTime = System.currentTimeMillis()

        if (phoneNumber == lastReportedNumber && status == lastReportedStatus && (currentTime - lastReportTime) < 5000) {
            return
        }

        lastReportedNumber = phoneNumber
        lastReportedStatus = status
        lastReportTime = currentTime

        CoroutineScope(Dispatchers.IO).launch {
            val dataStore = DataStoreManager(applicationContext)
            refreshAppConfig()
            val agentId = dataStore.agentId.first()
            val agentName = dataStore.agentName.first() ?: "Agent"

            Log.d("Solvit", "Pushing $type ($status) to dashboard...")

            val request = EventRequest(agentId, agentName, type, phoneNumber, status, regNo)

            ApiClient.getApiService().logEvent(request).enqueue(object : retrofit2.Callback<Void> {
                override fun onResponse(call: retrofit2.Call<Void>, response: retrofit2.Response<Void>) {
                    if (response.isSuccessful) {
                        Log.d("Solvit", "✅ Successfully pushed $type ($status)")
                    } else {
                        Log.e("Solvit", "❌ Dashboard Error: ${response.code()} - ${response.message()}")
                    }
                }

                override fun onFailure(call: retrofit2.Call<Void>, t: Throwable) {
                    Log.e("Solvit", "❌ Network Failure: ${t.message}")
                }
            })
        }
    }

    /**
     * Ensures this installation has a stable backend agent ID, then downloads
     * the latest dashboard-controlled display name and SMS configuration.
     * Network failures deliberately leave the last cached configuration intact.
     */
    private suspend fun refreshAppConfig() {
        val dataStore = DataStoreManager(applicationContext)
        try {
            var agentId = dataStore.agentId.first()
            if (agentId == null) {
                val localName = dataStore.agentName.first()?.trim().orEmpty()
                if (localName.isEmpty()) return

                val registration = ApiClient.getApiService()
                    .logAgent(AgentRequest(localName, null))
                    .execute()
                if (!registration.isSuccessful || registration.body()?.agent_id == null) {
                    Log.w("Solvit", "Agent registration failed: ${registration.code()}")
                    return
                }
                agentId = registration.body()!!.agent_id
                dataStore.saveAgentId(agentId)
            }

            val configuredAgentId = agentId ?: return
            val configResponse = ApiClient.getApiService().getAppConfig(configuredAgentId).execute()
            val config = configResponse.body()
            if (configResponse.isSuccessful && config != null) {
                dataStore.saveAppConfig(
                    config.agent_name,
                    config.sms_template ?: "",
                    config.sms_followup_enabled
                )
                Log.d("Solvit", "App configuration synchronized for agent $configuredAgentId")
            } else {
                Log.w("Solvit", "Configuration refresh failed: ${configResponse.code()}")
            }
        } catch (e: Exception) {
            Log.w("Solvit", "Using cached app configuration: ${e.message}")
        }
    }

    private fun removeOverlay() {
        handler.post {
            countDownTimer?.cancel()
            overlayView?.let {
                try {
                    windowManager.removeView(it)
                    Log.d("Solvit", "Overlay removed")
                } catch (e: Exception) {
                    Log.e("Solvit", "Error removing overlay: ${e.message}")
                }
                overlayView = null
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel("solvit_channel", "Solvit Service", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d("Solvit", "Service onDestroy")
        handler.removeCallbacks(configRefresh)
        removeOverlay()
    }
}

package com.solvit.smssender

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.POST

class EventWorker(appContext: Context, workerParams: WorkerParameters) :
    CoroutineWorker(appContext, workerParams) {

    interface DashboardApi {
        @POST("api/log-event")
        suspend fun logEvent(@Body event: Map<String, String>): retrofit2.Response<Unit>
    }

    override suspend fun doWork(): Result {
        val agentName = inputData.getString("agent_name") ?: "Unknown Agent"
        val type = inputData.getString("type") ?: "CALL"
        val phone = inputData.getString("target_phone") ?: "Unknown"
        val status = inputData.getString("status") ?: "UNKNOWN"

        val eventData = mapOf(
            "agent_name" to agentName,
            "type" to type,
            "target_phone" to phone,
            "status" to status
        )

        return try {
            val retrofit = Retrofit.Builder()
                .baseUrl("https://sms-sender-7pbe.onrender.com/") // Replace with your actual URL
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            val api = retrofit.create(DashboardApi::class.java)
            val response = api.logEvent(eventData)

            if (response.isSuccessful) {
                Log.d("SolvitWorker", "✅ Event synced successfully")
                Result.success()
            } else {
                Log.e("SolvitWorker", "❌ Sync failed: ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e("SolvitWorker", "Error syncing event", e)
            Result.retry()
        }
    }
}
package com.solvit.smssender

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class DataStoreManager(private val context: Context) {
    companion object {
        val AGENT_NAME = stringPreferencesKey("agent_name")
        val AGENT_ID = longPreferencesKey("agent_id")
        val SMS_TEMPLATE = stringPreferencesKey("sms_template")
        val SMS_FOLLOWUP_ENABLED = booleanPreferencesKey("sms_followup_enabled")
    }

    val agentName: Flow<String?> = context.dataStore.data.map { preferences ->
        preferences[AGENT_NAME]
    }

    val agentId: Flow<Long?> = context.dataStore.data.map { it[AGENT_ID] }
    val smsTemplate: Flow<String?> = context.dataStore.data.map { it[SMS_TEMPLATE] }
    val smsFollowupEnabled: Flow<Boolean> = context.dataStore.data.map {
        it[SMS_FOLLOWUP_ENABLED] ?: true
    }

    suspend fun saveAgentName(name: String) {
        context.dataStore.edit { preferences ->
            preferences[AGENT_NAME] = name
        }
    }

    suspend fun saveAgentId(id: Long) {
        context.dataStore.edit { it[AGENT_ID] = id }
    }

    suspend fun saveAppConfig(agentName: String, template: String, followupEnabled: Boolean) {
        context.dataStore.edit {
            it[AGENT_NAME] = agentName
            it[SMS_TEMPLATE] = template
            it[SMS_FOLLOWUP_ENABLED] = followupEnabled
        }
    }
}

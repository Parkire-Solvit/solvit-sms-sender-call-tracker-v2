package com.solvit.smssender

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.security.ProviderInstaller
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var dataStoreManager: DataStoreManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Fix for SSL/TLS issues on older Android (Android 6)
        updateSecurityProvider()

        dataStoreManager = DataStoreManager(this)

        setContent {
            val agentName by dataStoreManager.agentName.collectAsState(initial = null)
            val scope = rememberCoroutineScope()

            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (agentName == null) {
                        OnboardingScreen { name ->
                            scope.launch {
                                dataStoreManager.saveAgentName(name)
                                Toast.makeText(this@MainActivity, "Setup complete! Service is now running.", Toast.LENGTH_LONG).show()
                                startService()
                            }
                        }
                    } else {
                        DashboardScreen(agentName!!)
                    }
                }
            }
        }

        checkPermissions()
    }

    private fun updateSecurityProvider() {
        ProviderInstaller.installIfNeededAsync(this, object : ProviderInstaller.ProviderInstallListener {
            override fun onProviderInstalled() {
                Log.d("Solvit", "Security provider installed successfully")
            }

            override fun onProviderInstallFailed(errorCode: Int, recoveryIntent: Intent?) {
                Log.e("Solvit", "Security provider installation failed: $errorCode")
            }
        })
    }

    private fun checkPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_CALL_LOG
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val requestPermissionLauncher = registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { results ->
            if (results.values.all { it }) {
                startService()
            }
        }

        requestPermissionLauncher.launch(permissions.toTypedArray())

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                startActivity(intent)
            }
        }
    }

    private fun startService() {
        val intent = Intent(this, SolvitService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    @Composable
    fun OnboardingScreen(onSave: (String) -> Unit) {
        var name by remember { mutableStateOf("") }
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Solvit Valuers", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Color(0xFF10B981))
            Spacer(modifier = Modifier.height(8.dp))
            Text("Enter your name to start", color = Color.Gray)
            Spacer(modifier = Modifier.height(32.dp))
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Agent Name") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = { if (name.isNotBlank()) onSave(name) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
            ) {
                Text("Save & Start")
            }
        }
    }

    @Composable
    fun DashboardScreen(name: String) {
        val scrollState = rememberScrollState()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(scrollState),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("Solvit SMS Sender", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(8.dp))
            Text("Active Agent: $name", color = Color(0xFF10B981), fontWeight = FontWeight.Medium)

            Spacer(modifier = Modifier.height(24.dp))

            // Success Banner
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFECFDF5), RoundedCornerShape(16.dp))
                    .padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF10B981))
                    Spacer(modifier = Modifier.width(12.dp))
                    Column {
                        Text("Service Running", fontWeight = FontWeight.Bold, color = Color(0xFF065F46))
                        Text("Monitoring calls in background.", fontSize = 14.sp, color = Color(0xFF065F46))
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Extra Settings Guide
            Text(
                "Android 6+ & Extra Settings Guide",
                modifier = Modifier.fillMaxWidth(),
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )
            Spacer(modifier = Modifier.height(12.dp))

            GuideItem(
                icon = Icons.Default.Warning,
                title = "Overlay Permission",
                description = "Ensure 'Permit drawing over other apps' is enabled. This is required for the popup after calls.",
                iconColor = Color(0xFFF59E0B)
            )

            GuideItem(
                icon = Icons.Default.BatteryChargingFull,
                title = "Battery Optimization",
                description = "Disable battery optimization for this app to ensure it keeps running in the background.",
                iconColor = Color(0xFF10B981)
            )

            GuideItem(
                icon = Icons.Default.Info,
                title = "App Permissions",
                description = "Ensure Phone, SMS, and Call Logs permissions are granted in App Settings.",
                iconColor = Color(0xFF3B82F6)
            )

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    val intent = Intent(this@MainActivity, SolvitService::class.java).apply {
                        action = "SHOW_OVERLAY"
                        putExtra("PHONE_NUMBER", "0712 345 678")
                    }
                    startService(intent)
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Test Overlay Card")
            }
        }
    }

    @Composable
    fun GuideItem(icon: ImageVector, title: String, description: String, iconColor: Color) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFC))
        ) {
            Row(modifier = Modifier.padding(16.dp)) {
                Icon(icon, contentDescription = null, tint = iconColor)
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(description, fontSize = 12.sp, color = Color.Gray)
                }
            }
        }
    }
}

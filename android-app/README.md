# Solvit Android SMS Sender

This directory contains the Android companion app for the Solvit dashboard.

Version 1.2 registers an installation with the production API and stores its stable agent ID. It retrieves the current agent name, master SMS template, and SMS follow-up switch from `/api/app-config/:id`. Configuration is cached for offline use and refreshed every 15 minutes, before sending an SMS, and before logging an event.

Supported master-template placeholders:

- `{agent_name}`
- `{reg_no}`
- `{phone_number}`

Open `android-app` as a project in Android Studio. Use the debug variant for device testing. Production signing credentials must remain outside the repository.

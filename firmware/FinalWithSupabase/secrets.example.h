// Copy this file to secrets.h (same folder) and paste the device token.
// secrets.h is gitignored so the token never goes to GitHub.
//
// This is the DEVICE TOKEN that the upload-sensor-reading Edge Function checks
// (sent as the x-device-token header). It is NOT the Supabase service_role / sb_secret_ key.
#pragma once
#define SOILSPHERE_DEVICE_TOKEN "PASTE_DEVICE_TOKEN_HERE"

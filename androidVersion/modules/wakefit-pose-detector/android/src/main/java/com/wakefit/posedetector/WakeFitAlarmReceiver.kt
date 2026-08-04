package com.wakefit.posedetector

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat

class WakeFitAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != WakeFitAlarmContract.ACTION_ALARM_FIRE) {
      return
    }

    Log.i(TAG, "alarm fired")
    wakeScreen(context)
    WakeFitAlarmRinger.start(context)

    val launchIntent = WakeFitAlarmContract.launchIntent(context, intent) ?: return
    showAlarmNotification(context, intent, launchIntent)

    try {
      context.startActivity(launchIntent)
    } catch (_: Exception) {
      // The full-screen notification remains as the supported fallback.
    }

    WakeFitAlarmScheduler.scheduleNextDay(context, intent)
  }

  @Suppress("DEPRECATION")
  private fun wakeScreen(context: Context) {
    try {
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val wakeLock = powerManager.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
          PowerManager.ACQUIRE_CAUSES_WAKEUP or
          PowerManager.ON_AFTER_RELEASE,
        "WakeFit:Alarm",
      )
      wakeLock.acquire(10_000L)
    } catch (error: RuntimeException) {
      Log.e(TAG, "failed to acquire wake lock", error)
    }
  }

  private fun showAlarmNotification(context: Context, source: Intent, launchIntent: Intent) {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channelId = "wakefit_alarm"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        channelId,
        "WakeFit Alarm",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "WakeFit full-screen exercise alarm"
        enableVibration(true)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      notificationManager.createNotificationChannel(channel)
    }

    val alarmId = source.getStringExtra(WakeFitAlarmContract.EXTRA_ALARM_ID).orEmpty()
    val label = source.getStringExtra(WakeFitAlarmContract.EXTRA_LABEL).orEmpty().ifBlank { "WakeFit Alarm" }
    val exerciseType = source.getStringExtra(WakeFitAlarmContract.EXTRA_EXERCISE_TYPE) ?: "squat"
    val exerciseName = if (exerciseType == "squat") "squat" else "push-up"
    val targetCount = source.getIntExtra(WakeFitAlarmContract.EXTRA_TARGET_COUNT, 5)
    val requestCode = WakeFitAlarmContract.requestCode(alarmId)
    val fullScreenIntent = PendingIntent.getActivity(
      context,
      requestCode + 200_000,
      launchIntent,
      pendingIntentFlags(PendingIntent.FLAG_UPDATE_CURRENT),
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, channelId)
    } else {
      Notification.Builder(context)
    }

    val notification = builder
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(label)
      .setContentText("Complete $targetCount ${exerciseName} reps to dismiss the alarm")
      .setCategory(Notification.CATEGORY_ALARM)
      .setPriority(Notification.PRIORITY_MAX)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setDefaults(Notification.DEFAULT_ALL)
      .setFullScreenIntent(fullScreenIntent, true)
      .setContentIntent(fullScreenIntent)
      .setAutoCancel(true)
      .build()

    notificationManager.notify(requestCode, notification)
  }

  private fun pendingIntentFlags(baseFlags: Int): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      baseFlags or PendingIntent.FLAG_IMMUTABLE
    } else {
      baseFlags
    }
  }

  companion object {
    private const val TAG = "WakeFitAlarm"
  }
}

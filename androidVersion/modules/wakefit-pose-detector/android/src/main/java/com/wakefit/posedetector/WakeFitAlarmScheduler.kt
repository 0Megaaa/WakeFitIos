package com.wakefit.posedetector

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

object WakeFitAlarmScheduler {
  private const val DAY_MILLIS = 24L * 60L * 60L * 1000L

  fun schedule(
    context: Context,
    alarmId: String,
    fireAtMillis: Long,
    label: String,
    timeOfDay: String,
    targetCount: Int,
    exerciseType: String,
  ) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val requestCode = WakeFitAlarmContract.requestCode(alarmId)
    val receiverIntent = WakeFitAlarmContract.receiverIntent(
      context,
      alarmId,
      fireAtMillis,
      label,
      timeOfDay,
      targetCount,
      exerciseType,
    )
    val alarmIntent = PendingIntent.getBroadcast(
      context,
      requestCode,
      receiverIntent,
      pendingIntentFlags(PendingIntent.FLAG_UPDATE_CURRENT),
    )
    val showIntent = WakeFitAlarmContract.launchIntent(context, receiverIntent)?.let {
      PendingIntent.getActivity(
        context,
        requestCode + 100_000,
        it,
        pendingIntentFlags(PendingIntent.FLAG_UPDATE_CURRENT),
      )
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && showIntent != null) {
      alarmManager.setAlarmClock(
        AlarmManager.AlarmClockInfo(fireAtMillis, showIntent),
        alarmIntent,
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAtMillis, alarmIntent)
    } else {
      alarmManager.setExact(AlarmManager.RTC_WAKEUP, fireAtMillis, alarmIntent)
    }
  }

  fun scheduleNextDay(context: Context, sourceAlarmIntent: android.content.Intent) {
    val alarmId = sourceAlarmIntent.getStringExtra(WakeFitAlarmContract.EXTRA_ALARM_ID) ?: return
    val previousFireAt = sourceAlarmIntent.getLongExtra(WakeFitAlarmContract.EXTRA_FIRE_AT_MILLIS, 0L)
    if (previousFireAt <= 0L) {
      return
    }

    schedule(
      context,
      alarmId,
      previousFireAt + DAY_MILLIS,
      sourceAlarmIntent.getStringExtra(WakeFitAlarmContract.EXTRA_LABEL).orEmpty(),
      sourceAlarmIntent.getStringExtra(WakeFitAlarmContract.EXTRA_TIME_OF_DAY).orEmpty(),
      sourceAlarmIntent.getIntExtra(WakeFitAlarmContract.EXTRA_TARGET_COUNT, 5),
      sourceAlarmIntent.getStringExtra(WakeFitAlarmContract.EXTRA_EXERCISE_TYPE) ?: "squat",
    )
  }

  fun cancel(context: Context, alarmId: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val receiverIntent = WakeFitAlarmContract.receiverIntent(
      context,
      alarmId,
      0L,
      "",
      "",
      5,
      "squat",
    )
    val alarmIntent = PendingIntent.getBroadcast(
      context,
      WakeFitAlarmContract.requestCode(alarmId),
      receiverIntent,
      pendingIntentFlags(PendingIntent.FLAG_NO_CREATE),
    )

    if (alarmIntent != null) {
      alarmManager.cancel(alarmIntent)
      alarmIntent.cancel()
    }
  }

  private fun pendingIntentFlags(baseFlags: Int): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      baseFlags or PendingIntent.FLAG_IMMUTABLE
    } else {
      baseFlags
    }
  }
}

package com.wakefit.posedetector

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object WakeFitAlarmContract {
  const val ACTION_ALARM_FIRE = "com.wakefit.mobile.ALARM_FIRE"
  const val EXTRA_ALARM_FIRED = "wakefit_alarm_fired"
  const val EXTRA_ALARM_ID = "wakefit_alarm_id"
  const val EXTRA_FIRED_AT = "wakefit_fired_at"
  const val EXTRA_FIRE_AT_MILLIS = "wakefit_fire_at_millis"
  const val EXTRA_LABEL = "wakefit_label"
  const val EXTRA_TIME_OF_DAY = "wakefit_time_of_day"
  const val EXTRA_TARGET_COUNT = "wakefit_target_count"
  const val EXTRA_EXERCISE_TYPE = "wakefit_exercise_type"

  fun requestCode(alarmId: String): Int = alarmId.hashCode()

  fun receiverIntent(
    context: Context,
    alarmId: String,
    fireAtMillis: Long,
    label: String,
    timeOfDay: String,
    targetCount: Int,
    exerciseType: String,
  ): Intent {
    return Intent(context, WakeFitAlarmReceiver::class.java).apply {
      action = ACTION_ALARM_FIRE
      data = Uri.parse("wakefit://alarm/$alarmId")
      putExtra(EXTRA_ALARM_ID, alarmId)
      putExtra(EXTRA_FIRE_AT_MILLIS, fireAtMillis)
      putExtra(EXTRA_FIRED_AT, isoInstant(fireAtMillis))
      putExtra(EXTRA_LABEL, label)
      putExtra(EXTRA_TIME_OF_DAY, timeOfDay)
      putExtra(EXTRA_TARGET_COUNT, targetCount)
      putExtra(EXTRA_EXERCISE_TYPE, exerciseType)
    }
  }

  fun launchIntent(context: Context, source: Intent): Intent? {
    return context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      action = ACTION_ALARM_FIRE
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_ALARM_FIRED, true)
      putExtra(EXTRA_ALARM_ID, source.getStringExtra(EXTRA_ALARM_ID).orEmpty())
      putExtra(EXTRA_FIRED_AT, source.getStringExtra(EXTRA_FIRED_AT).orEmpty())
      putExtra(EXTRA_LABEL, source.getStringExtra(EXTRA_LABEL).orEmpty())
      putExtra(EXTRA_TIME_OF_DAY, source.getStringExtra(EXTRA_TIME_OF_DAY).orEmpty())
      putExtra(EXTRA_TARGET_COUNT, source.getIntExtra(EXTRA_TARGET_COUNT, 5))
      putExtra(EXTRA_EXERCISE_TYPE, source.getStringExtra(EXTRA_EXERCISE_TYPE) ?: "squat")
    }
  }

  fun clearLaunchExtras(intent: Intent) {
    intent.removeExtra(EXTRA_ALARM_FIRED)
    intent.removeExtra(EXTRA_ALARM_ID)
    intent.removeExtra(EXTRA_FIRED_AT)
    intent.removeExtra(EXTRA_LABEL)
    intent.removeExtra(EXTRA_TIME_OF_DAY)
    intent.removeExtra(EXTRA_TARGET_COUNT)
    intent.removeExtra(EXTRA_EXERCISE_TYPE)
  }

  fun isoInstant(timestampMillis: Long): String {
    return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timestampMillis))
  }
}

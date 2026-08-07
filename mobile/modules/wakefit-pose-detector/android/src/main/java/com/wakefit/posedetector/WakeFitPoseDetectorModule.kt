package com.wakefit.posedetector

import android.app.NotificationManager
import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WakeFitPoseDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WakeFitPoseDetector")

    AsyncFunction("isAvailable") {
      true
    }

    AsyncFunction("startAlarmTone") {
      startAlarmTone()
    }

    AsyncFunction("stopAlarmTone") {
      stopAlarmTone()
    }

    AsyncFunction("scheduleAlarm") { alarmId: String, fireAtMillis: Double, label: String, timeOfDay: String, targetCount: Int, exerciseType: String ->
      WakeFitAlarmScheduler.schedule(
        requireNotNull(appContext.reactContext),
        alarmId,
        fireAtMillis.toLong(),
        label,
        timeOfDay,
        targetCount,
        exerciseType,
      )
    }

    AsyncFunction("cancelAlarm") { alarmId: String ->
      WakeFitAlarmScheduler.cancel(requireNotNull(appContext.reactContext), alarmId)
    }

    AsyncFunction("consumePendingAlarmLaunch") {
      consumePendingAlarmLaunch()
    }

    View(WakeFitPoseCameraView::class) {
      Events("onPoseFrame", "onCameraError")

      // Permanent view destruction — closes ML Kit detector and executor.
      // This fires when React Native permanently unmounts the native view,
      // which is the definitive end-of-life signal for the camera resources.
      OnViewDestroys { view: WakeFitPoseCameraView ->
        view.destroyResources()
      }

      Prop("cameraFacing") { view: WakeFitPoseCameraView, cameraFacing: String ->
        view.cameraFacing = cameraFacing
      }
    }
  }

  private fun consumePendingAlarmLaunch(): Map<String, Any>? {
    val intent = appContext.activityProvider?.currentActivity?.intent ?: return null
    if (!intent.getBooleanExtra(WakeFitAlarmContract.EXTRA_ALARM_FIRED, false)) {
      return null
    }

    val alarmId = intent.getStringExtra(WakeFitAlarmContract.EXTRA_ALARM_ID).orEmpty()
    val payload = mapOf(
      "alarmId" to alarmId,
      "firedAt" to intent.getStringExtra(WakeFitAlarmContract.EXTRA_FIRED_AT).orEmpty(),
      "label" to intent.getStringExtra(WakeFitAlarmContract.EXTRA_LABEL).orEmpty(),
      "timeOfDay" to intent.getStringExtra(WakeFitAlarmContract.EXTRA_TIME_OF_DAY).orEmpty(),
      "targetCount" to intent.getIntExtra(WakeFitAlarmContract.EXTRA_TARGET_COUNT, 5),
      "exerciseType" to (intent.getStringExtra(WakeFitAlarmContract.EXTRA_EXERCISE_TYPE) ?: "squat"),
    )
    cancelAlarmNotification(alarmId)
    WakeFitAlarmContract.clearLaunchExtras(intent)
    return payload
  }

  private fun cancelAlarmNotification(alarmId: String) {
    if (alarmId.isBlank()) {
      return
    }

    val context = appContext.reactContext ?: return
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.cancel(WakeFitAlarmContract.requestCode(alarmId))
  }

  private fun startAlarmTone() {
    WakeFitAlarmRinger.start(requireNotNull(appContext.reactContext))
  }

  private fun stopAlarmTone() {
    WakeFitAlarmRinger.stop(requireNotNull(appContext.reactContext))
  }
}

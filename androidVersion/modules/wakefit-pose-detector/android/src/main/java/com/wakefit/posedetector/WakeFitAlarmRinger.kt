package com.wakefit.posedetector

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

object WakeFitAlarmRinger {
  private const val TAG = "WakeFitAlarm"
  private val mainHandler = Handler(Looper.getMainLooper())
  private var toneGenerator: ToneGenerator? = null
  private var toneRunnable: Runnable? = null
  private var running = false

  @Synchronized
  fun start(context: Context) {
    if (running) {
      Log.i(TAG, "ringer already running")
      return
    }

    running = true
    Log.i(TAG, "start ringer")
    val generator = try {
      ToneGenerator(AudioManager.STREAM_ALARM, 100)
    } catch (error: RuntimeException) {
      Log.e(TAG, "failed to create tone generator", error)
      null
    }
    toneGenerator = generator

    if (generator != null) {
      val runnable = object : Runnable {
        override fun run() {
          toneGenerator?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 900)
          mainHandler.postDelayed(this, 1300)
        }
      }
      toneRunnable = runnable
      mainHandler.post(runnable)
    }
    vibrate(context.applicationContext)
  }

  @Synchronized
  fun stop(context: Context) {
    Log.i(TAG, "stop ringer")
    running = false
    toneRunnable?.let { mainHandler.removeCallbacks(it) }
    toneRunnable = null
    toneGenerator?.stopTone()
    toneGenerator?.release()
    toneGenerator = null
    stopVibration(context.applicationContext)
  }

  @Suppress("DEPRECATION")
  private fun vibrate(context: Context) {
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    if (!vibrator.hasVibrator()) {
      return
    }

    val pattern = longArrayOf(0, 900, 350, 900)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
    } else {
      vibrator.vibrate(pattern, 0)
    }
  }

  @Suppress("DEPRECATION")
  private fun stopVibration(context: Context) {
    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    vibrator.cancel()
  }
}

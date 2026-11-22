package com.webtoontr.app

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Color
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.widget.FrameLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode
import org.robolectric.annotation.SQLiteMode
import org.robolectric.shadows.ShadowChoreographer
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
@GraphicsMode(GraphicsMode.Mode.LEGACY)
@SQLiteMode(SQLiteMode.Mode.LEGACY)
class FloatingButtonTest {
    private lateinit var controller: ActivityController<Activity>
    private lateinit var container: FrameLayout
    private lateinit var button: FloatingButton
    private var clicks = 0
    private var downTime = 0L

    @Before
    fun createButton() {
        // Parmak hareketleri ve animasyon kareleri aynı denetlenen saati kullanmalı.
        ShadowChoreographer.setPaused(true)
        ShadowChoreographer.setFrameDelay(Duration.ofMillis(16))
        controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.getSharedPreferences("floating_controls", Context.MODE_PRIVATE).edit().clear().commit()
        container = FrameLayout(activity)
        activity.setContentView(container)
        button = FloatingButton(activity, container, "test", "TR", "Çeviri", Color.BLUE, 0) { clicks++ }
        idle(20)
        container.layout(0, 0, 600, 900)
        button.layout(0, 0, dp(48), dp(48))
        button.x = 150f
        button.y = 200f
    }

    @After
    fun destroyButton() {
        controller.pause().stop().destroy()
    }

    private fun dp(value: Int) = (value * button.resources.displayMetrics.density).toInt()
    private fun idle(milliseconds: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(milliseconds))

    private fun touch(action: Int, screenX: Float, screenY: Float) {
        val time = SystemClock.uptimeMillis()
        if (action == MotionEvent.ACTION_DOWN) downTime = time
        // Yerel koordinatlar hareket eden düğmenin içinde sabit kalabilir.
        val event = MotionEvent.obtain(downTime, time, action, screenX, screenY, 0)
        event.offsetLocation(-button.x, -button.y)
        assertEquals("Raw touch X must remain in screen coordinates", screenX, event.rawX, 0.1f)
        assertEquals("Raw touch Y must remain in screen coordinates", screenY, event.rawY, 0.1f)
        button.onTouchEvent(event)
        event.recycle()
    }

    private fun dragRight() {
        touch(MotionEvent.ACTION_DOWN, 170f, 220f)
        idle(80)
        touch(MotionEvent.ACTION_MOVE, 190f, 220f)
        idle(80)
        touch(MotionEvent.ACTION_MOVE, 210f, 220f)
        idle(10)
        touch(MotionEvent.ACTION_UP, 210f, 220f)
    }

    @Test
    fun keepsMovingAfterReleaseThenSlowsAndSavesTheFinalPosition() {
        dragRight()
        val releasedX = button.x
        val releasedWidth = container.width
        val animatorField = FloatingButton::class.java.getDeclaredField("glide").apply { isAccessible = true }
        val hadAnimator = animatorField.get(button) != null
        idle(120)
        val firstX = button.x
        idle(120)
        val secondX = button.x
        idle(100)
        val thirdX = button.x
        assertTrue("Must visibly move after the finger lifts: released=$releasedX first=$firstX second=$secondX third=$thirdX width=$releasedWidth/${container.width} animator=$hadAnimator dp6=${dp(6)}", firstX - releasedX >= dp(6))
        assertTrue("Must still visibly move after 240 ms", thirdX - secondX >= dp(1))
        assertTrue("Movement must slow down", secondX - firstX > thirdX - secondX)
        idle(300)
        val stoppedX = button.x
        assertTrue("Glide should cover at least 24 dp", stoppedX - releasedX >= dp(24) - 1)
        assertTrue("Glide should stay short", stoppedX - releasedX <= dp(56) + 1)
        idle(500)
        assertEquals(stoppedX, button.x, 0.1f)
        assertEquals(0, clicks)
        val stored = controller.get().getSharedPreferences("floating_controls", Context.MODE_PRIVATE)
        assertEquals(stoppedX / (container.width - button.width), stored.getFloat("test-x", -1f), 0.001f)
    }

    @Test
    fun touchingAMovingButtonStopsItImmediately() {
        dragRight()
        idle(80)
        val caughtX = button.x
        touch(MotionEvent.ACTION_DOWN, caughtX + 20, button.y + 20)
        idle(500)
        assertEquals(caughtX, button.x, 0.1f)
        touch(MotionEvent.ACTION_CANCEL, caughtX + 20, button.y + 20)
        assertEquals(0, clicks)
    }

    @Test
    fun tappingDoesNotGlide() {
        val initialX = button.x
        touch(MotionEvent.ACTION_DOWN, 170f, 220f)
        idle(20)
        touch(MotionEvent.ACTION_UP, 170f, 220f)
        idle(600)
        assertEquals(1, clicks)
        assertEquals(initialX, button.x, 0.1f)
    }

    @Test
    fun holdingBeforeReleaseAllowsPrecisePlacement() {
        touch(MotionEvent.ACTION_DOWN, 170f, 220f)
        idle(40)
        touch(MotionEvent.ACTION_MOVE, 210f, 220f)
        idle(200)
        val placedX = button.x
        touch(MotionEvent.ACTION_UP, 210f, 220f)
        idle(600)
        assertEquals(placedX, button.x, 0.1f)
        assertEquals(0, clicks)
    }

    @Test
    fun diagonalGlideStaysWithinTheScreen() {
        button.x = container.width - button.width - 35f
        button.y = container.height - button.height - 35f
        val fingerX = button.x + 20
        val fingerY = button.y + 20
        touch(MotionEvent.ACTION_DOWN, fingerX, fingerY)
        idle(20)
        touch(MotionEvent.ACTION_MOVE, fingerX + 20, fingerY + 20)
        idle(10)
        touch(MotionEvent.ACTION_UP, fingerX + 20, fingerY + 20)
        idle(600)
        assertTrue(button.x in 0f..(container.width - button.width).toFloat())
        assertTrue(button.y in 0f..(container.height - button.height).toFloat())
        assertEquals(0, clicks)
    }
}

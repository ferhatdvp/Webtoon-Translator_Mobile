package com.webtoontr.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.Button
import android.widget.FrameLayout
import android.widget.OverScroller
import java.util.ArrayDeque
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Sayfadan bağımsız, dokunma ile tıklama ve sürüklemeyi ayıran yuvarlak kontrol. */
class FloatingButton(
    context: Context,
    private val container: FrameLayout,
    private val positionKey: String,
    label: String,
    description: String,
    color: Int,
    private val bottomOffsetDp: Int,
    onClick: () -> Unit,
) : Button(context) {
    private val positions = context.getSharedPreferences("floating_controls", Context.MODE_PRIVATE)
    private val diameter = dp(48)
    private val configuration = ViewConfiguration.get(context)
    private val touchSlop = configuration.scaledTouchSlop
    private var fractionX = savedFraction("x")
    private var fractionY = savedFraction("y")
    private var gestureActive = false
    private var dragging = false
    private var downX = 0f
    private var downY = 0f
    private var startX = 0f
    private var startY = 0f
    private data class MotionSample(val time: Long, val x: Float, val y: Float)
    private val motionSamples = ArrayDeque<MotionSample>()
    private var glide: Runnable? = null
    private val scroller = OverScroller(context).apply {
        setFriction(ViewConfiguration.getScrollFriction() * 0.65f)
    }

    init {
        text = label
        textSize = if (label == "TR") 15f else 24f
        contentDescription = description
        tooltipText = description
        isAllCaps = false
        typeface = Typeface.DEFAULT_BOLD
        includeFontPadding = false
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        setPadding(0, 0, 0, 0)
        minimumWidth = 0
        minimumHeight = 0
        stateListAnimator = null
        elevation = dp(6).toFloat()
        val colors = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_selected), circle(Color.rgb(107, 114, 128)))
            addState(intArrayOf(), circle(color))
        }
        background = RippleDrawable(
            ColorStateList.valueOf(Color.argb(70, 255, 255, 255)), colors, circle(Color.WHITE),
        )
        clipToOutline = true
        setOnClickListener { onClick() }
        container.addView(this, FrameLayout.LayoutParams(diameter, diameter, Gravity.TOP or Gravity.LEFT))
        container.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
                val wasGliding = glide != null
                stopGlide()
                cancelGesture()
                place()
                if (wasGliding) savePosition()
            }
        }
        post { place() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

    private fun circle(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    private fun savedFraction(axis: String): Float? {
        val key = "$positionKey-$axis"
        return if (positions.contains(key)) positions.getFloat(key, 0f).takeIf { it.isFinite() }?.coerceIn(0f, 1f) else null
    }

    private fun maxX() = (container.width - diameter).coerceAtLeast(0).toFloat()
    private fun maxY() = (container.height - diameter).coerceAtLeast(0).toFloat()

    private fun place() {
        val marginX = dp(16).toFloat().coerceAtMost(maxX() / 2)
        val marginY = dp(16).toFloat().coerceAtMost(maxY() / 2)
        x = fractionX?.let { it * maxX() } ?: (maxX() - marginX)
        y = fractionY?.let { it * maxY() } ?: (maxY() - marginY - dp(bottomOffsetDp)).coerceAtLeast(0f)
    }

    private fun savePosition() {
        val normalizedX = if (maxX() > 0) x / maxX() else 0f
        val normalizedY = if (maxY() > 0) y / maxY() else 0f
        fractionX = normalizedX
        fractionY = normalizedY
        positions.edit().putFloat("$positionKey-x", normalizedX).putFloat("$positionKey-y", normalizedY).apply()
    }

    private fun stopGlide() {
        glide?.let { removeCallbacks(it) }
        glide = null
        scroller.forceFinished(true)
    }

    /** Yeni dokunmada, PiP'e geçişte veya ekran kapanırken hareketi bulunduğu yerde sonlandırır. */
    fun finishMotion() {
        if (glide != null) {
            stopGlide()
            savePosition()
        }
        cancelGesture()
    }

    private fun recordMotion(event: MotionEvent) {
        // Hareket eden View'ın yerel koordinatlarından bağımsız, son 100 ms'yi ölç.
        motionSamples.addLast(MotionSample(event.eventTime, event.rawX, event.rawY))
        while (motionSamples.size > 2 && motionSamples.first.time < event.eventTime - 100) {
            motionSamples.removeFirst()
        }
    }

    private fun releaseVelocity(): Pair<Float, Float> {
        val last = motionSamples.lastOrNull() ?: return 0f to 0f
        val first = motionSamples.firstOrNull {
            val dx = last.x - it.x
            val dy = last.y - it.y
            dx * dx + dy * dy >= 1f
        } ?: return 0f to 0f
        val seconds = (last.time - first.time).coerceAtLeast(1) / 1000f
        return (last.x - first.x) / seconds to (last.y - first.y) / seconds
    }

    private fun startGlide(vx: Float, vy: Float) {
        val speed = sqrt(vx * vx + vy * vy)
        if (speed < configuration.scaledMinimumFlingVelocity) return
        val maxVelocity = configuration.scaledMaximumFlingVelocity.toFloat()
        scroller.fling(
            x.roundToInt(), y.roundToInt(),
            vx.coerceIn(-maxVelocity, maxVelocity).roundToInt(),
            vy.coerceIn(-maxVelocity, maxVelocity).roundToInt(),
            0, maxX().toInt(), 0, maxY().toInt(),
        )
        if (scroller.finalX == scroller.startX && scroller.finalY == scroller.startY) return
        val animation = object : Runnable {
            override fun run() {
                if (glide !== this) return
                scroller.computeScrollOffset()
                x = scroller.currX.toFloat().coerceIn(0f, maxX())
                y = scroller.currY.toFloat().coerceIn(0f, maxY())
                fractionX = if (maxX() > 0) x / maxX() else 0f
                fractionY = if (maxY() > 0) y / maxY() else 0f
                if (scroller.isFinished) {
                    glide = null
                    savePosition()
                } else {
                    postOnAnimation(this)
                }
            }
        }
        glide = animation
        postOnAnimation(animation)
    }

    private fun cancelGesture() {
        gestureActive = false
        dragging = false
        isPressed = false
        motionSamples.clear()
        parent?.requestDisallowInterceptTouchEvent(false)
    }

    private fun move(event: MotionEvent) {
        val dx = event.rawX - downX
        val dy = event.rawY - downY
        if (dx * dx + dy * dy > touchSlop * touchSlop) dragging = true
        if (dragging) {
            isPressed = false
            x = (startX + dx).coerceIn(0f, maxX())
            y = (startY + dy).coerceIn(0f, maxY())
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!isEnabled) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                finishMotion()
                gestureActive = true
                dragging = false
                downX = event.rawX
                downY = event.rawY
                startX = x
                startY = y
                recordMotion(event)
                isPressed = true
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> if (gestureActive) {
                recordMotion(event)
                move(event)
            }
            MotionEvent.ACTION_UP -> if (gestureActive) {
                recordMotion(event)
                move(event)
                val shouldClick = !dragging
                val (vx, vy) = releaseVelocity()
                if (dragging) savePosition()
                cancelGesture()
                if (shouldClick) performClick()
                else startGlide(vx, vy)
            }
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> {
                finishMotion()
                place()
            }
        }
        return true
    }

    override fun onDetachedFromWindow() {
        finishMotion()
        super.onDetachedFromWindow()
    }
}

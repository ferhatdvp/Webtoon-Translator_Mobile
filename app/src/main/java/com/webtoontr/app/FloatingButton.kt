package com.webtoontr.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
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
import android.view.VelocityTracker
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.FrameLayout
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
    private var velocity: VelocityTracker? = null
    private var pointerId = 0
    private var glide: ValueAnimator? = null

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
        glide?.let {
            it.removeAllListeners()
            it.removeAllUpdateListeners()
            it.cancel()
        }
        glide = null
    }

    /** Yeni dokunmada, PiP'e geçişte veya ekran kapanırken hareketi bulunduğu yerde sonlandırır. */
    fun finishMotion() {
        if (glide != null) {
            stopGlide()
            savePosition()
        }
        cancelGesture()
    }

    private fun recordVelocity(event: MotionEvent) {
        val sample = MotionEvent.obtain(event)
        // Düğme parmağı izlediğinden yerel koordinatlar değişmeyebilir; ekran koordinatlarını ölç.
        sample.setLocation(event.rawX, event.rawY)
        velocity?.addMovement(sample)
        sample.recycle()
    }

    private fun startGlide(vx: Float, vy: Float) {
        val speed = sqrt(vx * vx + vy * vy)
        if (speed < configuration.scaledMinimumFlingVelocity) return
        val travelTime = minOf(0.08f, dp(36) / speed)
        val fromX = x
        val fromY = y
        val toX = (fromX + vx * travelTime).coerceIn(0f, maxX())
        val toY = (fromY + vy * travelTime).coerceIn(0f, maxY())
        if (toX == fromX && toY == fromY) return
        val animation = ValueAnimator.ofFloat(0f, 1f)
        animation.duration = 220L
        animation.interpolator = DecelerateInterpolator(1.5f)
        animation.addUpdateListener {
            val progress = it.animatedValue as Float
            x = fromX + (toX - fromX) * progress
            y = fromY + (toY - fromY) * progress
            fractionX = if (maxX() > 0) x / maxX() else 0f
            fractionY = if (maxY() > 0) y / maxY() else 0f
        }
        animation.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                glide = null
                savePosition()
            }
        })
        glide = animation
        animation.start()
    }

    private fun cancelGesture() {
        gestureActive = false
        dragging = false
        isPressed = false
        velocity?.recycle()
        velocity = null
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
                pointerId = event.getPointerId(0)
                velocity = VelocityTracker.obtain()
                recordVelocity(event)
                isPressed = true
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> if (gestureActive) {
                recordVelocity(event)
                move(event)
            }
            MotionEvent.ACTION_UP -> if (gestureActive) {
                recordVelocity(event)
                move(event)
                val shouldClick = !dragging
                velocity?.computeCurrentVelocity(1000, configuration.scaledMaximumFlingVelocity.toFloat())
                val vx = velocity?.getXVelocity(pointerId) ?: 0f
                val vy = velocity?.getYVelocity(pointerId) ?: 0f
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

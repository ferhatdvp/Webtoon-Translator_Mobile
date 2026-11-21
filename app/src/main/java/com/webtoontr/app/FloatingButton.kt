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
import kotlin.math.roundToInt

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
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var fractionX = savedFraction("x")
    private var fractionY = savedFraction("y")
    private var gestureActive = false
    private var dragging = false
    private var downX = 0f
    private var downY = 0f
    private var startX = 0f
    private var startY = 0f

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
                cancelGesture()
                place()
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

    private fun cancelGesture() {
        gestureActive = false
        dragging = false
        isPressed = false
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
                gestureActive = true
                dragging = false
                downX = event.rawX
                downY = event.rawY
                startX = x
                startY = y
                isPressed = true
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> if (gestureActive) move(event)
            MotionEvent.ACTION_UP -> if (gestureActive) {
                move(event)
                val shouldClick = !dragging
                if (dragging) savePosition()
                cancelGesture()
                if (shouldClick) performClick()
            }
            MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> {
                cancelGesture()
                place()
            }
        }
        return true
    }
}

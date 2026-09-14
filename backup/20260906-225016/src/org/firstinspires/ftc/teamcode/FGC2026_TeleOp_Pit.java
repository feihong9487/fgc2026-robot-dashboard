package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * B1-PIT —— 維修區 / 練習用。
 *
 * 和 A1-MATCH 一模一樣的控制邏輯，只翻兩個 boolean：
 *   pitMode()   = true  → 儀表板全開：WebSocket 推播、/dash/state.json、
 *                          MJPEG 串流、線上調參（/dash/set）全部接受。
 *   useCamera() = true  → 啟動 AprilTag 相機（也才有 AimAssist 可用）。
 *
 * 比賽日千萬不要跑這一支：它會把資料往外送，也會佔用相機與頻寬。
 * 場上請選 A1-MATCH。
 */
@TeleOp(name = "B1-PIT", group = "B")
public class FGC2026_TeleOp_Pit extends FGC2026_TeleOp_Match {

    @Override
    protected boolean pitMode() { return true; }

    @Override
    protected boolean useCamera() { return true; }
}

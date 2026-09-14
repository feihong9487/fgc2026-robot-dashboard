package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.hardware.Servo;

/**
 * 球倉。
 *
 * 1. 開闔：兩顆 REV Smart Servo v2（連續旋轉模式）→ CRServo，R1/L1 按住才轉。
 * 2. 放下："open" 一顆 REV Smart Robot Servo（定位模式）→ Servo。
 *    INIT 收在 Constants.OPEN_STOW_DEG（0°，球倉扣在起始體積內），
 *    按 PLAY 後放到 Constants.OPEN_DEPLOY_DEG（120°）。整場維持放下，沒有手動收回。
 *    硬體組態沒有 "open" 時不讓 OpMode 掛掉（備援也要能開車）：
 *    open == null、deployState() 回 "MISSING"，INIT 畫面會標出來。
 */
public class HopperSystem {
    private final CRServo yoyoL, yoyoR;

    /** 放下球倉的定位伺服；null = 硬體組態找不到 "open"（或型別設錯）。 */
    private final Servo open;
    /** 上一次真的送出去的角度；NaN = 還沒送過。角度沒變就不重送（每圈呼叫零匯流排成本）。 */
    private double appliedOpenDeg = Double.NaN;
    /** "STOWED" / "DEPLOYED" / "MISSING"：給 telemetry 與儀表板看的指令狀態（伺服沒有回授）。 */
    private String deployState = "MISSING";

    public HopperSystem(HardwareMap hardwareMap) {
        yoyoL = hardwareMap.get(CRServo.class, "yoyoL");
        yoyoR = hardwareMap.get(CRServo.class, "yoyoR");
        yoyoL.setDirection(Constants.DIR_YL);
        yoyoR.setDirection(Constants.DIR_YR);

        Servo s = null;
        try {
            s = hardwareMap.get(Servo.class, "open");
            s.setDirection(Constants.DIR_OPEN);
        } catch (Throwable t) {
            s = null;   // 組態沒有 "open"：其餘功能照常，INIT telemetry 會標 MISSING
        }
        open = s;
    }

    // ── 開闔（CRServo）────────────────────────────────────────────────
    public void open()  { set( Constants.HOPPER_POWER); }   // R1 按住：往開的方向轉
    public void close() { set(-Constants.HOPPER_POWER); }   // L1 按住：往關的方向轉
    public void stop()  { set(0); }                          // 放開：停

    private void set(double p) {
        yoyoL.setPower(p);
        yoyoR.setPower(p);
    }

    // ── 放下（"open" 定位伺服）────────────────────────────────────────
    /** INIT：收起（OPEN_STOW_DEG）。 */
    public void stow()   { setOpenDeg(Constants.OPEN_STOW_DEG,   "STOWED"); }
    /** 按 PLAY 後：放下球倉（OPEN_DEPLOY_DEG）。每圈呼叫也沒關係：角度沒變就不送指令。 */
    public void deploy() { setOpenDeg(Constants.OPEN_DEPLOY_DEG, "DEPLOYED"); }

    public boolean hasOpenServo() { return open != null; }
    public String  deployState()  { return deployState; }
    /** 上一次送出的角度；還沒送過或缺硬體時是 NaN（DashHub.put 會轉成 0）。 */
    public double  openDeg()      { return appliedOpenDeg; }

    private void setOpenDeg(double deg, String state) {
        if (open == null) { deployState = "MISSING"; return; }
        deployState = state;
        if (deg == appliedOpenDeg) return;              // 沒變就不重送；NaN 比較恆 false，所以第一次一定送
        double pos = deg / Constants.OPEN_RANGE_DEG;    // 角度 → Servo 0..1（REV SRS 出廠 270°）
        if (pos < 0.0) pos = 0.0;
        if (pos > 1.0) pos = 1.0;
        open.setPosition(pos);
        appliedOpenDeg = deg;
    }
}

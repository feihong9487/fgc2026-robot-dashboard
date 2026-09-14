package org.firstinspires.ftc.teamcode;

/**
 * AimAssist：純數學，沒有任何硬體、沒有任何狀態。
 *
 * 這樣寫的理由：
 *   1. 可以在 PC 上用一支 main() 直接驗證，不必上機。
 *   2. OnBotJava 每次 Build Everything 換 ClassLoader，無狀態的類別不會有殘留。
 *
 * 使用規則（比賽安全）：
 *   - 只加在「轉向」上，絕不碰前進、絕不代按扳機。
 *   - 放開輔助鍵就完全回手動：呼叫端不呼叫這裡即可，這裡沒有積分項也沒有記憶。
 */
public final class AimAssist {

    private AimAssist() {}

    /**
     * bearing 與 turn 的符號換算 —— 整批程式碼裡唯一可能把車轉錯方向的一行。
     *
     * ★ 上機第一件事就是實測這個符號 ★
     *   1. 跑 B1-PIT，把 tag 放在鏡頭正前方偏左。
     *   2. 看 /FGC/Vision/Best/Bearing deg 的正負（FTC SDK 的 javadoc 寫
     *      "positive to the right"，但坊間程式碼常寫成左，只能有一邊對，
     *      所以不要相信任何一份註解，看數字）。
     *   3. 按住輔助鍵，看 /FGC/Aim/Delta 與車實際轉的方向對不對。
     *   4. 反了的話有兩條路：改這裡成 +1.0 重 Build，或直接在現場把
     *      AIM_KP 設成負值（白名單下限已經放寬到 -0.20，不必重 Build）。
     *
     * 本車 DriveSystem.arcadeDrive(forward, turn)：powL = forward + turn、
     * powR = forward - turn，所以 turn 正值 = 「右轉」，這一半是確定的。
     */
    public static final double BEARING_TO_TURN_SIGN = -1.0;

    /** 夾在 [lo, hi]；NaN 一律回 lo 與 hi 的中點以外的安全值 0。 */
    public static double clamp(double v, double lo, double hi) {
        if (Double.isNaN(v)) return 0.0;
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }

    /**
     * 這一圈要疊加到 turn 上的修正量。
     *
     * @param bearingDeg AprilTag 方位角（度；正負方向見 BEARING_TO_TURN_SIGN，以實測為準）
     * @param kp         Constants.AIM_KP（可以是負的：現場翻符號用）
     * @param max        Constants.AIM_MAX（修正量絕對值上限）
     * @return 修正量；輸入不合理（NaN、kp==0、max<=0）時回 0
     */
    public static double turnDelta(double bearingDeg, double kp, double max) {
        if (Double.isNaN(bearingDeg) || Double.isInfinite(bearingDeg)) return 0.0;
        if (Double.isNaN(kp) || Double.isInfinite(kp) || kp == 0.0) return 0.0;
        if (Double.isNaN(max) || max <= 0.0) return 0.0;
        double m = Math.abs(max);
        return clamp(BEARING_TO_TURN_SIGN * kp * bearingDeg, -m, m);
    }

    /**
     * 手動轉向 + 修正量，並夾回 [-1, 1]。
     * 手動輸入永遠保留：駕駛想壓過輔助就直接推搖桿。
     */
    public static double applyTurn(double manualTurn, double bearingDeg, double kp, double max) {
        double t = manualTurn;
        if (Double.isNaN(t) || Double.isInfinite(t)) t = 0.0;
        return clamp(t + turnDelta(bearingDeg, kp, max), -1.0, 1.0);
    }

    /**
     * 這組視覺數字能不能拿來瞄準。
     * 只做數值合理性檢查（有限、距離為正）；「幾幀確認」「Age」那類時間過濾在 TagCam / 呼叫端。
     */
    public static boolean usable(double rangeM, double bearingDeg) {
        if (Double.isNaN(rangeM) || Double.isInfinite(rangeM)) return false;
        if (Double.isNaN(bearingDeg) || Double.isInfinite(bearingDeg)) return false;
        if (rangeM <= 0.0) return false;
        if (Math.abs(bearingDeg) > 90.0) return false;   // 超過視角範圍必是壞值
        return true;
    }
}

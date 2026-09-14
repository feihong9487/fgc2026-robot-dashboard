package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class DriveSystem {
    private final DcMotor motorL, motorR;

    public DriveSystem(HardwareMap hardwareMap) {
        motorL = hardwareMap.get(DcMotor.class, "L");
        motorR = hardwareMap.get(DcMotor.class, "R");

        motorL.setDirection(Constants.DIR_L);
        motorR.setDirection(Constants.DIR_R);
        motorL.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        motorR.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
        motorL.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
        motorR.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
    }

    public void arcadeDrive(double forward, double turn) {
        double powL = forward + turn, powR = forward - turn;
        double m = Math.max(Math.abs(powL), Math.abs(powR));
        if (m > 1.0) { powL /= m; powR /= m; }
        motorL.setPower(powL);
        motorR.setPower(powR);
    }

    /**
     * 搖桿整形：死區 → 重映射 → 平方保號
     *
     * DEADZONE 是 volatile（PIT 可以線上調），所以先讀進 local 只讀一次：
     * 一次呼叫內讀三次的話，三次可能拿到不同的值 —— 若 DEADZONE 在判斷之後
     * 被調大，(|v| - dz) 會變負數，平方後又回正，輸出方向對但大小是錯的，
     * 而且完全靜默。順便省掉每圈兩次多餘的 volatile 讀。
     */
    public static double shape(double v) {
        final double dz = Constants.DEADZONE;
        if (Math.abs(v) < dz) return 0.0;
        double sign = Math.signum(v);
        double denom = 1.0 - dz;
        if (denom <= 0.0) return sign;              // dz >= 1：死區吃掉全部行程
        double mag = (Math.abs(v) - dz) / denom;
        if (mag > 1.0) mag = 1.0;
        return sign * mag * mag;
    }
}
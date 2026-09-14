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

    /** 搖桿整形：死區 → 重映射 → 平方保號 */
    public static double shape(double v) {
        if (Math.abs(v) < Constants.DEADZONE) return 0.0;
        double sign = Math.signum(v);
        double mag = (Math.abs(v) - Constants.DEADZONE) / (1.0 - Constants.DEADZONE);
        return sign * mag * mag;
    }
}
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class ClimbSystem {
    private final DcMotorEx climb;
    private boolean holding = false;
    /** 上一次真的送出去的保持力道；Constants.HOLD 被儀表板改掉時要重送。 */
    private double appliedHold = Double.NaN;

    public ClimbSystem(HardwareMap hardwareMap) {
        climb = hardwareMap.get(DcMotorEx.class, "climb");
        climb.setDirection(Constants.DIR_C);
        climb.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);

        climb.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        climb.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
    }

    public void hold() {
        if (!holding) {
            int currentPos = climb.getCurrentPosition();
            climb.setTargetPosition(currentPos);
            climb.setMode(DcMotor.RunMode.RUN_TO_POSITION);
            appliedHold = Constants.HOLD;
            climb.setPower(appliedHold);
            holding = true;
        } else if (appliedHold != Constants.HOLD) {
            // PIT 模式線上調 HOLD：不重設目標位置，只重套力道
            appliedHold = Constants.HOLD;
            climb.setPower(appliedHold);
        }
    }

    public void climbUp() {
        climb.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        climb.setPower(Constants.CLIMB);
        holding = false;
    }

    public void climbDown() {
        climb.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        climb.setPower(-Constants.CLIMB);
        holding = false;
    }

    public int getPosition() { return climb.getCurrentPosition(); }

    public boolean isHolding() { return holding; }

    public DcMotorEx motor() { return climb; }
}

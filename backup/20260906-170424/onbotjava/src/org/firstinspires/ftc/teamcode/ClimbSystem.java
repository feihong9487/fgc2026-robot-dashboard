package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class ClimbSystem {
    private final DcMotorEx climb;
    private boolean holding = false;

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
            climb.setPower(Constants.HOLD);
            holding = true;
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
}
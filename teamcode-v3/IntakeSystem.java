package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class IntakeSystem {
    private final DcMotor intake;

    public IntakeSystem(HardwareMap hardwareMap) {
        intake   = hardwareMap.get(DcMotor.class, "intake");

        intake.setDirection(Constants.DIR_IN);
    }

    public void collect() { intake.setPower(Constants.INTAKE_COLLECT); }
    public void shoot() { intake.setPower(Constants.INTAKE_SHOOT); }
    public void eject() { intake.setPower(-1.0); }
    public void stop()  { intake.setPower(0.0); }
}
package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class ShooterSystem {
    private final DcMotorEx shooterL, shooterR, way;

    public ShooterSystem(HardwareMap hardwareMap) {
        shooterL = hardwareMap.get(DcMotorEx.class, "shooterL");
        shooterR = hardwareMap.get(DcMotorEx.class, "shooterR");
        way      = hardwareMap.get(DcMotorEx.class, "way");

        shooterL.setDirection(Constants.DIR_SL);
        shooterR.setDirection(Constants.DIR_SR);
        way.setDirection(Constants.DIR_WY);

        for (DcMotorEx m : new DcMotorEx[]{shooterL, shooterR, way}) {
            m.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
            m.setMode(DcMotor.RunMode.RUN_USING_ENCODER);
        }
    }

    public void collect() {
        shooterL.setVelocity(Constants.IDLE_TPS);
        shooterR.setVelocity(Constants.IDLE_TPS);
        way.setVelocity(-Constants.WAY_IDLE_TPS);
    }

    public void shoot() {
        shooterL.setVelocity(Constants.VEL_SL);
        shooterR.setVelocity(Constants.VEL_SR);
        boolean atSpeed = shooterL.getVelocity()>Constants.FEED_THRESHOLD && shooterR.getVelocity()>Constants.FEED_THRESHOLD;
        way.setVelocity((!Constants.WAIT_SPINUP || atSpeed) ? Constants.WAY_TPS : 0);
    }

    public void eject() {
        shooterL.setVelocity(-Constants.EJECT_VEL);
        shooterR.setVelocity(-Constants.EJECT_VEL);
        way.setVelocity(-Constants.WAY_TPS);
    }

    public double getVelocityL() { return shooterL.getVelocity(); }
    public double getVelocityR() { return shooterR.getVelocity(); }
    public double getWayVelocity() { return way.getVelocity(); }
}
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
        // 這些常數是 volatile（PIT 線上可調），同一次決策要用同一個值，
        // 所以先讀進 local，不要在一行內讀兩次。
        final double feed = Constants.FEED_THRESHOLD;
        final boolean wait = Constants.WAIT_SPINUP;
        shooterL.setVelocity(Constants.VEL_SL);
        shooterR.setVelocity(Constants.VEL_SR);
        boolean atSpeed = shooterL.getVelocity() > feed && shooterR.getVelocity() > feed;
        way.setVelocity((!wait || atSpeed) ? Constants.WAY_TPS : 0);
    }

    public void eject() {
        shooterL.setVelocity(-Constants.EJECT_VEL);
        shooterR.setVelocity(-Constants.EJECT_VEL);
        way.setVelocity(-Constants.WAY_TPS);
    }

    public double getVelocityL() { return shooterL.getVelocity(); }
    public double getVelocityR() { return shooterR.getVelocity(); }
    public double getWayVelocity() { return way.getVelocity(); }

    // ── 給儀表板埋點用的存取器（不改任何控制行為）──
    // 電流 getCurrent() 不在 bulk cache 裡，是一次獨立的往返，
    // 所以 TeleOp 每圈只讀其中一項輪流，不要在這裡自己每圈全讀。
    public DcMotorEx motorL()   { return shooterL; }
    public DcMotorEx motorR()   { return shooterR; }
    public DcMotorEx motorWay() { return way; }
}
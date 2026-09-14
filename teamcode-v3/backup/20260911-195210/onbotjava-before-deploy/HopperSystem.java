package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.HardwareMap;

/** 球倉開闔：兩顆 REV Smart Servo v2（連續旋轉模式）→ 用 CRServo 控制 */
public class HopperSystem {
    private final CRServo yoyoL, yoyoR;

    public HopperSystem(HardwareMap hardwareMap) {
        yoyoL = hardwareMap.get(CRServo.class, "yoyoL");
        yoyoR = hardwareMap.get(CRServo.class, "yoyoR");
        yoyoL.setDirection(Constants.DIR_YL);
        yoyoR.setDirection(Constants.DIR_YR);
    }

    public void open()  { set( Constants.HOPPER_POWER); }   // R1 按住：往開的方向轉
    public void close() { set(-Constants.HOPPER_POWER); }   // L1 按住：往關的方向轉
    public void stop()  { set(0); }                          // 放開：停

    private void set(double p) {
        yoyoL.setPower(p);
        yoyoR.setPower(p);
    }
}

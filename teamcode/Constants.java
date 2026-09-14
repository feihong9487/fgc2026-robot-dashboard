package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

public class Constants {
    // 方向
    public static final DcMotor.Direction DIR_L     = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_R     = DcMotor.Direction.REVERSE;
    public static final DcMotor.Direction DIR_SL    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_SR    = DcMotor.Direction.REVERSE;
    public static final DcMotor.Direction DIR_IN    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_WY    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_C     = DcMotor.Direction.REVERSE;

    // 底盤
    public static final double DEADZONE   = 0.06;
    public static final double TURN_SCALE = 0.80;

    // 射手
    public static final double VEL_SL = 1900;
    public static final double VEL_SR = 1900;
    public static final double IDLE_TPS = 0;
    public static final double EJECT_VEL = 1600;
    public static final boolean WAIT_SPINUP = true;
    public static final double FEED_THRESHOLD = 1200;

    // way 送料
    public static final double WAY_TPS      = 1800;
    public static final double WAY_IDLE_TPS = 400;

    // intake（馬達）
    public static final double INTAKE_COLLECT = 1.0;
    public static final double INTAKE_SHOOT   = 1.0;

    // 爬升
    public static final double CLIMB = 1.0;
    public static final double HOLD = 0.6;

    // 球倉（REV SRS v2 連續旋轉模式，CRServo）
    public static final DcMotorSimple.Direction DIR_YL = DcMotorSimple.Direction.FORWARD;
    public static final DcMotorSimple.Direction DIR_YR = DcMotorSimple.Direction.REVERSE; // 左右鏡像；開錯邊就對調
    public static final double HOPPER_POWER = 1;   // 開闔轉速（0~1），太猛就降
}

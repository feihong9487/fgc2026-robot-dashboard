package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;

/**
 * 常數表。
 *
 * 可調參數一律用 public static volatile（不可以 final）——
 * final 會被 javac 常數摺疊，儀表板在 PIT 改了也不會生效。
 * 方向類維持 final：它們只在建構子讀一次，改了也沒用，而且改錯會把車開壞。
 *
 * 白名單、上下界、回讀與存檔都在 DashParams。
 */
public class Constants {
    // 方向（final：只在 init 讀一次，不開放線上調）
    public static final DcMotor.Direction DIR_L     = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_R     = DcMotor.Direction.REVERSE;
    public static final DcMotor.Direction DIR_SL    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_SR    = DcMotor.Direction.REVERSE;
    public static final DcMotor.Direction DIR_IN    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_WY    = DcMotor.Direction.FORWARD;
    public static final DcMotor.Direction DIR_C     = DcMotor.Direction.REVERSE;

    // 底盤
    public static volatile double DEADZONE   = 0.06;
    public static volatile double TURN_SCALE = 0.80;

    // 射手
    public static volatile double VEL_SL = 1900;
    public static volatile double VEL_SR = 1900;
    public static volatile double IDLE_TPS = 0;
    public static volatile double EJECT_VEL = 1600;
    public static volatile boolean WAIT_SPINUP = true;
    public static volatile double FEED_THRESHOLD = 1200;

    // way 送料
    public static volatile double WAY_TPS      = 1800;
    public static volatile double WAY_IDLE_TPS = 400;

    // intake（馬達）
    public static volatile double INTAKE_COLLECT = 1.0;
    public static volatile double INTAKE_SHOOT   = 1.0;

    // 爬升
    public static volatile double CLIMB = 1.0;
    public static volatile double HOLD = 0.6;

    // 球倉（REV SRS v2 連續旋轉模式，CRServo）
    public static final DcMotorSimple.Direction DIR_YL = DcMotorSimple.Direction.FORWARD;
    public static final DcMotorSimple.Direction DIR_YR = DcMotorSimple.Direction.REVERSE; // 左右鏡像；開錯邊就對調
    public static volatile double HOPPER_POWER = 1;   // 開闔轉速（0~1），太猛就降

    // AprilTag（第二階段 TagCam 用）
    public static volatile double TAG_DECIMATION = 2;   // 每圈套到 AprilTagProcessor.setDecimation
    public static volatile double TAG_MIN_MARGIN = 30;  // decisionMargin 低於這個就丟掉

    /**
     * VisionPortal 的統計列（解析度 / FPS / 各 processor 每幀耗時）。
     *
     * 刻意不進 DashParams 白名單：它只在 TagCam.start() 建 portal 那一次被讀，
     * 線上調了也不會生效（反而讓人以為改得動），要關就改這裡重 Build。
     * true 時 /dash/snapshot.jpg 與 /dash/stream.mjpg 的畫面會帶著這列數字
     * —— 要拿乾淨畫面去標定鏡頭時把它改 false。
     */
    public static volatile boolean CAM_STATS_OVERLAY = true;

    // 瞄準輔助（按住 L1 才作用，永不代按扳機）
    public static volatile double AIM_KP  = 0.01;
    public static volatile double AIM_MAX = 0.3;

    // MJPEG 串流
    public static volatile double MJPEG_FPS = 10;
    public static volatile double MJPEG_Q   = 40;
}

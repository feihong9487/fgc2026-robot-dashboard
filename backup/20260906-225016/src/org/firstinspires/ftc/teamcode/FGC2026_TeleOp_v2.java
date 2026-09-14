package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * Z-FALLBACK-v2 —— 比賽出事時的救命備援。
 *
 * 控制邏輯是原始 v2，一個字都沒動（不吃儀表板、不吃相機、不吃 DashBoot，
 * 就算整套橋接器爛掉這一支照樣能開車）。相對 v2 只改了兩件事：
 *   1. @TeleOp 的 name / group 改成 Z-FALLBACK-v2 / Z（排到選單最後面）。
 *   2. telemetry 改成純 ASCII —— Driver Hub 對全形符號（✕ □ · —）的字型支援
 *      不保證，最糟是備援 OpMode 一跑就滿螢幕豆腐字，讓現場更慌。
 *
 * 注意：以前這裡 import 了 com.qualcomm.robotcore.robot.RobotState（機器人連線
 * 狀態列舉），同時又宣告了同名的巢狀 enum RobotState。能編過是靠 JLS 6.4.1 的
 * 遮蔽規則，但只要有人把那個 enum 搬出去變成 top-level，整個檔案就會靜默改成
 * 指向 SDK 那個完全不相干的型別。那個 import 從頭到尾沒用到，已刪除。
 */
@TeleOp(name = "Z-FALLBACK-v2", group = "Z")
public class FGC2026_TeleOp_v2 extends LinearOpMode {

    private DriveSystem drive;
    private ShooterSystem shooter;
    private IntakeSystem intake;
    private ClimbSystem climb;
    private HopperSystem hopper;

    public enum RobotState {
        COLLECT, SHOOT, EJECT
    }

    @Override
    public void runOpMode() {
        drive   = new DriveSystem(hardwareMap);
        shooter = new ShooterSystem(hardwareMap);
        intake  = new IntakeSystem(hardwareMap);
        climb   = new ClimbSystem(hardwareMap);
        hopper  = new HopperSystem(hardwareMap);

        telemetry.addLine("FALLBACK v2 - R2 shoot / L2 collect / X eject");
        telemetry.addLine("DPad Up-Down climb, R1 open / L1 close hopper, Square flip front");
        telemetry.update();
        waitForStart();
        
        RobotState state = RobotState.COLLECT;
        RobotState prevState = RobotState.COLLECT;   // 退球前的模式（放開 ✕ 要回去的地方）
        // 車頭切換（□）。reversed=true 表示「吸取端為前」，開局預設就是它。
        // ※ 若開局推桿前進發現是射手端在前，把這裡的 true 改 false 即可
        boolean reversed = true, prevSquare = false;

        while (opModeIsActive()) {
            // ── □ 按一下切換車頭前後（邊緣偵測，按住不會連跳）──
            if (gamepad1.square && !prevSquare) reversed = !reversed;
            prevSquare = gamepad1.square;

            double forward = DriveSystem.shape(-gamepad1.left_stick_y);
            double turn    = DriveSystem.shape(gamepad1.right_stick_x) * Constants.TURN_SCALE;
            if (reversed) forward = -forward;   // 只反前後；轉向維持「新車頭往右」的手感
            drive.arcadeDrive(forward, turn);

            if (gamepad1.cross) {
                if (state != RobotState.EJECT) prevState = state;  // 進入退球時記住原模式
                state = RobotState.EJECT;                          // ✕ 按住 → 退球
            } else if (state == RobotState.EJECT) {
                state = prevState;                                 // ✕ 放開 → 回到退球前的模式
            } else if (gamepad1.right_trigger > 0.5) {
                state = RobotState.SHOOT;
            } else if (gamepad1.left_trigger > 0.5) {
                state = RobotState.COLLECT;
            }

            switch (state) {
                case EJECT:
                    shooter.eject();
                    intake.stop();      // 退球時 intake 不動
                    break;
                case SHOOT:
                    shooter.shoot();
                    intake.shoot();
                    break;
                case COLLECT:
                default:
                    shooter.collect();
                    intake.collect();
                    break;
            }

            // ── 爬升：按住上=往上爬、按住下=往下降、放開=原地保持（獨立於狀態機）──
            if (gamepad1.dpad_up)        climb.climbUp();
            else if (gamepad1.dpad_down) climb.climbDown();
            else                         climb.hold();

            // ── 球倉：按住才轉，放開即停（獨立於狀態機）──
            if (gamepad1.right_bumper)     hopper.open();
            else if (gamepad1.left_bumper) hopper.close();
            else                           hopper.stop();

            telemetry.addData("SL", "%.0f", shooter.getVelocityL());
            telemetry.addData("SR", "%.0f", shooter.getVelocityR());
            telemetry.addData("way", "%.0f", shooter.getWayVelocity());
            telemetry.addData("climb", "%.0f", (double) climb.getPosition());
            telemetry.addData("state", state);
            telemetry.addData("front", reversed ? "INTAKE" : "SHOOTER");
            telemetry.update();
        }
    }
}
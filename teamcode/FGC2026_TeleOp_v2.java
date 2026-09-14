package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.robot.RobotState;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

@TeleOp(name = "FGC2026_TeleOp_v2")
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

        telemetry.addLine("機器就緒 — R2 鎖定射擊 · L2 解除 · ✕ 退球 · 十字鍵上/下 按住爬升 · R1 開倉 / L1 關倉 · □ 反轉車頭");
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
            telemetry.addData("爬升Encoder", "%.0f", (double) climb.getPosition());
            telemetry.addData("射球狀態", state);
            telemetry.addData("車頭", reversed ? "吸取端為前" : "射手端為前");
            telemetry.update();
        }
    }
}
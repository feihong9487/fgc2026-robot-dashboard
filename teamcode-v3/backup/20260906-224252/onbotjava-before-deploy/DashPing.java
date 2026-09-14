package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * Day-1 煙霧測試：不碰任何硬體，只證明
 *   8080 /dash/health、/dash/state.json
 *   8081 namespace "dash" 的 hello / nt
 * 全部活著。
 *
 * 這支刻意不呼叫 waitForStart()，所以按 INIT 就開始跳數字。
 */
@TeleOp(name = "Z-DASH-PING", group = "Z")
public class DashPing extends LinearOpMode {

    @Override
    public void runOpMode() {
        DashBoot.ensure("ping");
        DashHub.setMode(DashHub.MODE_PIT);      // 測試用，開全部功能

        long t0 = System.currentTimeMillis();
        long next = t0;
        long n = 0;

        while (!isStopRequested()) {
            long now = System.currentTimeMillis();
            if (now >= next) {
                next = now + 1000L;
                n++;
                DashHub.put("/FGC/Probe/Counter", (double) n);
                DashHub.put("/FGC/Probe/Uptime s", (now - t0) / 1000.0);
                DashHub.put("/FGC/Status/OpMode", "Z-DASH-PING");
            }

            telemetry.addLine("DASH PING");
            telemetry.addData("counter", n);
            telemetry.addData("build", DashHub.buildTag());
            telemetry.addData("gen", DashHub.gen().get());
            telemetry.addData("threads", DashHub.threads().get());
            telemetry.addData("viewers", DashHub.sockets().size());
            telemetry.addData("mode", DashHub.mode());
            telemetry.addData("enabled", DashHub.enabled() ? "1" : "0");
            telemetry.addData("rec", DashRec.currentName());
            telemetry.addLine("http://192.168.43.1:8080/dash/health");
            telemetry.update();

            sleep(50);
        }

        DashHub.setMode(DashHub.MODE_MATCH);
    }
}

package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 打開橋接器總開關（規則 5：執行期旗標，不是 static final）。 */
@TeleOp(name = "Z-DASH-ON", group = "Z")
public class DashOn extends LinearOpMode {

    @Override
    public void runOpMode() {
        DashHub.setEnabled(true);
        telemetry.addLine("DASH ENABLED");
        telemetry.addData("enabled", System.getProperty(DashHub.PROP_ENABLED));
        telemetry.addData("build", DashHub.buildTag());
        telemetry.update();
    }
}

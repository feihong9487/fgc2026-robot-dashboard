package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/** 關掉橋接器總開關；薄殼會立刻開始回 404、不再處理 WebSocket。 */
@TeleOp(name = "Z-DASH-OFF", group = "Z")
public class DashOff extends LinearOpMode {

    @Override
    public void runOpMode() {
        DashHub.setEnabled(false);
        telemetry.addLine("DASH DISABLED");
        telemetry.addData("enabled", System.getProperty(DashHub.PROP_ENABLED));
        telemetry.addData("build", DashHub.buildTag());
        telemetry.update();
    }
}

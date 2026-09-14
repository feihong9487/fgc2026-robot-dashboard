package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * red_drive —— 紅方比賽用：和 A1-MATCH 一模一樣，只多開相機、瞄準只認 tag 101。
 *
 *   pitMode()   = false → 仍是比賽封鎖（不推播、不接受 set、MJPEG 503）。
 *   useCamera() = true  → 開 AprilTag 相機（loop 約多 5 ms）。
 *   aimTagId()  = 101   → 按住 Circle 時只朝 101 轉；看到 102/103 不動。
 *
 * 場上選這一支或 blue_drive；A1-MATCH 是「不開相機」的備用版。
 */
@TeleOp(name = "A1-red_drive (tag 101)", group = "A")
public class FGC2026_RedDrive extends FGC2026_TeleOp_Match {

    @Override
    protected boolean useCamera() { return true; }

    @Override
    protected int aimTagId() { return 101; }
}

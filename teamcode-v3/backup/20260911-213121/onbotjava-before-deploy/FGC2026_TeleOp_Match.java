package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.VoltageSensor;

import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * A1-MATCH —— 比賽用 TeleOp。
 *
 * 控制邏輯是 FGC2026_TeleOp_v2 的逐行搬移（狀態機、車頭反轉、爬升、球倉都沒動），
 * 只多了三件不影響手感的事：
 *   1. Lynx bulk caching = MANUAL，每圈開頭 clearBulkCache()。
 *   2. 儀表板埋點（DashHub.put，全部是記憶體寫入，不做 I/O）。
 *   3. 按住 L1 且真的看得到 AprilTag 時，轉向疊一個上限 AIM_MAX 的修正量。
 *      放開 L1 就完全回手動；輔助永遠不碰前進、不代按扳機。
 *   4. "open" 伺服（2026-09-11）：INIT 就 hopper.stow()（0°），主迴圈每圈
 *      hopper.deploy()（120°）——主迴圈只在 PLAY 之後跑，所以「按下 PLAY 才放下」；
 *      INIT 按 STOP 不會放下。Z-FALLBACK-v2 也加了同樣兩行。
 *
 * MATCH / PIT 的差別只有兩個 boolean（見 pitMode() / useCamera()），
 * FGC2026_TeleOp_Pit 就是把它們覆寫成 true 而已。
 *
 * telemetry 與 OpMode 名稱一律 ASCII（Driver Hub 字型安全）；註解才用中文。
 */
@TeleOp(name = "A1-MATCH", group = "A")
public class FGC2026_TeleOp_Match extends LinearOpMode {

    public enum RobotState {
        COLLECT, SHOOT, EJECT
    }

    // ── 子類覆寫點（Pit 只翻這兩個）──────────────────────────────────────
    /** true = 開儀表板全部功能（推播、state.json、MJPEG、線上調參）。 */
    protected boolean pitMode()   { return false; }
    /**
     * true = 啟動 AprilTag 相機。
     *
     * ★ A1-MATCH 預設 false ★ 所以比賽模式下 TagCam 不啟動、tagOk 恆為 false、
     * 瞄準輔助不作用（只有 B1-PIT 練習時看得到）。這是任務書指定的預設值：
     * 相機會吃 USB 頻寬與迴圈時間，而且開機失敗的模式比不開多。
     *
     * 要在場上用瞄準輔助的話，只改這一個回傳值就好：
     *     protected boolean useCamera() { return true; }
     * pitMode() 維持 return false —— 相機開、資料照樣不外送
     * （TagCam.applyStreamServer() 看 pit 決定要不要餵 CameraStreamServer，
     * DashMjpeg.Stream / Snapshot 各自檢查 pit()，所以不會破壞 MATCH 封鎖）。
     * 改之前務必先照 AimAssist.BEARING_TO_TURN_SIGN 那段實測轉向符號。
     */
    protected boolean useCamera() { return false; }
    /**
     * 瞄準輔助只認這一個 AprilTag id；-1 = 任何 tag（取 margin 最大者）。
     * blue_drive 回 103、red_drive 回 101（場地：101 在 x=-975、103 在 x=+975，
     * 都在 y=+2790 的那道牆上）。看得到別的 tag 時 Circle 不會轉車。
     */
    protected int aimTagId() { return -1; }

    /** /dash/health 上看得到的建置標籤；不需要子類覆寫。 */
    protected String buildTag() { return pitMode() ? "pit" : "match"; }

    // ── 子系統 ───────────────────────────────────────────────────────────
    private DriveSystem   drive;
    private ShooterSystem shooter;
    private IntakeSystem  intake;
    private ClimbSystem   climb;
    private HopperSystem  hopper;

    // ── 慢速感測器（每圈只讀一項，10 圈輪完）────────────────────────────
    private List<LynxModule> hubs;
    private VoltageSensor    battery;
    private int     slot      = 0;
    private double  batteryV  = 0.0;
    private double  curL      = 0.0, curR = 0.0, curWay = 0.0, curClimb = 0.0;
    private boolean ocL, ocR, ocWay, ocClimb;

    // ── spinup 計時（進 SHOOT 到雙輪達速的毫秒數）────────────────────────
    private long    shootEnterMs  = 0L;
    private double  spinupMs      = 0.0;
    private boolean spinupLatched = false;

    // ── AprilTag（TagCam 是實例類別；它自己絕不進共享 map）────────────────
    private TagCam  tagCam     = null;
    private double  tagRange   = Double.NaN;
    private double  tagBearing = Double.NaN;
    private int     tagId      = -1;
    private boolean tagOk      = false;
    private boolean camStarted = false;

    /** Best/Age 超過這個秒數就當作沒看到，避免拿舊資料瞄準。 */
    private static final double TAG_MAX_AGE_S = 0.40;

    // ── Loop 時間統計（最近 200 圈的環形緩衝）─────────────────────────────
    // 每圈的 Loop ms 本來就有埋點，但單看那個數字只會看到「最後一圈」——
    // 偶發的 80 ms 尖峰在儀表板上一閃就沒了。p95 / Max 才看得出「卡不卡」。
    // 排序 200 個 double 每秒只做 2-3 次（每 20 圈一次），不是每圈都排。
    private static final int LOOP_WIN   = 200;
    private static final int LOOP_EVERY = 20;
    private final double[] loopRing = new double[LOOP_WIN];
    private final double[] loopSort = new double[LOOP_WIN];   // 排序用副本，避免每次配置
    private int loopIdx   = 0;      // 下一個要寫的位置
    private int loopCount = 0;      // 目前有效筆數（封頂 LOOP_WIN）
    private int loopSince = 0;      // 距離上次發布過了幾圈

    // ── notify 觸發條件與節流 ─────────────────────────────────────────────
    /** SL / SR 偏離目標超過這個比例就算「掉速」。 */
    private static final double SHOOT_OFF_PCT     = 0.10;
    /** 要連續偏離這麼久才報（避免送球那一下的瞬間掉速一直跳提示）。 */
    private static final long   SHOOT_OFF_HOLD_MS = 500L;
    private static final long   SHOOT_NOTIFY_MS   = 5000L;
    private static final double BATT_LOW_V        = 11.5;
    private static final long   BATT_NOTIFY_MS    = 30000L;
    private long shootOffSinceMs   = 0L;   // 0 = 目前沒在偏離
    private long lastShootNotifyMs = 0L;
    private long lastBattNotifyMs  = 0L;

    @Override
    public void runOpMode() {
        // ════════ INIT ════════════════════════════════════════════════════
        // 順序很重要：DashListener.onOpModePreInit 會先把模式強制壓回 MATCH，
        // 所以 setMode 一定要在 ensure() 之後、在這裡做。
        DashBoot.ensure(buildTag());
        DashHub.setMode(pitMode() ? DashHub.MODE_PIT : DashHub.MODE_MATCH);
        DashHub.put("/FGC/Bridge/Mode", DashHub.mode());
        DashHub.put("/FGC/Status/OpMode", pitMode() ? "B1-PIT" : "A1-MATCH");

        // Lynx bulk caching：MANUAL + 每圈 clearBulkCache()，
        // 這樣一圈之內同一顆 encoder 讀幾次都只有一次匯流排往返。
        hubs = hardwareMap.getAll(LynxModule.class);
        for (int i = 0; i < hubs.size(); i++) {
            try { hubs.get(i).setBulkCachingMode(LynxModule.BulkCachingMode.MANUAL); }
            catch (Throwable t) { DashHub.lastError("bulk mode: " + t); }
        }
        DashHub.put("/FGC/Status/Hubs", (double) hubs.size());

        battery = null;
        for (VoltageSensor vs : hardwareMap.voltageSensor) { battery = vs; break; }

        drive   = new DriveSystem(hardwareMap);
        shooter = new ShooterSystem(hardwareMap);
        intake  = new IntakeSystem(hardwareMap);
        climb   = new ClimbSystem(hardwareMap);
        hopper  = new HopperSystem(hardwareMap);
        // "open" 伺服：INIT 就收到 OPEN_STOW_DEG（0°），把球倉扣在起始體積內（R04）。
        // 放下（OPEN_DEPLOY_DEG）只在主迴圈裡做，主迴圈只在 PLAY 之後跑（M09：go 之前不能動）。
        hopper.stow();
        if (!hopper.hasOpenServo()) DashHub.lastError("open servo missing: check robot config (Servo \"open\")");

        // 相機整段包起來：沒有 "Webcam 1"、USB 沒插、jar 沒上傳都不能讓 OpMode 掛掉。
        // TagCam.start() 自己也吃掉所有例外並回 false，這裡是第二層保險。
        if (useCamera()) {
            try {
                tagCam = new TagCam();
                tagCam.setPreferredId(aimTagId());
                camStarted = tagCam.start(hardwareMap, pitMode());
            } catch (Throwable t) {
                DashHub.lastError("tagcam start: " + t);
                camStarted = false;
            }
        } else {
            DashHub.put("/FGC/Vision/CamState", "OFF");
        }

        telemetry.addLine(pitMode() ? ">>> PIT MODE <<<" : ">>> MATCH MODE <<<");
        telemetry.addLine("R2 shoot / L2 collect / X eject");
        telemetry.addLine("DPad Up-Down climb, R1 open / L1 close hopper, Square flip front");
        telemetry.addLine(hopperInitLine());
        telemetry.addLine(aimTagId() >= 0
                    ? "Circle = aim assist (turn only, needs tag " + aimTagId() + ")"
                    : "Circle = aim assist (turn only, needs a tag)");
        if (pitMode()) telemetry.addLine("http://192.168.43.1:8080/dash/health");
        telemetry.addData("build", DashHub.buildTag());
        telemetry.addData("gen", DashHub.gen().get());
        telemetry.update();

        // ════════ INIT 等待迴圈 ═════════════════════════════
        // waitForStart() 只是睡到按下 PLAY 為止，中間什麼都不跑 —— 所以以前
        // tagCam.update() 要等主迴圈才第一次被呼叫，/FGC/Vision/CamState 會一路
        // 停在 start() 寫的 "STARTING"，PIT 在 INIT 期間看不到任何視覺讀數，
        // 也分不出「相機還在開」跟「相機開不起來」。
        //
        // 這個迴圈把「相機更新 + 埋點 + telemetry」提前到 INIT 就開始跑。
        // 裡面絕對不碰任何馬達、伺服、狀態機：只有 tagCam.update()、電池電壓
        // 讀取、DashHub.put() 與 telemetry。
        //
        // 按 STOP：isStopRequested() 轉 true -> 迴圈結束 -> waitForStart() 自己也
        // 檢查 stop 所以立刻返回 -> 下面 try 裡的 opModeIsActive() 是 false、主迴圈
        // 一圈都不跑 -> 照樣進 finally 把相機關掉、錄影 flush。收尾路徑沒有變。
        while (!isStarted() && !isStopRequested()) {
            if (tagCam != null) {
                try { tagCam.update(); }
                catch (Throwable t) { DashHub.lastError("init tagcam: " + t); }
            }

            try {
                if (battery != null) batteryV = battery.getVoltage();
                DashHub.put("/FGC/Bridge/Mode",      DashHub.mode());
                DashHub.put("/FGC/Status/OpMode",    pitMode() ? "B1-PIT" : "A1-MATCH");
                DashHub.put("/FGC/Status/Phase",     "INIT");
                DashHub.put("/FGC/Status/Battery V", batteryV);
                DashHub.put("/FGC/Hopper/Deploy",    hopper.deployState());
                DashHub.put("/FGC/Hopper/OpenDeg",   hopper.openDeg());
            } catch (Throwable t) {
                DashHub.lastError("init publish: " + t);
            }

            telemetry.addLine(pitMode() ? ">>> PIT MODE <<<" : ">>> MATCH MODE <<<");
            telemetry.addLine("INIT - press PLAY to start");
            telemetry.addLine("R2 shoot / L2 collect / X eject");
            telemetry.addLine("DPad Up-Down climb, R1 open / L1 close hopper, Square flip front");
            telemetry.addLine(hopperInitLine());
            telemetry.addLine(aimTagId() >= 0
                    ? "Circle = aim assist (turn only, needs tag " + aimTagId() + ")"
                    : "Circle = aim assist (turn only, needs a tag)");
            if (pitMode()) telemetry.addLine("http://192.168.43.1:8080/dash/health");
            telemetry.addData("batt", "%.1f V", batteryV);
            if (useCamera()) {
                telemetry.addData("cam", "%s  fps %.1f", camStateStr(), camFps());
                if (tagCam != null && tagCam.hasTag()) {
                    telemetry.addData("TAG", "id %d  range %.2f m  bearing %.1f deg",
                            tagCam.getBestId(), tagCam.getBestRangeM(), tagCam.getBestBearingDeg());
                } else {
                    telemetry.addLine("TAG: none");
                }
            }
            telemetry.addData("build", DashHub.buildTag());
            telemetry.addData("gen", DashHub.gen().get());
            telemetry.update();

            sleep(50);
        }

        // 在 INIT 就按 STOP 的話 isStarted() 是 false，這裡不能誤報成 RUN。
        // （下面的 finally 另外會把 /FGC/Status/OpMode 寫成 STOPPED。）
        DashHub.put("/FGC/Status/Phase", isStarted() ? "RUN" : "STOPPED");

        waitForStart();

        RobotState state     = RobotState.COLLECT;
        RobotState prevState = RobotState.COLLECT;   // 退球前的模式（放開 X 要回去的地方）
        // 車頭切換（Square）。reversed=true 表示「吸取端為前」，開局預設就是它。
        boolean reversed = true, prevSquare = false;

        long lastLoop = System.currentTimeMillis();

        // ════════ 主迴圈 ═══════════════════════════════════════════════════
        // 整段包 try/finally：迴圈裡任何未捕捉例外（USB 掉線時 setPower 會丟
        // RuntimeException、Lynx 通訊失效時 hardwareMap 物件也會丟）都不能跳過
        // 收尾 —— 跳過的代價是相機不關（Driver Hub 的 CameraStreamServer 還握著
        // VisionPortal、USB 被占住，只能 Restart Robot）與最後最多 10 秒的錄影沒
        // flush 掉。DashListener.onOpModePostStop 是第二層保險，這裡是第一層。
        try {
            while (opModeIsActive()) {
                long now = System.currentTimeMillis();
                double loopMs = (double) (now - lastLoop);
                lastLoop = now;

                // 每圈第一件事：清 bulk cache，這圈之後的 encoder 讀取才是新鮮的。
                for (int i = 0; i < hubs.size(); i++) {
                    try { hubs.get(i).clearBulkCache(); } catch (Throwable ignored) {}
                }

                // ── 視覺（整段 try/catch，相機爆炸不能影響開車）──
                readTag();

                // ══════ 以下控制邏輯與 FGC2026_TeleOp_v2 完全相同 ══════════════

                // ── Square 按一下切換車頭前後（邊緣偵測，按住不會連跳）──
                if (gamepad1.square && !prevSquare) reversed = !reversed;
                prevSquare = gamepad1.square;

                double forward = DriveSystem.shape(-gamepad1.left_stick_y);
                double turn    = DriveSystem.shape(gamepad1.right_stick_x) * Constants.TURN_SCALE;
                if (reversed) forward = -forward;   // 只反前後；轉向維持「新車頭往右」的手感

                // ── 瞄準輔助：按住 Circle 且真的有 tag 才作用 ──
                // 只疊在 turn 上；放開 Circle 這一段完全不執行 → 立刻回純手動。
                //
                // 為什麼是 Circle 不是 L1：L1 在 v2 就是「關球倉」，兩個功能綁同
                // 一顆鍵的話，想瞄準時球倉會自己關、想關倉時車子會自己轉。Circle
                // 在 v2 與這一支都沒有用到，右手拇指按得到，也不會跟 Cross（退球）
                // 打架。
                boolean aiming   = gamepad1.circle && tagOk;
                double  aimDelta = 0.0;
                if (aiming) {
                    aimDelta = AimAssist.turnDelta(tagBearing, Constants.AIM_KP, Constants.AIM_MAX);
                    turn = AimAssist.clamp(turn + aimDelta, -1.0, 1.0);
                }

                drive.arcadeDrive(forward, turn);

                if (gamepad1.cross) {
                    if (state != RobotState.EJECT) prevState = state;  // 進入退球時記住原模式
                    state = RobotState.EJECT;                          // X 按住 → 退球
                } else if (state == RobotState.EJECT) {
                    state = prevState;                                 // X 放開 → 回到退球前的模式
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
                String hopperCmd;
                if (gamepad1.right_bumper)     { hopper.open();  hopperCmd = "OPEN";  }
                else if (gamepad1.left_bumper) { hopper.close(); hopperCmd = "CLOSE"; }
                else                           { hopper.stop();  hopperCmd = "STOP";  }

                // ── 球倉放下：PLAY 後每圈都要求 open 在 OPEN_DEPLOY_DEG（角度沒變不重送指令；
                //    PIT 線上調 OPEN_DEPLOY_DEG 時下一圈就重套）。INIT 期間是 stow()，這裡才是放下。──
                hopper.deploy();

                // ══════ 控制邏輯到此結束；以下全部是唯讀的埋點與畫面 ═════════════

                // bulk cache 內的 encoder 速度：這一圈第一次讀會觸發一次匯流排往返，
                // 之後（telemetry）都是快取，所以只讀一次存起來。
                double sl  = shooter.getVelocityL();
                double sr  = shooter.getVelocityR();
                double way = shooter.getWayVelocity();
                boolean atSpeed = sl > Constants.FEED_THRESHOLD && sr > Constants.FEED_THRESHOLD;

                // spinup 計時：進 SHOOT 開始算，第一次達速就凍結；
                // 離開 SHOOT 保留上一次的值（= 上一次達速耗時，除錯時比 0 有用），
                // 下次進 SHOOT 再重算。
                if (state == RobotState.SHOOT) {
                    if (shootEnterMs == 0L) { shootEnterMs = now; spinupLatched = false; }
                    if (!spinupLatched) {
                        spinupMs = (double) (now - shootEnterMs);
                        if (atSpeed) spinupLatched = true;
                    }
                } else {
                    shootEnterMs  = 0L;
                    spinupLatched = false;
                }

                slowSensors();
                loopStats(loopMs);
                notifyChecks(state, atSpeed, sl, sr, now);

                publish(forward, turn, reversed, state, hopperCmd,
                        sl, sr, way, atSpeed, loopMs, aiming, aimDelta, now);

                // ── Driver Hub 畫面：第一行就是駕駛唯一要看的東西 ──
                telemetry.addLine(atSpeed ? "READY" : "SPINUP");
                telemetry.addData("state", state);
                telemetry.addData("front", reversed ? "INTAKE" : "SHOOTER");
                telemetry.addData("SL/SR", "%.0f / %.0f", sl, sr);
                telemetry.addData("way", "%.0f", way);
                telemetry.addData("climb", "%d", climb.getPosition());
                telemetry.addData("hopper", hopper.deployState());
                telemetry.addData("batt", "%.1f V", batteryV);
                if (tagOk) {
                    telemetry.addData("TAG", "id %d  range %.2f m  bearing %.1f deg", tagId, tagRange, tagBearing);
                    if (aiming) telemetry.addData("AIM", "%+.3f", aimDelta);
                } else if (useCamera()) {
                    telemetry.addLine("TAG: none");
                }
                telemetry.update();
            }
        } finally {
            if (tagCam != null) {
                try { tagCam.close(); } catch (Throwable t) { DashHub.lastError("tagcam close: " + t); }
            }
            try {
                DashHub.setMode(DashHub.MODE_MATCH);
                DashHub.setCamsrc(null);
                DashHub.put("/FGC/Status/OpMode", "STOPPED");
                DashRec.flush();
            } catch (Throwable ignored) {}
        }
        // 推播執行緒不在這裡停：下一支 OpMode 的 ensure() 會換世代把它收掉，
        // 這樣比賽之間儀表板不會斷線。
    }

    // ── 視覺讀取 ─────────────────────────────────────────────────────────

    /**
     * 從 TagCam 取這一圈的最佳目標。
     *
     * 三道關卡，任何一道沒過就當作「沒看到」（tagOk = false）：
     *   1. TagCam.hasTag()      —— 它自己的兩層過濾（margin + 連續 3 幀）已經通過
     *   2. AimAssist.usable()   —— 數值本身合理（有限、距離為正、角度在視角內）
     *   3. TagCam.getBestAgeS() —— 夠新。TagCam 的 TAG_TTL_MS 是 1.5 秒，
     *                              那對「記住看過什麼」剛好，對「拿來轉車」太舊，
     *                              所以這裡另外用 TAG_MAX_AGE_S 再收緊一次。
     *
     * 第 3 道以前是去讀埋點字串 /FGC/Vision/Best/Age s，而且寫成
     * 「是 Double 而且太舊才 return」—— 那是 fail-open：key 改名、那一圈的
     * publish 丟例外被吞掉，檢查就被靜默跳過，機器會拿 1.5 秒前的 tag 去轉車。
     * 安全檢查失敗時要保守拒絕，所以現在直接問資料來源，而且無法取得就當沒看到。
     */
    private void readTag() {
        tagRange   = Double.NaN;
        tagBearing = Double.NaN;
        tagId      = -1;
        tagOk      = false;
        if (!camStarted || tagCam == null) return;
        try {
            // 模式可能被 Z-DASH-ON/OFF 中途改掉；setPit 沒變就直接 return，很便宜。
            tagCam.setPit(DashHub.pit());
            tagCam.update();

            if (!tagCam.hasTag()) return;
            tagRange   = tagCam.getBestRangeM();
            tagBearing = tagCam.getBestBearingDeg();
            tagId      = tagCam.getBestId();
            if (!AimAssist.usable(tagRange, tagBearing)) return;

            if (tagCam.getBestAgeS() > TAG_MAX_AGE_S) return;

            tagOk = true;
        } catch (Throwable t) {
            DashHub.lastError("tagcam: " + t);
            tagOk = false;
        }
    }

    /**
     * INIT telemetry 用的相機狀態字串。
     *
     * 直接讀 TagCam 自己 publish 的埋點（而不是另外開一個 getter），
     * 這樣 telemetry 上看到的與儀表板看到的保證是同一個值；
     * 純顯示用，拿不到就寫 "?"，不影響任何安全檢查。
     */
    private String camStateStr() {
        try {
            Object o = DashHub.get(TagCam.K_STATE);
            if (o != null) return String.valueOf(o);
        } catch (Throwable ignored) {}
        return "?";
    }

    /** INIT 畫面：open 伺服目前角度與 PLAY 後要去的角度；缺硬體就大聲講。純 ASCII。 */
    private String hopperInitLine() {
        if (!hopper.hasOpenServo()) return "!! open servo MISSING - check config";
        return String.format(Locale.US, "hopper: open %.0f deg (stowed), %.0f deg at PLAY",
                hopper.openDeg(), Constants.OPEN_DEPLOY_DEG);
    }

    /** 同上，/FGC/Vision/FPS。 */
    private double camFps() {
        try {
            Object o = DashHub.get(TagCam.K_FPS);
            if (o instanceof Number) return ((Number) o).doubleValue();
        } catch (Throwable ignored) {}
        return 0.0;
    }

    // ── 慢速感測器輪讀 ───────────────────────────────────────────────────

    /**
     * 每圈只做一項，10 圈輪完一輪。
     * getCurrent() 不在 bulk cache 內（是獨立的 Lynx 指令），全部每圈讀會直接吃掉迴圈時間。
     */
    private void slowSensors() {
        try {
            switch (slot) {
                case 0: if (battery != null) batteryV = battery.getVoltage(); break;
                case 1: curL     = shooter.motorL().getCurrent(CurrentUnit.AMPS);   break;
                case 2: curR     = shooter.motorR().getCurrent(CurrentUnit.AMPS);   break;
                case 3: curWay   = shooter.motorWay().getCurrent(CurrentUnit.AMPS); break;
                case 4: curClimb = climb.motor().getCurrent(CurrentUnit.AMPS);      break;
                case 5: ocL      = shooter.motorL().isOverCurrent();   break;
                case 6: ocR      = shooter.motorR().isOverCurrent();   break;
                case 7: ocWay    = shooter.motorWay().isOverCurrent(); break;
                case 8: ocClimb  = climb.motor().isOverCurrent();      break;
                default: break;   // 第 10 圈留白，給迴圈喘一口氣
            }
        } catch (Throwable t) {
            DashHub.lastError("sensor slot " + slot + ": " + t);
        }
        slot++;
        if (slot > 9) slot = 0;
    }

    // ── Loop 時間統計 ────────────────────────────────────────────────────

    /**
     * 收一圈的 loop ms，每 LOOP_EVERY 圈才發布一次 p95 / Max。
     *
     * ring 是從 index 0 往上填的，所以還沒填滿時有效資料剛好是 [0, loopCount)，
     * 直接 arraycopy 前 n 個就好，不用管環繞。
     */
    private void loopStats(double loopMs) {
        try {
            loopRing[loopIdx] = loopMs;
            loopIdx++;
            if (loopIdx >= LOOP_WIN) loopIdx = 0;
            if (loopCount < LOOP_WIN) loopCount++;

            loopSince++;
            if (loopSince < LOOP_EVERY) return;
            loopSince = 0;

            int n = loopCount;
            if (n <= 0) return;
            System.arraycopy(loopRing, 0, loopSort, 0, n);
            Arrays.sort(loopSort, 0, n);

            // p95：nearest-rank，第 ceil(0.95 * n) 名（1-based）
            int rank = (int) Math.ceil(0.95 * (double) n) - 1;
            if (rank < 0)  rank = 0;
            if (rank >= n) rank = n - 1;

            DashHub.put("/FGC/Status/Loop p95", loopSort[rank]);
            DashHub.put("/FGC/Status/Loop Max", loopSort[n - 1]);
        } catch (Throwable t) {
            DashHub.lastError("loop stats: " + t);
        }
    }

    // ── notify 觸發 ──────────────────────────────────────────────────────

    /**
     * 兩個現場真的需要有人喊一聲的狀況：
     *   1. 射手在 SHOOT 且已經達速，但 SL 或 SR 偏離目標超過 10% 連續 0.5 秒
     *      → WARN，最多每 5 秒一次。
     *   2. 電池低於 11.5 V → ERROR，最多每 30 秒一次。
     *
     * 節流是必須的：DashNotify.send() 會在這條控制執行緒上序列化並送 socket。
     * 只有 PIT 而且有人在看時才會真的送出去（MATCH 只留 Last Notify 埋點）。
     */
    private void notifyChecks(RobotState state, boolean atSpeed, double sl, double sr, long now) {
        try {
            boolean off = (state == RobotState.SHOOT) && atSpeed
                    && (offTarget(sl, Constants.VEL_SL) || offTarget(sr, Constants.VEL_SR));
            if (!off) {
                shootOffSinceMs = 0L;
            } else {
                if (shootOffSinceMs == 0L) shootOffSinceMs = now;
                if (now - shootOffSinceMs >= SHOOT_OFF_HOLD_MS
                        && (lastShootNotifyMs == 0L || now - lastShootNotifyMs >= SHOOT_NOTIFY_MS)) {
                    lastShootNotifyMs = now;
                    DashNotify.send("WARN", "Shooter off target",
                            String.format(Locale.US, "SL %.0f/%.0f SR %.0f/%.0f",
                                    sl, Constants.VEL_SL, sr, Constants.VEL_SR),
                            (int) SHOOT_NOTIFY_MS);
                }
            }

            // batteryV 是輪讀的，第一輪跑完之前是 0.0 —— 那不是「電池沒電」。
            if (batteryV > 0.0 && batteryV < BATT_LOW_V
                    && (lastBattNotifyMs == 0L || now - lastBattNotifyMs >= BATT_NOTIFY_MS)) {
                lastBattNotifyMs = now;
                DashNotify.send("ERROR", "Battery low",
                        String.format(Locale.US, "%.1f V (limit %.1f V)",
                                batteryV, BATT_LOW_V),
                        10000);
            }
        } catch (Throwable t) {
            DashHub.lastError("notify check: " + t);
        }
    }

    /** 偏離目標超過 SHOOT_OFF_PCT；目標為 0（例如 IDLE_TPS 型的設定）時不判定。 */
    private static boolean offTarget(double actual, double target) {
        if (target <= 0.0) return false;
        return Math.abs(actual - target) > SHOOT_OFF_PCT * target;
    }

    // ── 埋點 ─────────────────────────────────────────────────────────────

    private void publish(double forward, double turn, boolean reversed, RobotState state,
                         String hopperCmd, double sl, double sr, double way, boolean atSpeed,
                         double loopMs, boolean aiming, double aimDelta, long now) {
        try {
            DashHub.put("/FGC/Drive/Forward",  forward);
            DashHub.put("/FGC/Drive/Turn",     turn);
            DashHub.put("/FGC/Drive/Reversed", reversed);
            DashHub.put("/FGC/Drive/State",    state.name());

            DashHub.put("/FGC/Shooter/SL",       sl);
            DashHub.put("/FGC/Shooter/SR",       sr);
            DashHub.put("/FGC/Shooter/Way",      way);
            DashHub.put("/FGC/Shooter/TargetL",  Constants.VEL_SL);
            DashHub.put("/FGC/Shooter/TargetR",  Constants.VEL_SR);
            DashHub.put("/FGC/Shooter/AtSpeed",  atSpeed);
            DashHub.put("/FGC/Shooter/SpinupMs", spinupMs);
            DashHub.put("/FGC/Shooter/CurrentL", curL);
            DashHub.put("/FGC/Shooter/CurrentR", curR);
            DashHub.put("/FGC/Shooter/CurrentWay",     curWay);
            DashHub.put("/FGC/Shooter/OverCurrentL",   ocL);
            DashHub.put("/FGC/Shooter/OverCurrentR",   ocR);
            DashHub.put("/FGC/Shooter/OverCurrentWay", ocWay);

            DashHub.put("/FGC/Climb/Pos",         (double) climb.getPosition());
            DashHub.put("/FGC/Climb/Holding",     climb.isHolding());
            DashHub.put("/FGC/Climb/Current",     curClimb);
            DashHub.put("/FGC/Climb/OverCurrent", ocClimb);

            DashHub.put("/FGC/Hopper/Cmd", hopperCmd);
            DashHub.put("/FGC/Hopper/Deploy",  hopper.deployState());
            DashHub.put("/FGC/Hopper/OpenDeg", hopper.openDeg());

            DashHub.put("/FGC/Gamepad/LY",     (double) -gamepad1.left_stick_y);
            DashHub.put("/FGC/Gamepad/RX",     (double)  gamepad1.right_stick_x);
            DashHub.put("/FGC/Gamepad/LT",     (double)  gamepad1.left_trigger);
            DashHub.put("/FGC/Gamepad/RT",     (double)  gamepad1.right_trigger);
            DashHub.put("/FGC/Gamepad/Cross",  gamepad1.cross);
            DashHub.put("/FGC/Gamepad/Square", gamepad1.square);
            DashHub.put("/FGC/Gamepad/L1",     gamepad1.left_bumper);
            DashHub.put("/FGC/Gamepad/Circle", gamepad1.circle);
            DashHub.put("/FGC/Gamepad/R1",     gamepad1.right_bumper);
            DashHub.put("/FGC/Gamepad/DUp",    gamepad1.dpad_up);
            DashHub.put("/FGC/Gamepad/DDown",  gamepad1.dpad_down);

            DashHub.put("/FGC/Status/Battery V", batteryV);
            DashHub.put("/FGC/Status/Loop ms",   loopMs);
            DashHub.put("/FGC/Status/OpMode",    pitMode() ? "B1-PIT" : "A1-MATCH");
            DashHub.put("/FGC/Status/Match s",   (now - DashHub.t0()) / 1000.0);

            DashHub.put("/FGC/Aim/Active", aiming);
            DashHub.put("/FGC/Aim/Delta",  aimDelta);

            DashHub.put("/FGC/Bridge/Mode", DashHub.mode());
        } catch (Throwable t) {
            DashHub.lastError("publish opmode: " + t);
        }
    }
}

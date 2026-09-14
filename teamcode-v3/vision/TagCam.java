package org.firstinspires.ftc.teamcode;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.qualcomm.robotcore.hardware.HardwareMap;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.external.matrices.VectorF;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.stream.CameraStreamServer;
import org.firstinspires.ftc.robotcore.external.stream.CameraStreamSource;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagLibrary;
import org.firstinspires.ftc.vision.apriltag.AprilTagPoseFtc;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

/**
 * TagCam：AprilTag 視覺 + 相機來源。實例類別。
 *
 * 用法（OpMode）：
 *   init  : tagCam = new TagCam(); tagCam.start(hardwareMap, pitMode());
 *   每圈  : tagCam.update();
 *   結束  : tagCam.close();
 *
 * 設計重點
 *  1. 整個 start() 包 try/catch —— 相機沒插、名字打錯、被別的 OpMode 佔住，
 *     都只寫 /FGC/Bridge/Last Error 並回 false，絕不讓 OpMode 掛掉。
 *  2. VisionPortal 本身就是 CameraStreamSource（SDK 型別），放進共享 map 給
 *     DashMjpeg 用；TagCam 這個 teamcode 類別的實例永遠不進共享 map（規則 1）。
 *  3. PIT 才 CameraStreamServer.setSource(portal)（Driver Hub 看得到畫面）；
 *     MATCH 與 close() 一律 setSource(null)。
 *  4. 過濾兩層：decisionMargin &lt; Constants.TAG_MIN_MARGIN 直接丟；
 *     同一個 id 要「連續 CONFIRM_FRAMES 幀」都看到才採信。
 *  5. 機器上只有一顆 Webcam，同時只能有一個 VisionPortal 佔住它。所以另外用一個
 *     靜態欄位 LIVE 記住「現在開著的那個 portal」，新的 start() 會先把它關掉。
 *     這個欄位隨 ClassLoader 一起死，不是跨 Build 的共享狀態（那種東西才放 DashHub）。
 */
public class TagCam {

    // ── 常數 ─────────────────────────────────────────────────────────────

    /** 同一個 id 連續幾幀才採信。 */
    public static final int CONFIRM_FRAMES = 3;

    /** 超過這個時間沒再看到就不算「現在看得到」（毫秒）。 */
    public static final long TAG_TTL_MS = 1500L;

    /**
     * 超過這個時間沒再看到就把那個 id 的紀錄整個丟掉（毫秒）。
     * tag36h11 在場邊燈光下偶爾會誤判出不在 library 裡的 id，
     * 沒有這道清理的話 lastSeen / lastPose / streak 三張表只增不減，
     * /FGC/Vision/Age/&lt;id&gt; s 也會一路長進 DashHub.latest()。
     */
    public static final long FORGET_MS = 10000L;

    /** FGC 2026 標籤邊長（公尺）。 */
    public static final double TAG_SIZE_M = 0.160;

    /** 相機在 hardwareMap 裡的名字。 */
    public static final String CAM_NAME = "Webcam 1";

    public static final int CAM_W = 640;
    public static final int CAM_H = 480;

    /** 這一版預設不用場地座標（只用相對 range/bearing）。要用再改成 true。 */
    public static volatile boolean USE_FIELD_POSE = false;

    /** 場地上五個標籤的 id（順序與 FIELD_XYZ / FIELD_YAW / TAG_NAMES 一致）。 */
    public static final int[] FIELD_IDS = { 100, 101, 102, 103, 104 };

    public static final String[] TAG_NAMES = {
        "Red Side - Facing Drivers",
        "Red Side - Facing Audience",
        "Center - Facing Audience",
        "Blue Side - Facing Audience",
        "Blue Side - Facing Drivers"
    };

    /**
     * 場地座標（毫米，中心原點；+X 藍方、+Y 場地元件、z 離地毯）。
     * 排列同 FIELD_IDS。
     */
    public static final double[][] FIELD_XYZ = {
        { -1674.0, 3152.0, 791.0 },   // 100
        {  -975.0, 2790.0, 791.0 },   // 101
        {     0.0, 2787.0, 791.0 },   // 102
        {   975.0, 2790.0, 791.0 },   // 103
        {  1674.0, 3152.0, 791.0 }    // 104
    };

    /** 標籤法線的 yaw（度；自 +X 逆時針）。 */
    public static final double[] FIELD_YAW = { 210.0, 270.0, 270.0, 270.0, 330.0 };

    // ── 埋點 key ─────────────────────────────────────────────────────────

    public static final String K_COUNT   = "/FGC/Vision/Count";
    public static final String K_FPS     = "/FGC/Vision/FPS";
    public static final String K_STATE   = "/FGC/Vision/CamState";
    public static final String K_TAGS    = "/FGC/Vision/Tags";
    public static final String K_LIB     = "/FGC/Vision/Library";
    public static final String K_DEC     = "/FGC/Vision/Decimation";
    public static final String K_FRAMES  = "/FGC/Vision/Frames";
    public static final String K_ENABLED = "/FGC/Vision/Enabled";
    public static final String K_B_ID    = "/FGC/Vision/Best/Id";
    public static final String K_B_RANGE = "/FGC/Vision/Best/Range m";
    public static final String K_B_BEAR  = "/FGC/Vision/Best/Bearing deg";
    public static final String K_B_YAW   = "/FGC/Vision/Best/Yaw deg";
    public static final String K_B_MARG  = "/FGC/Vision/Best/Margin";
    public static final String K_B_AGE   = "/FGC/Vision/Best/Age s";

    private static final Gson GSON = new Gson();

    /** 單相機互斥：start / close 都要拿這把鎖。 */
    private static final Object LOCK = new Object();

    /** 目前開著的 portal（同一個 ClassLoader 內最多一個）。 */
    private static volatile VisionPortal LIVE;

    // ── 執行期狀態（實例欄位）────────────────────────────────────────────

    private volatile VisionPortal portal;
    private volatile AprilTagProcessor proc;
    private volatile boolean pit;
    private boolean started;
    private float appliedDec = -1f;
    private long frames;

    /** id -> 連續看到幾幀（沒看到就歸零）。 */
    private final HashMap<Integer, Integer> streak = new HashMap<Integer, Integer>();
    /** id -> 最後一次「被採信」的時間戳。 */
    private final HashMap<Integer, Long> lastSeen = new HashMap<Integer, Long>();
    /** id -> 最後一次被採信的量測 {range m, bearing deg, yaw deg, margin}。 */
    private final HashMap<Integer, double[]> lastPose = new HashMap<Integer, double[]>();

    private volatile double bestRange   = Double.NaN;
    private volatile double bestBearing = Double.NaN;
    private volatile double bestYaw     = Double.NaN;
    private volatile int    bestId      = -1;
    private volatile int    visible;
    /**
     * 只瞄這一個 id（-1 = 不限，取 margin 最大者）。
     * blue_drive 設 103、red_drive 設 101：看得到別的 tag 也不算 hasTag()，
     * 免得瞄準輔助把車轉向錯的目標。
     */
    private volatile int    preferredId = -1;

    /** 指定要瞄的 tag id；-1 = 任何 tag。任何時候都能改，下一幀生效。 */
    public void setPreferredId(int id) { preferredId = id; }
    public int  getPreferredId()       { return preferredId; }

    // ── 生命週期 ─────────────────────────────────────────────────────────

    /**
     * 開相機。失敗不丟例外，只回 false 並寫 /FGC/Bridge/Last Error。
     *
     * @param hw      OpMode 的 hardwareMap
     * @param pitMode true = PIT（會把畫面丟給 Driver Hub 與 MJPEG）
     */
    public boolean start(HardwareMap hw, boolean pitMode) {
        synchronized (LOCK) {
            this.pit = pitMode;
            if (started) {                       // 重複呼叫：只重套畫面來源
                applyStreamServer();
                return portal != null;
            }
            started = true;
            try {
                // 上一支 OpMode 沒關乾淨的話，先把舊 portal 收掉，
                // 不然兩個 portal 會搶同一支 USB 相機，兩個都開不起來。
                closeLive();

                AprilTagLibrary lib = tagLibrary();

                AprilTagProcessor.Builder pb = new AprilTagProcessor.Builder();
                if (lib != null) pb.setTagLibrary(lib);
                pb.setOutputUnits(DistanceUnit.METER, AngleUnit.DEGREES);
                pb.setDrawTagOutline(true);
                pb.setDrawTagID(true);
                pb.setNumThreads(2);
                // 刻意不呼叫 setLensIntrinsics：讓 SDK 用它內建的鏡頭標定值
                proc = pb.build();

                WebcamName cam = hw.get(WebcamName.class, CAM_NAME);

                VisionPortal.Builder vb = new VisionPortal.Builder();
                vb.setCamera(cam);
                vb.setCameraResolution(new android.util.Size(CAM_W, CAM_H));
                vb.setStreamFormat(VisionPortal.StreamFormat.MJPEG);
                vb.enableLiveView(false);
                // Driver Hub 螢幕不畫 LiveView，但 CameraStreamServer / MJPEG 拿到的
                // 還是 LiveView 那條 pipeline 的輸出，所以這一行對得到的影像有效。
                vb.setShowStatsOverlay(Constants.CAM_STATS_OVERLAY);
                vb.addProcessor(proc);
                portal = vb.build();
                LIVE = portal;

                // VisionPortal 是 SDK 型別（app ClassLoader 載入），可以放共享 map
                DashHub.setCamsrc(portal);
                applyStreamServer();

                DashHub.put(K_ENABLED, true);
                DashHub.put(K_STATE, "STARTING");
                return true;
            } catch (Throwable t) {
                DashHub.lastError("tagcam start: " + t);
                DashHub.put(K_ENABLED, false);
                DashHub.put(K_STATE, "ERROR");
                closeInternal();
                started = false;
                return false;
            }
        }
    }

    /** 每圈呼叫一次：套 decimation、讀 detections、過濾、發布埋點。 */
    public void update() {
        AprilTagProcessor p = proc;
        if (p == null) { publishNone(); return; }
        try {
            applyDecimation(p);

            long now = System.currentTimeMillis();
            ArrayList<AprilTagDetection> fresh = p.getFreshDetections();
            if (fresh != null) {
                frames++;
                ingest(fresh, now);
            }
            forgetStale(now);
            recomputeBest(now);
            publish(now);
        } catch (Throwable t) {
            DashHub.lastError("tagcam update: " + t);
        }
    }

    /** 關相機。可以重複呼叫。 */
    public void close() {
        synchronized (LOCK) {
            try { CameraStreamServer.getInstance().setSource(null); } catch (Throwable ignored) {}
            try { DashHub.setCamsrc(null); } catch (Throwable ignored) {}
            closeInternal();
            started = false;
            try {
                DashHub.put(K_ENABLED, false);
                DashHub.put(K_STATE, "CLOSED");
                publishNone();
            } catch (Throwable ignored) {}
        }
    }

    private void closeInternal() {
        VisionPortal p = portal;
        portal = null;
        proc = null;
        if (p != null) {
            if (LIVE == p) LIVE = null;
            try { p.close(); } catch (Throwable ignored) {}
        }
    }

    /** 把上一個沒收乾淨的 portal 關掉（單相機保險）。 */
    private static void closeLive() {
        VisionPortal p = LIVE;
        LIVE = null;
        if (p == null) return;
        try { CameraStreamServer.getInstance().setSource(null); } catch (Throwable ignored) {}
        try { p.close(); } catch (Throwable ignored) {}
        DashHub.lastError("tagcam: closed a leaked portal before reopening");
    }

    /** 模式在跑的中途被改（Z-DASH-ON/OFF、Pit 子類）時重套 Driver Hub 畫面。 */
    public void setPit(boolean pitMode) {
        if (this.pit == pitMode) return;
        synchronized (LOCK) {
            this.pit = pitMode;
            applyStreamServer();
        }
    }

    private void applyStreamServer() {
        try {
            CameraStreamServer srv = CameraStreamServer.getInstance();
            VisionPortal p = portal;
            if (pit && p != null) srv.setSource((CameraStreamSource) p);
            else srv.setSource(null);
        } catch (Throwable t) {
            DashHub.lastError("tagcam stream server: " + t);
        }
    }

    // ── 查詢（給 AimAssist 用；沒有 tag 一律回 NaN）───────────────────────

    /**
     * 目前最佳標籤的水平角（度）；沒有就 NaN。
     *
     * 這是 AprilTagPoseFtc.bearing 的原始值，「正值是左還是右」以上機實測為準
     * （SDK javadoc 寫 positive to the right，坊間程式碼常寫成左，只能有一邊對）。
     * 符號換算集中在 AimAssist.BEARING_TO_TURN_SIGN 那一個地方，不要在這裡
     * 再寫一份可能是錯的說明。
     */
    public double getBestBearingDeg() { return bestBearing; }

    /**
     * 目前最佳標籤「有多舊」（秒）；沒有目標回 99.9。
     *
     * 給控制端當安全閘門用。以前 OpMode 是繞道去讀自己發布出去的埋點字串
     * /FGC/Vision/Best/Age s，那讓一道安全檢查依賴兩邊的 key 字串一字不差，
     * 任何一邊改名都會靜默失效（讀到 null -> 檢查被跳過 -> 拿 1.5 秒前的
     * 舊資料轉車）。這個方法直接問資料來源，改名會編譯失敗。
     */
    public double getBestAgeS() {
        int id = bestId;
        if (id < 0) return 99.9;
        Long t = lastSeen.get(Integer.valueOf(id));
        if (t == null) return 99.9;
        double age = (System.currentTimeMillis() - t.longValue()) / 1000.0;
        if (age < 0.0) age = 0.0;
        return (age > 99.9) ? 99.9 : age;
    }

    /** 目前最佳標籤的距離（公尺）；沒有就 NaN。 */
    public double getBestRangeM() { return bestRange; }

    /** 目前最佳標籤的 yaw（度）；沒有就 NaN。 */
    public double getBestYawDeg() { return bestYaw; }

    /** 目前最佳標籤的 id；沒有就 -1。 */
    public int getBestId() { return bestId; }

    /** 這一刻有沒有可信的標籤。 */
    public boolean hasTag() { return bestId >= 0 && !Double.isNaN(bestBearing); }

    /** 目前可信且沒過期的標籤數。 */
    public int getVisibleCount() { return visible; }

    public boolean isRunning() { return portal != null; }

    public boolean isPit() { return pit; }

    // ── 內部：過濾與發布 ─────────────────────────────────────────────────

    private void applyDecimation(AprilTagProcessor p) {
        float dec = (float) Constants.TAG_DECIMATION;
        if (dec < 1f) dec = 1f;
        if (dec > 8f) dec = 8f;
        if (dec != appliedDec) {
            try {
                p.setDecimation(dec);
                appliedDec = dec;
                DashHub.put(K_DEC, dec);
            } catch (Throwable t) {
                DashHub.lastError("tagcam decimation: " + t);
            }
        }
    }

    /** 吃一幀新的偵測結果，更新 streak / lastSeen / lastPose。 */
    private void ingest(List<AprilTagDetection> fresh, long now) {
        double minMargin = Constants.TAG_MIN_MARGIN;
        HashSet<Integer> seen = new HashSet<Integer>();

        for (int i = 0; i < fresh.size(); i++) {
            AprilTagDetection d = fresh.get(i);
            if (d == null) continue;
            if (d.decisionMargin < minMargin) continue;        // 第一層：品質太差

            Integer key = Integer.valueOf(d.id);
            seen.add(key);

            Integer c = streak.get(key);
            int n = (c == null ? 0 : c.intValue()) + 1;
            if (n > CONFIRM_FRAMES) n = CONFIRM_FRAMES;        // 封頂，省得一直加
            streak.put(key, Integer.valueOf(n));
            if (n < CONFIRM_FRAMES) continue;                  // 第二層：要連續 3 幀

            AprilTagPoseFtc p = d.ftcPose;                     // 不在 library 裡就是 null
            double range   = (p == null) ? Double.NaN : p.range;
            double bearing = (p == null) ? Double.NaN : p.bearing;
            double yaw     = (p == null) ? Double.NaN : p.yaw;

            lastSeen.put(key, Long.valueOf(now));
            lastPose.put(key, new double[] { range, bearing, yaw, d.decisionMargin });
        }

        // 這一幀沒出現的 id：連續計數歸零（下次再看到要重新累積 3 幀）
        ArrayList<Integer> ids = new ArrayList<Integer>(streak.keySet());
        for (int i = 0; i < ids.size(); i++) {
            Integer id = ids.get(i);
            if (!seen.contains(id)) streak.put(id, Integer.valueOf(0));
        }
    }

    /** 把 FORGET_MS 之前就沒再看到的 id 整組丟掉（三張表一起）。 */
    private void forgetStale(long now) {
        if (lastSeen.isEmpty()) return;
        ArrayList<Integer> stale = null;
        for (Map.Entry<Integer, Long> e : lastSeen.entrySet()) {
            if (now - e.getValue().longValue() > FORGET_MS) {
                if (stale == null) stale = new ArrayList<Integer>();
                stale.add(e.getKey());
            }
        }
        if (stale == null) return;
        for (int i = 0; i < stale.size(); i++) {
            Integer k = stale.get(i);
            lastSeen.remove(k);
            lastPose.remove(k);
            streak.remove(k);
            // 已經發布出去的 key 沒辦法收回，至少讓它停在「很舊」而不是最後一次的值
            try { DashHub.put("/FGC/Vision/Age/" + k + " s", 99.9); } catch (Throwable ignored) {}
        }
    }

    /**
     * 選出「最佳」標籤：decisionMargin 最大者；同分取距離近的。
     * 只考慮 TAG_TTL_MS 內看過、而且有 ftcPose 的。
     */
    private void recomputeBest(long now) {
        int    id     = -1;
        double range  = Double.NaN;
        double bear   = Double.NaN;
        double yaw    = Double.NaN;
        double margin = -1.0;
        int    n      = 0;

        final int want = preferredId;
        for (Map.Entry<Integer, Long> e : lastSeen.entrySet()) {
            if (now - e.getValue().longValue() > TAG_TTL_MS) continue;
            n++;                                                   // visible 仍然數全部
            if (want >= 0 && e.getKey().intValue() != want) continue;  // 只瞄指定的那一個
            double[] p = lastPose.get(e.getKey());
            if (p == null || Double.isNaN(p[1])) continue;     // 沒有 pose 就不能拿來瞄準
            boolean better = (p[3] > margin)
                          || (p[3] == margin && !Double.isNaN(p[0]) && p[0] < range);
            if (better) {
                margin = p[3];
                id     = e.getKey().intValue();
                range  = p[0];
                bear   = p[1];
                yaw    = p[2];
            }
        }
        // 先寫數值再寫 id：別的執行緒讀到 id >= 0 時，角度一定已經是新的
        bestRange   = range;
        bestBearing = bear;
        bestYaw     = yaw;
        bestId      = id;
        visible     = n;
    }

    private void publish(long now) {
        DashHub.put(K_COUNT, (double) visible);
        DashHub.put(K_FRAMES, (double) frames);

        try {
            VisionPortal p = portal;
            DashHub.put(K_FPS, (p == null) ? 0.0 : (double) p.getFps());
            DashHub.put(K_STATE, (p == null) ? "CLOSED" : String.valueOf(p.getCameraState()));
        } catch (Throwable ignored) {}

        int id = bestId;
        if (id >= 0) {
            Long t = lastSeen.get(Integer.valueOf(id));
            double age = (t == null) ? 0.0 : (now - t.longValue()) / 1000.0;
            double[] pose = lastPose.get(Integer.valueOf(id));
            DashHub.put(K_B_ID, (double) id);
            DashHub.put(K_B_RANGE, bestRange);
            DashHub.put(K_B_BEAR, bestBearing);
            DashHub.put(K_B_YAW, bestYaw);
            DashHub.put(K_B_MARG, (pose == null) ? 0.0 : pose[3]);
            DashHub.put(K_B_AGE, age);
        } else {
            DashHub.put(K_B_ID, -1.0);
            DashHub.put(K_B_RANGE, 0.0);
            DashHub.put(K_B_BEAR, 0.0);
            DashHub.put(K_B_YAW, 0.0);
            DashHub.put(K_B_MARG, 0.0);
            // 沒目標時 Age 要「大」，呼叫端才不會把舊值當新的
            DashHub.put(K_B_AGE, 99.9);
        }

        // 每個 id 一則 Age 秒（只發還在 TTL 內的，過期的由 forgetStale 收尾）
        for (Map.Entry<Integer, Long> e : lastSeen.entrySet()) {
            double age = (now - e.getValue().longValue()) / 1000.0;
            if (age > TAG_TTL_MS / 1000.0) continue;
            DashHub.put("/FGC/Vision/Age/" + e.getKey() + " s", Math.round(age * 10.0) / 10.0);
        }

        DashHub.put(K_TAGS, tagsJson(now));
    }

    private void publishNone() {
        visible     = 0;
        bestId      = -1;
        bestRange   = Double.NaN;
        bestBearing = Double.NaN;
        bestYaw     = Double.NaN;
        DashHub.put(K_COUNT, 0.0);
        DashHub.put(K_B_ID, -1.0);
        DashHub.put(K_B_RANGE, 0.0);
        DashHub.put(K_B_BEAR, 0.0);
        DashHub.put(K_B_YAW, 0.0);          // 與 publish() 的 else 分支對齊，別讓 Yaw 停在舊值
        DashHub.put(K_B_MARG, 0.0);
        DashHub.put(K_B_AGE, 99.9);
        DashHub.put(K_TAGS, new ArrayList<String>());
    }

    /** /FGC/Vision/Tags：每個元素是一個 JSON 字串（string[]，儀表板好解）。 */
    private List<String> tagsJson(long now) {
        ArrayList<String> out = new ArrayList<String>();
        for (Map.Entry<Integer, Long> e : lastSeen.entrySet()) {
            long age = now - e.getValue().longValue();
            if (age > TAG_TTL_MS) continue;
            double[] p = lastPose.get(e.getKey());
            JsonObject o = new JsonObject();
            o.addProperty("id", e.getKey());
            o.addProperty("name", nameOf(e.getKey().intValue()));
            // 量化到 0.1 秒：全精度的話每一圈的值都不同，DashHub.set 永遠判定
            // 「有變」，K_TAGS 每圈都進 dirty、每 50 ms 都被序列化推播一次，
            // 而這段 Gson 工作是在 OpMode 控制執行緒上做的（會反映在 Loop ms）。
            o.addProperty("age", Double.valueOf(Math.round(age / 100.0) / 10.0));
            if (p != null) {
                o.addProperty("range",   Double.valueOf(clean(p[0])));
                o.addProperty("bearing", Double.valueOf(clean(p[1])));
                o.addProperty("yaw",     Double.valueOf(clean(p[2])));
                o.addProperty("margin",  Double.valueOf(clean(p[3])));
                o.addProperty("pose",    Boolean.valueOf(!Double.isNaN(p[1])));
            }
            out.add(GSON.toJson(o));
        }
        return out;
    }

    private static double clean(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return 0.0;
        return Math.round(v * 1000.0) / 1000.0;
    }

    public static String nameOf(int id) {
        for (int i = 0; i < FIELD_IDS.length; i++) if (FIELD_IDS[i] == id) return TAG_NAMES[i];
        return "Tag " + id;
    }

    // ── 標籤庫 ───────────────────────────────────────────────────────────

    /**
     * 優先用官方 jar（上傳到 OnBotJava 的 ExternalLibraries 才會有）；
     * 沒有就自己建。USE_FIELD_POSE 為 true 時建帶場地座標的版本。
     */
    public static AprilTagLibrary tagLibrary() {
        AprilTagLibrary lib = officialLibrary();
        if (lib != null) { DashHub.put(K_LIB, "official"); return lib; }
        if (USE_FIELD_POSE) { DashHub.put(K_LIB, "field"); return buildFieldLibrary(); }
        DashHub.put(K_LIB, "local");
        return buildLocalLibrary();
    }

    /** 反射拿官方 FGC 2026 標籤庫；沒有那個 jar 就回 null。 */
    public static AprilTagLibrary officialLibrary() {
        try {
            Class<?> c = Class.forName("global.first.IgnitingInnovationGameDatabase");
            Object o = c.getMethod("getIgnitingInnovationTagLibrary").invoke(null);
            if (o instanceof AprilTagLibrary) return (AprilTagLibrary) o;
        } catch (Throwable ignored) {
            // 官方 jar 沒上傳很正常，安靜退回自建
        }
        return null;
    }

    /** 只有 id / 名稱 / 尺寸，沒有場地座標（robotPose 會是 null，但 ftcPose 照樣有）。 */
    public static AprilTagLibrary buildLocalLibrary() {
        AprilTagLibrary.Builder b = new AprilTagLibrary.Builder();
        for (int i = 0; i < FIELD_IDS.length; i++) {
            b.addTag(FIELD_IDS[i], TAG_NAMES[i], TAG_SIZE_M, DistanceUnit.METER);
        }
        return b.build();
    }

    /**
     * 帶場地座標的版本（單位毫米）。預設不用 —— 座標表還沒在真場地驗證過，
     * 一旦餵進去 SDK 會算 robotPose，錯的座標會產生「看起來很合理」的錯誤定位。
     */
    public static AprilTagLibrary buildFieldLibrary() {
        AprilTagLibrary.Builder b = new AprilTagLibrary.Builder();
        double sizeMm = TAG_SIZE_M * 1000.0;
        for (int i = 0; i < FIELD_IDS.length; i++) {
            VectorF pos = new VectorF((float) FIELD_XYZ[i][0], (float) FIELD_XYZ[i][1], (float) FIELD_XYZ[i][2]);
            b.addTag(FIELD_IDS[i], TAG_NAMES[i], sizeMm, pos, DistanceUnit.MM, yawQuaternion(FIELD_YAW[i]));
        }
        return b.build();
    }

    /** 繞 +Z 轉 yaw 度的四元數。 */
    public static Quaternion yawQuaternion(double yawDeg) {
        double h = Math.toRadians(yawDeg) / 2.0;
        return new Quaternion((float) Math.cos(h), 0f, 0f, (float) Math.sin(h), 0L);
    }
}

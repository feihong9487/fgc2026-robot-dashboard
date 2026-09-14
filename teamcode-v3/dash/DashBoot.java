package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.util.ThreadPool;

import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;

/**
 * DashBoot：每支 OpMode 的 init 與 @OnCreateEventLoop 都要呼叫 ensure()。
 *
 * 它做三件事（規則 2 / 3 / 5）：
 *   1. 把「最新 ClassLoader 建立的委派物件」塞進 DashHub.delegates()，
 *      這樣 app 開機時註冊的薄殼就會轉呼叫到新程式碼。
 *   2. 世代加一、把舊 executor shutdownNow、開一條新的 publisher。
 *   3. 總開關若還沒設就預設打開。
 */
public final class DashBoot {

    private DashBoot() {}

    /** 每個 ClassLoader（= 每次 Build Everything）只自動讀一次 fgc-tune.json。 */
    private static boolean tuneLoaded = false;

    public static void ensure(String buildTag) {
        boolean needLoad = false;
        ConcurrentHashMap<String, Object> g = DashHub.g();
        synchronized (g) {                       // 這顆 map 是跨 ClassLoader 共用的物件，可以當鎖
            try {
                // 3) 總開關
                if (System.getProperty(DashHub.PROP_ENABLED) == null) DashHub.setEnabled(true);
                DashHub.setBuildTag(buildTag);

                // 1) 換上最新的委派物件
                ConcurrentHashMap<String, Object> del = DashHub.delegates();
                del.put(DashHub.P_HEALTH,  new DashHttp.Health());
                del.put(DashHub.P_STATE,   new DashHttp.State());
                del.put(DashHub.P_SET,     new DashHttp.SetParam());
                del.put(DashHub.P_RECLIST, new DashHttp.RecList());
                del.put(DashHub.P_RECFILE, new DashHttp.RecFile());
                del.put(DashHub.P_NS,      new DashWs());
                // 第二階段：影像兩條路徑的委派（薄殼在 app 開機時就註冊好了，
                // 這裡補上委派不需要重開 Control Hub）。
                del.put(DashHub.P_STREAM,   new DashMjpeg.Stream());
                del.put(DashHub.P_SNAPSHOT, new DashMjpeg.Snapshot());

                // 2) 世代與執行緒
                long myGen = DashHub.gen().incrementAndGet();
                Object old = g.get(DashHub.K_EXEC);
                if (old instanceof ExecutorService) {
                    try { ((ExecutorService) old).shutdownNow(); } catch (Throwable ignored) {}
                }
                ExecutorService ex = ThreadPool.newSingleThreadExecutor("fgc-dash");
                g.put(DashHub.K_EXEC, ex);
                ex.execute(new DashPublisher(myGen));

                // 開機埋點
                DashHub.put("/FGC/Bridge/Gen", (double) myGen);
                DashHub.put("/FGC/Bridge/Mode", DashHub.mode());
                DashHub.put("/FGC/Bridge/Enabled", DashHub.enabled());
                DashHub.put("/CameraPublisher/C270/streams", cameraStreams());

                if (!tuneLoaded) {
                    tuneLoaded = true;
                    needLoad = true;             // 真正的讀檔搬到鎖外面做
                }
            } catch (Throwable t) {
                DashHub.lastError("boot: " + t);
            }
        }

        // ★ 鎖外面 ★ DashParams.load() 會開 sdcard 上的檔案、逐行讀、gson 解析。
        // 這裡是 OpMode 的 init 執行緒，而 g 這把鎖是跨 ClassLoader 全域共用的
        // （DashBoot.shutdown() 也拿它），持鎖做 I/O 會讓別條執行緒陪著等。
        // load()/publishAll() 內部只寫 volatile 與共享 map，本來就不需要這把鎖。
        try {
            if (needLoad) DashParams.load();     // 檔案不存在也算成功
            DashParams.publishAll();
        } catch (Throwable t) {
            DashHub.lastError("boot tune: " + t);
        }
    }

    /**
     * 補掛一個委派 WebHandler 到既有的薄殼路徑上。
     *
     * 注意：路徑必須是 DashBridge.PATHS 裡已經註冊過的那幾條 —— 8080 的
     * @WebHandlerRegistrar 一輩子只跑一次，這裡放的只是「誰來服務」，
     * 不是「開一條新路徑」。放沒註冊過的路徑會回 false（而且沒有效果）。
     */
    public static boolean registerDelegate(String path, WebHandler handler) {
        if (path == null || handler == null) return false;
        boolean known = DashBridge.isRegisteredPath(path);
        try {
            DashHub.delegates().put(path, handler);
        } catch (Throwable t) {
            DashHub.lastError("registerDelegate: " + t);
            return false;
        }
        return known;
    }

    /** 儀表板拿去開 MJPEG 的網址（第二階段才真的有畫面）。 */
    public static List<String> cameraStreams() {
        ArrayList<String> l = new ArrayList<String>(1);
        l.add("mjpg:http://192.168.43.1:8080" + DashHub.P_STREAM);
        return l;
    }

    /** OpMode 結束或 @OnDestroy 用：停掉推播執行緒、清 socket。 */
    public static void shutdown() {
        ConcurrentHashMap<String, Object> g = DashHub.g();
        synchronized (g) {
            try {
                DashHub.gen().incrementAndGet();  // 讓所有現存迴圈自己收工
                Object old = g.get(DashHub.K_EXEC);
                if (old instanceof ExecutorService) {
                    try { ((ExecutorService) old).shutdownNow(); } catch (Throwable ignored) {}
                }
                g.remove(DashHub.K_EXEC);
                DashHub.sockets().clear();
                DashRec.flush();
            } catch (Throwable t) {
                DashHub.lastError("shutdown: " + t);
            }
        }
    }
}

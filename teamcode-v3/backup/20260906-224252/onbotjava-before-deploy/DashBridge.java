package org.firstinspires.ftc.teamcode;

import android.content.Context;

import com.qualcomm.ftccommon.FtcEventLoop;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.util.WebHandlerManager;

import fi.iki.elonen.NanoHTTPD;

import org.firstinspires.ftc.ftccommon.external.OnCreateEventLoop;
import org.firstinspires.ftc.ftccommon.external.OnDestroy;
import org.firstinspires.ftc.ftccommon.external.WebHandlerRegistrar;
import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.FtcWebSocket;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.FtcWebSocketMessage;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.WebSocketNamespaceHandler;
import org.firstinspires.ftc.robotserver.internal.webserver.websockets.WebSocketNamespaceHandlerRegistry;

import java.util.concurrent.ConcurrentHashMap;

/**
 * DashBridge：三個 SDK hook + 薄殼。
 *
 * 這是整套橋接器唯一會被 SDK「只呼叫一次」的地方：
 *   @WebHandlerRegistrar 只在 app onServiceBind 跑一次，改了要重開 Control Hub 電源。
 * 所以這裡註冊的東西必須是永遠不用改的薄殼 —— 真正的實作放在 DashHub.delegates()，
 * 每次 Build Everything 由 DashBoot.ensure() 換成新 ClassLoader 的實例。
 */
public class DashBridge {

    public static final String TAG = "FGCDash";

    /** namespace 已註冊過的旗標（process 內一次性；見 registerWebHandlers）。 */
    public static final String PROP_NSREG = "fgc.dash.nsreg";

    /**
     * 薄殼要服務的路徑。
     *
     * ★ 凍結介面 ★ 這些字串的「值」改了要重開 Control Hub 電源才生效
     * （@WebHandlerRegistrar 一輩子只跑一次）。詳見 DashHub 頂端那段說明。
     */
    private static final String[] PATHS = {
        DashHub.P_HEALTH,
        DashHub.P_STATE,
        DashHub.P_SET,
        DashHub.P_RECLIST,
        DashHub.P_RECFILE,
        DashHub.P_STREAM,
        DashHub.P_SNAPSHOT
    };

    /** 這條路徑有沒有在 app 開機時被註冊過（DashBoot.registerDelegate 用）。 */
    public static boolean isRegisteredPath(String path) {
        if (path == null) return false;
        for (int i = 0; i < PATHS.length; i++) if (PATHS[i].equals(path)) return true;
        return false;
    }

    // ── Hook 1：8080 註冊（一輩子只跑一次）───────────────────────────────

    @WebHandlerRegistrar
    public static void registerWebHandlers(Context context, WebHandlerManager manager) {
        try {
            for (int i = 0; i < PATHS.length; i++) {
                manager.register(PATHS[i], new HttpShell(PATHS[i]));
            }
        } catch (Throwable t) {
            DashHub.lastError("register http: " + t);
        }
        // ★ 只准註冊一次 ★
        // WebSocketNamespaceHandlerRegistry.onWebSocketServerCreation() 把
        // namespaceHandlersToBeRegistered 逐一註冊之後「不會清空那個 List」，
        // 而 WebSocketManagerImpl.internalRegisterNamespaceHandler() 對已存在的
        // namespace 會丟 IllegalArgumentException。service 斷線重連時 onServiceBind
        // 會再跑一次這個 hook，若當下 manager 還是 null，佇列裡就會躺兩個 "dash"，
        // 下一次 onWebSocketServerCreation 走到第二個就丟例外 —— 那條例外在 SDK
        // 自己的 for 迴圈裡，我方的 try/catch 接不到，會害後面所有 handler
        // （含 SDK 自己的）都註冊不上，8081 整層掛掉。
        // 用 System property 當旗標，不用 static 欄位：static 會隨 Build Everything
        // 的新 ClassLoader 歸零，System.getProperties() 不會。
        try {
            if (System.getProperty(PROP_NSREG) == null) {
                System.setProperty(PROP_NSREG, "1");
                WebSocketNamespaceHandlerRegistry.registerNamespaceHandler(new NsShell());
            }
        } catch (IllegalArgumentException dup) {
            // 同一個 namespace 註冊兩次 —— 忽略，舊的照樣能用
        } catch (Throwable t) {
            DashHub.lastError("register ws: " + t);
        }
    }

    // ── Hook 2：每次 event loop 建立（Restart Robot / Build 後）──────────

    @OnCreateEventLoop
    public static void onCreateEventLoop(Context context, FtcEventLoop eventLoop) {
        try {
            DashBoot.ensure("eventloop");
        } catch (Throwable t) {
            DashHub.lastError("eventloop boot: " + t);
        }
        try {
            OpModeManagerImpl mgr = eventLoop.getOpModeManager();
            if (mgr == null) return;
            ConcurrentHashMap<String, Object> g = DashHub.g();
            Object old = g.get(DashHub.K_LISTENER);
            if (old instanceof OpModeManagerNotifier.Notifications) {
                try { mgr.unregisterListener((OpModeManagerNotifier.Notifications) old); } catch (Throwable ignored) {}
            }
            DashListener fresh = new DashListener();
            // listeners 是 WeakReferenceSet，一定要自己持強參考
            g.put(DashHub.K_LISTENER, fresh);
            mgr.registerListener(fresh);
        } catch (Throwable t) {
            DashHub.lastError("listener: " + t);
        }
    }

    // ── Hook 3：app 收工 ─────────────────────────────────────────────────

    @OnDestroy
    public static void onDestroy(Context context) {
        try { DashBoot.shutdown(); } catch (Throwable ignored) {}
    }

    // ── 薄殼：HTTP ───────────────────────────────────────────────────────

    /**
     * 每次請求都先看旗標，再從共享 map 取委派。
     * 這個實例可能是很久以前的 ClassLoader 建的，所以它只碰
     * System.getProperty 與 SDK 介面型別。
     */
    public static class HttpShell implements WebHandler {
        private final String path;

        public HttpShell(String path) { this.path = path; }

        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            NanoHTTPD.Response r;
            if (!"1".equals(System.getProperty(DashHub.PROP_ENABLED))) {
                r = NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "dash disabled");
                r.addHeader("Access-Control-Allow-Origin", "*");
                r.addHeader("Cache-Control", "no-store");
                return r;
            }
            Object d = null;
            try { d = DashHub.delegates().get(path); } catch (Throwable ignored) {}
            if (d instanceof WebHandler) {
                try {
                    return ((WebHandler) d).getResponse(session);
                } catch (Throwable t) {
                    r = NanoHTTPD.newFixedLengthResponse(
                            NanoHTTPD.Response.Status.INTERNAL_ERROR, "text/plain", "delegate error: " + t);
                    r.addHeader("Access-Control-Allow-Origin", "*");
                    r.addHeader("Cache-Control", "no-store");
                    return r;
                }
            }
            r = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "text/plain",
                    "no delegate: run an OpMode once");
            r.addHeader("Access-Control-Allow-Origin", "*");
            r.addHeader("Cache-Control", "no-store");
            return r;
        }
    }

    // ── 薄殼：WebSocket namespace ────────────────────────────────────────

    /**
     * namespace "dash" 的薄殼。沒有委派時仍然要把 socket 收進集合並回一則 hello，
     * 這樣 Day 1 煙霧測試（還沒跑過 OpMode）也能看到東西。
     */
    public static class NsShell extends WebSocketNamespaceHandler {

        public NsShell() { super(DashHub.NS); }

        private static boolean off() {
            return !"1".equals(System.getProperty(DashHub.PROP_ENABLED));
        }

        private static Object del() {
            try { return DashHub.delegates().get(DashHub.P_NS); } catch (Throwable t) { return null; }
        }

        /**
         * MATCH 時薄殼自己要回的 hello payload。
         *
         * 這裡刻意只用 DashHub.pit() 與 DashHub.snapshotJson() 這兩個「一定存在」
         * 的方法，不呼叫 DashHub.helloJson() —— 薄殼可能是很舊的 ClassLoader
         * 實例，呼叫它那個版本沒有的新方法會丟 NoSuchMethodError。
         */
        private static String shellHello() {
            try {
                if (DashHub.pit()) return DashHub.snapshotJson();
            } catch (Throwable ignored) {}
            return "{\"/FGC/Bridge/Mode\":\"MATCH\"}";
        }

        @Override
        public void onSubscribe(FtcWebSocket webSocket) {
            try {
                // 先無條件收進集合：總開關關著的時候連上的 socket，之後跑
                // Z-DASH-ON 打開旗標仍然要收得到推播（否則前端會表現成
                // 「連線是通的但畫面永遠不更新」，而且完全沒有錯誤可看）。
                DashHub.sockets().add(webSocket);
                if (off()) return;
                Object d = del();
                if (d instanceof WebSocketNamespaceHandler) {
                    ((WebSocketNamespaceHandler) d).onSubscribe(webSocket);
                } else {
                    // 還沒跑過 OpMode：自己回一則 hello（MATCH 只回 Mode）
                    webSocket.send(new FtcWebSocketMessage(DashHub.NS, "hello", shellHello()));
                }
            } catch (Throwable t) {
                DashHub.lastError("shell subscribe: " + t);
            }
        }

        @Override
        public void onUnsubscribe(FtcWebSocket webSocket) {
            try {
                DashHub.sockets().remove(webSocket);
                Object d = del();
                if (d instanceof WebSocketNamespaceHandler) {
                    ((WebSocketNamespaceHandler) d).onUnsubscribe(webSocket);
                }
            } catch (Throwable t) {
                DashHub.lastError("shell unsubscribe: " + t);
            }
        }

        @Override
        public boolean onMessage(FtcWebSocketMessage message, FtcWebSocket webSocket) {
            if (off()) return false;
            try {
                Object d = del();
                if (d instanceof WebSocketNamespaceHandler) {
                    return ((WebSocketNamespaceHandler) d).onMessage(message, webSocket);
                }
                if (message != null && "hello".equals(message.getType())) {
                    webSocket.send(new FtcWebSocketMessage(DashHub.NS, "hello", shellHello()));
                    return true;
                }
                return false;
            } catch (Throwable t) {
                DashHub.lastError("shell message: " + t);
                return true;
            }
        }
    }

    // ── OpMode 生命週期監聽 ──────────────────────────────────────────────

    /** 放進共享 map 持強參考（OpModeManagerImpl.listeners 是 WeakReferenceSet）。 */
    public static class DashListener implements OpModeManagerNotifier.Notifications {

        @Override
        public void onOpModePreInit(OpMode opMode) {
            try {
                DashHub.setMode(DashHub.MODE_MATCH);      // 強制回 MATCH，由 OpMode 自己再打開
                DashHub.put("/FGC/Status/OpMode", (opMode == null) ? "?" : opMode.getClass().getSimpleName());
                // startNewFile() 會 flush 上一場、可能 mkdirs()，sdcard 忙的時候是
                // 幾十到幾百毫秒。這裡是 event loop 執行緒（按下 INIT 的那一刻），
                // 阻塞會被 OpModeStuckCodeMonitor 算進去，所以丟背景做。
                DashRec.startNewFileAsync();
            } catch (Throwable t) {
                DashHub.lastError("preinit: " + t);
            }
        }

        @Override
        public void onOpModePreStart(OpMode opMode) {
            try {
                DashHub.setT0(System.currentTimeMillis());
            } catch (Throwable t) {
                DashHub.lastError("prestart: " + t);
            }
        }

        @Override
        public void onOpModePostStop(OpMode opMode) {
            // 這裡可能是 UI thread，耗時工作丟到別條執行緒
            try {
                DashHub.setMode(DashHub.MODE_MATCH);
                DashHub.setCamsrc(null);
            } catch (Throwable ignored) {}
            try {
                Thread t = new Thread(new Runnable() {
                    @Override public void run() {
                        // 規格：MATCH 一定要 CameraStreamServer.setSource(null)。
                        // 正常路徑是 TeleOp 收尾的 tagCam.close() 做掉，但 OpMode
                        // 若丟出未捕捉例外就跳過了 —— 那時 Driver Hub 仍握著舊的
                        // VisionPortal 繼續送影格、USB 相機被占住，而且 TagCam.LIVE
                        // 是 ClassLoader 內的靜態欄位，Build Everything 之後新的
                        // closeLive() 看不到舊的，只能 Restart Robot 才救得回來。
                        try {
                            org.firstinspires.ftc.robotcore.external.stream.CameraStreamServer
                                    .getInstance().setSource(null);
                        } catch (Throwable ignored) {}
                        try { DashRec.flush(); } catch (Throwable ignored) {}
                    }
                }, "fgc-dash-poststop");
                t.setDaemon(true);
                t.start();
            } catch (Throwable ignored) {}
        }
    }
}

package org.firstinspires.ftc.teamcode;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * DashHub：跨 ClassLoader 的共享狀態中樞。
 *
 * 工程規則 1：OnBotJava 每次 Build Everything 都會換一個新的 ClassLoader，
 * 舊的 static 欄位全部作廢。所以所有需要跨 Build 存活的東西都塞進
 * System.getProperties()（Properties 物件本身由 app ClassLoader 載入，
 * 每個 ClassLoader 看到的是同一顆）。
 *
 * 只放「一個」ConcurrentHashMap（key = fgc.dash.g），裡面的值一律只用
 * JDK 型別 / SDK 型別 / 字串；絕不放 teamcode 自己的類別實例當共享狀態
 * （唯一例外是 delegates 與 listener，它們的宣告型別是 SDK 介面，
 * 可以跨 ClassLoader 安全轉型）。
 */
public final class DashHub {

    private DashHub() {}

    // ═══════════════════════════════════════════════════════════════════
    // ★ 凍結介面 ★
    // 以下常數（PROP_*、K_*、P_*、NS）的「值」一旦改動，必須重開 Control Hub
    // 電源才會生效：8080 的 HttpShell 與 8081 的 NsShell 是 app 開機那一刻註冊的
    // 舊 ClassLoader 實例，它們讀到的是舊值。新的 DashBoot.ensure() 會把委派放進
    // 新 key，舊薄殼卻還在找舊 key，結果是所有路徑一起回 503 no delegate，
    // 而且從外面完全看不出原因。
    //   新增 key 是安全的；改既有 key 的字串值不是。
    // 改動前先看 README-deploy.md 第 0 節那張表。
    // ═══════════════════════════════════════════════════════════════════

    // ── System property keys ──────────────────────────────────────────────
    public static final String PROP_G       = "fgc.dash.g";
    public static final String PROP_ENABLED = "fgc.dash.enabled";

    // ── 共享 map 內部的 key ───────────────────────────────────────────────
    public static final String K_LATEST    = "latest";
    public static final String K_DIRTY     = "dirty";
    public static final String K_INBOX     = "inbox";
    public static final String K_SOCKETS   = "sockets";
    public static final String K_DELEGATES = "delegates";
    public static final String K_GEN       = "gen";
    public static final String K_THREADS   = "threads";
    public static final String K_EXEC      = "exec";
    public static final String K_MODE      = "mode";
    public static final String K_CAMSRC    = "camsrc";
    public static final String K_LISTENER  = "listener";
    public static final String K_REC       = "rec";
    public static final String K_RECPEND   = "recpend";
    public static final String K_RECFILE   = "recfile";
    public static final String K_RECLINES  = "reclines";
    public static final String K_BUILDTAG  = "buildTag";
    public static final String K_T0        = "t0";

    // ── HTTP 路徑（delegates 的 key 就是這些字串）─────────────────────────
    public static final String P_HEALTH   = "/dash/health";
    public static final String P_STATE    = "/dash/state.json";
    public static final String P_SET      = "/dash/set";
    public static final String P_RECLIST  = "/dash/rec.json";
    public static final String P_RECFILE  = "/dash/rec.jsonl";
    public static final String P_STREAM   = "/dash/stream.mjpg";
    public static final String P_SNAPSHOT = "/dash/snapshot.jpg";
    /** WebSocket namespace 委派在 delegates 裡的 key。 */
    public static final String P_NS       = "ns";

    public static final String NS = "dash";

    public static final String MODE_MATCH = "MATCH";
    public static final String MODE_PIT   = "PIT";

    /** 這顆 Gson 只在本 ClassLoader 用，不進共享 map。 */
    private static final Gson GSON = new Gson();

    // ── 共享 map ─────────────────────────────────────────────────────────

    /** 取得共享 map；不存在就建立（跨 ClassLoader 用 Properties 物件當鎖）。 */
    @SuppressWarnings("unchecked")
    public static ConcurrentHashMap<String, Object> g() {
        Properties p = System.getProperties();
        Object o = p.get(PROP_G);
        if (!(o instanceof ConcurrentHashMap)) {
            synchronized (p) {
                o = p.get(PROP_G);
                if (!(o instanceof ConcurrentHashMap)) {
                    o = new ConcurrentHashMap<String, Object>();
                    p.put(PROP_G, o);
                }
            }
        }
        return (ConcurrentHashMap<String, Object>) o;
    }

    /** 缺 key 就補上（讓舊版 Build 建的 map 也能自動長出新欄位）。 */
    private static Object need(String k, Object def) {
        ConcurrentHashMap<String, Object> m = g();
        Object o = m.get(k);
        if (o == null) {
            Object prev = m.putIfAbsent(k, def);
            o = (prev != null) ? prev : def;
        }
        return o;
    }

    @SuppressWarnings("unchecked")
    public static ConcurrentHashMap<String, Object> latest() {
        return (ConcurrentHashMap<String, Object>) need(K_LATEST, new ConcurrentHashMap<String, Object>());
    }

    @SuppressWarnings("unchecked")
    public static ConcurrentHashMap<String, Object> dirty() {
        return (ConcurrentHashMap<String, Object>) need(K_DIRTY, new ConcurrentHashMap<String, Object>());
    }

    @SuppressWarnings("unchecked")
    public static ConcurrentLinkedQueue<String> inbox() {
        return (ConcurrentLinkedQueue<String>) need(K_INBOX, new ConcurrentLinkedQueue<String>());
    }

    /** 存的是 FtcWebSocket，但宣告成 Object 以免跨 ClassLoader 出事。 */
    @SuppressWarnings("unchecked")
    public static CopyOnWriteArraySet<Object> sockets() {
        return (CopyOnWriteArraySet<Object>) need(K_SOCKETS, new CopyOnWriteArraySet<Object>());
    }

    /** path 對應 WebHandler 實例；"ns" 對應 WebSocketNamespaceHandler 實例。 */
    @SuppressWarnings("unchecked")
    public static ConcurrentHashMap<String, Object> delegates() {
        return (ConcurrentHashMap<String, Object>) need(K_DELEGATES, new ConcurrentHashMap<String, Object>());
    }

    public static AtomicLong gen() {
        return (AtomicLong) need(K_GEN, new AtomicLong(0L));
    }

    public static AtomicInteger threads() {
        return (AtomicInteger) need(K_THREADS, new AtomicInteger(0));
    }

    @SuppressWarnings("unchecked")
    public static ArrayDeque<String> rec() {
        return (ArrayDeque<String>) need(K_REC, new ArrayDeque<String>());
    }

    @SuppressWarnings("unchecked")
    public static ConcurrentLinkedQueue<String> recPending() {
        return (ConcurrentLinkedQueue<String>) need(K_RECPEND, new ConcurrentLinkedQueue<String>());
    }

    public static AtomicLong recLines() {
        return (AtomicLong) need(K_RECLINES, new AtomicLong(0L));
    }

    // ── 模式 / 旗標 / 標籤 ────────────────────────────────────────────────

    public static String mode() {
        Object o = g().get(K_MODE);
        return (o instanceof String) ? (String) o : MODE_MATCH;
    }

    public static void setMode(String m) {
        String v = MODE_PIT.equals(m) ? MODE_PIT : MODE_MATCH;
        g().put(K_MODE, v);
        put("/FGC/Bridge/Mode", v);
    }

    public static boolean pit() { return MODE_PIT.equals(mode()); }

    public static String buildTag() {
        Object o = g().get(K_BUILDTAG);
        return (o instanceof String) ? (String) o : "unknown";
    }

    public static void setBuildTag(String t) {
        g().put(K_BUILDTAG, (t == null) ? "unknown" : t);
        put("/FGC/Bridge/Build", buildTag());
    }

    /** 總開關：執行期旗標，不可以用 static final boolean（規則 5）。 */
    public static boolean enabled() {
        return "1".equals(System.getProperty(PROP_ENABLED));
    }

    public static void setEnabled(boolean on) {
        System.setProperty(PROP_ENABLED, on ? "1" : "0");
    }

    public static long t0() {
        Object o = g().get(K_T0);
        if (o instanceof Long) {
            long v = ((Long) o).longValue();
            if (v > 0L) return v;
        }
        return System.currentTimeMillis();
    }

    public static void setT0(long ms) { g().put(K_T0, Long.valueOf(ms)); }

    /** CameraStreamSource（第二階段用），這裡只當 Object 保管。 */
    public static Object camsrc() { return g().get(K_CAMSRC); }

    public static void setCamsrc(Object src) {
        if (src == null) g().remove(K_CAMSRC);
        else g().put(K_CAMSRC, src);
    }

    public static void lastError(String why) {
        try {
            put("/FGC/Bridge/Last Error", (why == null) ? "" : trim(why, 300));
        } catch (Throwable ignored) { /* 錯誤路徑不准再丟錯 */ }
    }

    private static String trim(String s, int n) {
        return (s.length() <= n) ? s : s.substring(0, n);
    }

    // ── 埋點 put（只有真的變了才進 dirty）────────────────────────────────

    public static void put(String k, double v) {
        // NaN / Infinity 會讓 JSON 變成非法字串，直接歸零
        if (Double.isNaN(v) || Double.isInfinite(v)) v = 0.0;
        set(k, Double.valueOf(v));
    }

    public static void put(String k, boolean v) { set(k, Boolean.valueOf(v)); }

    public static void put(String k, String v) { set(k, (v == null) ? "" : v); }

    public static void put(String k, List<String> v) {
        if (v == null) { set(k, Collections.unmodifiableList(new ArrayList<String>())); return; }
        set(k, Collections.unmodifiableList(new ArrayList<String>(v)));
    }

    /**
     * latest 與 dirty 必須一起更新，否則兩張表會永久發散：
     * T1 寫 A 進 latest、T2 寫 B 進 latest 與 dirty、T1 才把 A 寫進 dirty
     * → latest=B 但推出去的是 A；下次再寫 B 時 old.equals(v) 判定「沒變」直接
     * return，前端就永遠停在 A。/FGC/Bridge/Mode、/FGC/Bridge/Viewers、
     * /FGC/Camera/Frame KB 都是多執行緒同鍵寫入，真的會發生。
     *
     * 這是靜態同步（鎖 DashHub.class）。OpMode 每圈約 60 次 put、publisher
     * 每 50 ms 一輪，實務上都是無競爭鎖，成本遠低於一次 Lynx 往返。
     */
    private static synchronized void set(String k, Object v) {
        if (k == null) return;
        ConcurrentHashMap<String, Object> l = latest();
        Object old = l.get(k);
        if (old != null && old.equals(v)) return;
        l.put(k, v);
        dirty().put(k, v);
    }

    public static Object get(String k) { return latest().get(k); }

    // ── 序列化 ───────────────────────────────────────────────────────────

    /** 把整張 latest 序列化成 JSON 物件字串（只給 PIT 用）。 */
    public static String snapshotJson() { return toJson(latest()); }

    /**
     * WebSocket 訂閱時要回的 hello payload。
     *
     * MATCH 模式不可以送全量 —— 那份東西跟 /dash/state.json 拒絕提供的完全一樣
     * （射速、電流、gamepad、AprilTag、電池），只要連上 Hub WiFi 訂閱 namespace
     * "dash" 就拿得到，MATCH 的封鎖會形同虛設。所以 MATCH 只回
     * /FGC/Bridge/* 與 /FGC/Status/OpMode 這個白名單子集：前端還看得到
     * Mode / Gen / Threads / Viewers / Build 足以判斷連線正常，但沒有任何比賽資料。
     */
    public static String helloJson() {
        if (pit()) return snapshotJson();
        HashMap<String, Object> m = new HashMap<String, Object>();
        for (Map.Entry<String, Object> e : latest().entrySet()) {
            String k = e.getKey();
            if (k == null) continue;
            if (k.startsWith("/FGC/Bridge/") || "/FGC/Status/OpMode".equals(k)) {
                m.put(k, e.getValue());
            }
        }
        m.put("/FGC/Bridge/Mode", MODE_MATCH);
        return toJson(m);
    }

    /** 取出並清空 dirty；沒東西回 null。 */
    public static Map<String, Object> drainDirty() {
        ConcurrentHashMap<String, Object> d = dirty();
        if (d.isEmpty()) return null;
        HashMap<String, Object> out = new HashMap<String, Object>();
        ArrayList<String> keys = new ArrayList<String>(d.keySet());
        for (int i = 0; i < keys.size(); i++) {
            String k = keys.get(i);
            Object v = d.remove(k);
            if (v != null) out.put(k, v);
        }
        return out.isEmpty() ? null : out;
    }

    /** 取出並清空 dirty 後直接序列化；沒東西回 null（nt 用）。 */
    public static String drainDirtyJson() {
        Map<String, Object> d = drainDirty();
        return (d == null) ? null : toJson(d);
    }

    /** 值型別只支援 Double / Boolean / String / List(String)。 */
    public static String toJson(Map<String, Object> m) {
        JsonObject o = new JsonObject();
        for (Map.Entry<String, Object> e : m.entrySet()) {
            Object v = e.getValue();
            if (v instanceof Double)       o.addProperty(e.getKey(), (Double) v);
            else if (v instanceof Number)  o.addProperty(e.getKey(), (Number) v);
            else if (v instanceof Boolean) o.addProperty(e.getKey(), (Boolean) v);
            else if (v instanceof String)  o.addProperty(e.getKey(), (String) v);
            else if (v instanceof List) {
                JsonArray a = new JsonArray();
                List<?> list = (List<?>) v;
                for (int i = 0; i < list.size(); i++) a.add(String.valueOf(list.get(i)));
                o.add(e.getKey(), a);
            } else if (v != null) {
                o.addProperty(e.getKey(), String.valueOf(v));
            }
        }
        return GSON.toJson(o);
    }

    /** 錯誤訊息封包 {"k":..,"why":..}。 */
    public static String errJson(String k, String why) {
        JsonObject o = new JsonObject();
        o.addProperty("k", (k == null) ? "" : k);
        o.addProperty("why", (why == null) ? "" : why);
        return GSON.toJson(o);
    }

    /** {"ok":bool,"why":str}。 */
    public static String okJson(boolean ok, String why) {
        JsonObject o = new JsonObject();
        o.addProperty("ok", Boolean.valueOf(ok));
        o.addProperty("why", (why == null) ? "" : why);
        return GSON.toJson(o);
    }
}

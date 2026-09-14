package org.firstinspires.ftc.teamcode;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.Locale;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * DashParams：可調參數白名單 + 邊界檢查 + 套用 + 存讀檔。
 *
 * 只有 PIT 模式接受寫入；MATCH 一律拒絕。
 * 前端送 {"k":"/FGC/Tune/VEL_SL","v":1900}，套用成功後回讀 /FGC/Param/VEL_SL。
 *
 * ★ 執行緒 ★ apply() 有兩條進入路徑，而且在不同執行緒上：
 *   - HTTP /dash/set  → NanoHTTPD 的連線執行緒（DashHttp.SetParam，同步回報拒絕原因）
 *   - WebSocket "set" → 丟 inbox，由 publisher 執行緒 drainInbox() 統一處理
 * 因此「所有被 write() 寫入的 Constants 欄位一定要是 volatile」，而且
 * 任何「改完之後需要重套硬體」的參數（像 ClimbSystem 對 Constants.HOLD 那樣）
 * 都必須由使用端每圈自己重讀，不可以指望 apply() 那一刻去碰硬體 ——
 * 那兩條執行緒都不是 OpMode 控制執行緒。
 */
public final class DashParams {

    private DashParams() {}

    public static final String TUNE_PREFIX  = "/FGC/Tune/";
    public static final String PARAM_PREFIX = "/FGC/Param/";
    public static final String FILE_NAME    = "fgc-tune.json";

    private static final int T_DOUBLE = 0;
    private static final int T_BOOL   = 1;

    /** 白名單：名稱、型別、min、max。順序即 snippet 輸出順序。 */
    private static final String[] NAMES = {
        "DEADZONE", "TURN_SCALE",
        "VEL_SL", "VEL_SR", "IDLE_TPS", "EJECT_VEL", "WAIT_SPINUP", "FEED_THRESHOLD",
        "WAY_TPS", "WAY_IDLE_TPS",
        "INTAKE_COLLECT", "INTAKE_SHOOT",
        "CLIMB", "HOLD",
        "HOPPER_POWER",
        "TAG_DECIMATION", "TAG_MIN_MARGIN", "AIM_KP", "AIM_MAX", "MJPEG_FPS", "MJPEG_Q"
    };

    private static final int[] KIND = {
        T_DOUBLE, T_DOUBLE,
        T_DOUBLE, T_DOUBLE, T_DOUBLE, T_DOUBLE, T_BOOL, T_DOUBLE,
        T_DOUBLE, T_DOUBLE,
        T_DOUBLE, T_DOUBLE,
        T_DOUBLE, T_DOUBLE,
        T_DOUBLE,
        T_DOUBLE, T_DOUBLE, T_DOUBLE, T_DOUBLE, T_DOUBLE, T_DOUBLE
    };

    // 注意 AIM_KP 的下限是 -0.20（不是 0）：AprilTagPoseFtc.bearing 的符號要上機
    // 實測才知道，萬一 AimAssist.BEARING_TO_TURN_SIGN 猜反了，現場可以直接把
    // AIM_KP 設成負值翻回來，不必重 Build。
    private static final double[] MIN = {
        0.0, 0.0,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0,
        0.0, 0.0,
        0.0, 0.0,
        0.0,
        1.0, 0.0, -0.20, 0.0, 1.0, 5.0
    };

    private static final double[] MAX = {
        0.40, 1.0,
        3000.0, 3000.0, 3000.0, 3000.0, 1.0, 3000.0,
        3000.0, 3000.0,
        1.0, 1.0,
        1.0, 1.0,
        1.0,
        8.0, 200.0, 0.20, 1.0, 30.0, 95.0
    };

    private static final Gson GSON = new Gson();

    /**
     * 「編譯進去的值」表：這一版 Constants.java 原始碼裡的字面值。
     *
     * ★ 一定要在 load() 之前抄 ★ 這個陣列在類別載入時（static init，每個
     * ClassLoader = 每次 Build Everything 一次）就把 21 個欄位的當下值複製一份。
     * DashParams 是「唯一」會寫 Constants 這些欄位的地方（write()），而任何進到
     * write() 的路徑（apply / load）都必須先觸發本類別的 static init，JVM 又保證
     * 類別初始化跑完之前別的執行緒進不了任何靜態方法 —— 所以 BUILD[] 抄到的
     * 一定是 fgc-tune.json 與線上調參都還沒動過的原始值。
     *
     * 用途：load() 讀完檔、或現場調了半天之後，儀表板仍然可以拿
     * /FGC/Param/Build <NAME> 跟 /FGC/Param/<NAME> 對照，一眼看出「哪幾個
     * 跟 Build 進去的不一樣」——賽後要不要用 _snippet 貼回 Constants.java 就靠它。
     *
     * 宣告位置必須在 NAMES / KIND 後面：static 欄位是照原始碼順序初始化的，
     * 放前面的話 read() 會拿到還是 null 的 NAMES。
     */
    private static final double[] BUILD = snapshotBuildValues();

    private static double[] snapshotBuildValues() {
        double[] b = new double[NAMES.length];
        for (int i = 0; i < NAMES.length; i++) {
            try { b[i] = read(i); } catch (Throwable t) { b[i] = 0.0; }
        }
        return b;
    }

    public static String[] names() { return NAMES.clone(); }

    /** Build 時編譯進去的預設值（boolean 以 1/0 表示）。 */
    public static double buildValue(int i) {
        if (i < 0 || i >= BUILD.length) return 0.0;
        return BUILD[i];
    }

    private static int indexOf(String name) {
        if (name == null) return -1;
        String n = name;
        if (n.startsWith(TUNE_PREFIX))  n = n.substring(TUNE_PREFIX.length());
        if (n.startsWith(PARAM_PREFIX)) n = n.substring(PARAM_PREFIX.length());
        for (int i = 0; i < NAMES.length; i++) if (NAMES[i].equals(n)) return i;
        return -1;
    }

    // ── 讀 / 寫 Constants ─────────────────────────────────────────────────

    /** 目前值（boolean 以 1/0 表示）。 */
    public static double read(int i) {
        switch (NAMES[i]) {
            case "DEADZONE":       return Constants.DEADZONE;
            case "TURN_SCALE":     return Constants.TURN_SCALE;
            case "VEL_SL":         return Constants.VEL_SL;
            case "VEL_SR":         return Constants.VEL_SR;
            case "IDLE_TPS":       return Constants.IDLE_TPS;
            case "EJECT_VEL":      return Constants.EJECT_VEL;
            case "WAIT_SPINUP":    return Constants.WAIT_SPINUP ? 1.0 : 0.0;
            case "FEED_THRESHOLD": return Constants.FEED_THRESHOLD;
            case "WAY_TPS":        return Constants.WAY_TPS;
            case "WAY_IDLE_TPS":   return Constants.WAY_IDLE_TPS;
            case "INTAKE_COLLECT": return Constants.INTAKE_COLLECT;
            case "INTAKE_SHOOT":   return Constants.INTAKE_SHOOT;
            case "CLIMB":          return Constants.CLIMB;
            case "HOLD":           return Constants.HOLD;
            case "HOPPER_POWER":   return Constants.HOPPER_POWER;
            case "TAG_DECIMATION": return Constants.TAG_DECIMATION;
            case "TAG_MIN_MARGIN": return Constants.TAG_MIN_MARGIN;
            case "AIM_KP":         return Constants.AIM_KP;
            case "AIM_MAX":        return Constants.AIM_MAX;
            case "MJPEG_FPS":      return Constants.MJPEG_FPS;
            case "MJPEG_Q":        return Constants.MJPEG_Q;
            default:               return 0.0;
        }
    }

    private static void write(int i, double v) {
        switch (NAMES[i]) {
            case "DEADZONE":       Constants.DEADZONE = v; break;
            case "TURN_SCALE":     Constants.TURN_SCALE = v; break;
            case "VEL_SL":         Constants.VEL_SL = v; break;
            case "VEL_SR":         Constants.VEL_SR = v; break;
            case "IDLE_TPS":       Constants.IDLE_TPS = v; break;
            case "EJECT_VEL":      Constants.EJECT_VEL = v; break;
            case "WAIT_SPINUP":    Constants.WAIT_SPINUP = (v >= 0.5); break;
            case "FEED_THRESHOLD": Constants.FEED_THRESHOLD = v; break;
            case "WAY_TPS":        Constants.WAY_TPS = v; break;
            case "WAY_IDLE_TPS":   Constants.WAY_IDLE_TPS = v; break;
            case "INTAKE_COLLECT": Constants.INTAKE_COLLECT = v; break;
            case "INTAKE_SHOOT":   Constants.INTAKE_SHOOT = v; break;
            case "CLIMB":          Constants.CLIMB = v; break;
            case "HOLD":           Constants.HOLD = v; break;
            case "HOPPER_POWER":   Constants.HOPPER_POWER = v; break;
            case "TAG_DECIMATION": Constants.TAG_DECIMATION = v; break;
            case "TAG_MIN_MARGIN": Constants.TAG_MIN_MARGIN = v; break;
            case "AIM_KP":         Constants.AIM_KP = v; break;
            case "AIM_MAX":        Constants.AIM_MAX = v; break;
            case "MJPEG_FPS":      Constants.MJPEG_FPS = v; break;
            case "MJPEG_Q":        Constants.MJPEG_Q = v; break;
            default: break;
        }
    }

    // ── 套用 ─────────────────────────────────────────────────────────────

    /**
     * 套用一筆設定。回傳 null 代表成功，否則回傳拒絕原因（ASCII）。
     * rawValue 允許 "1900"、"true"、"false"。
     */
    public static String apply(String key, String rawValue) {
        if (!DashHub.pit()) return reject(key, "MATCH mode: writes are rejected");
        int i = indexOf(key);
        if (i < 0) return reject(key, "unknown key");
        if (rawValue == null || rawValue.length() == 0) return reject(key, "empty value");

        double v;
        String s = rawValue.trim();
        if (KIND[i] == T_BOOL) {
            if ("true".equalsIgnoreCase(s) || "1".equals(s))       v = 1.0;
            else if ("false".equalsIgnoreCase(s) || "0".equals(s)) v = 0.0;
            else return reject(key, "not a boolean");
        } else {
            try { v = Double.parseDouble(s); }
            catch (NumberFormatException e) { return reject(key, "not a number"); }
            if (Double.isNaN(v) || Double.isInfinite(v)) return reject(key, "not finite");
            if (v < MIN[i] || v > MAX[i]) {
                return reject(key, "out of range " + fmt(MIN[i]) + ".." + fmt(MAX[i]));
            }
        }

        write(i, v);
        publishOne(i);
        DashHub.put("/FGC/Bridge/Last Set", NAMES[i] + "=" + fmt(read(i)));
        return null;
    }

    private static String reject(String key, String why) {
        DashHub.put("/FGC/Bridge/Last Set Rejected", (key == null ? "?" : key) + ": " + why);
        return why;
    }

    /**
     * 把 WS inbox 裡的 set 指令全部處理掉（由 DashPublisher 每圈呼叫）。
     *
     * err 只在 PIT 廣播：MATCH 的規則是「不推播」，而且 broadcast 是廣播給
     * 所有訂閱者 —— 別人送的壞指令不該讓全部人收到訊息。拒絕原因照舊寫進
     * /FGC/Bridge/Last Set Rejected（reject()），事後查得到。
     */
    public static void drainInbox() {
        ConcurrentLinkedQueue<String> q = DashHub.inbox();
        for (int guard = 0; guard < 64; guard++) {
            String raw = q.poll();
            if (raw == null) return;
            String k = null;
            try {
                JsonElement el = new JsonParser().parse(raw);
                if (el == null || !el.isJsonObject()) { err("", "bad payload"); continue; }
                JsonObject o = el.getAsJsonObject();
                if (!o.has("k") || !o.has("v")) { err("", "missing k or v"); continue; }
                k = o.get("k").getAsString();
                JsonElement ve = o.get("v");
                String vs;
                if (ve.isJsonPrimitive() && ve.getAsJsonPrimitive().isBoolean()) {
                    vs = ve.getAsBoolean() ? "true" : "false";
                } else {
                    vs = ve.getAsString();
                }
                String why = apply(k, vs);
                if (why != null) err(k, why);
            } catch (Throwable t) {
                err(k == null ? "" : k, "parse: " + t);
            }
        }
    }

    /** 廣播一則錯誤；MATCH 不推播，只留下 Last Set Rejected 供事後查。 */
    private static void err(String k, String why) {
        DashHub.put("/FGC/Bridge/Last Set Rejected", (k == null || k.length() == 0 ? "?" : k) + ": " + why);
        if (DashHub.pit()) DashWs.broadcast("err", DashHub.errJson(k, why));
    }

    // ── 發布 ─────────────────────────────────────────────────────────────

    public static void publishOne(int i) {
        if (KIND[i] == T_BOOL) {
            boolean b = read(i) >= 0.5;
            DashHub.put(TUNE_PREFIX  + NAMES[i], b);
            DashHub.put(PARAM_PREFIX + NAMES[i], b);
        } else {
            double v = read(i);
            DashHub.put(TUNE_PREFIX  + NAMES[i], v);
            DashHub.put(PARAM_PREFIX + NAMES[i], v);
        }
    }

    /**
     * 發布 Build 進去的預設值 /FGC/Param/Build &lt;NAME&gt;。
     * 值永遠不變，所以只有第一次 put 會弄髒 dirty，之後都是空操作。
     */
    public static void publishBuild(int i) {
        if (KIND[i] == T_BOOL) DashHub.put(PARAM_PREFIX + "Build " + NAMES[i], BUILD[i] >= 0.5);
        else                   DashHub.put(PARAM_PREFIX + "Build " + NAMES[i], BUILD[i]);
    }

    public static void publishAll() {
        for (int i = 0; i < NAMES.length; i++) {
            publishOne(i);
            publishBuild(i);
        }
        DashHub.put(PARAM_PREFIX + "_Snippet", snippet());
    }

    /** 產生可以直接貼回 Constants.java 的片段。 */
    public static String snippet() {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("// fgc-tune snippet\n");
        for (int i = 0; i < NAMES.length; i++) {
            if (KIND[i] == T_BOOL) {
                sb.append("public static volatile boolean ").append(NAMES[i])
                  .append(" = ").append(read(i) >= 0.5 ? "true" : "false").append(";\n");
            } else {
                sb.append("public static volatile double ").append(NAMES[i])
                  .append(" = ").append(fmt(read(i))).append(";\n");
            }
        }
        return sb.toString();
    }

    private static String fmt(double v) {
        if (v == Math.rint(v) && Math.abs(v) < 1.0e9) return String.valueOf((long) v);
        return String.format(Locale.US, "%.4f", Double.valueOf(v));
    }

    // ── 存檔 / 讀檔 ──────────────────────────────────────────────────────

    public static File file() { return new File(AppUtil.FIRST_FOLDER, FILE_NAME); }

    /** 回傳 null 代表成功，否則是錯誤原因。 */
    public static String save() {
        BufferedWriter w = null;
        try {
            JsonObject o = new JsonObject();
            for (int i = 0; i < NAMES.length; i++) {
                if (KIND[i] == T_BOOL) o.addProperty(NAMES[i], Boolean.valueOf(read(i) >= 0.5));
                else                   o.addProperty(NAMES[i], Double.valueOf(read(i)));
            }
            File f = file();
            w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f, false), "UTF-8"));
            w.write(GSON.toJson(o));
            w.flush();
            DashHub.put("/FGC/Param/_Saved", f.getName());
            return null;
        } catch (Throwable t) {
            DashHub.lastError("param save: " + t);
            return String.valueOf(t);
        } finally {
            if (w != null) { try { w.close(); } catch (Throwable ignored) {} }
        }
    }

    /** 回傳 null 代表成功（檔案不存在也算成功），否則是錯誤原因。 */
    public static String load() {
        BufferedReader r = null;
        try {
            File f = file();
            if (!f.exists()) return null;
            r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            JsonElement el = new JsonParser().parse(sb.toString());
            if (el == null || !el.isJsonObject()) return "bad json";
            JsonObject o = el.getAsJsonObject();
            // 每個 key 各自 try：一個壞值（例如手改成 "VEL_SL": "1900rpm"）
            // 以前會讓 getAsDouble() 丟例外中斷整批，變成「前幾個已經寫進
            // Constants、後幾個維持預設」的半套設定，而且 publishAll() 也不會跑，
            // 儀表板顯示的跟實際生效的不一致 —— 而且是在 ensure() 的自動 load
            // 路徑上安靜發生。
            for (int i = 0; i < NAMES.length; i++) {
                try {
                    if (!o.has(NAMES[i])) continue;
                    JsonElement ve = o.get(NAMES[i]);
                    double v;
                    if (ve.isJsonPrimitive() && ve.getAsJsonPrimitive().isBoolean()) v = ve.getAsBoolean() ? 1.0 : 0.0;
                    else v = ve.getAsDouble();
                    if (KIND[i] != T_BOOL) {
                        if (Double.isNaN(v) || Double.isInfinite(v)) continue;
                        if (v < MIN[i] || v > MAX[i]) continue;      // 檔案裡的爛值一律忽略
                    }
                    write(i, v);
                } catch (Throwable one) {
                    DashHub.put("/FGC/Bridge/Last Set Rejected", NAMES[i] + ": bad value in " + FILE_NAME);
                }
            }
            return null;
        } catch (Throwable t) {
            DashHub.lastError("param load: " + t);
            return String.valueOf(t);
        } finally {
            if (r != null) { try { r.close(); } catch (Throwable ignored) {} }
            try { publishAll(); } catch (Throwable ignored) {}   // 不管成敗，回讀值一定要是真的
        }
    }
}

package org.firstinspires.ftc.teamcode;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import fi.iki.elonen.NanoHTTPD;
import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import java.io.File;
import java.io.FileInputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.List;
import java.util.Map;

/**
 * DashHttp：四類委派 WebHandler（health / state.json / set / rec）。
 *
 * 這些是「委派」，不是註冊到 8080 的東西 —— 註冊的是 DashBridge 裡的薄殼。
 * DashBoot.ensure() 每次都放新實例進 DashHub.delegates()，
 * 所以永遠是最新 ClassLoader 的程式碼在服務。
 */
public final class DashHttp {

    private DashHttp() {}

    public static final String MIME_TEXT  = "text/plain";
    public static final String MIME_JSON  = "application/json";
    public static final String MIME_NDJSON = "application/x-ndjson";

    private static final Gson GSON = new Gson();

    // ── 共用小工具 ───────────────────────────────────────────────────────

    /** 統一加 CORS 與 no-store。 */
    public static NanoHTTPD.Response resp(NanoHTTPD.Response.IStatus st, String mime, String body) {
        NanoHTTPD.Response r = NanoHTTPD.newFixedLengthResponse(st, mime, body == null ? "" : body);
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Cache-Control", "no-store");
        return r;
    }

    public static NanoHTTPD.Response text(NanoHTTPD.Response.IStatus st, String body) {
        return resp(st, MIME_TEXT, body);
    }

    public static NanoHTTPD.Response json(NanoHTTPD.Response.IStatus st, String body) {
        return resp(st, MIME_JSON, body);
    }

    /** 只接受簡單 GET。 */
    private static boolean notGet(NanoHTTPD.IHTTPSession s) {
        try { return s.getMethod() != NanoHTTPD.Method.GET; }
        catch (Throwable t) { return false; }
    }

    /**
     * 取 query 參數。
     *
     * 用 getParameters()（Map&lt;String,List&lt;String&gt;&gt;）而不是 getParms() ——
     * 後者已 deprecated，是全專案唯一的編譯 warning，留著久了會讓人忽略真正的新
     * warning。拿不到就自己拆 getQueryParameterString()。
     */
    public static String qp(NanoHTTPD.IHTTPSession s, String name) {
        try {
            Map<String, List<String>> m = s.getParameters();
            if (m != null) {
                List<String> v = m.get(name);
                if (v != null && !v.isEmpty() && v.get(0) != null) return v.get(0);
            }
        } catch (Throwable ignored) {}
        try {
            String qs = s.getQueryParameterString();
            if (qs == null) return null;
            String[] parts = qs.split("&");
            for (int i = 0; i < parts.length; i++) {
                int eq = parts[i].indexOf('=');
                if (eq <= 0) continue;
                String k = dec(parts[i].substring(0, eq));
                if (name.equals(k)) return dec(parts[i].substring(eq + 1));
            }
        } catch (Throwable ignored) {}
        return null;
    }

    private static String dec(String s) {
        try { return URLDecoder.decode(s, "UTF-8"); }
        catch (UnsupportedEncodingException e) { return s; }
        catch (Throwable t) { return s; }
    }

    // ── /dash/health ─────────────────────────────────────────────────────

    /** 純文字健康檢查；MATCH 也可以看（不含任何比賽資料）。 */
    public static class Health implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            if (notGet(session)) return text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
            StringBuilder sb = new StringBuilder(512);
            sb.append("build=").append(DashHub.buildTag()).append('\n');
            sb.append("gen=").append(DashHub.gen().get()).append('\n');
            sb.append("threads=").append(DashHub.threads().get()).append('\n');
            sb.append("mode=").append(DashHub.mode()).append('\n');
            sb.append("enabled=").append(DashHub.enabled() ? "1" : "0").append('\n');
            sb.append("viewers=").append(DashHub.sockets().size()).append('\n');
            sb.append("camsrc=").append(DashHub.camsrc() != null ? "yes" : "no").append('\n');
            sb.append("rec=").append(DashRec.currentName()).append('\n');
            sb.append("reclines=").append(DashHub.recLines().get()).append('\n');
            sb.append("recpending=").append(DashHub.recPending().size()).append('\n');
            Object le = DashHub.get("/FGC/Bridge/Last Error");
            sb.append("lasterror=").append(le == null ? "" : String.valueOf(le)).append('\n');
            sb.append("keys=").append(DashHub.latest().size()).append('\n');
            return text(NanoHTTPD.Response.Status.OK, sb.toString());
        }
    }

    // ── /dash/state.json ─────────────────────────────────────────────────

    /** 全量狀態；MATCH 一律 503。 */
    public static class State implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            if (notGet(session)) return text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
            if (!DashHub.pit()) {
                return text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "MATCH mode: state is closed");
            }
            return json(NanoHTTPD.Response.Status.OK, DashHub.snapshotJson());
        }
    }

    // ── /dash/set?k=&v= ──────────────────────────────────────────────────

    /** 參數寫入；只有 PIT 接受。回 {"ok":bool,"why":str}。 */
    public static class SetParam implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            if (notGet(session)) return text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
            String k = qp(session, "k");
            if (k == null || k.length() == 0) {
                return json(NanoHTTPD.Response.Status.BAD_REQUEST, DashHub.okJson(false, "missing k"));
            }
            if (!DashHub.pit()) {
                DashHub.put("/FGC/Bridge/Last Set Rejected", k + ": MATCH mode");
                return json(NanoHTTPD.Response.Status.FORBIDDEN, DashHub.okJson(false, "MATCH mode: writes are rejected"));
            }
            // 特殊指令
            if ("_save".equals(k)) {
                String why = DashParams.save();
                return json(why == null ? NanoHTTPD.Response.Status.OK : NanoHTTPD.Response.Status.INTERNAL_ERROR,
                            DashHub.okJson(why == null, why == null ? "saved" : why));
            }
            if ("_load".equals(k)) {
                String why = DashParams.load();
                return json(why == null ? NanoHTTPD.Response.Status.OK : NanoHTTPD.Response.Status.INTERNAL_ERROR,
                            DashHub.okJson(why == null, why == null ? "loaded" : why));
            }
            if ("_snippet".equals(k)) {
                DashHub.put("/FGC/Param/_Snippet", DashParams.snippet());
                return json(NanoHTTPD.Response.Status.OK, DashHub.okJson(true, "snippet published"));
            }
            String v = qp(session, "v");
            if (v == null) {
                return json(NanoHTTPD.Response.Status.BAD_REQUEST, DashHub.okJson(false, "missing v"));
            }
            String why = DashParams.apply(k, v);
            if (why != null) {
                DashWs.broadcast("err", DashHub.errJson(k, why));
                return json(NanoHTTPD.Response.Status.BAD_REQUEST, DashHub.okJson(false, why));
            }
            return json(NanoHTTPD.Response.Status.OK, DashHub.okJson(true, ""));
        }
    }

    // ── /dash/rec.json ───────────────────────────────────────────────────

    /**
     * 列出 /sdcard/FIRST/fgc-rec 底下的錄影檔。
     *
     * MATCH 一律 503：檔名與大小雖然不是比賽資料，但它是 /dash/rec.jsonl 的入口，
     * 兩條一起關比較不會有人繞路。錄影本身照樣在 MATCH 進行（DashPublisher），
     * 只是不開放線上讀取；賽後要拉檔先跑一次 B1-PIT 或 Z-DASH-PING 切成 PIT。
     */
    public static class RecList implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            if (notGet(session)) return text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
            if (!DashHub.pit()) {
                return text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "MATCH mode: recordings are closed");
            }
            JsonObject root = new JsonObject();
            JsonArray arr = new JsonArray();
            try {
                DashRec.flush();
                List<File> fs = DashRec.listFiles();
                for (int i = 0; i < fs.size(); i++) {
                    File f = fs.get(i);
                    JsonObject o = new JsonObject();
                    o.addProperty("name", f.getName());
                    o.addProperty("size", Long.valueOf(f.length()));
                    o.addProperty("mtime", Long.valueOf(f.lastModified()));
                    arr.add(o);
                }
                root.addProperty("dir", DashRec.dir().getAbsolutePath());
                root.addProperty("current", DashRec.currentName());
            } catch (Throwable t) {
                root.addProperty("error", String.valueOf(t));
            }
            root.add("files", arr);
            return json(NanoHTTPD.Response.Status.OK, GSON.toJson(root));
        }
    }

    // ── /dash/rec.jsonl?name= ────────────────────────────────────────────

    /**
     * 回一個錄影檔的內容；不給 name 就給最新的，name=live 給這一場的記憶體 ring。
     *
     * MATCH 一律 503。這條路徑洩漏的東西比被擋掉的 state.json 更多：state.json
     * 只有當下值，rec 是整段時間序列（?name=live 就是這一場到目前為止的全部埋點）。
     */
    public static class RecFile implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            if (notGet(session)) return text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
            if (!DashHub.pit()) {
                return text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "MATCH mode: recordings are closed");
            }
            try {
                DashRec.flush();
                String name = qp(session, "name");
                if ("live".equals(name)) {
                    // 這一場的記憶體 ring（還沒 flush 的也在裡面），上限見 DashRec.MAX_BYTES
                    return resp(NanoHTTPD.Response.Status.OK, MIME_NDJSON, DashRec.ringText());
                }
                File f;
                if (name == null || name.length() == 0) {
                    List<File> fs = DashRec.listFiles();
                    if (fs.isEmpty()) return text(NanoHTTPD.Response.Status.NOT_FOUND, "no recordings");
                    f = fs.get(0);
                } else {
                    if (!DashRec.safeName(name)) return text(NanoHTTPD.Response.Status.BAD_REQUEST, "bad name");
                    f = new File(DashRec.dir(), name);
                    if (!f.isFile()) return text(NanoHTTPD.Response.Status.NOT_FOUND, "no such file");
                }
                // 串流，不要把整個檔案讀成 String：一場 3 分鐘就有 4 MB 以上，
                // 變成 String 是 16 MB 的 char[]，再加上送出去時轉回 byte[]，
                // Control Hub 會在賽後拉資料的時候 OOM。
                // NanoHTTPD 送完（或連線斷掉）會自己 close 這個 InputStream。
                NanoHTTPD.Response r = NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.OK, MIME_NDJSON,
                        new FileInputStream(f), f.length());
                r.addHeader("Access-Control-Allow-Origin", "*");
                r.addHeader("Cache-Control", "no-store");
                return r;
            } catch (Throwable t) {
                return text(NanoHTTPD.Response.Status.INTERNAL_ERROR, "rec error: " + t);
            }
        }
    }
}

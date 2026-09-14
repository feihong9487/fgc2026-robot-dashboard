package org.firstinspires.ftc.teamcode;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * DashNotify：一次性提示訊息（儀表板右上角那種會自己消失的小卡）。
 *
 * 與埋點的差別：埋點是「現在的狀態」，會被下一圈蓋掉；notify 是「剛剛發生了
 * 一件事」，前端要留 ttlMs 毫秒讓人看得到。所以它走 WebSocket 的 "notify"
 * 訊息型別，不佔 /FGC/... 的 key 空間。
 *
 * 規則：
 *   - 只有 PIT 而且真的有人在看（sockets 非空）才 broadcast。MATCH 不推播，
 *     這一條跟 nt / err 一樣，不開後門。
 *   - 不管哪一種模式，一律留一筆 /FGC/Bridge/Last Notify = level:title。
 *     那是黑盒子的一部分（DashRec 不分模式都錄），賽後查得到「第幾秒跳了什麼」。
 *   - level / title / desc 一律 ASCII（Driver Hub 與前端字型安全），
 *     這裡會自己過濾，呼叫端傳了中文也不會弄壞 JSON。
 *
 * ★ 呼叫端注意 ★ send() 會在呼叫執行緒上做 JSON 序列化與 socket 送出。
 * 從 OpMode 控制迴圈呼叫時務必自己做節流（每 N 秒最多一次），
 * 不要每圈都叫 —— 那會直接反映在 Loop ms 上。
 */
public final class DashNotify {

    private DashNotify() {}

    /** 這顆 Gson 只在本 ClassLoader 用，不進共享 map。 */
    private static final Gson GSON = new Gson();

    public static final int MAX_TTL_MS = 60000;

    public static final String LEVEL_INFO  = "INFO";
    public static final String LEVEL_WARN  = "WARN";
    public static final String LEVEL_ERROR = "ERROR";

    /**
     * 送一則提示。任何情況都不丟例外（錯誤路徑只留 Last Error）。
     *
     * @param level INFO / WARN / ERROR
     * @param title 短標題（ASCII，最多 48 字）
     * @param desc  說明（ASCII，最多 160 字）
     * @param ttlMs 前端保留毫秒數，0 = 由前端自己決定
     */
    public static void send(String level, String title, String desc, int ttlMs) {
        try {
            String lv = ascii(level, 16);
            if (lv.length() == 0) lv = LEVEL_INFO;
            String ti = ascii(title, 48);
            String de = ascii(desc, 160);

            int ttl = ttlMs;
            if (ttl < 0) ttl = 0;
            if (ttl > MAX_TTL_MS) ttl = MAX_TTL_MS;

            // 先留紀錄再推播：推播失敗（沒人在看、MATCH）也要看得到這件事發生過。
            DashHub.put("/FGC/Bridge/Last Notify", lv + ":" + ti);

            if (!DashHub.pit()) return;
            if (DashHub.sockets().isEmpty()) return;

            JsonObject o = new JsonObject();
            o.addProperty("level", lv);
            o.addProperty("title", ti);
            o.addProperty("desc",  de);
            o.addProperty("ttlMs", Integer.valueOf(ttl));
            o.addProperty("t", Double.valueOf((System.currentTimeMillis() - DashHub.t0()) / 1000.0));
            DashWs.broadcast("notify", GSON.toJson(o));
        } catch (Throwable t) {
            DashHub.lastError("notify: " + t);
        }
    }

    /** 只留可列印的 ASCII（0x20-0x7E），其餘換成空白；同時截長度。 */
    private static String ascii(String s, int max) {
        if (s == null) return "";
        int n = (s.length() < max) ? s.length() : max;
        StringBuilder sb = new StringBuilder(n);
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            sb.append((c >= 0x20 && c <= 0x7E) ? c : ' ');
        }
        return sb.toString().trim();
    }
}

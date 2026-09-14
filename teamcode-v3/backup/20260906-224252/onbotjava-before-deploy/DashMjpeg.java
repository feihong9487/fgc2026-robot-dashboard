package org.firstinspires.ftc.teamcode;

import android.graphics.Bitmap;

import fi.iki.elonen.NanoHTTPD;

import org.firstinspires.ftc.robotcore.external.function.Consumer;
import org.firstinspires.ftc.robotcore.external.function.Continuation;
import org.firstinspires.ftc.robotcore.external.stream.CameraStreamSource;
import org.firstinspires.ftc.robotcore.internal.webserver.WebHandler;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * DashMjpeg：/dash/stream.mjpg（multipart 串流）與 /dash/snapshot.jpg（單張）。
 *
 * 影格來源是 DashHub.camsrc() —— TagCam 開機時放進去的 VisionPortal
 * （它實作 SDK 的 CameraStreamSource）。
 *
 * ★ 為什麼壓縮是在相機執行緒做的（與任務書原本寫的不同）★
 * EasyOpenCV 的 OpenCvCameraBase 在 dispatch 之後長這樣：
 *     consumer.accept(bitmapForDs);
 *     bitmapForDs.recycle();          // ← 就在 accept 回來的下一行
 * （這是 javap -c org.openftc.easyopencv.OpenCvCameraBase$4 驗證過的 bytecode。）
 * 所以「把 Bitmap 參考交出去、等連線執行緒再 compress」一定會拿到已經 recycle
 * 的點陣圖，Bitmap.compress 會丟 IllegalStateException。SDK 自己的
 * CameraStreamServer.sendFrame 也是在 accept 裡面直接壓縮的（同樣驗證過）。
 * 因此這裡在 accept 內就壓成 JPEG bytes，只把 byte[] 交給連線執行緒。
 *
 * 其他規則
 *  - MATCH 一律 503（不管畫面、不管參數）。
 *  - 併發上限 1：第二條連線回 503 busy；連線關閉要遞減。
 *  - 2 秒拿不到新影格就結束串流（read 回 -1）。
 *  - ?fps=（預設 Constants.MJPEG_FPS）、?q=（預設 Constants.MJPEG_Q）。
 *    沒帶參數時每一幀都重讀 Constants，PIT 線上調參可以即時看到效果。
 */
public final class DashMjpeg {

    private DashMjpeg() {}

    public static final String BOUNDARY  = "fgcframe";
    public static final String MIME_MJPEG = "multipart/x-mixed-replace; boundary=" + BOUNDARY;
    public static final String MIME_JPEG  = "image/jpeg";

    /** 共享 map 裡的 key：併發計數、心跳、名額擁有者（都是 JDK 型別，可跨 ClassLoader）。 */
    public static final String K_CLIENTS = "mjpegClients";
    public static final String K_BEAT    = "mjpegBeat";
    public static final String K_OWNER   = "mjpegOwner";

    /** 一次抓影格最多等多久。 */
    public static final long GRAB_WAIT_MS = 500L;
    /** 連續多久抓不到影格就收工。 */
    public static final long STALE_MS = 2000L;
    /** 舊連線超過這麼久沒心跳就視為死掉，把名額搶回來。 */
    public static final long SLOT_STALE_MS = 5000L;

    /**
     * 同時允許幾條 MJPEG 串流。
     *
     * ★ 底下的名額回收（殭屍搶回）與 token 機制假設這個值就是 1 ★
     * owner 只記得「最後一個拿到名額的人」，多路的話舊連線的 token 會被誤判成
     * 過期。真的要支援多路，K_BEAT 與 K_OWNER 都要改成
     * ConcurrentHashMap&lt;String,Long&gt;（每條連線一個 id），不是把這個數字改大就好。
     * 而且機器上只有一顆相機、一格 getFrameBitmap 請求槽，多開只會兩邊都逾時。
     */
    public static final int MAX_CLIENTS = 1;

    // ── 共享計數器（放共享 map，讓舊 ClassLoader 留下的串流也算得到）─────

    private static AtomicInteger clients() {
        return (AtomicInteger) shared(K_CLIENTS, AtomicInteger.class);
    }

    private static AtomicLong beat() {
        return (AtomicLong) shared(K_BEAT, AtomicLong.class);
    }

    /** 目前名額的擁有者代號（每次發名額就 +1）。 */
    private static AtomicLong owner() {
        return (AtomicLong) shared(K_OWNER, AtomicLong.class);
    }

    /**
     * 共享 map 裡的計數器；不存在就建一個。
     * 用 putIfAbsent 而不是 synchronized (g)：這裡要的只是「只建一次」的語意，
     * 沒必要去搶那把跨 ClassLoader 的全域鎖（DashBoot.ensure() 也拿它）。
     */
    private static Object shared(String key, Class<?> type) {
        ConcurrentHashMap<String, Object> g = DashHub.g();
        Object o = g.get(key);
        if (type.isInstance(o)) return o;
        Object fresh = (type == AtomicLong.class) ? (Object) new AtomicLong(0L) : (Object) new AtomicInteger(0);
        Object prev = g.putIfAbsent(key, fresh);
        if (type.isInstance(prev)) return prev;
        if (prev != null) g.put(key, fresh);      // 位置上躺著別的東西：直接蓋掉
        return fresh;
    }

    /**
     * 拿一個串流名額。
     *
     * 回傳 0 = 沒拿到；非 0 = 這條連線的「名額代號」（token）。
     *
     * 為什麼要 token 而不是單純計數：斷線沒收到 close 的殭屍連線會讓計數卡住，
     * 所以心跳停超過 SLOT_STALE_MS 就把名額搶回來。但那條被判定為殭屍的舊連線
     * 可能只是暫時卡住（grab() 正在等 500 ms 逾時、或在寫大檔案），它之後仍然會
     * 走到 close() -> release()。若 release 只是把計數減一，就會把新連線的名額
     * 一起減掉，於是第三條連線可以無阻礙地 acquire()，變成兩條串流同時搶那唯一
     * 一格 getFrameBitmap 請求槽 —— 兩邊都一直逾時、畫面全黑，AprilTag pipeline
     * 也被拖垮。有了 token，release() 只有在「自己還是擁有者」時才遞減。
     */
    private static long acquire() {
        AtomicInteger n = clients();
        AtomicLong b = beat();
        for (;;) {
            int cur = n.get();
            if (cur >= MAX_CLIENTS) {
                if (MAX_CLIENTS != 1) return 0L;          // 回收邏輯只在單路時正確，見 MAX_CLIENTS
                // 前一條連線可能是斷線沒收到 close 的殭屍：心跳停超過 5 秒就搶回來
                long last = b.get();
                if (last != 0L && System.currentTimeMillis() - last > SLOT_STALE_MS) {
                    if (n.compareAndSet(cur, MAX_CLIENTS)) {
                        b.set(System.currentTimeMillis());
                        return owner().incrementAndGet();     // 換人：舊 token 就此作廢
                    }
                    continue;
                }
                return 0L;
            }
            if (n.compareAndSet(cur, cur + 1)) {
                b.set(System.currentTimeMillis());
                return owner().incrementAndGet();
            }
        }
    }

    /** 還名額；只有還是擁有者的那條連線算數（名額被搶走的舊連線不准動計數）。 */
    private static void release(long token) {
        if (token == 0L) return;
        if (owner().get() != token) return;                   // 名額早就被別人搶走了
        AtomicInteger n = clients();
        for (;;) {
            int cur = n.get();
            int next = (cur <= 0) ? 0 : cur - 1;
            if (n.compareAndSet(cur, next)) break;
        }
        if (n.get() <= 0) beat().set(0L);
        DashHub.put("/FGC/Camera/Clients", (double) n.get());
    }

    // ── 抓一張 JPEG ──────────────────────────────────────────────────────

    /**
     * 向 camsrc 要一張影格並壓成 JPEG。
     * 拿不到（沒相機、逾時、壓縮失敗）就回 null，絕不丟例外。
     */
    public static byte[] grab(int quality, long waitMs) {
        Object src = DashHub.camsrc();
        if (!(src instanceof CameraStreamSource)) return null;

        final int q = (quality < 5) ? 5 : (quality > 95 ? 95 : quality);
        final byte[][] out = new byte[1][];
        final CountDownLatch latch = new CountDownLatch(1);

        // 這個 consumer 會在相機執行緒上被同步呼叫（Continuation.createTrivial），
        // 而且 accept 一回來 SDK 就 recycle 那張 Bitmap，所以壓縮必須在這裡做完。
        Consumer<Bitmap> consumer = new Consumer<Bitmap>() {
            @Override
            public void accept(Bitmap bmp) {
                try {
                    if (bmp != null && !bmp.isRecycled()) {
                        ByteArrayOutputStream bos = new ByteArrayOutputStream(32768);
                        if (bmp.compress(Bitmap.CompressFormat.JPEG, q, bos)) {
                            out[0] = bos.toByteArray();
                        }
                    }
                } catch (Throwable t) {
                    DashHub.lastError("mjpeg compress: " + t);
                } finally {
                    latch.countDown();
                }
            }
        };

        try {
            ((CameraStreamSource) src).getFrameBitmap(Continuation.createTrivial(consumer));
            if (!latch.await(waitMs, TimeUnit.MILLISECONDS)) return null;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Throwable t) {
            DashHub.lastError("mjpeg grab: " + t);
            return null;
        }
        return out[0];
    }

    /** 組一段 multipart：boundary + 標頭 + JPEG + CRLF。 */
    static byte[] part(byte[] jpg) {
        String head = "--" + BOUNDARY + "\r\n"
                    + "Content-Type: image/jpeg\r\n"
                    + "Content-Length: " + jpg.length + "\r\n\r\n";
        byte[] h;
        try { h = head.getBytes("US-ASCII"); }
        catch (java.io.UnsupportedEncodingException e) { h = head.getBytes(); }
        byte[] out = new byte[h.length + jpg.length + 2];
        System.arraycopy(h, 0, out, 0, h.length);
        System.arraycopy(jpg, 0, out, h.length, jpg.length);
        out[out.length - 2] = (byte) '\r';
        out[out.length - 1] = (byte) '\n';
        return out;
    }

    // ── 參數 ─────────────────────────────────────────────────────────────

    private static int intParam(NanoHTTPD.IHTTPSession s, String name, int lo, int hi) {
        String v = DashHttp.qp(s, name);
        if (v == null || v.length() == 0) return Integer.MIN_VALUE;   // 沒給
        try {
            int n = (int) Math.round(Double.parseDouble(v.trim()));
            if (n < lo) n = lo;
            if (n > hi) n = hi;
            return n;
        } catch (Throwable t) {
            return Integer.MIN_VALUE;
        }
    }

    private static int liveFps() {
        int n = (int) Math.round(Constants.MJPEG_FPS);
        if (n < 1) n = 1;
        if (n > 30) n = 30;
        return n;
    }

    private static int liveQuality() {
        int n = (int) Math.round(Constants.MJPEG_Q);
        if (n < 5) n = 5;
        if (n > 95) n = 95;
        return n;
    }

    // ── /dash/stream.mjpg ────────────────────────────────────────────────

    public static class Stream implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            try {
                if (session.getMethod() != NanoHTTPD.Method.GET) {
                    return DashHttp.text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
                }
            } catch (Throwable ignored) {}

            if (!DashHub.pit()) {
                return DashHttp.text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "MATCH mode: camera is closed");
            }
            if (!(DashHub.camsrc() instanceof CameraStreamSource)) {
                return DashHttp.text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "no camera: run a Pit OpMode with the camera on");
            }

            int fps = intParam(session, "fps", 1, 30);
            int q   = intParam(session, "q", 5, 95);

            long token = acquire();
            if (token == 0L) {
                return DashHttp.text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "busy: one stream at a time");
            }
            DashHub.put("/FGC/Camera/Clients", (double) clients().get());

            MjpegStream in = null;
            try {
                in = new MjpegStream(fps, q, token);
                NanoHTTPD.Response r = NanoHTTPD.newChunkedResponse(
                        NanoHTTPD.Response.Status.OK, MIME_MJPEG, in);
                r.addHeader("Access-Control-Allow-Origin", "*");
                r.addHeader("Cache-Control", "no-store");
                r.addHeader("Pragma", "no-cache");
                // 這裡不呼叫 setKeepAlive：NanoHTTPD 的 HTTPSession.execute() 在
                // send() 之前會用請求標頭再蓋一次，設了也是白設。串流結束時
                // execute() 的 finally 一定會 safeClose(response) -> 我們的
                // MjpegStream.close() -> release()（bytecode 驗證過）。
                return r;
            } catch (Throwable t) {
                if (in != null) { try { in.close(); } catch (Throwable ignored) {} }
                else release(token);
                DashHub.lastError("mjpeg open: " + t);
                return DashHttp.text(NanoHTTPD.Response.Status.INTERNAL_ERROR, "stream error: " + t);
            }
        }
    }

    // ── /dash/snapshot.jpg ───────────────────────────────────────────────

    public static class Snapshot implements WebHandler {
        @Override
        public NanoHTTPD.Response getResponse(NanoHTTPD.IHTTPSession session) {
            try {
                if (session.getMethod() != NanoHTTPD.Method.GET) {
                    return DashHttp.text(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "GET only");
                }
            } catch (Throwable ignored) {}

            if (!DashHub.pit()) {
                return DashHttp.text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "MATCH mode: camera is closed");
            }
            int q = intParam(session, "q", 5, 95);
            if (q == Integer.MIN_VALUE) q = liveQuality();

            byte[] jpg = grab(q, 800L);
            if (jpg == null || jpg.length == 0) {
                return DashHttp.text(NanoHTTPD.Response.Status.SERVICE_UNAVAILABLE, "no frame");
            }
            DashHub.put("/FGC/Camera/Frame KB", Math.round(jpg.length / 102.4) / 10.0);
            NanoHTTPD.Response r = NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.OK, MIME_JPEG,
                    new ByteArrayInputStream(jpg), jpg.length);
            r.addHeader("Access-Control-Allow-Origin", "*");
            r.addHeader("Cache-Control", "no-store");
            return r;
        }
    }

    // ── 串流本體 ─────────────────────────────────────────────────────────

    /**
     * NanoHTTPD 的 sendBody() 會一直呼叫 read(byte[],0,16384)，回傳 &gt;0 就寫成一個
     * chunk，回傳 &lt;=0 就結束。所以：
     *   - 一定要覆寫 read(byte[],int,int)（不覆寫的話 InputStream 預設會一個 byte
     *     一個 byte 讀滿 16 KB 才回來，延遲會爆掉）；
     *   - 永遠不可以回 0（會被當成串流結束）；
     *   - 沒影格時就在 fill() 裡面等，真的等不到才回 -1。
     */
    static class MjpegStream extends InputStream {

        private final int fixedFps;      // Integer.MIN_VALUE = 跟著 Constants 走
        private final int fixedQuality;
        private final long token;        // 這條連線的名額代號（見 acquire）

        private byte[] buf = new byte[0];
        private int pos;

        private long nextFrameAt;
        private long lastFrameAt = System.currentTimeMillis();
        private long framesSent;

        private final AtomicBoolean closed = new AtomicBoolean(false);

        MjpegStream(int fps, int quality, long token) {
            this.fixedFps = fps;
            this.fixedQuality = quality;
            this.token = token;
        }

        @Override
        public int read() throws IOException {
            if (pos >= buf.length && !fill()) return -1;
            return buf[pos++] & 0xFF;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (b == null) throw new NullPointerException();
            if (off < 0 || len < 0 || len > b.length - off) throw new IndexOutOfBoundsException();
            if (len == 0) return 0;
            if (pos >= buf.length && !fill()) return -1;
            int n = buf.length - pos;
            if (n > len) n = len;
            System.arraycopy(buf, pos, b, off, n);
            pos += n;
            return n;
        }

        @Override
        public int available() {
            return buf.length - pos;
        }

        /** 準備下一段 multipart；拿不到就回 false（= 串流結束）。 */
        private boolean fill() {
            for (;;) {
                if (closed.get()) return false;
                if (!DashHub.enabled()) return false;
                if (!DashHub.pit()) return false;                 // 中途切回 MATCH：立刻斷

                if (owner().get() != token) return false;         // 名額被搶走了（本連線被判定成殭屍）
                beat().set(System.currentTimeMillis());           // 心跳，讓名額不會被誤搶

                int q = (fixedQuality == Integer.MIN_VALUE) ? liveQuality() : fixedQuality;
                int f = (fixedFps == Integer.MIN_VALUE) ? liveFps() : fixedFps;
                long period = 1000L / f;

                long now = System.currentTimeMillis();
                if (now < nextFrameAt) {
                    long nap = nextFrameAt - now;
                    if (nap > 200L) nap = 200L;                   // 分段睡，才聽得到中斷
                    if (!nap(nap)) return false;
                    continue;
                }

                byte[] jpg = grab(q, GRAB_WAIT_MS);
                if (jpg != null && jpg.length > 0) {
                    lastFrameAt = System.currentTimeMillis();
                    nextFrameAt = lastFrameAt + period;
                    buf = part(jpg);
                    pos = 0;
                    framesSent++;
                    DashHub.put("/FGC/Camera/Frames", (double) framesSent);
                    DashHub.put("/FGC/Camera/Frame KB", Math.round(jpg.length / 102.4) / 10.0);
                    return true;
                }

                if (System.currentTimeMillis() - lastFrameAt > STALE_MS) {
                    DashHub.put("/FGC/Camera/Last Error", "no frame for 2s");
                    return false;                                  // 2 秒沒新影格 -> read() 回 -1
                }
                if (!nap(20L)) return false;
            }
        }

        private boolean nap(long ms) {
            if (ms <= 0L) return true;
            try { Thread.sleep(ms); return true; }
            catch (InterruptedException ie) { Thread.currentThread().interrupt(); return false; }
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                release(token);                                   // 只遞減一次，而且只有擁有者算數
            }
        }
    }
}

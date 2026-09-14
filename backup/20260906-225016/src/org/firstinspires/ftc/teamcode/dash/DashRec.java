package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.robotcore.internal.system.AppUtil;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;

/**
 * DashRec：比賽錄影（不管 MATCH / PIT 都錄）。
 *
 * 每 50 ms 由 DashPublisher 把一批 dirty 寫成一行
 *   {"t":秒,"d":{...}}
 * 格式與儀表板 RobotClient.exportRecording 一致。
 * 記憶體 ring 上限 6000 行；每 10 秒把待寫佇列 append 到
 *   /sdcard/FIRST/fgc-rec/rec-yyyyMMdd-HHmmss.jsonl
 */
public final class DashRec {

    private DashRec() {}

    public static final String DIR_NAME  = "fgc-rec";
    public static final int    MAX_LINES = 6000;

    /**
     * ring 的位元組預算。
     * 只用行數封頂不夠：一行的大小取決於那 50 ms 內有多少 key 變動，
     * A1-MATCH 每圈約 40 個埋點、其中 Loop ms / Match s / Gamepad / Shooter
     * 每圈都不一樣，所以一行大約 1.0-1.5 KB，6000 行就是 6-9 MB 常駐。
     */
    public static final long MAX_BYTES = 2000000L;

    /** ring 目前的位元組數（放共享 map；AtomicLong 是 JDK 型別，可跨 ClassLoader）。 */
    private static AtomicLong ringBytes() {
        ConcurrentHashMap<String, Object> g = DashHub.g();
        Object o = g.get(K_RECBYTES);
        if (o instanceof AtomicLong) return (AtomicLong) o;
        AtomicLong fresh = new AtomicLong(0L);
        Object prev = g.putIfAbsent(K_RECBYTES, fresh);
        return (prev instanceof AtomicLong) ? (AtomicLong) prev : fresh;
    }

    /** 共享 map 內的 key。 */
    private static final String K_RECBYTES = "recbytes";

    /** 錄影資料夾（/sdcard/FIRST/fgc-rec）。 */
    public static File dir() {
        return new File(AppUtil.FIRST_FOLDER, DIR_NAME);
    }

    /**
     * 一批 key/value 變成一行 {"t":秒,"d":{...}}。
     *
     * t 一律用 DashHub.t0() 當原點：INIT 期間 t0 是 0，DashHub.t0() 會回
     * System.currentTimeMillis()，所以這段時間寫出去的行 t 全部是 0.000；
     * START 之後才會真的開始長。全量快照那一行也走這裡，語意才會一致。
     */
    private static String buildLine(Map<String, Object> d) {
        double t = (System.currentTimeMillis() - DashHub.t0()) / 1000.0;
        if (t < 0.0) t = 0.0;
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"t\":").append(String.format(Locale.US, "%.3f", Double.valueOf(t)))
          .append(",\"d\":").append(DashHub.toJson(d)).append('}');
        return sb.toString();
    }

    /** 一批 dirty 變成一行；同時進 ring 與待寫佇列。 */
    public static void addLine(Map<String, Object> d) {
        if (d == null || d.isEmpty()) return;
        String line = buildLine(d);

        ArrayDeque<String> ring = DashHub.rec();
        AtomicLong bytes = ringBytes();
        synchronized (ring) {
            ring.addLast(line);
            bytes.addAndGet(line.length());
            while (ring.size() > MAX_LINES || bytes.get() > MAX_BYTES) {
                String gone = ring.pollFirst();
                if (gone == null) { bytes.set(0L); break; }
                bytes.addAndGet(-gone.length());
            }
        }
        // 這一步也要拿 recPending 的鎖：startNewFile() 是在持鎖狀態下先 flushLocked()
        // 再 q.clear()，publisher 若剛好在那兩步之間 add，那行會被 clear 掉 ——
        // 也就是上一場最後一批資料靜默遺失。flushLocked 只是 poll 到空，持鎖很短。
        ConcurrentLinkedQueue<String> q = DashHub.recPending();
        synchronized (q) { q.add(line); }
    }

    /**
     * onOpModePreInit 的同步部分：把時間原點標記成「尚未開始」。
     *
     * t0 設 0：DashHub.t0() 對 &lt;= 0 的存值會回 System.currentTimeMillis()，
     * 所以 INIT 到 START 之間寫出去的行 t 全部是 0.000（不會從 0 長到 30 再跳回 0）。
     * 真正的原點由 DashBridge.DashListener.onOpModePreStart 設，符合規格
     * 「t 從 OpMode start 起算」，也保證同一個 .jsonl 內 t 單調遞增。
     *
     * ★ 這一步一定要同步做 ★ 如果丟到背景執行緒，而 sdcard 剛好很忙、駕駛又很快
     * 按下 START，這行就會在 onOpModePreStart 之後才執行，把真正的 t0 蓋成 0 ——
     * 那一整場的 t 會全部是 0.000。
     */
    private static void resetClock() {
        DashHub.setT0(0L);                       // 0 = 尚未 START
    }

    /**
     * 換檔的耗時部分：把上一場剩下的行寫完、關掉舊檔、清 ring 與待寫佇列。
     * 刻意不碰 t0（見 resetClock 的說明）。
     */
    private static void rotate() {
        ConcurrentLinkedQueue<String> q = DashHub.recPending();
        synchronized (q) {
            flushLocked();                       // 先把上一場剩下的寫完（K_RECFILE 還指著舊檔）
            DashHub.g().remove(DashHub.K_RECFILE);
            DashHub.recLines().set(0L);
            ArrayDeque<String> ring = DashHub.rec();
            synchronized (ring) { ring.clear(); ringBytes().set(0L); }
            q.clear();
            DashHub.put("/FGC/Rec/File", "");
            DashHub.put("/FGC/Rec/Lines", 0.0);
            seedSnapshotLocked();                // 新檔第一行 = 全量初始快照
        }
    }

    /**
     * 新檔的第一行補一份全量快照 {"t":0.000,"d":{全部 key}}。
     *
     * 沒有這一行的話，回放起點只有「這 50 ms 內剛好變動過的 key」，
     * 沒變過的（Target、Hubs、Param/*、CamState…）在整段回放裡永遠是空的。
     * 走 buildLine() 所以 t 的語意與其他行一致：rotate() 一定接在 resetClock()
     * 之後（t0 = 0），所以這一行必然是 0.000，不會破壞「START 後才起算」。
     *
     * ★ 必須在持有 recPending 鎖時呼叫 ★ 這樣 q.clear() 與這一行之間不會有別的
     * 行插進來，也就保證它是新檔的第一行。ring 的鎖在裡面才拿，順序與 rotate()
     * 其他地方一致（q → ring），不會有死鎖。
     */
    private static void seedSnapshotLocked() {
        try {
            Map<String, Object> all = new HashMap<String, Object>(DashHub.latest());
            if (all.isEmpty()) return;
            String line = buildLine(all);
            ArrayDeque<String> ring = DashHub.rec();
            synchronized (ring) {
                ring.addLast(line);
                ringBytes().addAndGet(line.length());
            }
            DashHub.recPending().add(line);
        } catch (Throwable t) {
            DashHub.lastError("rec seed: " + t);
        }
    }

    /** 同步版換檔（會做磁碟 I/O；event loop 執行緒請改用 startNewFileAsync()）。 */
    public static void startNewFile() {
        resetClock();
        rotate();
    }

    /**
     * onOpModePreInit 專用：時鐘同步歸零，耗時的換檔丟背景。
     *
     * 代價：背景那一段跑完之前，publisher 若已經寫了幾行（INIT 階段的埋點），
     * 那幾行會被 rotate() 的 clear 丟掉。窗口通常只有幾毫秒，最糟幾百毫秒，
     * 而且丟掉的只是 INIT 階段的資料，比在按 INIT 的瞬間卡住 event loop
     * （會被 OpModeStuckCodeMonitor 算進去）划算。
     */
    public static void startNewFileAsync() {
        resetClock();
        try {
            Thread t = new Thread(new Runnable() {
                @Override public void run() {
                    try { rotate(); } catch (Throwable e) { DashHub.lastError("rec newfile: " + e); }
                }
            }, "fgc-rec-newfile");
            t.setDaemon(true);
            t.start();
        } catch (Throwable t) {
            // 開不出執行緒就退回同步做，總比不換檔好
            try { rotate(); } catch (Throwable ignored) {}
        }
    }

    /** 每 10 秒 append flush 一次；丟不出去就吞掉並記到 Last Error。 */
    public static void flush() {
        ConcurrentLinkedQueue<String> q = DashHub.recPending();
        if (q.isEmpty()) return;
        synchronized (q) { flushLocked(); }
    }

    /** 已持有 recPending 鎖時使用。 */
    private static void flushLocked() {
        ConcurrentLinkedQueue<String> q = DashHub.recPending();
        if (q.isEmpty()) return;
        BufferedWriter w = null;
        try {
            File f = currentFile();
            if (f == null) { q.clear(); return; }
            w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f, true), "UTF-8"));
            long n = 0L;
            for (;;) {
                String line = q.poll();
                if (line == null) break;
                w.write(line);
                w.write('\n');
                n++;
            }
            w.flush();
            long total = DashHub.recLines().addAndGet(n);
            DashHub.put("/FGC/Rec/Lines", (double) total);
        } catch (Throwable t) {
            DashHub.lastError("rec flush: " + t);
            q.clear();                            // 別讓佇列無限長大
        } finally {
            if (w != null) { try { w.close(); } catch (Throwable ignored) {} }
        }
    }

    /** 目前檔案；沒有就用現在時間開一個新的。 */
    public static File currentFile() {
        Object o = DashHub.g().get(DashHub.K_RECFILE);
        if (o instanceof String && ((String) o).length() > 0) return new File((String) o);
        try {
            File d = dir();
            if (!d.exists()) d.mkdirs();
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
            File f = new File(d, "rec-" + stamp + ".jsonl");
            DashHub.g().put(DashHub.K_RECFILE, f.getAbsolutePath());
            DashHub.put("/FGC/Rec/File", f.getName());
            return f;
        } catch (Throwable t) {
            DashHub.lastError("rec open: " + t);
            return null;
        }
    }

    /** 目前檔名（給 /dash/health 用）；還沒開檔回空字串。 */
    public static String currentName() {
        Object o = DashHub.g().get(DashHub.K_RECFILE);
        if (o instanceof String && ((String) o).length() > 0) return new File((String) o).getName();
        return "";
    }

    /** 依修改時間新到舊排序的檔案清單。 */
    public static List<File> listFiles() {
        ArrayList<File> out = new ArrayList<File>();
        File d = dir();
        File[] fs = d.listFiles();
        if (fs == null) return out;
        for (int i = 0; i < fs.length; i++) {
            File f = fs[i];
            if (f.isFile() && f.getName().endsWith(".jsonl")) out.add(f);
        }
        File[] arr = out.toArray(new File[out.size()]);
        Arrays.sort(arr, new Comparator<File>() {
            @Override public int compare(File a, File b) {
                long da = a.lastModified(), db = b.lastModified();
                if (da == db) return b.getName().compareTo(a.getName());
                return (da < db) ? 1 : -1;
            }
        });
        out.clear();
        for (int i = 0; i < arr.length; i++) out.add(arr[i]);
        return out;
    }

    /** 記憶體 ring 的內容（這一場到目前為止，最多 MAX_LINES 行 / MAX_BYTES 位元組）。 */
    public static String ringText() {
        ArrayDeque<String> ring = DashHub.rec();
        synchronized (ring) {
            long cap = ringBytes().get() + ring.size() + 64L;      // 先算好長度，別讓 StringBuilder 反覆擴容再複製
            if (cap < 1024L) cap = 1024L;
            if (cap > 8000000L) cap = 8000000L;
            StringBuilder sb = new StringBuilder((int) cap);
            for (String line : ring) sb.append(line).append('\n');
            return sb.toString();
        }
    }

    /** 檔名安全檢查：只允許 rec-*.jsonl，不准有路徑分隔或 .. */
    public static boolean safeName(String name) {
        if (name == null || name.length() == 0 || name.length() > 64) return false;
        if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf("..") >= 0) return false;
        return name.startsWith("rec-") && name.endsWith(".jsonl");
    }

    // 註：以前這裡有一個 readFile(File) 把整個檔案讀成 String。已刪除 ——
    // 8 MB 的 .jsonl 變成 String 是 16 MB 的 char[]，加上讀檔的 byte[] 與
    // NanoHTTPD 送出去時又轉回 byte[]，瞬間 24-32 MB，Control Hub 會 OOM，
    // 而且是在賽後拉資料時炸掉。/dash/rec.jsonl 現在直接用 FileInputStream 串流。
}

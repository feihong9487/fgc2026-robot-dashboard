package org.firstinspires.ftc.teamcode;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * DashPublisher：50 ms 推播迴圈 + 錄影批次寫入。
 *
 * 規則 3（執行緒世代）：DashBoot.ensure() 先把 gen 加一並把新值傳進來，
 * 每圈檢查 myGen == gen.get()，不等就 return —— 這樣舊 ClassLoader 留下來的
 * 迴圈會自己收工，不會兩個世代同時推播。
 */
public class DashPublisher implements Runnable {

    public static final long PERIOD_MS = 50L;
    public static final long FLUSH_MS  = 10000L;

    private final long myGen;

    public DashPublisher(long myGen) { this.myGen = myGen; }

    @Override
    public void run() {
        AtomicInteger threads = DashHub.threads();
        threads.incrementAndGet();
        long lastFlush = System.currentTimeMillis();
        try {
            while (myGen == DashHub.gen().get() && !Thread.currentThread().isInterrupted()) {
                long tick = System.currentTimeMillis();
                try {
                    boolean on = DashHub.enabled();

                    if (on) DashParams.drainInbox();

                    stats();

                    Map<String, Object> d = DashHub.drainDirty();
                    if (d != null) {
                        // 錄影是「黑盒子」，不分 MATCH / PIT，也不看總開關 ——
                        // fgc.dash.enabled 管的是「對外橋接服務」，不是本地錄影。
                        // 以前 addLine 被綁在 on 底下，跑過一次 Z-DASH-OFF 整場就
                        // 完全沒有錄影，而且 /dash/health 也連不上（薄殼回 404），
                        // 現場根本發現不了 —— 那正好是最需要事後追查的情境。
                        DashRec.addLine(d);
                        // 推播才看總開關：只在 PIT、且有人在看才序列化
                        if (on && DashHub.pit() && !DashHub.sockets().isEmpty()) {
                            DashWs.broadcast("nt", DashHub.toJson(d));
                        }
                    }

                    long now = System.currentTimeMillis();
                    if (now - lastFlush >= FLUSH_MS) {
                        lastFlush = now;
                        if (myGen == DashHub.gen().get()) DashRec.flush();
                    }
                } catch (Throwable t) {
                    DashHub.lastError("publish: " + t);
                }

                long spent = System.currentTimeMillis() - tick;
                long nap = PERIOD_MS - spent;
                if (nap < 5L) nap = 5L;
                Thread.sleep(nap);
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        } catch (Throwable t) {
            DashHub.lastError("publish fatal: " + t);
        } finally {
            threads.decrementAndGet();
            try { if (myGen == DashHub.gen().get()) DashRec.flush(); } catch (Throwable ignored) {}
        }
    }

    /** 橋接器自身的狀態；這些值大多不會變，所以不會一直弄髒 dirty。 */
    private void stats() {
        DashHub.put("/FGC/Bridge/Gen", (double) DashHub.gen().get());
        DashHub.put("/FGC/Bridge/Threads", (double) DashHub.threads().get());
        DashHub.put("/FGC/Bridge/Viewers", (double) DashHub.sockets().size());
        DashHub.put("/FGC/Bridge/Mode", DashHub.mode());
        DashHub.put("/FGC/Bridge/Enabled", DashHub.enabled());
        DashHub.put("/FGC/Bridge/Camera", DashHub.camsrc() != null);
    }
}

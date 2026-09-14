package org.firstinspires.ftc.teamcode;

import org.firstinspires.ftc.robotcore.internal.webserver.websockets.FtcWebSocket;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.FtcWebSocketMessage;
import org.firstinspires.ftc.robotcore.internal.webserver.websockets.WebSocketNamespaceHandler;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * DashWs：namespace "dash" 的委派實作（每次 Build 由 DashBoot 換上新實例）。
 *
 * 規則 4：推播自己維護 socket 集合，不呼叫 WebSocketManager.broadcastToNamespace。
 * 這個類別本身不會被 registerNamespaceHandler 註冊 —— 註冊的是 DashBridge 裡的薄殼。
 */
public class DashWs extends WebSocketNamespaceHandler {

    public DashWs() { super(DashHub.NS); }

    @Override
    public void onSubscribe(FtcWebSocket ws) {
        try {
            DashHub.sockets().add(ws);
            DashHub.put("/FGC/Bridge/Viewers", (double) DashHub.sockets().size());
            hello(ws);
        } catch (Throwable t) {
            DashHub.lastError("ws subscribe: " + t);
        }
    }

    @Override
    public void onUnsubscribe(FtcWebSocket ws) {
        try {
            DashHub.sockets().remove(ws);
            DashHub.put("/FGC/Bridge/Viewers", (double) DashHub.sockets().size());
        } catch (Throwable t) {
            DashHub.lastError("ws unsubscribe: " + t);
        }
    }

    @Override
    public boolean onMessage(FtcWebSocketMessage msg, FtcWebSocket ws) {
        try {
            if (msg == null) return false;
            String type = msg.getType();
            if ("set".equals(type)) {
                if (!DashHub.pit()) {
                    // 點對點回應（不是廣播），而且刻意不回傳 key 名稱
                    send(ws, "err", DashHub.errJson("", "rejected"));
                    return true;
                }
                offerSet(msg.getPayload());
                return true;
            }
            if ("hello".equals(type) || "sync".equals(type)) {
                hello(ws);
                return true;
            }
            return false;
        } catch (Throwable t) {
            DashHub.lastError("ws message: " + t);
            return true;
        }
    }

    /**
     * 送一次 hello。
     *
     * PIT 是全量 snapshot；MATCH 只送 /FGC/Bridge/* 白名單（見 DashHub.helloJson）。
     * 規則 4 要求「訂閱就立刻 hello」，模式規則要求「MATCH 不推播比賽資料」——
     * 兩者的交集就是「照樣回一則 hello，但裡面沒有比賽資料」。
     */
    public static void hello(FtcWebSocket ws) {
        send(ws, "hello", DashHub.helloJson());
    }

    /** 丟進 inbox 給 publisher 執行緒處理（不在 WS 執行緒上動硬體參數）。 */
    public static void offerSet(String payload) {
        if (payload == null) return;
        java.util.concurrent.ConcurrentLinkedQueue<String> q = DashHub.inbox();
        if (q.size() >= 64) return;                 // 沒人處理時別無限長大
        q.add(payload);
    }

    public static void send(FtcWebSocket ws, String type, String payload) {
        if (ws == null || payload == null) return;
        try {
            if (!ws.isOpen()) { DashHub.sockets().remove(ws); return; }
            ws.send(new FtcWebSocketMessage(DashHub.NS, type, payload));
        } catch (Throwable t) {
            try { DashHub.sockets().remove(ws); } catch (Throwable ignored) {}
        }
    }

    /**
     * 廣播給自己維護的 socket 集合。集合為空時直接回傳，
     * 呼叫端應該在集合為空時就跳過序列化。
     */
    public static void broadcast(String type, String payload) {
        if (payload == null) return;
        CopyOnWriteArraySet<Object> set = DashHub.sockets();
        if (set.isEmpty()) return;
        ArrayList<Object> dead = null;
        Iterator<Object> it = set.iterator();
        while (it.hasNext()) {
            Object o = it.next();
            if (!(o instanceof FtcWebSocket)) { if (dead == null) dead = new ArrayList<Object>(); dead.add(o); continue; }
            FtcWebSocket ws = (FtcWebSocket) o;
            try {
                if (!ws.isOpen()) { if (dead == null) dead = new ArrayList<Object>(); dead.add(o); continue; }
                ws.send(new FtcWebSocketMessage(DashHub.NS, type, payload));
            } catch (Throwable t) {
                if (dead == null) dead = new ArrayList<Object>();
                dead.add(o);
            }
        }
        if (dead != null) {
            for (int i = 0; i < dead.size(); i++) set.remove(dead.get(i));
            DashHub.put("/FGC/Bridge/Viewers", (double) set.size());
        }
    }
}

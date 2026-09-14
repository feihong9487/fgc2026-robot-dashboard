package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.io.File;
import java.util.List;

/**
 * Z-DASH-EXPORT —— 賽後拉錄影用的小工具。不碰任何硬體。
 *
 * 為什麼需要這一支：
 *   /dash/rec.json 與 /dash/rec.jsonl 在 MATCH 模式下一律回 503（錄影是整段
 *   時間序列，比 state.json 洩漏得更多，比賽中不能開）。而 OpMode 一結束，
 *   DashListener.onOpModePostStop 就把模式壓回 MATCH —— 所以「拉檔案」需要有
 *   一支正在跑、而且把模式設成 PIT 的 OpMode。
 *
 * 用法：按 INIT（不用按 START）→ 螢幕會列出最新幾個錄影檔的檔名與大小 →
 * 照著檔名 curl → 拉完按 STOP。
 *
 *   curl.exe http://192.168.43.1:8080/dash/rec.json
 *   curl.exe -o m1.jsonl "http://192.168.43.1:8080/dash/rec.jsonl?name=rec-20260906-141230.jsonl"
 *
 * ★ 一定要用檔名指定 ★ 按下 INIT 的那一刻 onOpModePreInit 會開一個新的錄影檔，
 * 所以「不給 name = 最新的檔案」會拿到這一支自己剛開的空檔，不是上一場比賽。
 * 上一場的資料在按 STOP 的時候就已經完整 flush 到它自己的檔案裡了。
 *
 * 總開關若被 Z-DASH-OFF 關掉，8080 全部回 404 —— 這支會順手把它打開。
 */
@TeleOp(name = "Z-DASH-EXPORT", group = "Z")
public class DashExport extends LinearOpMode {

    /** 螢幕上最多列幾個檔案。 */
    private static final int SHOW = 6;

    @Override
    public void runOpMode() {
        DashBoot.ensure("export");
        DashHub.setEnabled(true);               // 8080 回 404 的話什麼都拉不到
        DashHub.setMode(DashHub.MODE_PIT);      // rec 端點只有 PIT 開

        while (!isStopRequested()) {
            DashHub.setMode(DashHub.MODE_PIT);  // 有人中途跑 Z-DASH-OFF/ON 也要撐住
            DashHub.put("/FGC/Status/OpMode", "Z-DASH-EXPORT");

            telemetry.addLine("EXPORT MODE - recordings are open");
            telemetry.addLine("curl http://192.168.43.1:8080/dash/rec.json");
            telemetry.addLine("curl -o m1.jsonl \"http://192.168.43.1:8080/dash/rec.jsonl?name=<file>\"");
            telemetry.addLine("use an explicit name: the newest file is this OpMode's own");
            try {
                DashRec.flush();
                List<File> fs = DashRec.listFiles();
                telemetry.addData("files", fs.size());
                for (int i = 0; i < fs.size() && i < SHOW; i++) {
                    File f = fs.get(i);
                    telemetry.addData(f.getName(), "%.0f KB", Double.valueOf(f.length() / 1024.0));
                }
            } catch (Throwable t) {
                telemetry.addData("error", String.valueOf(t));
            }
            telemetry.addData("enabled", DashHub.enabled() ? "1" : "0");
            telemetry.addData("mode", DashHub.mode());
            telemetry.update();

            sleep(500);
        }

        DashHub.setMode(DashHub.MODE_MATCH);    // 收工一定要關回去
    }
}

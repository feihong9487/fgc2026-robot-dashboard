# FGC 2026 官方 AprilTag 檔案（2026-09-06 自 REV 下載）

來源：https://docs.revrobotics.com/first-global/apriltags-fgc（Game Manual 2.2 指向 https://first.global/fgc/robot-kit/）

| 檔案 | 用途 |
|---|---|
| IgnitingInnovationAprilTagLibrary-1.0.jar | 標籤庫（class `global.first.IgnitingInnovationGameDatabase`）。用 OnBot Java 的 Upload Files 上傳，會出現在 ExternalLibraries |
| IgnitingInnovationAprilTagSample.java | 官方 OnBot Java 範例（webcam 名稱需為 "Webcam 1"） |
| IgnitingInnovationAprilTagBlocksSample.blk | 官方 Blocks 範例 |
| A4-AprilTags-IgnitingInnovation26.zip / Letter-… | 印刷用 PDF（ID 100–104），務必 100% 原尺寸列印，黑框外緣 160 mm、含白邊 200 mm |

## 標籤規格（由 jar 反組譯 + 場地 STEP/圖紙解算）

- Tag family：36h11；尺寸 160 mm；官方庫**沒有**場地座標，`detection.robotPose` 會是 null。
- 高度：標籤中心離地毯 791 mm（五個相同）。
- 場地：7000 × 7000 mm 地毯面（護欄外緣 7400），CAD 原點在場地中心，+X 朝藍方站、+Y 朝 SUPPRESSION UNIT / EXTINGUISHER。

| ID | 名稱 | 中心原點座標 (x, y, z) mm | 法線 | yaw（+X 逆時針） | 角落原點座標 (x', y') |
|---|---|---|---|---|---|
| 100 | Red Side - Facing Drivers | (−1674, +3152, 791) | (−0.866, −0.500, 0) | 210° | (1826, 6652) |
| 101 | Red Side - Facing Audience | (−975, +2790, 791) | (0, −1, 0) | 270° | (2525, 6290) |
| 102 | Center - Facing Audience | (0, +2787, 791) | (0, −1, 0) | 270° | (3500, 6287) |
| 103 | Blue Side - Facing Audience | (+975, +2790, 791) | (0, −1, 0) | 270° | (4475, 6290) |
| 104 | Blue Side - Facing Drivers | (+1674, +3152, 791) | (+0.866, −0.500, 0) | 330° | (5174, 6652) |

X/Y 誤差約 ±6 mm（STEP 內兩個板實體厚度不同取平均）；側面兩片（100/104）相對觀眾方向外斜 30°。現場請以實測複核。

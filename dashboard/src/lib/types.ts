// 與機器人端 mapping::FieldPose（src/main/include/lib/mapping/FieldMap.h）同義。
// 座標系見該檔案開頭註解：原點在場地左下角，x 沿長邊（cm），y 沿短邊（cm），
// heading 為 deg，**0° = 車頭朝 +y，順時針為正**（不是常見的「0°=+x、逆時針」）。
// 故車頭方向 = (sin θ, cos θ)。這是 ChassisKinematics/ChassisOdometry 推出來的、
// 不可自行更改的慣例；機器人端由 tools/mathtest/test_frames.cpp 鎖住，畫圖或反解
// 角度前先看那組測試。
export interface Pose2d {
  xCm: number;
  yCm: number;
  headingDeg: number;
}

// 注意：機器人端故意存在兩條座標發布路徑，單位不同，讀取時勿混用：
//   /Shuffleboard/Sim/Pose X m                  — 公尺，給外部 FieldView 模擬工具用（見 sim.ts / FieldView.tsx，對應 keys.ts 的 SIM_K）
//   /Shuffleboard/TitanDrive/Odometry/Pose X cm — 公分，真實遙測（見 PathTestPanel.tsx，對應 keys.ts 的 TD_K）
// 兩者刻意保持不同單位以對齊各自消費端慣例。本檔的 Pose2d 語意鎖定 cm，
// 不要把公尺制的 Sim 路徑數值直接塞進 Pose2d。

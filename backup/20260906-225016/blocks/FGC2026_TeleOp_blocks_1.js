// IDENTIFIERS_USED=gamepad1,intakeAsDcMotor,LAsDcMotor,RAsDcMotor,shooter_blackAsDcMotor,shooter_grayAsDcMotor,wayAsDcMotor,yoyoLAsServo,yoyoRAsServo

var shootLatch, drive, turn;

/**
 * FGC2026 TeleOp (Blocks) - R2進入射擊鎖定/L2解除, L1開倉R1關倉, X退球
 */
function runOpMode() {
  LAsDcMotor.setDirection("REVERSE");
  shooter_blackAsDcMotor.setDirection("REVERSE");
  wayAsDcMotor.setDirection("REVERSE");
  intakeAsDcMotor.setDirection("REVERSE");
  LAsDcMotor.setZeroPowerBehavior("BRAKE");
  RAsDcMotor.setZeroPowerBehavior("BRAKE");
  shooter_blackAsDcMotor.setMode("STOP_AND_RESET_ENCODER");
  shooter_grayAsDcMotor.setMode("STOP_AND_RESET_ENCODER");
  wayAsDcMotor.setMode("STOP_AND_RESET_ENCODER");
  shooter_blackAsDcMotor.setMode("RUN_USING_ENCODER");
  shooter_grayAsDcMotor.setMode("RUN_USING_ENCODER");
  wayAsDcMotor.setMode("RUN_USING_ENCODER");
  yoyoRAsServo.setDirection("REVERSE");
  yoyoLAsServo.setPosition(0);
  yoyoRAsServo.setPosition(0);
  shootLatch = false;
  linearOpMode.waitForStart();
  yoyoLAsServo.setPosition(0.315);
  yoyoRAsServo.setPosition(0.315);
  while (linearOpMode.opModeIsActive()) {
    drive = -gamepad1.getLeftStickY() * Math.abs(gamepad1.getLeftStickY());
    turn = 0.8 * -gamepad1.getRightStickX() * Math.abs(gamepad1.getRightStickX());
    LAsDcMotor.setDualPower(Math.min(Math.max(drive + turn, -1), 1), RAsDcMotor, Math.min(Math.max(drive - turn, -1), 1));
    if (gamepad1.getRightTrigger() > 0.5) {
      shootLatch = true;
    }
    if (gamepad1.getLeftTrigger() > 0.5) {
      shootLatch = false;
    }
    if (gamepad1.getCross()) {
      shooter_blackAsDcMotor.setVelocity(-800);
      shooter_grayAsDcMotor.setVelocity(-800);
      wayAsDcMotor.setVelocity(-500);
      intakeAsDcMotor.setPower(-1);
    } else if (shootLatch) {
      shooter_blackAsDcMotor.setVelocity(2000);
      shooter_grayAsDcMotor.setVelocity(800);
      wayAsDcMotor.setVelocity(500);
      intakeAsDcMotor.setPower(1);
    } else {
      shooter_blackAsDcMotor.setVelocity(0);
      shooter_grayAsDcMotor.setVelocity(0);
      wayAsDcMotor.setVelocity(-500);
      intakeAsDcMotor.setPower(1);
    }
    if (gamepad1.getLeftBumper()) {
      yoyoLAsServo.setPosition(0.315);
      yoyoRAsServo.setPosition(0.315);
    }
    if (gamepad1.getRightBumper()) {
      yoyoLAsServo.setPosition(0);
      yoyoRAsServo.setPosition(0);
    }
  }
}

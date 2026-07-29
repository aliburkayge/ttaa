import { spawn } from "node:child_process";

const serviceName = String(process.env.RAILWAY_SERVICE_NAME || "").toLowerCase();
const workerMode = process.env.CONTENT_WORKER === "true" || serviceName.includes("worker");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const script = workerMode ? "worker:railway" : "web:railway";

process.stdout.write(`${JSON.stringify({
  event: "railway.start_mode",
  service: serviceName || null,
  mode: workerMode ? "worker" : "web",
  timestamp: new Date().toISOString(),
})}\n`);

const child = spawn(npmCommand, ["run", script], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  process.stderr.write(`${JSON.stringify({
    event: "railway.start_failed",
    mode: workerMode ? "worker" : "web",
    error: error.message,
    timestamp: new Date().toISOString(),
  })}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["-e", "setInterval(() => {}, 1000)"],
  { stdio: "ignore" }
);
console.log(child.pid);
setInterval(() => {}, 1_000);

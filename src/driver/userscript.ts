import { run, type DriverIO } from "./loop";
import { extract } from "@/simulator";
import { goal } from "@/model";
import { noopPolicy } from "@/policy/noop";

 
console.log("[autoplayer] userscript loaded");

const start = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as Window & { gamePage?: any };
  if (typeof w.gamePage === "undefined") {
    setTimeout(start, 500);
    return;
  }
   
  console.log("[autoplayer] gamePage detected, starting no-op driver");
  const io: DriverIO = {
    read: () => extract(w.gamePage),
    apply: () => {
      // placeholder
    },
    waitUntilNextEvent: () => new Promise<void>((r) => setTimeout(r, 1000)),
    shouldStop: (s) => goal(s),
  };
  void run(noopPolicy, io);
};
start();

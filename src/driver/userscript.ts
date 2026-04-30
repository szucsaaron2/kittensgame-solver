import { run, type DriverIO } from "./loop";
import { extract } from "@/simulator";
import { goal } from "@/model";
import { noopPolicy } from "@/policy/noop";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const unsafeWindow: any;

console.log("[autoplayer] userscript loaded");

// Tampermonkey isolates user scripts from page scripts; gamePage lives on the
// page's window, not ours. Prefer unsafeWindow when available.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pageWindow: any = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

let attempts = 0;
const start = (): void => {
  attempts++;
   
  const gp = pageWindow.gamePage as unknown;
  if (typeof gp !== "undefined" && gp !== null) {
    console.log(`[autoplayer] gamePage detected after ${attempts} polls, starting no-op driver`);
    const io: DriverIO = {
       
      read: () => extract(pageWindow.gamePage),
      apply: () => {
        // placeholder
      },
      waitUntilNextEvent: () => new Promise<void>((r) => setTimeout(r, 1000)),
      shouldStop: (s) => goal(s),
    };
    void run(noopPolicy, io);
    return;
  }
  if (attempts % 10 === 0) {
    console.log(`[autoplayer] still waiting for gamePage (${attempts} polls)`);
  }
  setTimeout(start, 500);
};
start();

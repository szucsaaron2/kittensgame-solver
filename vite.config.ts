import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  plugins: [
    monkey({
      entry: "src/driver/userscript.ts",
      userscript: {
        name: "Kittens Game Autoplayer",
        namespace: "https://github.com/szucsaaron2/kittens-autoplayer",
        version: "0.1.0",
        description: "Plays Kittens Game to completion (no paragon/karma).",
        match: [
          "https://kittensgame.com/web/*",
          "https://kittensgame.com/beta/*",
          "https://kittensgame.com/alpha/*",
          "https://kittensgame.com/desktop/*",
        ],
        grant: ["GM_setValue", "GM_getValue", "GM_log"],
        runAt: "document-end",
      },
    }),
  ],
});

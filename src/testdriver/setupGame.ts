/**
 * Boot the Kittens Game in Node by mirroring the upstream `test/setup.js` pattern.
 *
 * Why not jsdom + index.html: dojo.xd.js does XHR-based AMD loading that does not
 * work in jsdom; the upstream maintainers themselves abandoned that path and use a
 * mocked dojo + sequential `require()` of the source files. We do the same.
 */

import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import seedrandom from "seedrandom";

const VENDOR_DIR = resolve("kittensgame-master");
const requireGame = createRequire(resolve(VENDOR_DIR, "package.json"));

export interface GameHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gamePage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window: any;
  tick(n?: number): void;
  teardown(): Promise<void>;
}

export interface SetupOptions {
  seed?: number;
  saveString?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

let bootedOnce = false;
 
let cachedNamespaces: { com: AnyObj; classes: AnyObj; mixin: AnyObj; dojo: AnyObj } | null = null;

function bootOnce(): NonNullable<typeof cachedNamespaces> {
  if (cachedNamespaces) return cachedNamespaces;

  // 1. Provide a minimal browser-ish global env.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
   
  const g = globalThis as AnyObj;
  const setIfWritable = (key: string, value: unknown): void => {
    try {
      g[key] = value;
    } catch {
      // Some Node versions define navigator/etc. as read-only globals; that's fine.
    }
  };
  setIfWritable("window", dom.window);
  setIfWritable("document", dom.window.document);
  setIfWritable("navigator", dom.window.navigator);
  setIfWritable("location", dom.window.location);
  setIfWritable("localStorage", dom.window.localStorage);
  setIfWritable("sessionStorage", dom.window.sessionStorage);
  g.LCstorage = dom.window.localStorage;
  setIfWritable("XMLHttpRequest", dom.window.XMLHttpRequest);
  setIfWritable("Element", dom.window.Element);
  setIfWritable("HTMLElement", dom.window.HTMLElement);
  setIfWritable("Node", dom.window.Node);

  // 2. Mocked dojo namespace + declare.
   
  const createNamespace = requireGame("./test/declare");
  const namespace: AnyObj = { com: {}, classes: {}, mixin: {} };
   
  const dojoDeclare = createNamespace(namespace);
  g.com = namespace.com;
  g.classes = namespace.classes;
  g.mixin = namespace.mixin;
  // The game looks up `window["classes"]["managers"]`, so the namespaces must be
  // visible on the dom.window proxy too.
   
  (dom.window as AnyObj).com = namespace.com;
   
  (dom.window as AnyObj).classes = namespace.classes;
   
  (dom.window as AnyObj).mixin = namespace.mixin;

  const dojo: AnyObj = {
    version: { minor: 6 },

    declare: dojoDeclare.declare,
    destroy: () => undefined,
    empty: () => undefined,
    byId: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach: (array: any, predicate: (v: any, i: any) => void) => {

      for (const i in array) predicate(array[i], i);
    },
    clone: function clone(m: unknown): unknown {
      if (Array.isArray(m)) return m.map(clone);
      return Object.assign({}, m);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hitch: (ctx: any, method: any) => {

      return method.bind(ctx);
    },
    connect: () => undefined,
    publish: () => undefined,
    subscribe: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mixin: (obj: any, mixin: any) => Object.assign(obj, mixin),
    // DOM-mutation stubs: the engine occasionally creates UI nodes
    // (calendar.js onNewDay → observe button, game.js save tooltip,
    // various style toggles). In headless mode we have no DOM; return
    // a permissive sentinel that swallows further property reads/writes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (..._args: any[]) => ({}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    place: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attr: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setAttr: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addClass: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeClass: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toggleClass: (..._args: any[]) => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (..._args: any[]) => [],
  };
  g.dojo = dojo;

  // 3. jQuery, React, LZString, dropbox, system.
   
  g.React = requireGame("./lib/react.min.js");
   
  g.$ = requireGame("./lib/jQuery");
   
  g.$.ajax = () => ({ done() { return this; }, fail() { return this; } });
   
  g.LZString = requireGame("./lib/lz-string.js");
  requireGame("./lib/dropbox_v2.js");
  requireGame("./lib/system.js");

  // 4. Game source. i18n stub goes between i18n.js (which defines $I) and core.js
  // (which calls $I), matching upstream test/setup.js order.
  requireGame("./config");
  requireGame("./i18n");
  g.$I = (key: string) => `$${key}$`;
  requireGame("./core");
  requireGame("./js/resources");
  requireGame("./js/calendar");
  requireGame("./js/buildings");
  requireGame("./js/village");
  requireGame("./js/science");
  requireGame("./js/workshop");
  requireGame("./js/diplomacy");
  requireGame("./js/religion");
  requireGame("./js/achievements");
  requireGame("./js/settings");
  requireGame("./js/space");
  requireGame("./js/prestige");
  requireGame("./js/time");
  requireGame("./js/stats");
  requireGame("./js/challenges");
  requireGame("./js/void");
  requireGame("./js/math");
  requireGame("./game");
  // UI is optional; resetState requires UI to be set.
  try {
    requireGame("./js/jsx/left.jsx");
  } catch {
    // jsx may not be loadable in node; that's fine, we'll set a stub UI below.
  }
  try {
    requireGame("./js/ui");
    requireGame("./js/toolbar");
  } catch {
    // UI loading can fail in node; still fine for headless solver work.
  }

  // 6. newrelic stub (game.js calls it from heartbeat).
  g.newrelic = {
    addPageAction: () => undefined,
    addRelease: () => undefined,
    setCustomAttribute: () => undefined,
    setErrorHandler: () => undefined,
  };

  bootedOnce = true;
  cachedNamespaces = {
    com: namespace.com,
    classes: namespace.classes,
    mixin: namespace.mixin,
    dojo,
  };
  return cachedNamespaces;
}

export function setupGame(opts: SetupOptions = {}): GameHandle {
  const ns = bootOnce();

  // Seeded RNG: override Math.random so all subsequent game logic is deterministic.
  // We override globalThis.Math.random because the require()-loaded modules share
  // this global. Set it BEFORE constructing GamePage so init-time randomness is
  // also captured.
  const seed = opts.seed ?? 0;
  const rng = seedrandom(String(seed));
   
  const originalRandom = Math.random;
  Math.random = (): number => rng();

   
  const gamePage = new ns.com.nuclearunicorn.game.ui.GamePage();
   
  const g = globalThis as AnyObj;
  g.gamePage = gamePage;
  g.game = gamePage;

  // resetState wires up internal building/effect bookkeeping.
  // It needs a UI; provide a minimal stub if classes.ui.UISystem isn't available.
   
  const UISystem = ns.classes?.ui?.UISystem;
  if (UISystem) {
     
    gamePage.setUI(new UISystem("gameContainerId"));
  } else {
     
    gamePage.setUI({
       
      render: () => {},
       
      update: () => {},
       
      displayAutosave: () => {},
       
      onLoaded: () => {},
       
      attachTooltip: () => {},
       
      hideTooltip: () => {},
    });
  }
   
  gamePage.resetState();

  // Fire calculateEffects on every village job once. Upstream's job metadata
  // for scholar / priest / geologist / engineer starts with `modifiers: {}`
  // and only fills in the real production modifiers (science / faith / coal /
  // craft) inside `calculateEffects`. The live game's UI render path triggers
  // this lazily on first paint; in headless mode we never render, so without
  // this pass scholars produce 0 science, priests produce 0 faith, etc.
  // upstream village.js: scholar:42-52, priest:87-101, geologist:108-138.
  type JobMeta = {
    name: string;
    modifiers?: Record<string, number>;
    calculateEffects?: (self: unknown, game: unknown) => void;
  };
  const villageJobs = (gamePage as { village?: { jobs?: JobMeta[] } }).village?.jobs;
  if (Array.isArray(villageJobs)) {
    for (const job of villageJobs) {
      try {
        job.calculateEffects?.(job, gamePage);
      } catch {
        // Calc may throw if a referenced workshop/upgrade isn't initialized
        // yet at boot; the live game retries on subsequent renders. Same here:
        // the relevant upgrade-driven re-fire (e.g. astrophysicists adding
        // starchart to scholar) goes through game.upgrade and works correctly.
      }
    }
  }

  return {
    gamePage,
    window: g.window,
    tick(n: number = 1): void {
      for (let i = 0; i < n; i++) {
         
        gamePage.tick();
      }
    },
    async teardown(): Promise<void> {
       
      const gg = globalThis as AnyObj;
      gg.gamePage = undefined;
      gg.game = undefined;
      Math.random = originalRandom;
      await Promise.resolve();
    },
  };
}

export function isBooted(): boolean {
  return bootedOnce;
}

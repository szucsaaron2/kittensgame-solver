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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedNamespaces: { com: AnyObj; classes: AnyObj; mixin: AnyObj; dojo: AnyObj } | null = null;

function bootOnce(): NonNullable<typeof cachedNamespaces> {
  if (cachedNamespaces) return cachedNamespaces;

  // 1. Provide a minimal browser-ish global env.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const createNamespace = requireGame("./test/declare");
  const namespace: AnyObj = { com: {}, classes: {}, mixin: {} };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
  const dojoDeclare = createNamespace(namespace);
  g.com = namespace.com;
  g.classes = namespace.classes;
  g.mixin = namespace.mixin;
  // The game looks up `window["classes"]["managers"]`, so the namespaces must be
  // visible on the dom.window proxy too.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (dom.window as AnyObj).com = namespace.com;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (dom.window as AnyObj).classes = namespace.classes;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (dom.window as AnyObj).mixin = namespace.mixin;

  const dojo: AnyObj = {
    version: { minor: 6 },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    declare: dojoDeclare.declare,
    destroy: () => undefined,
    empty: () => undefined,
    byId: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    forEach: (array: any, predicate: (v: any, i: any) => void) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      for (const i in array) predicate(array[i], i);
    },
    clone: function clone(m: unknown): unknown {
      if (Array.isArray(m)) return m.map(clone);
      return Object.assign({}, m);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hitch: (ctx: any, method: any) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return method.bind(ctx);
    },
    connect: () => undefined,
    publish: () => undefined,
    subscribe: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mixin: (obj: any, mixin: any) => Object.assign(obj, mixin),
  };
  g.dojo = dojo;

  // 3. jQuery, React, LZString, dropbox, system.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  g.React = requireGame("./lib/react.min.js");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  g.$ = requireGame("./lib/jQuery");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  g.$.ajax = () => ({ done() { return this; }, fail() { return this; } });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
  void opts; // seed/saveString hooks land in Phase 3.
  const ns = bootOnce();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const gamePage = new ns.com.nuclearunicorn.game.ui.GamePage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as AnyObj;
  g.gamePage = gamePage;
  g.game = gamePage;

  // resetState wires up internal building/effect bookkeeping.
  // It needs a UI; provide a minimal stub if classes.ui.UISystem isn't available.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
  const UISystem = ns.classes?.ui?.UISystem;
  if (UISystem) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    gamePage.setUI(new UISystem("gameContainerId"));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    gamePage.setUI({
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      render: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      update: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      displayAutosave: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onLoaded: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      attachTooltip: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      hideTooltip: () => {},
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  gamePage.resetState();

  return {
    gamePage,
    window: g.window,
    tick(n: number = 1): void {
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        gamePage.tick();
      }
    },
    async teardown(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gg = globalThis as AnyObj;
      gg.gamePage = undefined;
      gg.game = undefined;
      await Promise.resolve();
    },
  };
}

export function isBooted(): boolean {
  return bootedOnce;
}

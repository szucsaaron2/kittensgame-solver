# Kittens Game Autoplayer

A TypeScript autoplayer that drives Kittens Game to completion (no paragon/karma).

## Reference docs

- [Kittens Game model.MD](./Kittens%20Game%20model.MD) — current game model
- [Powell's Reinforcement Learning and Stochastic Optimization.MD](./Powell's%20Reinforcement%20Learning%20and%20Stochastic%20Optimization.MD) — RL/SO reference

## Vendored game

The game lives at `./kittensgame-master/` (a snapshot, not a submodule). To upgrade:

```
# Replace kittensgame-master/ with the new snapshot, then:
pnpm test                 # expect catalog and integration tests to break if upstream added items
pnpm test:integration
```

## Scripts

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build       # produces dist/*.user.js for Tampermonkey
```

## Tampermonkey install

1. `pnpm build`
2. Tampermonkey → Dashboard → Utilities → Install from file → `dist/kittens-autoplayer.user.js`
3. Open kittensgame.com/web/ — DevTools console should show "userscript loaded".

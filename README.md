# preact-perf-tracker

> [!NOTE]
> This package is heavily inspired by [React-scan](https://github.com/aidenybai/react-scan)

Track component renders in Preact with:
- render-change detection (props/state/force updates)
- a visual DOM overlay
- a floating toolbar with render/FPS stats, pause toggle, reset, and report copy
- a runtime report API

## Install

```bash
pnpm add preact-perf-tracker
```

## Quick start

```ts
import { install } from 'preact-perf-tracker';

install({
  enabled: true,
  log: false,
  showToolbar: true,
  animationSpeed: 'fast',
});
```

Call `install()` once near app startup (for example in `main.tsx`).

## API

### `install(options?: Options): void`
Starts instrumentation (idempotent). If `enabled: false` and `showToolbar: false`, it does nothing.

### `setOptions(options: Partial<Options>): void`
Updates options at runtime.

### `getOptions(): Readonly<Options>`
Returns the active options object.

### `getReport(type?: unknown): ReportEntry | Map<unknown, ReportEntry> | null`
Returns aggregated render data for all tracked component types or one specific type.

### `getReportSummary(limit = 10): ReportSummaryEntry[]`
Returns top entries sorted by total self-time, including derived `avgSelfTime`.

### `clearReport(): void`
Resets collected report data.

### `stop(): void`
Removes instrumentation hooks, overlay, and toolbar.

## Types

```ts
type Options = {
  enabled?: boolean;           // default true
  log?: boolean;               // default false
  showToolbar?: boolean;       // default true
  animationSpeed?: 'slow' | 'fast' | 'off';
  onRender?: (info: RenderInfo) => void;
  onCommitStart?: () => void;
  onCommitFinish?: () => void;
};
```

`RenderInfo` includes:
- `componentName`
- `phase` (`mount` | `update` | `unmount`)
- `selfTime`
- `changes`
- `timestamp`
- `domNode`

`ReportSummaryEntry` includes:
- `displayName`
- `count`
- `totalSelfTime`
- `avgSelfTime`

## Example

A runnable demo is in `example/`.

```bash
cd example
pnpm install
pnpm dev
```

## Notes

- This package hooks into Preact `options` internals.
- Built for Preact 10.x.
- `install()` resets runtime options to defaults before applying provided options.
- Browser/runtime tooling only (not intended for SSR execution).

## License

MIT

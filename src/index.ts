import type { Options, RenderInfo, ReportEntry } from './types';
import {
	hookIntoPreact,
	unhookFromPreact,
	setActiveOptions,
	getActiveOptions,
	getReport as getReportInternal,
	clearReport as clearReportInternal,
	setOverlayRenderListener,
} from './instrumentation';
import { startOverlay, stopOverlay } from './overlay';
import { createToolbar, destroyToolbar, notifyToolbarRender } from './toolbar';

// ─── State ──────────────────────────────────────────────────────────────────

let started = false;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start tracking component renders.
 *
 * ```ts
 * import { install } from 'preact-perf-tracker';
 *
 * install({
 *   enabled: true,
 *   log: false,
 *   showToolbar: true,
 * });
 * ```
 */
export function install(options: Options = {}): void {
	setOptions(options);

	const opts = getActiveOptions();

	if (opts.enabled === false && opts.showToolbar !== true) {
		return;
	}

	start();
}

/**
 * Update options at runtime.
 */
export function setOptions(options: Partial<Options>): void {
	setActiveOptions(options);
}

/**
 * Get the current options.
 */
export function getOptions(): Readonly<Options> {
	return getActiveOptions();
}

/**
 * Get a report of all tracked components, or a single component type.
 */
export function getReport(
	type?: unknown,
): ReportEntry | Map<unknown, ReportEntry> | null {
	return getReportInternal(type);
}

/**
 * Clear all accumulated report data.
 */
export function clearReport(): void {
	clearReportInternal();
}

/**
 * Stop tracking and clean up all resources.
 */
export function stop(): void {
	if (!started) return;
	started = false;
	unhookFromPreact();
	stopOverlay();
	destroyToolbar();
}

// ─── Internal ───────────────────────────────────────────────────────────────

function start() {
	if (started) return;
	started = true;

	// Install options hooks
	hookIntoPreact();

	// Wire overlay render listener → toolbar render counter
	setOverlayRenderListener((_info: RenderInfo) => {
		// Feed to overlay (already set by startOverlay, we add toolbar notification)
		notifyToolbarRender();
	});

	// Start overlay drawing
	startOverlay();

	// Show toolbar if requested
	const opts = getActiveOptions();
	if (opts.showToolbar !== false) {
		if (typeof document !== 'undefined') {
			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', () => createToolbar(), {
					once: true,
				});
			} else {
				createToolbar();
			}
		}
	}
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { Options, RenderInfo, ReportEntry, Change, ChangeType } from './types';

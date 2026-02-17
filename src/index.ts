import type { Options, RenderInfo, ReportEntry } from './types';
import {
	hookIntoPreact,
	unhookFromPreact,
	setActiveOptions,
	getActiveOptions,
	getReport as getReportInternal,
	getReportSummary as getReportSummaryInternal,
	clearReport as clearReportInternal,
	resetActiveOptions,
	addRenderListener,
	removeRenderListener,
} from './instrumentation';
import { startOverlay, stopOverlay } from './overlay';
import { createToolbar, destroyToolbar, notifyToolbarRender } from './toolbar';


let started = false;
const toolbarRenderListener = (_info: RenderInfo) => {
	notifyToolbarRender();
};


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
	resetActiveOptions();
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
 * Get the top report entries sorted by total self-time.
 */
export function getReportSummary(limit = 10) {
	return getReportSummaryInternal(limit);
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
	removeRenderListener(toolbarRenderListener);
	unhookFromPreact();
	stopOverlay();
	destroyToolbar();
}


function start() {
	if (started) return;
	started = true;

	hookIntoPreact();
	addRenderListener(toolbarRenderListener);
	startOverlay();

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


export type {
	Options,
	RenderInfo,
	ReportEntry,
	ReportSummaryEntry,
	Change,
	ChangeType,
} from './types';

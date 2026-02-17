import { options, Fragment } from 'preact';
import {
	ChangeType,
	type InternalVNode,
	type InternalComponent,
	type InternalOptions,
	type RenderInfo,
	type Change,
	type Options,
	type ReportEntry,
	type ReportSummaryEntry,
} from './types';
import {
	getDisplayName,
	getComponentDOMNode,
	shallowDiff,
	isComponentVNode,
	snapshot,
	now,
} from './utils';

// ─── Internal State ─────────────────────────────────────────────────────────

/** Render timing: start time keyed by component instance */
const renderStartTimes = new WeakMap<InternalComponent, number>();
const defaultOptions: Options = {
	enabled: true,
	log: false,
	showToolbar: true,
	animationSpeed: 'fast',
};

/** Saved previous-hook options so we can restore on unhook */
let prevOptions: {
	__b?: InternalOptions['__b'];
	__r?: InternalOptions['__r'];
	diffed?: InternalOptions['diffed'];
	__c?: InternalOptions['__c'];
	unmount?: InternalOptions['unmount'];
} | null = null;

/** Currently active options (mutable, shared) */
let activeOptions: Options = {
	...defaultOptions,
};

/** Per-type report data */
const reportData = new Map<unknown, ReportEntry>();

/** External listeners */
const renderListeners = new Set<(info: RenderInfo) => void>();
let legacyOverlayRenderListener: ((info: RenderInfo) => void) | null = null;

/** Track whether we're hooked */
let isHooked = false;

// ─── Commit-boundary tracking ───────────────────────────────────────────────

/** Whether we are currently inside a diff cycle (between __b of root and __c) */
let inCommit = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectChanges(
	component: InternalComponent,
	vnode: InternalVNode,
	isMounting: boolean,
): Change[] {
	const changes: Change[] = [];

	if (isMounting) return changes; // nothing to compare on first mount

	// --- Props changes ---
	const prevProps = component.__prevProps;
	const nextProps = vnode.props as Record<string, unknown>;
	const changedPropKeys = shallowDiff(prevProps, nextProps);
	for (const key of changedPropKeys) {
		changes.push({
			type: ChangeType.Props,
			name: key,
			prevValue: prevProps?.[key],
			nextValue: nextProps[key],
		});
	}

	// --- State changes ---
	const prevState = component.__prevState;
	const nextState = component.__s ?? component.state;
	if (prevState && nextState) {
		const changedStateKeys = shallowDiff(
			prevState as Record<string, unknown>,
			nextState as Record<string, unknown>,
		);
		for (const key of changedStateKeys) {
			changes.push({
				type: ChangeType.State,
				name: key,
				prevValue: (prevState as Record<string, unknown>)[key],
				nextValue: (nextState as Record<string, unknown>)[key],
			});
		}
	}

	// Force update detection
	if (component.__f) {
		changes.push({
			type: ChangeType.Force,
			name: 'forceUpdate',
		});
	}

	return changes;
}

function emitRender(info: RenderInfo) {
	for (const listener of renderListeners) {
		listener(info);
	}
}

// ─── Options Hooks ──────────────────────────────────────────────────────────

function onBeforeDiff(vnode: InternalVNode) {
	if (!activeOptions.enabled) return;

	if (!inCommit) {
		inCommit = true;
		activeOptions.onCommitStart?.();
	}
}

function onBeforeRender(vnode: InternalVNode) {
	if (!activeOptions.enabled) return;
	if (!isComponentVNode(vnode)) return;
	if (vnode.type === Fragment) return;

	const component = vnode.__c as InternalComponent | null;
	if (!component) return;

	// Start timing
	renderStartTimes.set(component, now());
}

function onDiffed(vnode: InternalVNode) {
	if (!activeOptions.enabled) return;
	if (!isComponentVNode(vnode)) return;
	if (vnode.type === Fragment) return;

	const component = vnode.__c as InternalComponent | null;
	if (!component) return;

	const startTime = renderStartTimes.get(component);
	const selfTime = startTime != null ? now() - startTime : 0;
	renderStartTimes.delete(component);

	const isMounting = component.__prevProps === undefined;
	const changes = detectChanges(component, vnode, isMounting);
	const componentName = getDisplayName(vnode) || 'Anonymous';
	const domNode = getComponentDOMNode(vnode);

	const info: RenderInfo = {
		componentName,
		phase: isMounting ? 'mount' : 'update',
		selfTime,
		changes,
		timestamp: now(),
		domNode,
	};

	// Store snapshot for next diff comparison
	component.__prevProps = snapshot(
		vnode.props as Record<string, unknown>,
	) as Record<string, unknown>;
	component.__prevState = snapshot(
		(component.__s ?? component.state) as Record<string, unknown>,
	) as Record<string, unknown>;

	// Update report data
	const type = vnode.type;
	let entry = reportData.get(type);
	if (!entry) {
		entry = {
			count: 0,
			totalSelfTime: 0,
			displayName: componentName,
			type,
		};
		reportData.set(type, entry);
	}
	entry.count++;
	entry.totalSelfTime += selfTime;

	// Console logging
	if (activeOptions.log) {
		logRender(info);
	}

	// Notify user callback
	activeOptions.onRender?.(info);

	// Notify listeners
	emitRender(info);

}

function onCommit(_vnode: InternalVNode, _commitQueue: InternalComponent[]) {
	if (!activeOptions.enabled) return;

	if (inCommit) {
		inCommit = false;
		activeOptions.onCommitFinish?.();
	}
}

function onUnmount(vnode: InternalVNode) {
	if (!activeOptions.enabled) return;
	if (!isComponentVNode(vnode)) return;
	if (vnode.type === Fragment) return;

	const componentName = getDisplayName(vnode) || 'Anonymous';
	const domNode = getComponentDOMNode(vnode);

	const info: RenderInfo = {
		componentName,
		phase: 'unmount',
		selfTime: 0,
		changes: [],
		timestamp: now(),
		domNode,
	};

	activeOptions.onRender?.(info);
	emitRender(info);
}

// ─── Console Logging ────────────────────────────────────────────────────────

function logRender(info: RenderInfo) {
	const parts: string[] = [
		`%c[preact-perf-tracker]%c ${info.componentName}`,
		'color: #8b5cf6; font-weight: bold',
		'color: inherit',
	];

	const meta: string[] = [info.phase];
	if (info.selfTime >= 0.01) {
		meta.push(`${info.selfTime.toFixed(2)}ms`);
	}
	if (info.changes.length > 0) {
		meta.push(
			info.changes
				.map(
					(c) =>
						`${c.type === 1 ? 'prop' : c.type === 2 ? 'state' : c.type === 4 ? 'ctx' : 'force'}:${c.name}`,
				)
				.join(', '),
		);
	}
	parts[0] += ` (${meta.join(' · ')})`;

	console.log(...parts);
}

// ─── Public Instrumentation API ─────────────────────────────────────────────

/**
 * Install the Preact options hooks for render tracking.
 */
export function hookIntoPreact() {
	if (isHooked) return;
	isHooked = true;

	const opts = options as InternalOptions;

	// Save existing hooks so we can chain and restore
	prevOptions = {
		__b: opts.__b,
		__r: opts.__r,
		diffed: opts.diffed,
		__c: opts.__c,
		unmount: opts.unmount,
	};

	// Chain: before-diff
	const prev__b = opts.__b;
	opts.__b = (vnode: InternalVNode) => {
		onBeforeDiff(vnode);
		prev__b?.(vnode);
	};

	// Chain: before-render
	const prev__r = opts.__r;
	opts.__r = (vnode: InternalVNode) => {
		onBeforeRender(vnode);
		prev__r?.(vnode);
	};

	// Chain: diffed
	const prevDiffed = opts.diffed;
	opts.diffed = (vnode) => {
		onDiffed(vnode as InternalVNode);
		prevDiffed?.(vnode);
	};

	// Chain: commit
	const prev__c = opts.__c;
	opts.__c = (vnode: InternalVNode, queue: InternalComponent[]) => {
		onCommit(vnode, queue);
		(prev__c as any)?.(vnode, queue);
	};

	// Chain: unmount
	const prevUnmount = opts.unmount;
	opts.unmount = (vnode) => {
		onUnmount(vnode as InternalVNode);
		prevUnmount?.(vnode);
	};
}

/**
 * Remove our hooks and restore previous option hooks.
 */
// TODO: this is potentially destructive if i.e. hooks/signals
// are imported after this.
export function unhookFromPreact() {
	if (!isHooked || !prevOptions) return;
	isHooked = false;

	const opts = options as InternalOptions;
	opts.__b = prevOptions.__b;
	opts.__r = prevOptions.__r;
	opts.diffed = prevOptions.diffed;
	opts.__c = prevOptions.__c;
	opts.unmount = prevOptions.unmount;
	prevOptions = null;
}

// ─── Options & Report Access ────────────────────────────────────────────────

export function getActiveOptions(): Readonly<Options> {
	return activeOptions;
}

export function setActiveOptions(opts: Partial<Options>) {
	Object.assign(activeOptions, opts);
}

export function resetActiveOptions() {
	activeOptions = { ...defaultOptions };
}

/**
 * Get render report for all tracked components, or a specific type.
 */
export function getReport(
	type?: unknown,
): ReportEntry | Map<unknown, ReportEntry> | null {
	if (type !== undefined) {
		return reportData.get(type) ?? null;
	}
	return new Map(reportData);
}

export function clearReport() {
	reportData.clear();
}

/**
 * Register a listener that fires for every tracked render.
 */
export function addRenderListener(fn: (info: RenderInfo) => void) {
	renderListeners.add(fn);
}

export function removeRenderListener(fn: (info: RenderInfo) => void) {
	renderListeners.delete(fn);
}

/**
 * Backward-compatible single-listener API used by older integrations/tests.
 */
export function setOverlayRenderListener(
	fn: ((info: RenderInfo) => void) | null,
) {
	if (legacyOverlayRenderListener) {
		removeRenderListener(legacyOverlayRenderListener);
		legacyOverlayRenderListener = null;
	}
	if (fn) {
		legacyOverlayRenderListener = fn;
		addRenderListener(fn);
	}
}

/**
 * Get a sorted summary for quick insights (highest total self-time first).
 */
export function getReportSummary(limit = 10): ReportSummaryEntry[] {
	const normalizedLimit = Math.max(1, Math.floor(limit));
	return Array.from(reportData.values())
		.map((entry) => ({
			displayName: entry.displayName || 'Anonymous',
			count: entry.count,
			totalSelfTime: entry.totalSelfTime,
			avgSelfTime: entry.count > 0 ? entry.totalSelfTime / entry.count : 0,
		}))
		.sort((a, b) => {
			if (b.totalSelfTime !== a.totalSelfTime) {
				return b.totalSelfTime - a.totalSelfTime;
			}
			return b.count - a.count;
		})
		.slice(0, normalizedLimit);
}

export function isInstrumented() {
	return isHooked;
}

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

const renderStartTimes = new WeakMap<InternalComponent, number>();
const defaultOptions: Options = {
	enabled: true,
	log: false,
	showToolbar: true,
	animationSpeed: 'fast',
};

/**
 * Whether our permanent hook wrappers have been installed.
 * Once installed they stay in place for the lifetime of the page;
 * `isHooked` toggles them between active / pass-through so that
 * libraries hooking *after* us are never clobbered on unhook.
 */
let hooksInstalled = false;

let savedOriginalHooks: {
	__b?: InternalOptions['__b'];
	__r?: InternalOptions['__r'];
	diffed?: InternalOptions['diffed'];
	__c?: InternalOptions['__c'];
	unmount?: InternalOptions['unmount'];
} | null = null;

let activeOptions: Options = {
	...defaultOptions,
};

const reportData = new Map<unknown, ReportEntry>();

const renderListeners = new Set<(info: RenderInfo) => void>();
let legacyOverlayRenderListener: ((info: RenderInfo) => void) | null = null;

let isHooked = false;
let inCommit = false;


function detectChanges(
	component: InternalComponent,
	vnode: InternalVNode,
	isMounting: boolean,
): Change[] {
	const changes: Change[] = [];

	if (isMounting) return changes;

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

	component.__prevProps = snapshot(
		vnode.props as Record<string, unknown>,
	) as Record<string, unknown>;
	component.__prevState = snapshot(
		(component.__s ?? component.state) as Record<string, unknown>,
	) as Record<string, unknown>;

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

	if (activeOptions.log) {
		logRender(info);
	}

	activeOptions.onRender?.(info);
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


/**
 * Install the Preact options hooks for render tracking.
 *
 * The wrappers are installed once and stay in place for the lifetime
 * of the page.  `isHooked` toggles them between "active" (running
 * our instrumentation) and "pass-through" (just forwarding to the
 * previously chained hook).  This avoids the destructive restore
 * that would clobber hooks installed by other libraries (e.g.
 * hooks / signals) that chain after us.
 */
export function hookIntoPreact() {
	if (isHooked) return;
	isHooked = true;

	if (hooksInstalled) return;
	hooksInstalled = true;

	const opts = options as InternalOptions;

	savedOriginalHooks = {
		__b: opts.__b,
		__r: opts.__r,
		diffed: opts.diffed,
		__c: opts.__c,
		unmount: opts.unmount,
	};

	const prev__b = opts.__b;
	opts.__b = (vnode: InternalVNode) => {
		if (isHooked) onBeforeDiff(vnode);
		prev__b?.(vnode);
	};

	const prev__r = opts.__r;
	opts.__r = (vnode: InternalVNode) => {
		if (isHooked) onBeforeRender(vnode);
		prev__r?.(vnode);
	};

	const prevDiffed = opts.diffed;
	opts.diffed = (vnode) => {
		if (isHooked) onDiffed(vnode as InternalVNode);
		prevDiffed?.(vnode);
	};

	const prev__c = opts.__c;
	opts.__c = (vnode: InternalVNode, queue: InternalComponent[]) => {
		if (isHooked) onCommit(vnode, queue);
		(prev__c as any)?.(vnode, queue);
	};

	const prevUnmount = opts.unmount;
	opts.unmount = (vnode) => {
		if (isHooked) onUnmount(vnode as InternalVNode);
		prevUnmount?.(vnode);
	};
}

/**
 * Disable our instrumentation hooks.  The wrappers stay in the
 * options chain as transparent pass-throughs so that hooks installed
 * by other libraries after us are never lost.
 */
export function unhookFromPreact() {
	isHooked = false;
}


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

/**
 * @internal — test-only.  Fully tears down hook wrappers so the next
 * `hookIntoPreact()` call will re-install fresh ones.  Needed in test
 * harnesses where every test must start from a clean slate.
 */
export function __resetHooks() {
	isHooked = false;
	hooksInstalled = false;
	if (savedOriginalHooks) {
		const opts = options as InternalOptions;
		opts.__b = savedOriginalHooks.__b;
		opts.__r = savedOriginalHooks.__r;
		opts.diffed = savedOriginalHooks.diffed;
		opts.__c = savedOriginalHooks.__c;
		opts.unmount = savedOriginalHooks.unmount;
		savedOriginalHooks = null;
	}
}

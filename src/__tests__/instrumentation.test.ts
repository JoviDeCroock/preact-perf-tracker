import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { options } from 'preact';
import { createElement, Component } from 'preact';
import { render } from 'preact';
import type { InternalOptions, RenderInfo } from '../types';
import {
	hookIntoPreact,
	unhookFromPreact,
	setActiveOptions,
	getActiveOptions,
	getReport,
	getReportSummary,
	clearReport,
	addRenderListener,
	removeRenderListener,
	setOverlayRenderListener,
	isInstrumented,
	__resetHooks,
} from '../instrumentation';

// ─── Helpers ────────────────────────────────────────────────────────────────

let scratch: HTMLDivElement;

async function act(fn: () => void) {
	fn();
	// Flush Preact's microtask-based rerender queue
	await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
	scratch = document.createElement('div');
	document.body.appendChild(scratch);
	// Reset to defaults
	setActiveOptions({
		enabled: true,
		log: false,
		showToolbar: false,
		animationSpeed: 'off',
		onRender: undefined,
		onCommitStart: undefined,
		onCommitFinish: undefined,
	});
	clearReport();
});

afterEach(() => {
	unhookFromPreact();
	__resetHooks();
	render(null, scratch);
	scratch.remove();
});

// ─── hookIntoPreact / unhookFromPreact ──────────────────────────────────────

describe('hookIntoPreact / unhookFromPreact', () => {
	it('sets isInstrumented to true after hooking', () => {
		expect(isInstrumented()).toBe(false);
		hookIntoPreact();
		expect(isInstrumented()).toBe(true);
	});

	it('restores isInstrumented to false after unhooking', () => {
		hookIntoPreact();
		unhookFromPreact();
		expect(isInstrumented()).toBe(false);
	});

	it('is idempotent — calling hookIntoPreact twice does not double-hook', () => {
		hookIntoPreact();
		hookIntoPreact(); // second call should be a no-op
		expect(isInstrumented()).toBe(true);
		unhookFromPreact();
		expect(isInstrumented()).toBe(false);
	});

	it('chains existing options hooks (does not clobber them)', async () => {
		const spy = vi.fn();
		const opts = options as InternalOptions;
		const origDiffed = opts.diffed;
		opts.diffed = (vnode) => {
			spy();
			origDiffed?.(vnode);
		};

		hookIntoPreact();

		function TestComp() {
			return createElement('div', null, 'hello');
		}
		await act(() => render(createElement(TestComp, null), scratch));

		// Our spy from the existing hook should still have been called
		expect(spy).toHaveBeenCalled();

		unhookFromPreact();
		// After unhooking, hooks installed before us are still chained
		// (our wrapper is now a pass-through, but it still calls prev).
		// The options.diffed reference should still be a function.
		expect(typeof opts.diffed).toBe('function');
	});

	it('does not clobber hooks installed after us (e.g. signals)', async () => {
		hookIntoPreact();

		// Simulate a third-party library that chains after us
		const opts = options as InternalOptions;
		const thirdPartySpy = vi.fn();
		const ourDiffed = opts.diffed;
		opts.diffed = (vnode) => {
			thirdPartySpy();
			ourDiffed?.(vnode);
		};

		function TestComp() {
			return createElement('div', null, 'hello');
		}
		await act(() => render(createElement(TestComp, null), scratch));
		expect(thirdPartySpy).toHaveBeenCalled();
		thirdPartySpy.mockClear();

		// Unhook our instrumentation
		unhookFromPreact();

		// The third-party hook should still be in place and functional
		await act(() => render(createElement(TestComp, null), scratch));
		expect(thirdPartySpy).toHaveBeenCalled();
	});
});

// ─── Render tracking ────────────────────────────────────────────────────────

describe('render tracking', () => {
	it('calls onRender for each component mount', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Hello() {
			return createElement('span', null, 'hi');
		}
		await act(() => render(createElement(Hello, null), scratch));

		expect(renders.length).toBe(1);
		expect(renders[0].componentName).toBe('Hello');
		expect(renders[0].phase).toBe('mount');
	});

	it('tracks multiple component mounts in a tree', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Child() {
			return createElement('em', null, 'child');
		}
		function Parent() {
			return createElement('div', null, createElement(Child, null));
		}
		await act(() => render(createElement(Parent, null), scratch));

		const names = renders.map((r) => r.componentName);
		expect(names).toContain('Parent');
		expect(names).toContain('Child');
	});

	it('reports "update" phase on re-render', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Counter(props: { value: number }) {
			return createElement('span', null, String(props.value));
		}
		await act(() => render(createElement(Counter, { value: 0 }), scratch));
		expect(renders.length).toBe(1);
		expect(renders[0].phase).toBe('mount');

		await act(() => render(createElement(Counter, { value: 1 }), scratch));
		expect(renders.length).toBe(2);
		expect(renders[1].phase).toBe('update');
	});

	it('detects props changes on update', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Display(props: { value: number }) {
			return createElement('span', null, String(props.value));
		}
		await act(() => render(createElement(Display, { value: 1 }), scratch));
		await act(() => render(createElement(Display, { value: 2 }), scratch));

		const updateRender = renders.find((r) => r.phase === 'update');
		expect(updateRender).toBeDefined();
		expect(updateRender!.changes.length).toBeGreaterThan(0);
		expect(updateRender!.changes[0].name).toBe('value');
		expect(updateRender!.changes[0].prevValue).toBe(1);
		expect(updateRender!.changes[0].nextValue).toBe(2);
	});

	it('detects state changes on update', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		class Stateful extends Component<{}, { count: number }> {
			state = { count: 0 };
			render() {
				return createElement('span', null, String(this.state.count));
			}
		}
		let instance: Stateful | null = null;
		const ref = (node: Stateful | null) => {
			instance = node;
		};

		await act(() => render(createElement(Stateful, { ref } as any), scratch));
		await act(() => instance!.setState({ count: 10 }));

		const updateRender = renders.find((r) => r.phase === 'update');
		expect(updateRender).toBeDefined();
		expect(updateRender!.changes.some((c) => c.type === 2)).toBe(true);
	});

	it('reports positive selfTime for renders', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Slow() {
			// Burn a tiny bit of time
			const start = performance.now();
			while (performance.now() - start < 1) {
				/* spin */
			}
			return createElement('div', null, 'slow');
		}
		await act(() => render(createElement(Slow, null), scratch));

		expect(renders[0].selfTime).toBeGreaterThan(0);
	});

	it('records domNode for component renders', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Box() {
			return createElement('div', { id: 'box' }, 'box');
		}
		await act(() => render(createElement(Box, null), scratch));

		expect(renders[0].domNode).toBeInstanceOf(Element);
	});
});

// ─── Unmount tracking ───────────────────────────────────────────────────────

describe('unmount tracking', () => {
	it('fires onRender with phase=unmount when a component is removed', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Removable() {
			return createElement('div', null, 'here');
		}
		await act(() => render(createElement(Removable, null), scratch));
		await act(() => render(null, scratch));

		const unmountRender = renders.find((r) => r.phase === 'unmount');
		expect(unmountRender).toBeDefined();
		expect(unmountRender!.componentName).toBe('Removable');
	});
});

// ─── Commit callbacks ───────────────────────────────────────────────────────

describe('commit lifecycle callbacks', () => {
	it('calls onCommitStart and onCommitFinish per commit', async () => {
		const events: string[] = [];
		setActiveOptions({
			onCommitStart: () => events.push('start'),
			onCommitFinish: () => events.push('finish'),
		});
		hookIntoPreact();

		function App() {
			return createElement('div', null, 'app');
		}
		await act(() => render(createElement(App, null), scratch));

		expect(events).toContain('start');
		expect(events).toContain('finish');
		expect(events.indexOf('start')).toBeLessThan(events.indexOf('finish'));
	});
});

// ─── Report data ────────────────────────────────────────────────────────────

describe('getReport / clearReport', () => {
	it('accumulates render counts per component type', async () => {
		hookIntoPreact();

		function Counter() {
			return createElement('span', null, '0');
		}
		await act(() => render(createElement(Counter, null), scratch));
		await act(() => render(createElement(Counter, null), scratch));

		const report = getReport() as Map<unknown, any>;
		expect(report).toBeInstanceOf(Map);

		// Find the entry for Counter
		let found = false;
		for (const entry of report.values()) {
			if (entry.displayName === 'Counter') {
				expect(entry.count).toBeGreaterThanOrEqual(2);
				found = true;
			}
		}
		expect(found).toBe(true);
	});

	it('returns a specific entry when type is provided', async () => {
		hookIntoPreact();

		function Specific() {
			return createElement('span', null, 'x');
		}
		await act(() => render(createElement(Specific, null), scratch));

		const entry = getReport(Specific) as any;
		expect(entry).not.toBeNull();
		expect(entry.displayName).toBe('Specific');
		expect(entry.count).toBe(1);
	});

	it('returns null for an unknown type', () => {
		hookIntoPreact();
		function Unknown() {
			return createElement('span', null);
		}
		expect(getReport(Unknown)).toBeNull();
	});

	it('clearReport empties the report', async () => {
		hookIntoPreact();

		function Temp() {
			return createElement('span', null, 'temp');
		}
		await act(() => render(createElement(Temp, null), scratch));

		clearReport();
		const report = getReport() as Map<unknown, any>;
		expect(report.size).toBe(0);
	});
});

// ─── Overlay render listener ────────────────────────────────────────────────

describe('overlay render listener', () => {
	it('fires listener on component render', async () => {
		const spy = vi.fn();
		setOverlayRenderListener(spy);
		hookIntoPreact();

		function Comp() {
			return createElement('div', null, 'overlay');
		}
		await act(() => render(createElement(Comp, null), scratch));

		expect(spy).toHaveBeenCalled();
		const info: RenderInfo = spy.mock.calls[0][0];
		expect(info.componentName).toBe('Comp');
	});

	it('stops firing after listener is removed', async () => {
		const spy = vi.fn();
		setOverlayRenderListener(spy);
		hookIntoPreact();

		function A() {
			return createElement('div', null, 'a');
		}
		await act(() => render(createElement(A, null), scratch));
		const callCount = spy.mock.calls.length;

		setOverlayRenderListener(null);

		function B() {
			return createElement('div', null, 'b');
		}
		await act(() => render(createElement(B, null), scratch));

		// No new calls after removing listener
		expect(spy.mock.calls.length).toBe(callCount);
	});
});

// ─── Render listener fan-out ───────────────────────────────────────────────

describe('render listener fan-out', () => {
	it('notifies multiple listeners for the same render', async () => {
		const a = vi.fn();
		const b = vi.fn();
		addRenderListener(a);
		addRenderListener(b);
		hookIntoPreact();

		function Multi() {
			return createElement('div', null, 'multi');
		}
		await act(() => render(createElement(Multi, null), scratch));

		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);

		removeRenderListener(a);
		removeRenderListener(b);
	});
});

// ─── Report summary ────────────────────────────────────────────────────────

describe('getReportSummary', () => {
	it('returns summary entries with limit and derived average', async () => {
		hookIntoPreact();

		function SummaryComp() {
			return createElement('span', null, 'summary');
		}

		await act(() => render(createElement(SummaryComp, null), scratch));
		await act(() => render(createElement(SummaryComp, null), scratch));

		const summary = getReportSummary(1);
		expect(summary.length).toBe(1);
		expect(summary[0].displayName).toBe('SummaryComp');
		expect(summary[0].count).toBeGreaterThanOrEqual(2);
		expect(summary[0].avgSelfTime).toBeGreaterThanOrEqual(0);
	});
});

// ─── Enabled toggle ─────────────────────────────────────────────────────────

describe('enabled toggle', () => {
	it('does not track renders when disabled', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({
			enabled: false,
			onRender: (info) => renders.push(info),
		});
		hookIntoPreact();

		function Ignored() {
			return createElement('div', null, 'ignored');
		}
		await act(() => render(createElement(Ignored, null), scratch));

		expect(renders.length).toBe(0);
	});

	it('resumes tracking when re-enabled', async () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({
			enabled: false,
			onRender: (info) => renders.push(info),
		});
		hookIntoPreact();

		function Toggle() {
			return createElement('div', null, 'toggle');
		}
		await act(() => render(createElement(Toggle, null), scratch));
		expect(renders.length).toBe(0);

		setActiveOptions({ enabled: true });
		await act(() => render(createElement(Toggle, null), scratch));
		expect(renders.length).toBeGreaterThan(0);
	});
});

// ─── Options get/set ────────────────────────────────────────────────────────

describe('getActiveOptions / setActiveOptions', () => {
	it('returns current options', () => {
		const opts = getActiveOptions();
		expect(opts.enabled).toBe(true);
	});

	it('merges partial updates', () => {
		setActiveOptions({ log: true });
		expect(getActiveOptions().log).toBe(true);
		// Other options remain
		expect(getActiveOptions().enabled).toBe(true);
	});
});

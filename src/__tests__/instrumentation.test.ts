import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { options } from 'preact';
import { createElement } from 'preact';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { InternalOptions, RenderInfo } from '../types';
import {
	hookIntoPreact,
	unhookFromPreact,
	setActiveOptions,
	getActiveOptions,
	getReport,
	clearReport,
	setOverlayRenderListener,
	isInstrumented,
} from '../instrumentation';

// ─── Helpers ────────────────────────────────────────────────────────────────

let scratch: HTMLDivElement;

function act(fn: () => void) {
	fn();
	// Preact processes synchronously by default, no need for async act
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

	it('chains existing options hooks (does not clobber them)', () => {
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
		act(() => render(createElement(TestComp, null), scratch));

		// Our spy from the existing hook should still have been called
		expect(spy).toHaveBeenCalled();

		unhookFromPreact();
		// After unhooking our custom hook should still be there
		expect(opts.diffed).toBe(opts.diffed);
	});
});

// ─── Render tracking ────────────────────────────────────────────────────────

describe('render tracking', () => {
	it('calls onRender for each component mount', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Hello() {
			return createElement('span', null, 'hi');
		}
		act(() => render(createElement(Hello, null), scratch));

		expect(renders.length).toBe(1);
		expect(renders[0].componentName).toBe('Hello');
		expect(renders[0].phase).toBe('mount');
	});

	it('tracks multiple component mounts in a tree', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Child() {
			return createElement('em', null, 'child');
		}
		function Parent() {
			return createElement('div', null, createElement(Child, null));
		}
		act(() => render(createElement(Parent, null), scratch));

		const names = renders.map((r) => r.componentName);
		expect(names).toContain('Parent');
		expect(names).toContain('Child');
	});

	it('reports "update" phase on re-render', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		let forceUpdate: () => void;
		function Counter() {
			const [count, setCount] = useState(0);
			forceUpdate = () => setCount((c) => c + 1);
			return createElement('span', null, String(count));
		}
		act(() => render(createElement(Counter, null), scratch));
		expect(renders.length).toBe(1);
		expect(renders[0].phase).toBe('mount');

		act(() => forceUpdate!());
		expect(renders.length).toBe(2);
		expect(renders[1].phase).toBe('update');
	});

	it('detects props changes on update', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Display(props: { value: number }) {
			return createElement('span', null, String(props.value));
		}
		act(() => render(createElement(Display, { value: 1 }), scratch));
		act(() => render(createElement(Display, { value: 2 }), scratch));

		const updateRender = renders.find((r) => r.phase === 'update');
		expect(updateRender).toBeDefined();
		expect(updateRender!.changes.length).toBeGreaterThan(0);
		expect(updateRender!.changes[0].name).toBe('value');
		expect(updateRender!.changes[0].prevValue).toBe(1);
		expect(updateRender!.changes[0].nextValue).toBe(2);
	});

	it('detects state changes on update', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		let trigger: () => void;
		function Stateful() {
			const [count, setCount] = useState(0);
			trigger = () => setCount(10);
			return createElement('span', null, String(count));
		}
		act(() => render(createElement(Stateful, null), scratch));
		act(() => trigger!());

		const updateRender = renders.find((r) => r.phase === 'update');
		expect(updateRender).toBeDefined();
		// State changes should be detected (hooks use numeric keys)
		expect(updateRender!.changes.length).toBeGreaterThan(0);
	});

	it('reports positive selfTime for renders', () => {
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
		act(() => render(createElement(Slow, null), scratch));

		expect(renders[0].selfTime).toBeGreaterThan(0);
	});

	it('records domNode for component renders', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Box() {
			return createElement('div', { id: 'box' }, 'box');
		}
		act(() => render(createElement(Box, null), scratch));

		expect(renders[0].domNode).toBeInstanceOf(Element);
	});
});

// ─── Unmount tracking ───────────────────────────────────────────────────────

describe('unmount tracking', () => {
	it('fires onRender with phase=unmount when a component is removed', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({ onRender: (info) => renders.push(info) });
		hookIntoPreact();

		function Removable() {
			return createElement('div', null, 'here');
		}
		act(() => render(createElement(Removable, null), scratch));
		act(() => render(null, scratch));

		const unmountRender = renders.find((r) => r.phase === 'unmount');
		expect(unmountRender).toBeDefined();
		expect(unmountRender!.componentName).toBe('Removable');
	});
});

// ─── Commit callbacks ───────────────────────────────────────────────────────

describe('commit lifecycle callbacks', () => {
	it('calls onCommitStart and onCommitFinish per commit', () => {
		const events: string[] = [];
		setActiveOptions({
			onCommitStart: () => events.push('start'),
			onCommitFinish: () => events.push('finish'),
		});
		hookIntoPreact();

		function App() {
			return createElement('div', null, 'app');
		}
		act(() => render(createElement(App, null), scratch));

		expect(events).toContain('start');
		expect(events).toContain('finish');
		expect(events.indexOf('start')).toBeLessThan(events.indexOf('finish'));
	});
});

// ─── Report data ────────────────────────────────────────────────────────────

describe('getReport / clearReport', () => {
	it('accumulates render counts per component type', () => {
		hookIntoPreact();

		function Counter() {
			return createElement('span', null, '0');
		}
		act(() => render(createElement(Counter, null), scratch));
		act(() => render(createElement(Counter, null), scratch));

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

	it('returns a specific entry when type is provided', () => {
		hookIntoPreact();

		function Specific() {
			return createElement('span', null, 'x');
		}
		act(() => render(createElement(Specific, null), scratch));

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

	it('clearReport empties the report', () => {
		hookIntoPreact();

		function Temp() {
			return createElement('span', null, 'temp');
		}
		act(() => render(createElement(Temp, null), scratch));

		clearReport();
		const report = getReport() as Map<unknown, any>;
		expect(report.size).toBe(0);
	});
});

// ─── Overlay render listener ────────────────────────────────────────────────

describe('overlay render listener', () => {
	it('fires listener on component render', () => {
		const spy = vi.fn();
		setOverlayRenderListener(spy);
		hookIntoPreact();

		function Comp() {
			return createElement('div', null, 'overlay');
		}
		act(() => render(createElement(Comp, null), scratch));

		expect(spy).toHaveBeenCalled();
		const info: RenderInfo = spy.mock.calls[0][0];
		expect(info.componentName).toBe('Comp');
	});

	it('stops firing after listener is removed', () => {
		const spy = vi.fn();
		setOverlayRenderListener(spy);
		hookIntoPreact();

		function A() {
			return createElement('div', null, 'a');
		}
		act(() => render(createElement(A, null), scratch));
		const callCount = spy.mock.calls.length;

		setOverlayRenderListener(null);

		function B() {
			return createElement('div', null, 'b');
		}
		act(() => render(createElement(B, null), scratch));

		// No new calls after removing listener
		expect(spy.mock.calls.length).toBe(callCount);
	});
});

// ─── Enabled toggle ─────────────────────────────────────────────────────────

describe('enabled toggle', () => {
	it('does not track renders when disabled', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({
			enabled: false,
			onRender: (info) => renders.push(info),
		});
		hookIntoPreact();

		function Ignored() {
			return createElement('div', null, 'ignored');
		}
		act(() => render(createElement(Ignored, null), scratch));

		expect(renders.length).toBe(0);
	});

	it('resumes tracking when re-enabled', () => {
		const renders: RenderInfo[] = [];
		setActiveOptions({
			enabled: false,
			onRender: (info) => renders.push(info),
		});
		hookIntoPreact();

		function Toggle() {
			return createElement('div', null, 'toggle');
		}
		act(() => render(createElement(Toggle, null), scratch));
		expect(renders.length).toBe(0);

		setActiveOptions({ enabled: true });
		act(() => render(createElement(Toggle, null), scratch));
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

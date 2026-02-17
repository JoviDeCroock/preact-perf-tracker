import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'preact';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { install, stop, setOptions, getOptions, getReport, clearReport } from '../index';
import type { RenderInfo } from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

let scratch: HTMLDivElement;

function act(fn: () => void) {
	fn();
}

beforeEach(() => {
	scratch = document.createElement('div');
	document.body.appendChild(scratch);
});

afterEach(() => {
	stop();
	render(null, scratch);
	scratch.remove();
});

// ─── install() ─────────────────────────────────────────────────────────────────

describe('scan()', () => {
	it('starts tracking and creates the toolbar', () => {
		install({ showToolbar: true });

		const toolbar = document.getElementById('preact-scan-toolbar');
		expect(toolbar).not.toBeNull();
	});

	it('does not start if enabled=false and showToolbar is not true', () => {
		install({ enabled: false, showToolbar: false });

		// Toolbar should not exist
		const toolbar = document.getElementById('preact-scan-toolbar');
		expect(toolbar).toBeNull();
	});

	it('tracks renders after calling scan()', () => {
		const renders: RenderInfo[] = [];
		install({
			showToolbar: false,
			onRender: (info) => renders.push(info),
		});

		function App() {
			return createElement('div', null, 'hello');
		}
		act(() => render(createElement(App, null), scratch));

		expect(renders.length).toBe(1);
		expect(renders[0].componentName).toBe('App');
	});
});

// ─── stop() ─────────────────────────────────────────────────────────────────

describe('stop()', () => {
	it('removes the toolbar from the DOM', () => {
		install({ showToolbar: true });
		expect(document.getElementById('preact-tracker-toolbar')).not.toBeNull();

		stop();
		expect(document.getElementById('preact-scan-toolbar')).toBeNull();
	});

	it('stops tracking renders after stop()', () => {
		const renders: RenderInfo[] = [];
		install({
			showToolbar: false,
			onRender: (info) => renders.push(info),
		});

		function Before() {
			return createElement('div', null, 'before');
		}
		act(() => render(createElement(Before, null), scratch));
		const countBefore = renders.length;

		stop();

		function After() {
			return createElement('div', null, 'after');
		}
		act(() => render(createElement(After, null), scratch));

		// No new renders tracked
		expect(renders.length).toBe(countBefore);
	});

	it('is safe to call stop() multiple times', () => {
		install({ showToolbar: false });
		expect(() => {
			stop();
			stop();
			stop();
		}).not.toThrow();
	});
});

// ─── setOptions() / getOptions() ────────────────────────────────────────────

describe('setOptions() / getOptions()', () => {
	it('updates options at runtime', () => {
		install({ showToolbar: false, log: false });

		setOptions({ log: true });
		expect(getOptions().log).toBe(true);
	});

	it('preserves unmodified options', () => {
		install({ showToolbar: false, animationSpeed: 'slow' });

		setOptions({ log: true });
		expect(getOptions().animationSpeed).toBe('slow');
	});
});

// ─── getReport() / clearReport() ───────────────────────────────────────────

describe('getReport() / clearReport()', () => {
	it('returns a Map of all tracked components', () => {
		install({ showToolbar: false });

		function Foo() {
			return createElement('span', null, 'foo');
		}
		function Bar() {
			return createElement('span', null, 'bar');
		}
		act(() =>
			render(
				createElement('div', null, createElement(Foo, null), createElement(Bar, null)),
				scratch,
			),
		);

		const report = getReport() as Map<unknown, any>;
		expect(report).toBeInstanceOf(Map);
		expect(report.size).toBeGreaterThanOrEqual(2);
	});

	it('returns a single entry for a specific type', () => {
		install({ showToolbar: false });

		function Target() {
			return createElement('em', null, 'target');
		}
		act(() => render(createElement(Target, null), scratch));

		const entry = getReport(Target) as any;
		expect(entry).not.toBeNull();
		expect(entry.displayName).toBe('Target');
	});

	it('clears all data with clearReport()', () => {
		install({ showToolbar: false });

		function X() {
			return createElement('span', null);
		}
		act(() => render(createElement(X, null), scratch));

		clearReport();
		const report = getReport() as Map<unknown, any>;
		expect(report.size).toBe(0);
	});
});

// ─── Overlay canvas ─────────────────────────────────────────────────────────

describe('overlay', () => {
	it('creates the overlay canvas element', () => {
		install({ showToolbar: false });

		function Vis() {
			return createElement('div', null, 'visible');
		}
		act(() => render(createElement(Vis, null), scratch));

		const canvas = document.getElementById('preact-scan-overlay');
		expect(canvas).not.toBeNull();
		expect(canvas!.tagName).toBe('CANVAS');
	});

	it('removes the canvas on stop()', () => {
		install({ showToolbar: false });

		function Vis2() {
			return createElement('div', null, 'visible');
		}
		act(() => render(createElement(Vis2, null), scratch));

		stop();
		const canvas = document.getElementById('preact-scan-overlay');
		expect(canvas).toBeNull();
	});
});

// ─── Integration: full render cycle ─────────────────────────────────────────

describe('integration: full render cycle', () => {
	it('tracks mount → update → unmount lifecycle', () => {
		const phases: string[] = [];
		install({
			showToolbar: false,
			onRender: (info) => {
				if (info.componentName === 'Lifecycle') {
					phases.push(info.phase);
				}
			},
		});

		let setVal: (v: number) => void;
		function Lifecycle() {
			const [val, sv] = useState(0);
			setVal = sv;
			return createElement('div', null, String(val));
		}

		// Mount
		act(() => render(createElement(Lifecycle, null), scratch));
		expect(phases).toContain('mount');

		// Update
		act(() => setVal!(1));
		expect(phases).toContain('update');

		// Unmount
		act(() => render(null, scratch));
		expect(phases).toContain('unmount');

		expect(phases).toEqual(['mount', 'update', 'unmount']);
	});
});

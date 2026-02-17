import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'preact';
import { render } from 'preact';
import {
	install,
	stop,
	setOptions,
	getOptions,
	getReport,
	getReportSummary,
	clearReport,
} from '../index';
import { setActiveOptions } from '../instrumentation';
import type { RenderInfo } from '../types';


let scratch: HTMLDivElement;

async function act(fn: () => void) {
	fn();
	// Flush Preact's microtask-based rerender queue
	await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
	scratch = document.createElement('div');
	document.body.appendChild(scratch);
	// Reset options to defaults between tests
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
	stop();
	render(null, scratch);
	scratch.remove();
});


describe('scan()', () => {
	it('starts tracking and creates the toolbar', async () => {
		install({ showToolbar: true });
		await act(() => {});

		const toolbar = document.getElementById('preact-tracker-toolbar');
		expect(toolbar).not.toBeNull();
	});

	it('does not start if enabled=false and showToolbar is not true', () => {
		install({ enabled: false, showToolbar: false });

		// Toolbar should not exist
		const toolbar = document.getElementById('preact-tracker-toolbar');
		expect(toolbar).toBeNull();
	});

	it('tracks renders after calling scan()', async () => {
		const renders: RenderInfo[] = [];
		install({
			showToolbar: false,
			onRender: (info) => renders.push(info),
		});

		function App() {
			return createElement('div', null, 'hello');
		}
		await act(() => render(createElement(App, null), scratch));

		expect(renders.length).toBe(1);
		expect(renders[0].componentName).toBe('App');
	});
});


describe('stop()', () => {
	it('removes the toolbar from the DOM', () => {
		install({ showToolbar: true });
		expect(document.getElementById('preact-tracker-toolbar')).not.toBeNull();

		stop();
		expect(document.getElementById('preact-tracker-toolbar')).toBeNull();
	});

	it('stops tracking renders after stop()', async () => {
		const renders: RenderInfo[] = [];
		install({
			showToolbar: false,
			onRender: (info) => renders.push(info),
		});

		function Before() {
			return createElement('div', null, 'before');
		}
		await act(() => render(createElement(Before, null), scratch));
		const countBefore = renders.length;

		stop();

		function After() {
			return createElement('div', null, 'after');
		}
		await act(() => render(createElement(After, null), scratch));

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


describe('getReport() / clearReport()', () => {
	it('returns a Map of all tracked components', async () => {
		install({ showToolbar: false });

		function Foo() {
			return createElement('span', null, 'foo');
		}
		function Bar() {
			return createElement('span', null, 'bar');
		}
		await act(() =>
			render(
				createElement('div', null, createElement(Foo, null), createElement(Bar, null)),
				scratch,
			),
		);

		const report = getReport() as Map<unknown, any>;
		expect(report).toBeInstanceOf(Map);
		expect(report.size).toBeGreaterThanOrEqual(2);
	});

	it('returns a single entry for a specific type', async () => {
		install({ showToolbar: false });

		function Target() {
			return createElement('em', null, 'target');
		}
		await act(() => render(createElement(Target, null), scratch));

		const entry = getReport(Target) as any;
		expect(entry).not.toBeNull();
		expect(entry.displayName).toBe('Target');
	});

	it('clears all data with clearReport()', async () => {
		install({ showToolbar: false });

		function X() {
			return createElement('span', null);
		}
		await act(() => render(createElement(X, null), scratch));

		clearReport();
		const report = getReport() as Map<unknown, any>;
		expect(report.size).toBe(0);
	});

	it('returns a summary list with a limit', async () => {
		install({ showToolbar: false });

		function SummaryTarget() {
			return createElement('span', null, 'summary');
		}
		await act(() => render(createElement(SummaryTarget, null), scratch));
		await act(() => render(createElement(SummaryTarget, null), scratch));

		const summary = getReportSummary(1);
		expect(summary.length).toBe(1);
		expect(summary[0].displayName).toBe('SummaryTarget');
		expect(summary[0].count).toBeGreaterThanOrEqual(2);
		expect(summary[0].avgSelfTime).toBeGreaterThanOrEqual(0);
	});
});


describe('overlay', () => {
	it('creates the overlay canvas element', async () => {
		install({ showToolbar: false });

		function Vis() {
			return createElement('div', null, 'visible');
		}
		await act(() => render(createElement(Vis, null), scratch));

		const canvas = document.getElementById('preact-scan-overlay');
		expect(canvas).not.toBeNull();
		expect(canvas!.tagName).toBe('CANVAS');
	});

	it('removes the canvas on stop()', async () => {
		install({ showToolbar: false });

		function Vis2() {
			return createElement('div', null, 'visible');
		}
		await act(() => render(createElement(Vis2, null), scratch));

		stop();
		const canvas = document.getElementById('preact-scan-overlay');
		expect(canvas).toBeNull();
	});
});


describe('integration: full render cycle', () => {
	it('tracks mount → update → unmount lifecycle', async () => {
		const phases: string[] = [];
		install({
			showToolbar: false,
			onRender: (info) => {
				if (info.componentName === 'Lifecycle') {
					phases.push(info.phase);
				}
			},
		});

		function Lifecycle(props: { value: number }) {
			return createElement('div', null, String(props.value));
		}

		// Mount
		await act(() => render(createElement(Lifecycle, { value: 0 }), scratch));
		expect(phases).toContain('mount');

		// Update
		await act(() => render(createElement(Lifecycle, { value: 1 }), scratch));
		expect(phases).toContain('update');

		// Unmount
		await act(() => render(null, scratch));
		expect(phases).toContain('unmount');

		expect(phases).toEqual(['mount', 'update', 'unmount']);
	});
});

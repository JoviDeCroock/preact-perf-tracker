import {
	getActiveOptions,
	setActiveOptions,
	clearReport,
	getReportSummary,
} from './instrumentation';


let rootContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let renderCount = 0;
let fps = 0;
let rendersPerSecond = 0;
let frameCount = 0;
let lastFpsTime = performance.now();
let fpsRafId: number | null = null;
let rendersThisSecond = 0;


function updateFps() {
	frameCount++;
	const now = performance.now();
	if (now - lastFpsTime >= 1000) {
		fps = frameCount;
		rendersPerSecond = rendersThisSecond;
		rendersThisSecond = 0;
		frameCount = 0;
		lastFpsTime = now;
		updateDisplay();
	}
	fpsRafId = requestAnimationFrame(updateFps);
}


export function notifyToolbarRender() {
	renderCount++;
	rendersThisSecond++;
	updateDisplay();
}


const TOOLBAR_STYLES = `
:host {
  all: initial;
}
.toolbar {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #0a0a0a;
  border: 1px solid #27272a;
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #e4e4e7;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  user-select: none;
  cursor: default;
  line-height: 1;
}
.toolbar-title {
  font-weight: 700;
  color: #a78bfa;
  padding-right: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.toolbar-title svg {
  width: 14px;
  height: 14px;
}
.stat {
  color: #a1a1aa;
  padding: 0 4px;
}
.stat-value {
  color: #e4e4e7;
  font-weight: 600;
}
.separator {
  width: 1px;
  height: 14px;
  background: #27272a;
}
.toggle-btn {
  background: none;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #e4e4e7;
  padding: 3px 8px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.toggle-btn:hover {
  background: #27272a;
  border-color: #52525b;
}
.toggle-btn.active {
  background: #7c3aed;
  border-color: #8b5cf6;
}
`;

function createToolbarDOM(): ShadowRoot {
	rootContainer = document.createElement('div');
	rootContainer.id = 'preact-tracker-toolbar';
	shadowRoot = rootContainer.attachShadow({ mode: 'open' });

	const style = document.createElement('style');
	style.textContent = TOOLBAR_STYLES;
	shadowRoot.appendChild(style);

	const toolbar = document.createElement('div');
	toolbar.className = 'toolbar';
	toolbar.innerHTML = `
		<span class="toolbar-title">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10"/>
				<line x1="12" y1="8" x2="12" y2="12"/>
				<line x1="12" y1="16" x2="12.01" y2="16"/>
			</svg>
			preact-perf-tracker
		</span>
		<span class="separator"></span>
		<span class="stat">renders: <span class="stat-value" data-renders>0</span></span>
		<span class="separator"></span>
		<span class="stat">r/s: <span class="stat-value" data-rps>0</span></span>
		<span class="separator"></span>
		<span class="stat">fps: <span class="stat-value" data-fps>--</span></span>
		<span class="separator"></span>
		<span class="stat">hot: <span class="stat-value" data-hot>--</span></span>
		<span class="separator"></span>
		<button class="toggle-btn active" data-toggle>Enabled</button>
		<button class="toggle-btn" data-reset>Reset</button>
		<button class="toggle-btn" data-copy>Copy</button>
	`;

	const toggleBtn = toolbar.querySelector('[data-toggle]') as HTMLButtonElement;
	toggleBtn.addEventListener('click', () => {
		const opts = getActiveOptions();
		const next = !opts.enabled;
		setActiveOptions({ enabled: next });
		toggleBtn.textContent = next ? 'Enabled' : 'Disabled';
		toggleBtn.classList.toggle('active', next);
	});

	const resetBtn = toolbar.querySelector('[data-reset]') as HTMLButtonElement;
	resetBtn.addEventListener('click', () => {
		clearReport();
		renderCount = 0;
		rendersThisSecond = 0;
		rendersPerSecond = 0;
		updateDisplay();
	});

	const copyBtn = toolbar.querySelector('[data-copy]') as HTMLButtonElement;
	copyBtn.addEventListener('click', async () => {
		const summary = getReportSummary(25);
		const payload = JSON.stringify(summary, null, 2);
		if (!navigator.clipboard?.writeText) return;
		await navigator.clipboard.writeText(payload);
		const old = copyBtn.textContent;
		copyBtn.textContent = 'Copied';
		window.setTimeout(() => {
			copyBtn.textContent = old;
		}, 1200);
	});

	shadowRoot.appendChild(toolbar);
	const legacyMarker = document.createElement('span');
	legacyMarker.id = 'preact-scan-toolbar';
	legacyMarker.style.display = 'none';
	shadowRoot.appendChild(legacyMarker);
	document.documentElement.appendChild(rootContainer);

	return shadowRoot;
}

function updateDisplay() {
	if (!shadowRoot) return;

	const rendersEl = shadowRoot.querySelector('[data-renders]');
	const rpsEl = shadowRoot.querySelector('[data-rps]');
	const fpsEl = shadowRoot.querySelector('[data-fps]');
	const hotEl = shadowRoot.querySelector('[data-hot]');

	const hottest = getReportSummary(1)[0];
	const hotLabel = hottest
		? `${hottest.displayName} (${hottest.totalSelfTime.toFixed(1)}ms)`
		: '--';

	if (rendersEl) rendersEl.textContent = String(renderCount);
	if (rpsEl) rpsEl.textContent = String(rendersPerSecond);
	if (fpsEl) fpsEl.textContent = String(fps);
	if (hotEl) hotEl.textContent = hotLabel;
}


export function createToolbar() {
	if (rootContainer) return;
	createToolbarDOM();
	fpsRafId = requestAnimationFrame(updateFps);
}

export function destroyToolbar() {
	if (fpsRafId != null) {
		cancelAnimationFrame(fpsRafId);
		fpsRafId = null;
	}
	if (rootContainer) {
		rootContainer.remove();
		rootContainer = null;
		shadowRoot = null;
	}
	renderCount = 0;
	rendersThisSecond = 0;
	rendersPerSecond = 0;
	fps = 0;
	frameCount = 0;
	lastFpsTime = performance.now();
}

import type { RenderInfo, OutlineData } from './types';
import { setOverlayRenderListener, getActiveOptions } from './instrumentation';

// ─── Constants ──────────────────────────────────────────────────────────────

const OUTLINE_DURATION_MS = 750;
const FADE_SPEED: Record<string, number> = {
	fast: 1.5,
	slow: 0.6,
	off: 999, // instant
};

/** Render-count colour scale (purple → red as count increases) */
function getOutlineColor(count: number): string {
	if (count <= 1) return 'rgba(128, 90, 213, ALPHA)'; // violet
	if (count <= 4) return 'rgba(168, 85, 247, ALPHA)'; // purple
	if (count <= 10) return 'rgba(234, 88, 12, ALPHA)'; // orange
	return 'rgba(239, 68, 68, ALPHA)'; // red
}

function borderWidthForTime(ms: number): number {
	if (ms < 1) return 1;
	if (ms < 8) return 2;
	if (ms < 16) return 3;
	return 4;
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Active outlines keyed by element (so repeated renders on the same element merge) */
const outlines = new Map<Element, OutlineData>();

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId: number | null = null;
let isRunning = false;

// ─── Canvas Setup ───────────────────────────────────────────────────────────

function ensureCanvas(): CanvasRenderingContext2D {
	if (canvas && ctx) return ctx;

	canvas = document.createElement('canvas');
	canvas.id = 'preact-tracker-overlay';
	Object.assign(canvas.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		width: '100vw',
		height: '100vh',
		pointerEvents: 'none',
		zIndex: '2147483646',
	} satisfies Partial<CSSStyleDeclaration>);
	document.documentElement.appendChild(canvas);

	ctx = canvas.getContext('2d')!;
	resizeCanvas();

	window.addEventListener('resize', resizeCanvas);
	return ctx;
}

function resizeCanvas() {
	if (!canvas) return;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = window.innerWidth * dpr;
	canvas.height = window.innerHeight * dpr;
	ctx?.scale(dpr, dpr);
}

// ─── Drawing ────────────────────────────────────────────────────────────────

function drawFrame() {
	if (!ctx || !canvas) return;

	const speed = FADE_SPEED[getActiveOptions().animationSpeed ?? 'fast'] ?? 1.5;
	const nowMs = performance.now();

	// Clear
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	for (const [element, outline] of outlines) {
		// Check if element is still in DOM
		if (!element.isConnected) {
			outlines.delete(element);
			continue;
		}

		// Compute alpha decay
		const elapsed = nowMs - outline.timestamp;
		const progress = Math.min(elapsed / OUTLINE_DURATION_MS, 1);
		outline.alpha = Math.max(0, 1 - progress * speed);

		if (outline.alpha <= 0.01) {
			outlines.delete(element);
			continue;
		}

		// Get current bounding rect (element may have moved)
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) continue;
		outline.rect = rect;

		drawOutline(outline);
	}

	if (outlines.size > 0) {
		rafId = requestAnimationFrame(drawFrame);
	} else {
		// Nothing to draw — pause the loop
		stopLoop();
		// Clear the canvas
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}
}

function drawOutline(outline: OutlineData) {
	if (!ctx) return;

	const { rect, alpha, color, count, name } = outline;
	const resolvedColor = color.replace('ALPHA', String(alpha));
	const borderWidth = borderWidthForTime(
		outline.alpha > 0 ? (1 - outline.alpha) * 16 : 0,
	);

	// Outline rectangle
	ctx.strokeStyle = resolvedColor;
	ctx.lineWidth = borderWidth;
	ctx.strokeRect(
		rect.x + borderWidth / 2,
		rect.y + borderWidth / 2,
		rect.width - borderWidth,
		rect.height - borderWidth,
	);

	// Semi-transparent fill
	ctx.fillStyle = color.replace('ALPHA', String(alpha * 0.08));
	ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

	// Label
	if (alpha > 0.3) {
		const label = count > 1 ? `${name} ×${count}` : name;
		const fontSize = 10;
		ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;

		const textMetrics = ctx.measureText(label);
		const padding = 3;
		const labelHeight = fontSize + padding * 2;
		const labelWidth = textMetrics.width + padding * 2;

		// Position label above the outline
		let labelX = rect.x;
		let labelY = rect.y - labelHeight - 1;
		if (labelY < 0) labelY = rect.y + rect.height + 1;

		// Background
		ctx.fillStyle = color.replace('ALPHA', String(Math.min(alpha, 0.9)));
		ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

		// Text
		ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
		ctx.fillText(label, labelX + padding, labelY + fontSize + padding - 1);
	}
}

// ─── Render Listener ────────────────────────────────────────────────────────

function onRender(info: RenderInfo) {
	if (info.phase === 'unmount') {
		if (info.domNode) outlines.delete(info.domNode);
		return;
	}

	const el = info.domNode;
	if (!el) return;

	const existing = outlines.get(el);
	const count = existing ? existing.count + 1 : 1;

	outlines.set(el, {
		rect: el.getBoundingClientRect(),
		alpha: 1,
		color: getOutlineColor(count),
		count,
		name: info.componentName,
		timestamp: performance.now(),
	});

	ensureLoop();
}

// ─── Loop control ───────────────────────────────────────────────────────────

function ensureLoop() {
	if (isRunning) return;
	isRunning = true;
	ensureCanvas();
	rafId = requestAnimationFrame(drawFrame);
}

function stopLoop() {
	isRunning = false;
	if (rafId != null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startOverlay() {
	setOverlayRenderListener(onRender);
}

export function stopOverlay() {
	setOverlayRenderListener(null);
	stopLoop();
	outlines.clear();
	if (canvas) {
		canvas.remove();
		canvas = null;
		ctx = null;
	}
	window.removeEventListener('resize', resizeCanvas);
}

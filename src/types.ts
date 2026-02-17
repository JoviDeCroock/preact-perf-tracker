import type { VNode, Component, Options as PreactOptions } from 'preact';

// These reflect the mangled property names Preact uses at runtime (10.x).
// We declare them here so the rest of the codebase can access internals safely.

export interface InternalVNode<P = Record<string, unknown>> extends VNode<P> {
	/** Component instance (`_component`) */
	__c: InternalComponent | null;
	/** First DOM node (`_dom`) */
	__e: Element | Text | null;
	/** Children VNodes (`_children`) */
	__k: Array<InternalVNode | null> | null;
	/** Parent VNode (`_parent`) */
	__: InternalVNode | null;
	/** Diff flags / start offset (`_flags`) */
	__b: number;
	/** Index in parent children array (`_index`) */
	__i: number;
}

export interface InternalComponent extends Component<any, any> {
	/** Associated VNode (`_vnode`) */
	__v: InternalVNode;
	/** Pending / next state (`_nextState`) */
	__s: Record<string, unknown>;
	/** Dirty flag (`_dirty`) */
	__d: boolean;
	/** Force-update flag */
	__f: boolean;
	/** Hooks state container */
	__H: HooksState | null;
	/** displayName – set by user or build tooling */
	displayName?: string;
	/** Previous props snapshot (set by us for change detection) */
	__prevProps?: Record<string, unknown>;
	/** Previous state snapshot (set by us for change detection) */
	__prevState?: Record<string, unknown>;
	/** Previous hooks snapshot (set by us for hook-state change detection) */
	__prevHooks?: unknown[];
}

export interface HooksState {
	/** Ordered hook state list */
	__: HookState[];
	/** Pending effect hooks */
	__h: HookState[];
}

export interface HookState {
	/** Current value (useState ⇒ state value, useRef ⇒ ref object, …) */
	__: unknown;
	/** Deps array for effects / memo / callback */
	__H?: unknown[];
}

/** Extended Options including Preact-internal hooks */
export interface InternalOptions extends PreactOptions {
	__b?(vnode: InternalVNode): void;
	__r?(vnode: InternalVNode): void;
	__c?(vnode: InternalVNode, commitQueue: InternalComponent[]): void;
	__h?(component: InternalComponent, index: number, hookType: number): void;
}


export interface Options {
	/**
	 * Enable / disable tracking.
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Log render info to the console.
	 * @default false
	 */
	log?: boolean;

	/**
	 * Show the floating toolbar.
	 * @default true
	 */
	showToolbar?: boolean;

	/**
	 * Outline animation speed.
	 * @default "fast"
	 */
	animationSpeed?: 'slow' | 'fast' | 'off';

	/**
	 * Called when a component renders.
	 */
	onRender?: (info: RenderInfo) => void;

	/**
	 * Called when a commit cycle begins (before diffing).
	 */
	onCommitStart?: () => void;

	/**
	 * Called when a commit cycle ends (after diffed queue flushed).
	 */
	onCommitFinish?: () => void;
}

export enum ChangeType {
	Props = 1,
	State = 2,
	Context = 4,
	Force = 8,
}

export interface Change {
	type: ChangeType;
	name: string;
	prevValue?: unknown;
	nextValue?: unknown;
}

export interface RenderInfo {
	/** Component display name */
	componentName: string;
	/** Mount, update, or unmount */
	phase: 'mount' | 'update' | 'unmount';
	/** Wall-clock self-render time (ms) */
	selfTime: number;
	/** What triggered this render */
	changes: Change[];
	/** High-resolution timestamp */
	timestamp: number;
	/** Nearest DOM node in the subtree */
	domNode: Element | null;
}

export interface ReportEntry {
	count: number;
	totalSelfTime: number;
	displayName: string | null;
	type: unknown;
}

export interface ReportSummaryEntry {
	displayName: string;
	count: number;
	totalSelfTime: number;
	avgSelfTime: number;
}

export interface OutlineData {
	/** Target element bounding rect */
	rect: DOMRect;
	/** Current opacity (0..1) */
	alpha: number;
	/** Outline colour */
	color: string;
	/** Cumulative render count */
	count: number;
	/** Component display name */
	name: string;
	/** Last observed self render time for this element */
	selfTimeMs: number;
	/** Time outline was created / refreshed */
	timestamp: number;
}

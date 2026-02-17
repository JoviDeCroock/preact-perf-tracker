import type { InternalVNode } from './types';

/**
 * Get human-readable component name from a VNode.
 * Prefers `displayName`, falls back to `name`, then `'Unknown'`.
 */
export function getDisplayName(vnode: InternalVNode): string | null {
	const type = vnode.type;
	if (typeof type === 'string') return null; // host element
	if (typeof type === 'function') {
		return (
			(type as any).displayName || type.name || null
		);
	}
	return null;
}

/**
 * Get the nearest DOM Element for a component VNode.
 * Walks the child VNode tree if the component itself has no `__e`.
 */
export function getComponentDOMNode(vnode: InternalVNode): Element | null {
	let dom = vnode.__e;
	if (dom instanceof Element) return dom;

	// Walk children to find the first real DOM node
	const children = vnode.__k;
	if (children) {
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (!child) continue;
			if (child.__e instanceof Element) return child.__e;
		}
	}
	return null;
}

/**
 * Shallow diff two plain objects, returning an array of changed keys.
 */
export function shallowDiff(
	prev: Record<string, unknown> | null | undefined,
	next: Record<string, unknown> | null | undefined,
): string[] {
	const changed: string[] = [];
	if (!prev && !next) return changed;
	if (!prev || !next) {
		return Object.keys(next || prev || {});
	}
	const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
	for (const key of allKeys) {
		if (key === 'children') continue; // skip children prop (handled by vdom)
		if (!Object.is(prev[key], next[key])) {
			changed.push(key);
		}
	}
	return changed;
}

/**
 * Check whether a VNode represents a component (function or class).
 */
export function isComponentVNode(vnode: InternalVNode): boolean {
	return typeof vnode.type === 'function';
}

/**
 * Clone a plain object shallowly (for snapshot purposes).
 */
export function snapshot(
	obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	if (!obj) return null;
	return Object.assign({}, obj);
}

/** performance.now() wrapper */
export const now =
	typeof performance !== 'undefined'
		? () => performance.now()
		: () => Date.now();

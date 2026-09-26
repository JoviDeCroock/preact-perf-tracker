import type { InternalComponent, InternalVNode } from './types';

/** `COMPONENT_FORCE` bit in Preact 11's `component._bits` */
const COMPONENT_FORCE = 1 << 2;

/**
 * Whether a component is being re-rendered through `forceUpdate()` (or a
 * context-provider update). Preact 10 stores this as `component._force`
 * (mangled `__e`), Preact 11 moved it into the `component._bits` bitfield
 * (mangled `__g`). Preact clears the flag before `options._render` runs,
 * so this has to be read from `options._diff`.
 */
export function isForceUpdate(component: InternalComponent): boolean {
	return typeof component.__g === 'number'
		? (component.__g & COMPONENT_FORCE) !== 0
		: component.__e === true;
}

export function getDisplayName(vnode: InternalVNode): string | null {
	const type = vnode.type;
	if (typeof type === 'string') return null;
	if (typeof type === 'function') {
		const name = (type as any).displayName || type.name || null;
		if (name === 'type' || name === 'anonymous') return null;
		return name;
	}
	return null;
}

export function getComponentDOMNode(vnode: InternalVNode): Element | null {
	let dom = vnode.__e;
	if (dom instanceof Element) return dom;

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
		if (key === 'children') continue;
		if (!Object.is(prev[key], next[key])) {
			changed.push(key);
		}
	}
	return changed;
}

export function isComponentVNode(vnode: InternalVNode): boolean {
	return typeof vnode.type === 'function';
}

export function isFragmentLikeVNode(vnode: InternalVNode): boolean {
	const type = vnode.type as unknown;
	if (typeof type !== 'function') return false;

	const maybeComponentType = type as {
		name?: string;
		displayName?: string;
	};
	const name = maybeComponentType.displayName || maybeComponentType.name || '';

	if (name === 'Fragment') return true;

	// In linked-package/dev setups, Fragment can come from another Preact copy
	// and appear as a minified one-letter function (e.g. "k").
	if (/^[a-z]$/.test(name)) {
		const props = vnode.props as Record<string, unknown> | null | undefined;
		if (!props) return false;
		const keys = Object.keys(props);
		return keys.length === 1 && keys[0] === 'children';
	}

	return false;
}

export function snapshot(
	obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	if (!obj) return null;
	return Object.assign({}, obj);
}

export const now =
	typeof performance !== 'undefined'
		? () => performance.now()
		: () => Date.now();

import { describe, it, expect } from 'vitest';
import {
	getDisplayName,
	getComponentDOMNode,
	shallowDiff,
	isComponentVNode,
	snapshot,
} from '../utils';
import type { InternalVNode } from '../types';


function makeVNode(
	overrides: Partial<InternalVNode> = {},
): InternalVNode {
	return {
		type: 'div',
		key: null,
		ref: null,
		props: {},
		__c: null,
		__e: null,
		__k: null,
		__: null,
		__b: 0,
		__i: 0,
		constructor: undefined,
		...overrides,
	} as unknown as InternalVNode;
}


describe('getDisplayName', () => {
	it('returns null for host element vnodes', () => {
		const vnode = makeVNode({ type: 'div' });
		expect(getDisplayName(vnode)).toBe(null);
	});

	it('returns function name for a named component', () => {
		function MyComponent() {}
		const vnode = makeVNode({ type: MyComponent as any });
		expect(getDisplayName(vnode)).toBe('MyComponent');
	});

	it('prefers displayName over function name', () => {
		function Foo() {}
		(Foo as any).displayName = 'BarComponent';
		const vnode = makeVNode({ type: Foo as any });
		expect(getDisplayName(vnode)).toBe('BarComponent');
	});

	it('returns null for an anonymous arrow function', () => {
		// Create arrow fn as a separate variable to avoid JS engines
		// inferring the name from the object property key
		const anonFn = (() => {
			return () => {};
		})();
		const vnode = makeVNode({ type: anonFn as any });
		// Arrow functions have name="" in most engines
		expect(getDisplayName(vnode)).toBe(null);
	});
});


describe('getComponentDOMNode', () => {
	it('returns __e if it is an Element', () => {
		const el = document.createElement('span');
		const vnode = makeVNode({ __e: el });
		expect(getComponentDOMNode(vnode)).toBe(el);
	});

	it('returns null if __e is a Text node and no children', () => {
		const text = document.createTextNode('hi');
		const vnode = makeVNode({ __e: text });
		expect(getComponentDOMNode(vnode)).toBe(null);
	});

	it('walks children to find the first Element', () => {
		const el = document.createElement('div');
		const child = makeVNode({ __e: el });
		const parent = makeVNode({ __e: null, __k: [null, child] });
		expect(getComponentDOMNode(parent)).toBe(el);
	});

	it('returns null when there are no children and no __e', () => {
		const vnode = makeVNode({ __e: null, __k: null });
		expect(getComponentDOMNode(vnode)).toBe(null);
	});
});


describe('shallowDiff', () => {
	it('returns empty array for two nulls', () => {
		expect(shallowDiff(null, null)).toEqual([]);
	});

	it('returns all keys when prev is null', () => {
		const result = shallowDiff(null, { a: 1, b: 2 });
		expect(result.sort()).toEqual(['a', 'b']);
	});

	it('returns all keys when next is null', () => {
		const result = shallowDiff({ x: 1 }, null);
		expect(result).toEqual(['x']);
	});

	it('detects changed values', () => {
		const result = shallowDiff({ a: 1, b: 2 }, { a: 1, b: 3 });
		expect(result).toEqual(['b']);
	});

	it('detects added keys', () => {
		const result = shallowDiff({ a: 1 }, { a: 1, b: 2 });
		expect(result).toEqual(['b']);
	});

	it('detects removed keys', () => {
		const result = shallowDiff({ a: 1, b: 2 }, { a: 1 });
		expect(result).toEqual(['b']);
	});

	it('skips the "children" key', () => {
		const result = shallowDiff(
			{ children: [1], x: 1 },
			{ children: [2], x: 1 },
		);
		expect(result).toEqual([]);
	});

	it('uses Object.is for comparison (NaN === NaN)', () => {
		const result = shallowDiff({ a: NaN }, { a: NaN });
		expect(result).toEqual([]);
	});

	it('distinguishes +0 from -0', () => {
		const result = shallowDiff({ a: 0 }, { a: -0 });
		expect(result).toEqual(['a']);
	});
});


describe('isComponentVNode', () => {
	it('returns true for function components', () => {
		function Comp() {}
		expect(isComponentVNode(makeVNode({ type: Comp as any }))).toBe(true);
	});

	it('returns false for host elements', () => {
		expect(isComponentVNode(makeVNode({ type: 'div' }))).toBe(false);
	});
});


describe('snapshot', () => {
	it('returns null for null/undefined', () => {
		expect(snapshot(null)).toBe(null);
		expect(snapshot(undefined)).toBe(null);
	});

	it('creates a shallow copy', () => {
		const obj = { a: 1, b: { nested: true } };
		const copy = snapshot(obj)!;
		expect(copy).toEqual(obj);
		expect(copy).not.toBe(obj);
		// Nested reference is shared (shallow)
		expect(copy.b).toBe(obj.b);
	});
});

// StringRenderer Headless Component with StringRenderer class inside
const StringRendererComponent = (props, context) => {
	const { getState, juris } = context;

	const originalDOMRenderer = juris.domRenderer;

	// StringRenderer class defined inside the component
	class StringRenderer {
		constructor() {
			this.renderMode = 'string';
			this.juris = juris; // Use juris from component closure
			this.renderDepth = 0;
			this.maxRenderDepth = 100;
		}

		render(vnode, context = null) {
			if (this.renderDepth > this.maxRenderDepth) {
				console.warn('StringRenderer: Maximum render depth exceeded');
				return '<!-- Max render depth exceeded -->';
			}

			this.renderDepth++;

			try {
				const result = this._renderInternal(vnode, context);
				this.renderDepth--;
				return result;
			} catch (error) {
				this.renderDepth--;
				console.error('StringRenderer: Render error:', error);
				return `<!-- Render error: ${error.message} -->`;
			}
		}

		_renderInternal(vnode, context) {
			if (!vnode) {
				return '';
			}

			if (typeof vnode !== 'object') {
				return this._escapeHtml(String(vnode));
			}

			if (Array.isArray(vnode)) {
				return vnode.map(child => this.render(child, context)).join('');
			}

			const tagName = Object.keys(vnode)[0];
			if (!tagName) {
				return '';
			}

			const nodeProps = vnode[tagName] || {};

			// Check if it's a component
			if (this.juris && this.juris.componentManager && this.juris.componentManager.components.has(tagName)) {
				return this._renderComponent(tagName, nodeProps, context);
			}

			// Render as regular HTML element
			return this._renderElement(tagName, nodeProps, context);
		}

		_renderComponent(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				// Use the existing context from Juris
				let componentContext = parentContext;
				if (!componentContext) {
					componentContext = this.juris.createContext();
				}

				// Execute component function
				const componentResult = componentFn(props, componentContext);

				if (!componentResult) {
					return '';
				}

				// Handle component that returns { render: function } pattern
				if (componentResult.render && typeof componentResult.render === 'function') {
					try {
						const renderResult = componentResult.render();
						return this.render(renderResult, componentContext);
					} catch (renderError) {
						console.error(`StringRenderer: Error in component ${tagName} render method:`, renderError);
						return `<!-- Component ${tagName} render error: ${renderError.message} -->`;
					}
				}

				// Handle direct vnode return
				if (typeof componentResult === 'object' && componentResult !== null) {
					const keys = Object.keys(componentResult);
					if (keys.length > 0) {
						const firstKey = keys[0];

						// Check if it's a valid HTML tag or component
						const isValidTag = /^[a-z][a-z0-9]*$/i.test(firstKey) ||
							/^[A-Z][a-zA-Z0-9]*$/.test(firstKey) ||
							this.juris.componentManager.components.has(firstKey);

						if (isValidTag) {
							return this.render(componentResult, componentContext);
						}
					}
				}

				return this._escapeHtml(String(componentResult));

			} catch (error) {
				console.error(`StringRenderer: Error rendering component ${tagName}:`, error);
				return `<!-- Component ${tagName} error: ${error.message} -->`;
			}
		}

		_renderElement(tagName, props, context) {
			let html = `<${tagName}`;

			// Handle attributes
			Object.keys(props).forEach(key => {
				if (this._shouldSkipAttribute(key)) {
					return;
				}

				const value = props[key];
				if (typeof value === 'function') {
					try {
						const evalValue = this._evaluateFunction(value, context);
						if (evalValue !== null && evalValue !== undefined) {
							html += ` ${key}="${this._escapeHtml(evalValue)}"`;
						}
					} catch (e) {
						console.warn(`StringRenderer: Error evaluating attribute ${key}:`, e);
					}
				} else if (value !== null && value !== undefined) {
					html += ` ${key}="${this._escapeHtml(value)}"`;
				}
			});

			// Handle style attribute
			if (props.style) {
				const styleStr = this._renderStyle(props.style, context);
				if (styleStr) {
					html += ` style="${styleStr}"`;
				}
			}

			html += '>';

			// Handle content
			if (props.text !== undefined) {
				const text = typeof props.text === 'function'
					? this._evaluateFunction(props.text, context)
					: props.text;
				html += this._escapeHtml(text);
			} else if (props.children !== undefined) {
				let children = props.children;

				if (typeof children === 'function') {
					try {
						children = this._evaluateFunction(children, context);
					} catch (e) {
						console.error('StringRenderer: Error evaluating children function:', e);
						children = [];
					}
				}

				if (Array.isArray(children)) {
					html += children.map(child => this.render(child, context)).join('');
				} else if (children !== null && children !== undefined) {
					html += this.render(children, context);
				}
			}

			if (!this._isVoidElement(tagName)) {
				html += `</${tagName}>`;
			}

			return html;
		}

		_shouldSkipAttribute(key) {
			return ['children', 'text', 'style'].includes(key) || key.startsWith('on');
		}

		_isVoidElement(tagName) {
			const voidElements = [
				'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
				'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
			];
			return voidElements.includes(tagName.toLowerCase());
		}

		_evaluateFunction(fn, context) {
			if (typeof fn !== 'function') {
				return fn;
			}

			try {
				return fn.call(context);
			} catch (error) {
				console.warn('StringRenderer: Function evaluation error:', error);
				console.warn('Context available:', context ? Object.keys(context) : 'No context');
				return '';
			}
		}

		_renderStyle(style, context) {
			if (!style) {
				return '';
			}

			if (typeof style === 'function') {
				try {
					style = this._evaluateFunction(style, context);
				} catch (e) {
					console.warn('StringRenderer: Style function evaluation error:', e);
					return '';
				}
			}

			if (typeof style === 'object' && style !== null) {
				return Object.entries(style)
					.map(([prop, value]) => {
						let cssValue = value;
						if (typeof value === 'function') {
							cssValue = this._evaluateFunction(value, context);
						}
						const cssProp = this._camelToKebab(prop);
						return `${cssProp}: ${cssValue}`;
					})
					.filter(rule => rule.split(': ')[1] !== 'undefined')
					.join('; ');
			}

			return String(style);
		}

		_camelToKebab(str) {
			return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
		}

		_escapeHtml(str) {
			if (str == null) {
				return '';
			}
			return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		// Interface compatibility methods
		cleanup() {
			this.renderDepth = 0;
			return '';
		}

		setRenderMode(mode) {
			this.renderMode = mode;
		}

		getRenderMode() {
			return this.renderMode;
		}

		isFineGrained() {
			return false;
		}

		isBatchMode() {
			return false;
		}

		updateElementContent() {
			return '';
		}

		// Properties for interface compatibility
		subscriptions = new WeakMap();
		eventMap = {};
		elementCache = new Map();
		recyclePool = new Map();
		renderQueue = [];
		isRendering = false;
		scheduledRender = null;
	}

	// Create instance of StringRenderer
	const stringRenderer = new StringRenderer();

	return {
		api: {
			enableStringRenderer() {
				juris.domRenderer = stringRenderer;
				return stringRenderer;
			},
			enableDOMRenderer() {
				juris.domRenderer = originalDOMRenderer;
				return originalDOMRenderer;
			},
			getCurrentRenderer() {
				return juris.domRenderer === stringRenderer ? 'string' : 'dom';
			},
			renderToString(layout) {
				const layoutToRender = layout || juris.layout;
				if (!layoutToRender) {
					return '<p>No layout provided</p>';
				}

				try {
					return stringRenderer.render(layoutToRender);
				} catch (error) {
					console.error('StringRenderer renderToString error:', error);
					return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
				}
			},
			stringRenderer,
			originalDOMRenderer
		}
	};
};

// SimpleRouter Headless Component
const SimpleRouter = (props, context) => {
	const { setState, getState, juris } = context;

	const parseRoute = (route) => {
		if (!route || typeof route !== 'string') {
			return { path: '/', params: {}, query: {} };
		}

		const [pathAndQuery] = route.split('#');
		const [path, queryString] = pathAndQuery.split('?');

		const params = {};
		const query = {};

		if (queryString) {
			queryString.split('&').forEach(pair => {
				const [key, value] = pair.split('=');
				if (key) {
					query[decodeURIComponent(key)] = decodeURIComponent(value || '');
				}
			});
		}

		return { path: path || '/', params, query };
	};

	const matchRoute = (currentPath, routePattern) => {
		const currentSegments = currentPath.split('/').filter(Boolean);
		const patternSegments = routePattern.split('/').filter(Boolean);

		if (currentSegments.length !== patternSegments.length) {
			return null;
		}

		const params = {};

		for (let i = 0; i < patternSegments.length; i++) {
			const pattern = patternSegments[i];
			const current = currentSegments[i];

			if (pattern.startsWith(':')) {
				params[pattern.slice(1)] = current;
			} else if (pattern !== current) {
				return null;
			}
		}

		return params;
	};

	const api = {
		setRoute(route) {
			const parsed = parseRoute(route);

			const preservePaths = props.preserveOnRoute || [];

			setState('route', {
				current: route,
				path: parsed.path,
				params: parsed.params,
				query: parsed.query
			});

			return getState('route');
		},

		getRoute() {
			return getState('route', {});
		},

		navigate(route) {
			this.setRoute(route);

			if (typeof window !== 'undefined' && window.history) {
				window.history.pushState({}, '', route);
			}

			return this.getRoute();
		},

		replace(route) {
			this.setRoute(route);

			if (typeof window !== 'undefined' && window.history) {
				window.history.replaceState({}, '', route);
			}

			return this.getRoute();
		},

		buildUrl(pattern, params = {}, query = {}) {
			let url = pattern;

			Object.entries(params).forEach(([key, value]) => {
				url = url.replace(`:${key}`, encodeURIComponent(value));
			});

			const queryString = Object.entries(query)
				.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
				.join('&');

			if (queryString) {
				url += `?${queryString}`;
			}

			return url;
		},

		matches(pattern) {
			const route = this.getRoute();
			return matchRoute(route.path, pattern) !== null;
		},

		getParams(pattern) {
			const route = this.getRoute();
			return matchRoute(route.path, pattern) || {};
		}
	};

	return {
		api: api,
		hooks: {
			onRegister() {
				if (typeof window !== 'undefined') {
					window.addEventListener('popstate', () => {
						const currentRoute = window.location.pathname + window.location.search;
						api.setRoute(currentRoute);
					});

					const initialRoute = window.location.pathname + window.location.search;
					api.setRoute(initialRoute);
				}
			}
		}
	};
};


if (typeof module !== 'undefined' && module.exports) {
	// Node.js environment
	module.exports = {
		StringRendererComponent,
		SimpleRouter,
		createApp: (initialState) => {
			const Juris = require('../juris/juris.js');
			return new Juris({
				states: {
					counter: 0,
					todos: [],
					user: { name: 'Guest', isLoggedIn: false },
					...initialState
				},
				headlessComponents: {
					StringRenderer: {
						fn: StringRendererComponent,
						options: { autoInit: true }
					},
					Router: {
						fn: SimpleRouter,
						options: {
							preserveOnRoute: ['user'],
							autoInit: true
						}
					}
				}
			});
		}
	};
} else {
	// Browser environment
	Juris = window.Juris;
}
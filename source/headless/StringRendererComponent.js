// StringRenderer Headless Component with proper component handling
const StringRendererComponent = (props, context) => {
	const { getState, juris } = context;

	const originalDOMRenderer = juris.domRenderer;

	// Enhanced StringRenderer with proper attribute handling and component support
	class StringRenderer {
		constructor(juris = null) {
			this.renderMode = 'string';
			this.juris = juris; // Set from constructor parameter
			this.renderDepth = 0;
			this.maxRenderDepth = 100;

			// Boolean attributes that should be rendered without values when true
			this.booleanAttributes = new Set([
				'autofocus', 'autoplay', 'async', 'checked', 'controls', 'defer',
				'disabled', 'hidden', 'loop', 'multiple', 'muted', 'open',
				'readonly', 'required', 'reversed', 'selected', 'default'
			]);

			// Attributes that should be skipped completely
			this.skipAttributes = new Set([
				'children', 'text', 'style', 'key'
			]);

			// Event handler patterns (attributes starting with 'on')
			this.eventHandlerPattern = /^on[a-z]/i;
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

			// Check if it's a component - FIXED: ensure juris and componentManager exist
			if (this.juris && this.juris.componentManager && this.juris.componentManager.components.has(tagName)) {
				return this._renderComponent(tagName, nodeProps, context);
			}

			// Render as regular HTML element
			return this._renderElement(tagName, nodeProps, context);
		}

		_renderComponent(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				// Create proper context for component - FIXED: use juris.createContext
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
							(this.juris && this.juris.componentManager && this.juris.componentManager.components.has(firstKey));

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

			// Handle all attributes except special ones
			const processedAttributes = this._processAttributes(props, context);
			html += processedAttributes;

			// Handle style attribute separately
			const styleStr = this._renderStyle(props.style, context);
			if (styleStr) {
				html += ` style="${this._escapeAttributeValue(styleStr)}"`;
			}

			html += '>';

			// Handle content
			if (props.text !== undefined) {
				const text = typeof props.text === 'function'
					? this._evaluateFunction(props.text, context)
					: props.text;
				html += this._escapeHtml(String(text));
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

		_processAttributes(props, context) {
			let attributesHtml = '';

			Object.keys(props).forEach(key => {
				// Skip special attributes and event handlers
				if (this._shouldSkipAttribute(key)) {
					return;
				}

				const value = props[key];
				let processedValue = value;

				// Evaluate functions
				if (typeof value === 'function') {
					try {
						processedValue = this._evaluateFunction(value, context);
					} catch (e) {
						console.warn(`StringRenderer: Error evaluating attribute ${key}:`, e);
						return;
					}
				}

				// Handle different attribute types
				attributesHtml += this._renderAttribute(key, processedValue);
			});

			return attributesHtml;
		}

		_renderAttribute(name, value) {
			// Handle null/undefined values
			if (value === null || value === undefined) {
				return '';
			}

			const lowerName = name.toLowerCase();

			// Handle boolean attributes - aligned with DOMRenderer logic
			if (this.booleanAttributes.has(lowerName)) {
				// For boolean attributes, render the attribute name only if truthy
				if (value === true || value === '' || value === name || value === lowerName) {
					return ` ${name}`;
				} else if (value === false) {
					return '';
				} else {
					// For non-boolean values on boolean attributes, treat as regular attribute
					return ` ${name}="${this._escapeAttributeValue(value)}"`;
				}
			}

			// Handle data- and aria- attributes (always render with value)
			if (lowerName.startsWith('data-') || lowerName.startsWith('aria-')) {
				return ` ${name}="${this._escapeAttributeValue(value)}"`;
			}

			// Handle special cases - aligned with DOMRenderer _setStaticAttribute
			switch (lowerName) {
				case 'class':
				case 'classname':
					// Handle class arrays or objects
					const className = this._processClassName(value);
					return className ? ` class="${this._escapeAttributeValue(className)}"` : '';

				case 'for':
				case 'htmlfor':
					// Convert htmlFor to for
					return ` for="${this._escapeAttributeValue(value)}"`;

				case 'tabindex':
					// Ensure tabindex is a number - aligned with DOMRenderer
					const tabIndex = parseInt(value, 10);
					return isNaN(tabIndex) ? '' : ` tabindex="${tabIndex}"`;

				case 'value':
					// Handle form control values
					return ` value="${this._escapeAttributeValue(value)}"`;

				case 'type':
					// Input type attribute
					return ` type="${this._escapeAttributeValue(value)}"`;

				case 'id':
					// ID attribute
					return ` id="${this._escapeAttributeValue(value)}"`;

				case 'name':
					// Name attribute
					return ` name="${this._escapeAttributeValue(value)}"`;

				case 'placeholder':
					// Placeholder attribute
					return ` placeholder="${this._escapeAttributeValue(value)}"`;

				case 'title':
					// Title attribute
					return ` title="${this._escapeAttributeValue(value)}"`;

				case 'alt':
					// Alt attribute for images
					return ` alt="${this._escapeAttributeValue(value)}"`;

				case 'src':
					// Src attribute for images/scripts
					return ` src="${this._escapeAttributeValue(value)}"`;

				case 'href':
					// Href attribute for links
					return ` href="${this._escapeAttributeValue(value)}"`;

				case 'target':
					// Target attribute for links
					return ` target="${this._escapeAttributeValue(value)}"`;

				case 'rel':
					// Rel attribute for links
					return ` rel="${this._escapeAttributeValue(value)}"`;

				case 'role':
					// ARIA role attribute
					return ` role="${this._escapeAttributeValue(value)}"`;

				case 'contenteditable':
					// ContentEditable attribute
					return ` contenteditable="${this._escapeAttributeValue(value)}"`;

				case 'draggable':
					// Draggable attribute
					return ` draggable="${this._escapeAttributeValue(value)}"`;

				case 'spellcheck':
					// Spellcheck attribute
					return ` spellcheck="${this._escapeAttributeValue(value)}"`;

				default:
					// Regular attributes
					return ` ${name}="${this._escapeAttributeValue(value)}"`;
			}
		}

		_processClassName(value) {
			if (typeof value === 'string') {
				return value.trim();
			}

			if (Array.isArray(value)) {
				return value
					.filter(cls => cls && typeof cls === 'string')
					.map(cls => cls.trim())
					.filter(cls => cls.length > 0)
					.join(' ');
			}

			if (typeof value === 'object' && value !== null) {
				return Object.entries(value)
					.filter(([cls, condition]) => condition && cls)
					.map(([cls]) => cls.trim())
					.filter(cls => cls.length > 0)
					.join(' ');
			}

			return '';
		}

		_shouldSkipAttribute(key) {
			// Skip special props, style (handled separately), and event handlers
			return this.skipAttributes.has(key) ||
				this.eventHandlerPattern.test(key) ||
				key === 'style';
		}

		_isVoidElement(tagName) {
			const voidElements = new Set([
				'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
				'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
			]);
			return voidElements.has(tagName.toLowerCase());
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

						// Skip undefined/null values
						if (cssValue === undefined || cssValue === null) {
							return '';
						}

						const cssProp = this._camelToKebab(prop);
						return `${cssProp}: ${cssValue}`;
					})
					.filter(rule => rule && !rule.endsWith(': undefined') && !rule.endsWith(': null'))
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

		_escapeAttributeValue(value) {
			if (value == null) {
				return '';
			}
			return String(value)
				.replace(/&/g, '&amp;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		}

		// Main renderToString method - the primary public API
		renderToString(layout, context = null) {
			if (!layout) {
				return '<p>No layout provided</p>';
			}

			try {
				return this.render(layout, context);
			} catch (error) {
				console.error('StringRenderer renderToString error:', error);
				return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
			}
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

	// Create instance of StringRenderer with juris reference - FIXED!
	const stringRenderer = new StringRenderer(juris);

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
					// Use the stringRenderer instance that has juris reference
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
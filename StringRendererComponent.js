// Enhanced StringRenderer Headless Component with AUTO-DETECTION for async components
const StringRendererComponent = (props, context) => {
	const { getState, juris } = context;

	const originalDOMRenderer = juris.domRenderer;

	// Localized promisify for StringRenderer - optimized for string output
	const createStringPromisify = () => {
		// For string rendering, we prefer synchronous resolution when possible
		let useNative = typeof Promise.try === 'function';

		const promisify = (result) => {
			// For string rendering, if we have a sync value, return it immediately
			if (!result || typeof result.then !== 'function') {
				return result;
			}

			// Only use Promise machinery when actually needed
			return useNative ? Promise.try(() => result) : result;
		};

		const setPromiseMode = (mode) => {
			useNative = mode === 'native' || (mode !== 'custom' && typeof Promise.try === 'function');
		};

		// String-specific async resolver
		const resolveToString = async (value, fallback = '') => {
			try {
				if (value && typeof value.then === 'function') {
					const resolved = await promisify(value);
					return String(resolved ?? fallback);
				}
				return String(value ?? fallback);
			} catch (error) {
				console.warn('StringRenderer: Async resolution failed:', error);
				return fallback;
			}
		};

		return { promisify, setPromiseMode, resolveToString };
	};

	const { promisify, setPromiseMode, resolveToString } = createStringPromisify();

	// Enhanced StringRenderer with AUTO-DETECTION and proper component handling
	class StringRenderer {
		constructor(juris = null) {
			this.renderMode = 'string';
			this.juris = juris;
			this.renderDepth = 0;
			this.maxRenderDepth = 100;

			// Auto-detection settings
			this.autoDetectAsync = true;
			this.asyncDetected = false;
			this.currentRenderIsAsync = false;

			// Async rendering settings
			this.asyncTimeout = 5000;
			this.asyncPlaceholder = '<!-- Loading... -->';
			this.asyncErrorPlaceholder = '<!-- Error loading content -->';

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

		/**
		 * SMART RENDER - Auto-detects async and switches mode automatically
		 */
		smartRender(vnode, context = null) {
			// Reset async detection
			this.asyncDetected = false;
			this.currentRenderIsAsync = false;

			try {
				// First try sync rendering
				const syncResult = this.render(vnode, context);

				// Check if async was detected during sync rendering
				if (this.asyncDetected || this._containsAsyncIndicators(syncResult)) {
					console.log('Auto-detected async components, switching to async rendering');
					this.currentRenderIsAsync = true;
					return this.renderAsync(vnode, context);
				}

				return syncResult;
			} catch (error) {
				// If sync fails, try async
				console.warn('Sync render failed, trying async:', error.message);
				this.currentRenderIsAsync = true;
				return this.renderAsync(vnode, context);
			}
		}

		/**
		 * Check if result contains async indicators
		 */
		_containsAsyncIndicators(result) {
			if (typeof result !== 'string') return false;

			return result.includes('<!-- Loading... -->') ||
				result.includes('[object Promise]') ||
				result.includes('<!-- Async component') ||
				result.includes('async rendering detected');
		}

		/**
		 * Enhanced render method with async detection
		 */
		render(vnode, context = null) {
			if (this.renderDepth > this.maxRenderDepth) {
				console.warn('StringRenderer: Maximum render depth exceeded');
				return '<!-- Max render depth exceeded -->';
			}

			this.renderDepth++;

			try {
				const result = this._renderInternal(vnode, context);
				this.renderDepth--;

				// Check if result is a promise during sync rendering
				if (result && typeof result.then === 'function') {
					this.asyncDetected = true;
					console.warn('StringRenderer: Async rendering detected, will retry with async mode');
					return this.asyncPlaceholder;
				}

				return result;
			} catch (error) {
				this.renderDepth--;
				console.error('StringRenderer: Render error:', error);
				return `<!-- Render error: ${error.message} -->`;
			}
		}

		/**
		 * Async-aware render method
		 */
		async renderAsync(vnode, context = null) {
			if (this.renderDepth > this.maxRenderDepth) {
				console.warn('StringRenderer: Maximum render depth exceeded');
				return '<!-- Max render depth exceeded -->';
			}

			this.renderDepth++;

			try {
				const result = await this._renderInternalAsync(vnode, context);
				this.renderDepth--;
				return result;
			} catch (error) {
				this.renderDepth--;
				console.error('StringRenderer: Async render error:', error);
				return `<!-- Async render error: ${error.message} -->`;
			}
		}

		/**
		 * Internal render with async detection
		 */
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
				return this._renderComponentWithDetection(tagName, nodeProps, context);
			}

			// Render as regular HTML element
			return this._renderElement(tagName, nodeProps, context);
		}

		/**
		 * Component rendering with async detection
		 */
		_renderComponentWithDetection(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				let componentContext = parentContext;
				if (!componentContext) {
					componentContext = this.juris.createContext();
				}

				// Execute component function
				const componentResult = componentFn(props, componentContext);

				// DETECTION: Check if component returned a promise
				if (componentResult && typeof componentResult.then === 'function') {
					this.asyncDetected = true;
					return this.asyncPlaceholder;
				}

				if (!componentResult) {
					return '';
				}

				// Handle component that returns { render: function } pattern
				if (componentResult.render && typeof componentResult.render === 'function') {
					try {
						const renderResult = componentResult.render();

						// DETECTION: Check if render result is async
						if (renderResult && typeof renderResult.then === 'function') {
							this.asyncDetected = true;
							return this.asyncPlaceholder;
						}

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

		/**
		 * Async internal render
		 */
		async _renderInternalAsync(vnode, context) {
			if (!vnode) return '';

			if (typeof vnode !== 'object') {
				return this._escapeHtml(String(vnode));
			}

			if (Array.isArray(vnode)) {
				const results = await Promise.all(
					vnode.map(child => this.renderAsync(child, context))
				);
				return results.join('');
			}

			const tagName = Object.keys(vnode)[0];
			if (!tagName) return '';

			const nodeProps = vnode[tagName] || {};

			// Check for component
			if (this.juris?.componentManager?.components.has(tagName)) {
				return await this._renderComponentAsync(tagName, nodeProps, context);
			}

			// Render as HTML element
			return await this._renderElementAsync(tagName, nodeProps, context);
		}

		/**
		 * Async component rendering
		 */
		async _renderComponentAsync(tagName, props, parentContext) {
			try {
				const componentFn = this.juris.componentManager.components.get(tagName);

				let componentContext = parentContext;
				if (!componentContext) {
					componentContext = this.juris.createContext();
				}

				// Component function itself might be async
				const componentResult = await promisify(componentFn(props, componentContext));

				if (!componentResult) return '';

				// Handle render function pattern
				if (componentResult.render && typeof componentResult.render === 'function') {
					try {
						const renderResult = await promisify(componentResult.render());
						return await this.renderAsync(renderResult, componentContext);
					} catch (renderError) {
						console.error(`StringRenderer: Error in async component ${tagName} render:`, renderError);
						return `<!-- Component ${tagName} async render error: ${renderError.message} -->`;
					}
				}

				// Handle direct vnode return
				if (typeof componentResult === 'object' && componentResult !== null) {
					const keys = Object.keys(componentResult);
					if (keys.length > 0) {
						const firstKey = keys[0];
						const isValidTag = /^[a-z][a-z0-9]*$/i.test(firstKey) ||
							/^[A-Z][a-zA-Z0-9]*$/.test(firstKey) ||
							this.juris?.componentManager?.components.has(firstKey);

						if (isValidTag) {
							return await this.renderAsync(componentResult, componentContext);
						}
					}
				}

				return this._escapeHtml(String(componentResult));

			} catch (error) {
				console.error(`StringRenderer: Async component ${tagName} error:`, error);
				return `<!-- Async component ${tagName} error: ${error.message} -->`;
			}
		}

		/**
		 * Enhanced element rendering
		 */
		_renderElement(tagName, props, context) {
			let html = `<${tagName}`;

			// Handle all attributes except special ones (including style)
			const processedAttributes = this._processAttributes(props, context);
			html += processedAttributes;

			// Handle style attribute separately - FIXED: proper style handling with debugging
			if (props.style !== undefined) {
				try {
					const styleStr = this._renderStyle(props.style, context);
					if (styleStr && styleStr.trim()) {
						html += ` style="${this._escapeAttributeValue(styleStr)}"`;
					}
				} catch (error) {
					console.error('Error rendering style:', error, 'Style object:', props.style);
					// Don't render invalid style
				}
			}

			html += '>';

			// Handle content
			html += this._renderElementContent(props, context);

			if (!this._isVoidElement(tagName)) {
				html += `</${tagName}>`;
			}

			return html;
		}

		/**
		 * Async element rendering
		 */
		async _renderElementAsync(tagName, props, context) {
			let html = `<${tagName}`;

			// Process attributes (potentially async)
			const processedAttributes = await this._processAttributesAsync(props, context);
			html += processedAttributes;

			// Handle style (potentially async) - FIXED: proper style handling
			if (props.style !== undefined) {
				const styleStr = await this._renderStyleAsync(props.style, context);
				if (styleStr) {
					html += ` style="${this._escapeAttributeValue(styleStr)}"`;
				}
			}

			html += '>';

			// Handle content (potentially async)
			html += await this._renderElementContentAsync(props, context);

			if (!this._isVoidElement(tagName)) {
				html += `</${tagName}>`;
			}

			return html;
		}

		/**
		 * Enhanced element content rendering with async detection
		 */
		_renderElementContent(props, context) {
			if (props.text !== undefined) {
				const text = this._evaluateValueWithDetection(props.text, context);
				return this._escapeHtml(String(text));
			}

			if (props.children !== undefined) {
				let children = this._evaluateValueWithDetection(props.children, context);

				if (Array.isArray(children)) {
					return children.map(child => this.render(child, context)).join('');
				} else if (children !== null && children !== undefined) {
					return this.render(children, context);
				}
			}

			return '';
		}

		/**
		 * Async element content rendering
		 */
		async _renderElementContentAsync(props, context) {
			if (props.text !== undefined) {
				const text = await this._evaluateValueAsync(props.text, context);
				return this._escapeHtml(String(text));
			}

			if (props.children !== undefined) {
				let children = await this._evaluateValueAsync(props.children, context);

				if (Array.isArray(children)) {
					const results = await Promise.all(
						children.map(child => this.renderAsync(child, context))
					);
					return results.join('');
				} else if (children !== null && children !== undefined) {
					return await this.renderAsync(children, context);
				}
			}

			return '';
		}

		/**
		 * Enhanced attribute processing
		 */
		_processAttributes(props, context) {
			let attributesHtml = '';

			Object.keys(props).forEach(key => {
				// Skip special attributes and event handlers
				if (this._shouldSkipAttribute(key)) {
					return;
				}

				const value = this._evaluateValueWithDetection(props[key], context);
				attributesHtml += this._renderAttribute(key, value);
			});

			return attributesHtml;
		}

		/**
		 * Async attribute processing
		 */
		async _processAttributesAsync(props, context) {
			let attributesHtml = '';

			for (const key of Object.keys(props)) {
				if (this._shouldSkipAttribute(key)) continue;

				const value = await this._evaluateValueAsync(props[key], context);
				attributesHtml += this._renderAttribute(key, value);
			}

			return attributesHtml;
		}

		/**
		 * Enhanced value evaluation WITH ASYNC DETECTION
		 */
		_evaluateValueWithDetection(value, context) {
			if (typeof value === 'function') {
				try {
					const result = value.call(context);

					// DETECTION: If function returns a promise, mark async detected
					if (result && typeof result.then === 'function') {
						this.asyncDetected = true;
						return this.asyncPlaceholder;
					}

					return result;
				} catch (error) {
					console.warn('StringRenderer: Function evaluation error:', error);
					return '';
				}
			}

			// DETECTION: If value is a promise, mark async detected
			if (value && typeof value.then === 'function') {
				this.asyncDetected = true;
				return this.asyncPlaceholder;
			}

			return value;
		}

		/**
		 * Async value evaluation using promisify
		 */
		async _evaluateValueAsync(value, context) {
			if (typeof value === 'function') {
				try {
					const result = await promisify(value.call(context));
					return result;
				} catch (error) {
					console.warn('StringRenderer: Async function evaluation error:', error);
					return '';
				}
			}

			// Use resolveToString for promise values
			return await resolveToString(value);
		}

		/**
		 * Render attribute with proper handling
		 */
		_renderAttribute(name, value) {
			// Handle null/undefined values
			if (value === null || value === undefined) {
				return '';
			}

			// Skip style attribute completely - it should be handled separately
			if (name.toLowerCase() === 'style') {
				console.warn('Style attribute should not be processed here, skipping:', value);
				return '';
			}

			// Convert objects to strings (except style which is handled above)
			if (typeof value === 'object' && value !== null) {
				console.warn(`Object value for attribute ${name}:`, value);
				// For non-style objects, convert to JSON or skip
				if (name.toLowerCase().startsWith('data-')) {
					value = JSON.stringify(value);
				} else {
					console.warn(`Skipping object attribute ${name}`);
					return '';
				}
			}

			const lowerName = name.toLowerCase();

			// Handle boolean attributes
			if (this.booleanAttributes.has(lowerName)) {
				if (value === true || value === '' || value === name || value === lowerName) {
					return ` ${name}`;
				} else if (value === false) {
					return '';
				} else {
					return ` ${name}="${this._escapeAttributeValue(value)}"`;
				}
			}

			// Handle data- and aria- attributes
			if (lowerName.startsWith('data-') || lowerName.startsWith('aria-')) {
				return ` ${name}="${this._escapeAttributeValue(value)}"`;
			}

			// Handle special cases
			switch (lowerName) {
				case 'class':
				case 'classname':
					const className = this._processClassName(value);
					return className ? ` class="${this._escapeAttributeValue(className)}"` : '';
				case 'for':
				case 'htmlfor':
					return ` for="${this._escapeAttributeValue(value)}"`;
				case 'tabindex':
					const tabIndex = parseInt(value, 10);
					return isNaN(tabIndex) ? '' : ` tabindex="${tabIndex}"`;
				default:
					return ` ${name}="${this._escapeAttributeValue(value)}"`;
			}
		}

		/**
		 * Process className value (string, array, or object)
		 */
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

		/**
		 * Should skip attribute during processing
		 */
		_shouldSkipAttribute(key) {
			// Skip special props, style (handled separately), and event handlers
			return this.skipAttributes.has(key) ||
				this.eventHandlerPattern.test(key) ||
				key === 'style' ||  // Ensure style is always skipped in attribute processing
				key.toLowerCase() === 'style';
		}

		/**
		 * Check if element is void (self-closing)
		 */
		_isVoidElement(tagName) {
			const voidElements = new Set([
				'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
				'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
			]);
			return voidElements.has(tagName.toLowerCase());
		}

		/**
		 * Enhanced style rendering with async detection
		 */
		_renderStyle(style, context) {
			if (!style) return '';

			// Handle the case where style is already a string
			if (typeof style === 'string') {
				return style;
			}

			const evaluatedStyle = this._evaluateValueWithDetection(style, context);

			// If async was detected, return empty (will be handled in async pass)
			if (evaluatedStyle === this.asyncPlaceholder) {
				return '';
			}

			// Handle style object conversion to CSS
			if (typeof evaluatedStyle === 'object' && evaluatedStyle !== null) {
				const cssRules = [];

				for (const [prop, value] of Object.entries(evaluatedStyle)) {
					const cssValue = this._evaluateValueWithDetection(value, context);

					// Skip async values during sync pass
					if (cssValue === this.asyncPlaceholder || cssValue === undefined || cssValue === null) {
						continue;
					}

					const cssProp = this._camelToKebab(prop);
					cssRules.push(`${cssProp}: ${cssValue}`);
				}

				return cssRules.join('; ');
			}

			// Fallback to string conversion
			return String(evaluatedStyle);
		}

		/**
		 * Async style rendering
		 */
		async _renderStyleAsync(style, context) {
			if (!style) return '';

			const evaluatedStyle = await this._evaluateValueAsync(style, context);

			if (typeof evaluatedStyle === 'object' && evaluatedStyle !== null) {
				const entries = await Promise.all(
					Object.entries(evaluatedStyle).map(async ([prop, value]) => {
						const cssValue = await this._evaluateValueAsync(value, context);
						if (cssValue === undefined || cssValue === null) return '';

						const cssProp = this._camelToKebab(prop);
						return `${cssProp}: ${cssValue}`;
					})
				);

				return entries
					.filter(rule => rule && !rule.endsWith(': undefined') && !rule.endsWith(': null'))
					.join('; ');
			}

			return String(evaluatedStyle);
		}

		/**
		 * Convert camelCase to kebab-case
		 */
		_camelToKebab(str) {
			return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
		}

		/**
		 * Escape HTML content
		 */
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

		/**
		 * Escape attribute values
		 */
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

		/**
		 * SMART renderToString - AUTO-DETECTS and handles async automatically
		 */
		renderToString(layout, context = null, options = {}) {
			const { async: forceAsync = false, timeout = this.asyncTimeout } = options;

			if (!layout) {
				return '<p>No layout provided</p>';
			}

			try {
				// If async is forced, use async rendering directly
				if (forceAsync) {
					return Promise.race([
						this.renderAsync(layout, context),
						new Promise((_, reject) =>
							setTimeout(() => reject(new Error('Async render timeout')), timeout)
						)
					]).catch(error => {
						console.error('StringRenderer forced async renderToString error:', error);
						return `<div style="color: red;">Async StringRenderer Error: ${error.message}</div>`;
					});
				}

				// Use smart rendering with auto-detection
				if (this.autoDetectAsync) {
					const result = this.smartRender(layout, context);

					// If smartRender returns a promise, handle it
					if (result && typeof result.then === 'function') {
						return result.catch(error => {
							console.error('StringRenderer smart render error:', error);
							return `<div style="color: red;">Smart Render Error: ${error.message}</div>`;
						});
					}

					return result;
				}

				// Fallback to regular sync rendering
				return this.render(layout, context);
			} catch (error) {
				console.error('StringRenderer renderToString error:', error);
				return `<div style="color: red;">StringRenderer Error: ${error.message}</div>`;
			}
		}

		// Interface compatibility methods
		cleanup() {
			this.renderDepth = 0;
			this.asyncDetected = false;
			this.currentRenderIsAsync = false;
			return '';
		}

		setRenderMode(mode) {
			this.renderMode = mode;
		}

		getRenderMode() {
			return this.renderMode;
		}

		setAutoDetect(enabled) {
			this.autoDetectAsync = enabled;
		}

		getAutoDetect() {
			return this.autoDetectAsync;
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

	// Create instance of StringRenderer with juris reference
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

			// MAIN AUTO-DETECTING METHOD - just call this everywhere!
			async renderToString(layout, options = {}) {
				const layoutToRender = layout || juris.layout;
				if (!layoutToRender) {
					return '<p>No layout provided</p>';
				}

				try {
					const result = stringRenderer.renderToString(layoutToRender, null, options);

					// If result is a promise, await it
					if (result && typeof result.then === 'function') {
						return await result;
					}

					return result;
				} catch (error) {
					console.error('API renderToString error:', error);
					return `<div style="color: red;">Render Error: ${error.message}</div>`;
				}
			},

			// Legacy async method (now just calls the smart one)
			renderToStringAsync(layout, options = {}) {
				return this.renderToString(layout, { ...options, async: true });
			},

			// Direct access to renderer
			stringRenderer,
			originalDOMRenderer,
			setPromiseMode,

			// Auto-detection controls
			enableAutoDetect() {
				stringRenderer.setAutoDetect(true);
			},

			disableAutoDetect() {
				stringRenderer.setAutoDetect(false);
			},

			isAutoDetectEnabled() {
				return stringRenderer.getAutoDetect();
			},

			// Utility methods
			isStringRenderer() {
				return juris.domRenderer === stringRenderer;
			},

			getAsyncTimeout() {
				return stringRenderer.asyncTimeout;
			},

			setAsyncTimeout(timeout) {
				stringRenderer.asyncTimeout = timeout;
			},

			getAsyncPlaceholder() {
				return stringRenderer.asyncPlaceholder;
			},

			setAsyncPlaceholder(placeholder) {
				stringRenderer.asyncPlaceholder = placeholder;
			}
		}
	};
};
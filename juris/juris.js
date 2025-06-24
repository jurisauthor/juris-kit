/**
 * Caution: This is not just a framework, its a paradigm-shifting platform.
 * Juris (JavaScript Unified Reactive Interface Solution)
 * Transforms web development through its comprehensive object-first architecture that makes
 * reactivity an intentional choice rather than an automatic behavior. By expressing interfaces
 * as pure JavaScript objects where functions explicitly define reactivity, Juris delivers a
 * complete solution for applications that are universally deployable, precisely controlled,
 * and designed from the ground up for seamless AI collaboration—all while maintaining the 
 * simplicity and debuggability of native JavaScript patterns.
 * 
 * Author: Resti Guay
 * Maintained by: Juris Github Team
 * Version: 0.6.0 (stable)
 * License: MIT
 * GitHub: https://github.com/jurisjs/juris
 * Website: https://jurisjs.com
 * Documentation: https://jurisjs.com/#docs
 */
(function () {
    'use strict';

    /**
     * Utility functions
     */
    function isValidPath(path) {
        return typeof path === 'string' && path.trim().length > 0 && !path.includes('..');
    }

    function getPathParts(path) {
        return path.split('.').filter(Boolean);
    }

    function deepEquals(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== typeof b) return false;

        if (typeof a === 'object') {
            if (Array.isArray(a) !== Array.isArray(b)) return false;
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;

            for (let key of keysA) {
                if (!keysB.includes(key) || !deepEquals(a[key], b[key])) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    const createPromisify = () => {
        let useNative = typeof Promise.try === 'function';

        const promisify = (result) =>
            useNative ? Promise.try(() => result) :
                result?.then ? result : Promise.resolve(result);

        const setPromiseMode = (mode) => {
            useNative = mode === 'native' || (mode !== 'custom' && typeof Promise.try === 'function');
        };

        return { promisify, setPromiseMode };
    };

    // Usage:
    const { promisify, setPromiseMode } = createPromisify();
    /**
     * State Manager - Handles reactive state with middleware support
     */
    class StateManager {
        constructor(initialState = {}, middleware = []) {
            this.state = { ...initialState };
            this.middleware = [...middleware];
            this.subscribers = new Map();
            this.externalSubscribers = new Map();
            this.currentTracking = null;
            this.isUpdating = false;

            // Batch update system
            this.updateQueue = [];
            this.batchTimeout = null;
            this.batchUpdateInProgress = false;
            this.maxBatchSize = 50;
            this.batchDelayMs = 0; // ✅ FIXED: Non-zero default for batching
            this.batchingEnabled = true; // ✅ FIXED: Add batching control
            this.initialState = JSON.parse(JSON.stringify(initialState));
        }

        reset(preserve = []) {
            // Collect preserved values
            const preserved = {};
            preserve.forEach(path => {
                const value = this.getState(path);
                if (value !== null) {
                    preserved[path] = value;
                }
            });

            // Clear current state
            this.state = {};

            // Restore initial state
            Object.entries(this.initialState).forEach(([path, value]) => {
                this.setState(path, JSON.parse(JSON.stringify(value)));
            });

            // Restore preserved values
            Object.entries(preserved).forEach(([path, value]) => {
                this.setState(path, value);
            });
        }
        getState(path, defaultValue = null) {
            if (!isValidPath(path)) {
                console.warn('Invalid state path:', path);
                return defaultValue;
            }

            if (this.currentTracking) {
                this.currentTracking.add(path);
            }

            const parts = getPathParts(path);
            let current = this.state;

            for (const part of parts) {
                if (current == null || current[part] === undefined) {
                    return defaultValue;
                }
                current = current[part];
            }

            return current;
        }

        setState(path, value, context = {}) {
            if (!isValidPath(path)) {
                console.warn('Invalid state path:', path);
                return;
            }

            if (this._hasCircularUpdate(path)) {
                return;
            }

            // Route to batching if enabled
            if (this.batchingEnabled && this.batchDelayMs > 0) {
                this._queueUpdate(path, value, context);
                return;
            }

            this._setStateImmediate(path, value, context);
        }

        _setStateImmediate(path, value, context = {}) {
            const oldValue = this.getState(path);

            let finalValue = value;
            for (const middleware of this.middleware) {
                try {
                    const result = middleware({
                        path,
                        oldValue,
                        newValue: finalValue,
                        context,
                        state: this.state
                    });
                    if (result !== undefined) {
                        finalValue = result;
                    }
                } catch (error) {
                    console.error('Middleware error:', error);
                }
            }

            if (deepEquals(oldValue, finalValue)) {
                return;
            }

            const parts = getPathParts(path);
            let current = this.state;

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (current[part] == null || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part];
            }

            current[parts[parts.length - 1]] = finalValue;

            if (!this.isUpdating) {
                this.isUpdating = true;

                if (!this.currentlyUpdating) {
                    this.currentlyUpdating = new Set();
                }
                this.currentlyUpdating.add(path);

                this._notifySubscribers(path, finalValue, oldValue);
                this._notifyExternalSubscribers(path, finalValue, oldValue); // ✅ Now hierarchical

                this.currentlyUpdating.delete(path);
                this.isUpdating = false;
            }
        }


        _processBatchedUpdates() {
            if (this.batchUpdateInProgress || this.updateQueue.length === 0) {
                return;
            }

            this.batchUpdateInProgress = true;

            if (this.batchTimeout) {
                clearTimeout(this.batchTimeout);
                this.batchTimeout = null;
            }

            const batchSize = Math.min(this.maxBatchSize, this.updateQueue.length);
            const currentBatch = this.updateQueue.splice(0, batchSize);

            try {
                // ✅ FIXED: Group updates by path and take latest value
                const pathGroups = new Map();

                currentBatch.forEach(update => {
                    pathGroups.set(update.path, update); // Latest update wins
                });

                // ✅ FIXED: Process unique paths only
                const affectedPaths = new Set();

                pathGroups.forEach((update) => {
                    this._setStateImmediate(update.path, update.value, update.context);
                    affectedPaths.add(update.path);
                });

                console.log(`Batched ${currentBatch.length} updates into ${pathGroups.size} unique state changes`);

            } catch (error) {
                console.error('Error processing batched updates:', error);
            } finally {
                this.batchUpdateInProgress = false;

                if (this.updateQueue.length > 0) {
                    setTimeout(() => this._processBatchedUpdates(), 0);
                }
            }
        }

        configureBatching(options = {}) {
            this.maxBatchSize = options.maxBatchSize || this.maxBatchSize;
            this.batchDelayMs = options.batchDelayMs !== undefined ? options.batchDelayMs : this.batchDelayMs;

            if (options.enabled !== undefined) {
                this.batchingEnabled = options.enabled;
            }

            console.log(`Batching configured: enabled=${this.batchingEnabled}, delay=${this.batchDelayMs}ms, maxSize=${this.maxBatchSize}`);
        }

        getBatchStatus() {
            return {
                enabled: this.batchingEnabled,
                queueLength: this.updateQueue.length,
                inProgress: this.batchUpdateInProgress,
                hasTimeout: !!this.batchTimeout,
                delayMs: this.batchDelayMs,
                maxBatchSize: this.maxBatchSize
            };
        }

        _queueUpdate(path, value, context) {
            this.updateQueue.push({ path, value, context, timestamp: Date.now() });

            if (this.updateQueue.length > this.maxBatchSize * 2) {
                console.warn('Update queue is getting large, processing immediately');
                this._processBatchedUpdates();
                return;
            }

            if (!this.batchTimeout) {
                this.batchTimeout = setTimeout(() => {
                    this._processBatchedUpdates();
                }, this.batchDelayMs);
            }
        }

        subscribe(path, callback, hierarchical = true) {
            if (!this.externalSubscribers.has(path)) {
                this.externalSubscribers.set(path, new Set());
            }

            // Store callback with hierarchical flag
            const subscription = { callback, hierarchical };
            this.externalSubscribers.get(path).add(subscription);

            return () => {
                const subs = this.externalSubscribers.get(path);
                if (subs) {
                    subs.delete(subscription);
                    if (subs.size === 0) {
                        this.externalSubscribers.delete(path);
                    }
                }
            };
        }

        subscribeExact(path, callback) {
            return this.subscribe(path, callback, false);
        }

        subscribeInternal(path, callback) {
            if (!this.subscribers.has(path)) {
                this.subscribers.set(path, new Set());
            }
            this.subscribers.get(path).add(callback);

            return () => {
                const subs = this.subscribers.get(path);
                if (subs) {
                    subs.delete(callback);
                    if (subs.size === 0) {
                        this.subscribers.delete(path);
                    }
                }
            };
        }

        _notifySubscribers(path, newValue, oldValue) {
            this._triggerPathSubscribers(path);

            const parts = getPathParts(path);
            for (let i = parts.length - 1; i > 0; i--) {
                const parentPath = parts.slice(0, i).join('.');
                this._triggerPathSubscribers(parentPath);
            }

            const prefix = path ? path + '.' : '';
            const allSubscriberPaths = new Set([
                ...this.subscribers.keys(),
                ...this.externalSubscribers.keys()
            ]);

            allSubscriberPaths.forEach(subscriberPath => {
                if (subscriberPath.startsWith(prefix) && subscriberPath !== path) {
                    this._triggerPathSubscribers(subscriberPath);
                }
            });
        }

        _notifyExternalSubscribers(changedPath, newValue, oldValue) {
            // Check all external subscribers
            this.externalSubscribers.forEach((subscriptions, subscribedPath) => {
                subscriptions.forEach(subscription => {
                    const { callback, hierarchical } = subscription;

                    let shouldNotify = false;

                    if (hierarchical) {
                        // Hierarchical: notify if changedPath is under subscribedPath
                        if (changedPath === subscribedPath ||
                            changedPath.startsWith(subscribedPath + '.')) {
                            shouldNotify = true;
                        }
                    } else {
                        // Exact: notify only if paths match exactly
                        if (changedPath === subscribedPath) {
                            shouldNotify = true;
                        }
                    }

                    if (shouldNotify) {
                        try {
                            callback(newValue, oldValue, changedPath);
                        } catch (error) {
                            console.error('External subscriber error:', error);
                        }
                    }
                });
            });
        }

        _triggerPathSubscribers(path) {
            const subs = this.subscribers.get(path);
            if (subs) {
                const subscribersCopy = new Set(subs);

                subscribersCopy.forEach(callback => {
                    try {
                        const oldTracking = this.currentTracking;
                        const newTracking = new Set();
                        this.currentTracking = newTracking;

                        callback();

                        this.currentTracking = oldTracking;

                        newTracking.forEach(newPath => {
                            const existingSubs = this.subscribers.get(newPath);
                            if (!existingSubs || !existingSubs.has(callback)) {
                                this.subscribeInternal(newPath, callback);
                            }
                        });
                    } catch (error) {
                        console.error('Subscriber error:', error);
                        this.currentTracking = oldTracking;
                    }
                });
            }
        }

        _hasCircularUpdate(path) {
            if (!this.currentlyUpdating) {
                this.currentlyUpdating = new Set();
            }

            if (this.currentlyUpdating.has(path)) {
                console.warn(`Circular dependency detected for path: ${path}`);
                return true;
            }

            return false;
        }

        startTracking() {
            const dependencies = new Set();
            this.currentTracking = dependencies;
            return dependencies;
        }

        endTracking() {
            const tracking = this.currentTracking;
            this.currentTracking = null;
            return tracking || new Set();
        }
    }

    /**
     * Headless Manager - Enhanced with better lifecycle management
     */
    class HeadlessManager {
        constructor(juris) {
            this.juris = juris;
            this.components = new Map();
            this.instances = new Map();
            this.context = {};
            this.initQueue = new Set();
            this.lifecycleHooks = new Map();
        }

        register(name, componentFn, options = {}) {
            this.components.set(name, { fn: componentFn, options });

            if (options.autoInit) {
                this.initQueue.add(name);
            }
        }

        initialize(name, props = {}) {
            const component = this.components.get(name);
            if (!component) {
                console.warn(`Headless component '${name}' not found`);
                return null;
            }

            try {
                const context = this.juris.createHeadlessContext();
                const instance = component.fn(props, context);

                if (!instance || typeof instance !== 'object') {
                    console.warn(`Headless component '${name}' must return an object`);
                    return null;
                }

                this.instances.set(name, instance);

                if (instance.hooks) {
                    this.lifecycleHooks.set(name, instance.hooks);
                }

                if (instance.api) {
                    this.context[name] = instance.api;

                    if (!this.juris.headlessAPIs) {
                        this.juris.headlessAPIs = {};
                    }
                    this.juris.headlessAPIs[name] = instance.api;

                    this.juris._updateComponentContexts();
                }

                if (instance.hooks?.onRegister) {
                    try {
                        instance.hooks.onRegister();
                    } catch (error) {
                        console.error(`Error in onRegister for headless component '${name}':`, error);
                    }
                }

                return instance;
            } catch (error) {
                console.error(`Error initializing headless component '${name}':`, error);
                return null;
            }
        }

        initializeQueued() {
            this.initQueue.forEach(name => {
                if (!this.instances.has(name)) {
                    const component = this.components.get(name);
                    this.initialize(name, component.options || {});
                }
            });
            this.initQueue.clear();
        }

        getInstance(name) {
            return this.instances.get(name);
        }

        getAPI(name) {
            return this.context[name];
        }

        getAllAPIs() {
            return { ...this.context };
        }

        reinitialize(name, props = {}) {
            if (this.instances.has(name)) {
                const instance = this.instances.get(name);
                if (instance.hooks?.onUnregister) {
                    try {
                        instance.hooks.onUnregister();
                    } catch (error) {
                        console.error(`Error in onUnregister for '${name}':`, error);
                    }
                }
            }

            if (this.context[name]) {
                delete this.context[name];
            }
            if (this.juris.headlessAPIs?.[name]) {
                delete this.juris.headlessAPIs[name];
            }

            this.instances.delete(name);
            this.lifecycleHooks.delete(name);

            return this.initialize(name, props);
        }

        cleanup() {
            this.instances.forEach((instance, name) => {
                if (instance.hooks?.onUnregister) {
                    try {
                        instance.hooks.onUnregister();
                    } catch (error) {
                        console.error(`Error in onUnregister for '${name}':`, error);
                    }
                }
            });
            this.instances.clear();
            this.context = {};
            this.lifecycleHooks.clear();

            if (this.juris.headlessAPIs) {
                this.juris.headlessAPIs = {};
            }
        }

        getStatus() {
            return {
                registered: Array.from(this.components.keys()),
                initialized: Array.from(this.instances.keys()),
                queued: Array.from(this.initQueue),
                apis: Object.keys(this.context)
            };
        }
    }

    /**
     * Component Manager - Handles UI components with lifecycle
     */
    /**
 * Component Manager - Handles UI components with lifecycle + MINIMAL async props support
 */
    class ComponentManager {
        constructor(juris) {
            this.juris = juris;
            this.components = new Map();
            this.instances = new WeakMap();
            this.componentCounters = new Map();
            this.componentStates = new WeakMap();
            this.asyncPlaceholders = new WeakMap(); // Track async component placeholders
            this.asyncPropsCache = new Map(); // NEW: Only addition for async props
        }

        register(name, componentFn) {
            this.components.set(name, componentFn);
        }

        create(name, props = {}) {
            const componentFn = this.components.get(name);
            if (!componentFn) {
                console.error(`Component '${name}' not found`);
                return null;
            }

            try {
                // NEW: Only addition - check for async props
                if (this._hasAsyncProps(props)) {
                    return this._createWithAsyncProps(name, componentFn, props);
                }

                // UNCHANGED: Original creation logic
                if (!this.componentCounters.has(name)) {
                    this.componentCounters.set(name, 0);
                }
                const currentCount = this.componentCounters.get(name);
                const instanceIndex = currentCount + 1;
                this.componentCounters.set(name, instanceIndex);
                const componentId = `${name}_${instanceIndex}`;
                const componentStates = new Set();

                const context = this.juris.createContext();

                // Add newState function to context
                context.newState = (key, initialValue) => {
                    const statePath = `__local.${componentId}.${key}`;

                    // Set initial value if not exists
                    if (this.juris.stateManager.getState(statePath, Symbol('not-found')) === Symbol('not-found')) {
                        this.juris.stateManager.setState(statePath, initialValue);
                    }

                    // Track this state for cleanup
                    componentStates.add(statePath);

                    const getter = () => this.juris.stateManager.getState(statePath, initialValue);
                    const setter = (value) => this.juris.stateManager.setState(statePath, value);

                    return [getter, setter];
                };

                // Execute component function
                const result = componentFn(props, context);

                // Check if result is actually a promise first
                if (result && typeof result.then === 'function') {
                    // Component returned a promise, handle async
                    return this._handleAsyncComponent(promisify(result), name, props, componentStates);
                }

                // Component was sync, process normally
                return this._processComponentResult(result, name, props, componentStates);

            } catch (error) {
                console.error(`Error creating component '${name}':`, error);
                return this._createErrorElement(error);
            }
        }

        // NEW: Only additions for async props support
        _hasAsyncProps(props) {
            return Object.values(props).some(value =>
                value && typeof value.then === 'function'
            );
        }

        _createWithAsyncProps(name, componentFn, props) {
            // Create placeholder immediately
            const placeholder = document.createElement('div');
            placeholder.className = 'juris-async-props-loading';
            placeholder.textContent = `Loading ${name}...`;
            placeholder.style.cssText = 'padding: 8px; background: #f0f0f0; border: 1px dashed #ccc; opacity: 0.7;';

            this.asyncPlaceholders.set(placeholder, { name, props, type: 'async-props' });

            // Resolve async props
            this._resolveAsyncProps(props).then(resolvedProps => {
                try {
                    // Use original create logic with resolved props
                    const realElement = this._createSyncComponent(name, componentFn, resolvedProps);
                    if (realElement && placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(realElement, placeholder);
                    }
                    this.asyncPlaceholders.delete(placeholder);
                } catch (error) {
                    console.error(`Error resolving async props for '${name}':`, error);
                    const errorElement = this._createErrorElement(error);
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errorElement, placeholder);
                    }
                    this.asyncPlaceholders.delete(placeholder);
                }
            }).catch(error => {
                console.error(`Async props failed for '${name}':`, error);
                const errorElement = this._createErrorElement(error);
                if (placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(errorElement, placeholder);
                }
                this.asyncPlaceholders.delete(placeholder);
            });

            return placeholder;
        }

        async _resolveAsyncProps(props) {
            const cacheKey = this._generateCacheKey(props);

            if (this.asyncPropsCache.has(cacheKey)) {
                const cached = this.asyncPropsCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 5000) {
                    return cached.props;
                }
            }

            const resolved = {};
            for (const [key, value] of Object.entries(props)) {
                if (value && typeof value.then === 'function') {
                    try {
                        resolved[key] = await value;
                    } catch (error) {
                        resolved[key] = { __asyncError: error.message };
                    }
                } else {
                    resolved[key] = value;
                }
            }

            this.asyncPropsCache.set(cacheKey, {
                props: resolved,
                timestamp: Date.now()
            });

            return resolved;
        }

        _generateCacheKey(props) {
            return JSON.stringify(props, (key, value) => {
                return (value && typeof value.then === 'function') ? '[Promise]' : value;
            });
        }

        _createSyncComponent(name, componentFn, props) {
            // UNCHANGED: Extracted original creation logic
            if (!this.componentCounters.has(name)) {
                this.componentCounters.set(name, 0);
            }
            const currentCount = this.componentCounters.get(name);
            const instanceIndex = currentCount + 1;
            this.componentCounters.set(name, instanceIndex);
            const componentId = `${name}_${instanceIndex}`;
            const componentStates = new Set();

            const context = this.juris.createContext();

            context.newState = (key, initialValue) => {
                const statePath = `__local.${componentId}.${key}`;
                if (this.juris.stateManager.getState(statePath, Symbol('not-found')) === Symbol('not-found')) {
                    this.juris.stateManager.setState(statePath, initialValue);
                }
                componentStates.add(statePath);

                const getter = () => this.juris.stateManager.getState(statePath, initialValue);
                const setter = (value) => this.juris.stateManager.setState(statePath, value);
                return [getter, setter];
            };

            const result = componentFn(props, context);

            if (result && typeof result.then === 'function') {
                return this._handleAsyncComponent(promisify(result), name, props, componentStates);
            }

            return this._processComponentResult(result, name, props, componentStates);
        }
        // END NEW additions

        // UNCHANGED: All original methods below
        _handleAsyncComponent(resultPromise, name, props, componentStates) {
            // Create placeholder element immediately for non-blocking rendering
            const placeholder = document.createElement('div');
            placeholder.className = 'juris-async-loading';
            placeholder.textContent = `Loading ${name}...`;
            placeholder.style.cssText = 'padding: 8px; background: #f0f0f0; border: 1px dashed #ccc; opacity: 0.7;';

            // Mark as async placeholder
            this.asyncPlaceholders.set(placeholder, { name, props, componentStates });

            // Handle async resolution
            resultPromise.then(result => {
                try {
                    const realElement = this._processComponentResult(result, name, props, componentStates);
                    if (realElement && placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(realElement, placeholder);
                    }
                    this.asyncPlaceholders.delete(placeholder);
                } catch (error) {
                    console.error(`Error resolving async component '${name}':`, error);
                    const errorElement = this._createErrorElement(error);
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errorElement, placeholder);
                    }
                    this.asyncPlaceholders.delete(placeholder);
                }
            }).catch(error => {
                console.error(`Async component '${name}' failed:`, error);
                const errorElement = this._createErrorElement(error);
                if (placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(errorElement, placeholder);
                }
                this.asyncPlaceholders.delete(placeholder);
            });

            return placeholder;
        }

        _processComponentResult(result, name, props, componentStates) {
            if (result && typeof result === 'object') {
                // Check for lifecycle component first
                if (result.hooks && (result.hooks.onMount || result.hooks.onUpdate || result.hooks.onUnmount) ||
                    result.onMount || result.onUpdate || result.onUnmount) {
                    return this._createLifecycleComponent(result, name, props, componentStates);
                }

                // Check for render function pattern (no lifecycle hooks)
                if (typeof result.render === 'function' &&
                    !(result.hooks && (result.hooks.onMount !== undefined || result.hooks.onUpdate !== undefined || result.hooks.onUnmount !== undefined)) &&
                    !(result.onMount !== undefined || result.onUpdate !== undefined || result.onUnmount !== undefined)) {
                    const renderResult = result.render();

                    // Check if render function returned a promise
                    if (renderResult && typeof renderResult.then === 'function') {
                        return this._handleAsyncRender(promisify(renderResult), name, componentStates);
                    }

                    console.log(`Render function for '${name}' returned:`, renderResult);
                    const element = this.juris.domRenderer.render(renderResult);
                    if (element && componentStates.size > 0) {
                        this.componentStates.set(element, componentStates);
                    }
                    return element;
                }

                // Direct VDOM return - check if it has valid tag names
                const keys = Object.keys(result);
                if (keys.length === 1) {
                    const tagName = keys[0];
                    // Valid HTML tag names or registered components
                    if (typeof tagName === 'string' && tagName.length > 0) {
                        const element = this.juris.domRenderer.render(result);
                        if (element && componentStates.size > 0) {
                            this.componentStates.set(element, componentStates);
                        }
                        return element;
                    }
                }
            }

            // Fallback
            console.warn(`Component '${name}' returned unexpected structure, attempting to render:`, result);
            const element = this.juris.domRenderer.render(result);
            if (element && componentStates.size > 0) {
                this.componentStates.set(element, componentStates);
            }
            return element;
        }

        _handleAsyncRender(renderPromise, name, componentStates) {
            const placeholder = document.createElement('div');
            placeholder.className = 'juris-async-render';
            placeholder.textContent = `Rendering ${name}...`;
            placeholder.style.cssText = 'padding: 4px; background: #f8f8f8; border: 1px dashed #ddd;';

            renderPromise.then(renderResult => {
                try {
                    console.log(`Async render function for '${name}' returned:`, renderResult);
                    const element = this.juris.domRenderer.render(renderResult);
                    if (element && componentStates.size > 0) {
                        this.componentStates.set(element, componentStates);
                    }
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(element, placeholder);
                    }
                } catch (error) {
                    console.error(`Error in async render for '${name}':`, error);
                    const errorElement = this._createErrorElement(error);
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errorElement, placeholder);
                    }
                }
            }).catch(error => {
                console.error(`Async render failed for '${name}':`, error);
                const errorElement = this._createErrorElement(error);
                if (placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(errorElement, placeholder);
                }
            });

            return placeholder;
        }

        _createLifecycleComponent(componentResult, name, props, componentStates) {
            console.log(`Creating lifecycle component ${name}`, componentResult); // Debug log

            const instance = {
                name,
                props,
                hooks: componentResult.hooks || {},
                api: componentResult.api || {},
                render: componentResult.render
            };

            console.log(`Instance hooks for ${name}:`, instance.hooks); // Debug log

            // Check if render result is a promise
            const renderResult = instance.render();
            if (renderResult && typeof renderResult.then === 'function') {
                return this._handleAsyncLifecycleRender(promisify(renderResult), instance, componentStates);
            }

            // Sync lifecycle render
            const element = this.juris.domRenderer.render(renderResult);
            if (element) {
                this.instances.set(element, instance);

                // Store component states for cleanup
                if (componentStates && componentStates.size > 0) {
                    this.componentStates.set(element, componentStates);
                }

                console.log(`About to check onMount for ${name}, has onMount:`, !!instance.hooks.onMount); // Debug log

                if (instance.hooks.onMount) {
                    console.log(`Setting up onMount timeout for ${name}`); // Debug log
                    setTimeout(() => {
                        // Remove the isConnected check that might be preventing execution
                        console.log(`Attempting onMount for ${name}, element connected:`, element.isConnected);
                        try {
                            const mountResult = instance.hooks.onMount();

                            // Check if onMount returned a promise
                            if (mountResult && typeof mountResult.then === 'function') {
                                // Properly handle async onMount
                                promisify(mountResult).then(() => {
                                    console.log(`Async onMount completed for ${name}`);
                                }).catch(error => {
                                    console.error(`Async onMount error in ${name}:`, error);
                                });
                            } else {
                                console.log(`Sync onMount completed for ${name}`);
                            }
                        } catch (error) {
                            console.error(`onMount error in ${name}:`, error);
                        }
                    }, 0);
                } else {
                    console.log(`No onMount hook found for ${name}`); // Debug log
                }
            }

            return element;
        }

        _handleAsyncLifecycleRender(renderPromise, instance, componentStates) {
            const placeholder = document.createElement('div');
            placeholder.className = 'juris-async-lifecycle';
            placeholder.textContent = `Loading ${instance.name}...`;
            placeholder.style.cssText = 'padding: 8px; background: #f5f5f5; border: 1px dashed #bbb;';

            renderPromise.then(renderResult => {
                try {
                    const element = this.juris.domRenderer.render(renderResult);
                    if (element) {
                        this.instances.set(element, instance);

                        if (componentStates && componentStates.size > 0) {
                            this.componentStates.set(element, componentStates);
                        }

                        if (placeholder.parentNode) {
                            placeholder.parentNode.replaceChild(element, placeholder);
                        }

                        // Execute onMount after replacement
                        if (instance.hooks.onMount) {
                            setTimeout(() => {
                                console.log(`Attempting async onMount for ${instance.name}, element connected:`, element.isConnected);
                                try {
                                    const mountResult = instance.hooks.onMount();

                                    if (mountResult && typeof mountResult.then === 'function') {
                                        // Properly handle async onMount for async components
                                        promisify(mountResult).then(() => {
                                            console.log(`Async onMount completed for ${instance.name}`);
                                        }).catch(error => {
                                            console.error(`Async onMount error in ${instance.name}:`, error);
                                        });
                                    } else {
                                        console.log(`Sync onMount completed for ${instance.name}`);
                                    }
                                } catch (error) {
                                    console.error(`onMount error in ${instance.name}:`, error);
                                }
                            }, 0);
                        }
                    }
                } catch (error) {
                    console.error(`Error in async lifecycle render for '${instance.name}':`, error);
                    const errorElement = this._createErrorElement(error);
                    if (placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(errorElement, placeholder);
                    }
                }
            }).catch(error => {
                console.error(`Async lifecycle render failed for '${instance.name}':`, error);
                const errorElement = this._createErrorElement(error);
                if (placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(errorElement, placeholder);
                }
            });

            return placeholder;
        }

        updateInstance(element, newProps) {
            const instance = this.instances.get(element);
            if (!instance) return;

            const oldProps = instance.props;

            // Check if props have actually changed using deep comparison
            if (deepEquals && deepEquals(oldProps, newProps)) {
                console.log(`Skipping re-render for ${instance.name} - props unchanged`);
                return;
            }

            // NEW: Handle async props in updates
            if (this._hasAsyncProps(newProps)) {
                this._resolveAsyncProps(newProps).then(resolvedProps => {
                    instance.props = resolvedProps;
                    this._performUpdate(instance, element, oldProps, resolvedProps);
                }).catch(error => {
                    console.error(`Error updating async props for ${instance.name}:`, error);
                });
            } else {
                instance.props = newProps;
                this._performUpdate(instance, element, oldProps, newProps);
            }
        }

        _performUpdate(instance, element, oldProps, newProps) {
            // UNCHANGED: Original update logic
            if (instance.hooks.onUpdate) {
                try {
                    const updateResult = instance.hooks.onUpdate(oldProps, newProps);

                    // Check if onUpdate returned a promise  
                    if (updateResult && typeof updateResult.then === 'function') {
                        // Properly handle async onUpdate
                        promisify(updateResult).then(() => {
                            console.log(`Async onUpdate completed for ${instance.name}`);
                        }).catch(error => {
                            console.error(`Async onUpdate error in ${instance.name}:`, error);
                        });
                    }
                } catch (error) {
                    console.error(`onUpdate error in ${instance.name}:`, error);
                }
            }

            try {
                // Use promisify for render function
                const renderResult = instance.render();
                const normalizedRenderResult = promisify(renderResult);

                // Handle async re-render
                if (normalizedRenderResult !== renderResult) {
                    normalizedRenderResult.then(newContent => {
                        this.juris.domRenderer.updateElementContent(element, newContent);
                    }).catch(error => {
                        console.error(`Async re-render error in ${instance.name}:`, error);
                    });
                } else {
                    // Sync re-render
                    this.juris.domRenderer.updateElementContent(element, renderResult);
                }
            } catch (error) {
                console.error(`Re-render error in ${instance.name}:`, error);
            }
        }

        cleanup(element) {
            const instance = this.instances.get(element);
            if (instance && instance.hooks.onUnmount) {
                try {
                    const unmountResult = instance.hooks.onUnmount();

                    // Check if onUnmount returned a promise
                    if (unmountResult && typeof unmountResult.then === 'function') {
                        // Properly handle async onUnmount
                        promisify(unmountResult).then(() => {
                            console.log(`Async onUnmount completed for ${instance.name}`);
                        }).catch(error => {
                            console.error(`Async onUnmount error in ${instance.name}:`, error);
                        });
                    }
                } catch (error) {
                    console.error(`onUnmount error in ${instance.name}:`, error);
                }
            }

            // Cleanup component local states
            const states = this.componentStates.get(element);
            if (states) {
                states.forEach(statePath => {
                    // Remove from global state
                    const pathParts = statePath.split('.');
                    let current = this.juris.stateManager.state;
                    for (let i = 0; i < pathParts.length - 1; i++) {
                        if (current[pathParts[i]]) {
                            current = current[pathParts[i]];
                        } else {
                            return; // Path doesn't exist
                        }
                    }
                    delete current[pathParts[pathParts.length - 1]];
                });
                this.componentStates.delete(element);
            }

            // Cleanup async placeholder if it exists
            if (this.asyncPlaceholders.has(element)) {
                this.asyncPlaceholders.delete(element);
            }

            this.instances.delete(element);
        }

        _createErrorElement(error) {
            const element = document.createElement('div');
            element.style.cssText = 'color: red; border: 1px solid red; padding: 8px; background: #ffe6e6;';
            element.textContent = `Component Error: ${error.message}`;
            return element;
        }

        // NEW: Only new utility methods
        clearAsyncPropsCache() {
            this.asyncPropsCache.clear();
        }

        // Utility methods for async component management
        getAsyncStats() {
            return {
                activePlaceholders: this.asyncPlaceholders.size,
                registeredComponents: this.components.size,
                cachedAsyncProps: this.asyncPropsCache.size // NEW: Only addition
            };
        }

        isAsyncPlaceholder(element) {
            return this.asyncPlaceholders.has(element);
        }

        getAsyncPlaceholderInfo(element) {
            return this.asyncPlaceholders.get(element);
        }
    }

    /**
     * OPTIMIZED DOM Renderer with renderMode support
     */
    /**
 * Enhanced DOMRenderer with comprehensive promisify integration
 * Lean approach for async attributes and children handling
 */
    class DOMRenderer {
        constructor(juris) {
            this.juris = juris;
            this.subscriptions = new WeakMap();
            this.specialAttributeHandlers = new Map();
            this.eventMap = {
                ondoubleclick: 'dblclick',
                onmousedown: 'mousedown',
                onmouseup: 'mouseup',
                onmouseover: 'mouseover',
                onmouseout: 'mouseout',
                onmousemove: 'mousemove',
                onkeydown: 'keydown',
                onkeyup: 'keyup',
                onkeypress: 'keypress',
                onfocus: 'focus',
                onblur: 'blur',
                onchange: 'change',
                oninput: 'input',
                onsubmit: 'submit',
                onload: 'load',
                onresize: 'resize',
                onscroll: 'scroll'
            };

            // VDOM-style optimizations
            this.elementCache = new Map();
            this.recyclePool = new Map();
            this.renderQueue = [];
            this.isRendering = false;
            this.scheduledRender = null;

            // Performance settings
            this.batchSize = 20;
            this.recyclePoolSize = 100;

            // RENDER MODE: Choose between fine-grained and batch rendering
            this.renderMode = 'fine-grained'; // 'batch' or 'fine-grained'
            this.failureCount = 0;
            this.maxFailures = 3;

            this.renderStats = {
                totalUpdates: 0,
                skippedUpdates: 0,
                lastReset: Date.now()
            };

            // Lean async handling with promisify integration
            this.asyncCache = new Map();
            this.asyncPlaceholders = new WeakMap();
        }

        getType() {
            return 'DOMRenderer';
        }

        getRenderStats() {
            const now = Date.now();
            const duration = (now - this.renderStats.lastReset) / 1000;
            const skipRate = this.renderStats.totalUpdates > 0
                ? (this.renderStats.skippedUpdates / this.renderStats.totalUpdates * 100).toFixed(1)
                : 0;

            return {
                totalUpdates: this.renderStats.totalUpdates,
                skippedUpdates: this.renderStats.skippedUpdates,
                skipRate: `${skipRate}%`,
                duration: `${duration.toFixed(1)}s`
            };
        }

        resetRenderStats() {
            this.renderStats = {
                totalUpdates: 0,
                skippedUpdates: 0,
                lastReset: Date.now()
            };
        }

        setRenderMode(mode) {
            if (mode === 'fine-grained' || mode === 'batch') {
                this.renderMode = mode;
                console.log(`Juris: Render mode set to '${mode}'`);
            } else {
                console.warn(`Invalid render mode '${mode}'. Use 'fine-grained' or 'batch'`);
            }
        }

        getRenderMode() {
            return this.renderMode;
        }

        isFineGrained() {
            return this.renderMode === 'fine-grained';
        }

        isBatchMode() {
            return this.renderMode === 'batch';
        }

        render(vnode) {
            if (!vnode || typeof vnode !== 'object') {
                return null;
            }

            // Handle arrays of vnodes
            if (Array.isArray(vnode)) {
                const fragment = document.createDocumentFragment();
                vnode.forEach(child => {
                    const childElement = this.render(child);
                    if (childElement) {
                        fragment.appendChild(childElement);
                    }
                });
                return fragment;
            }

            const tagName = Object.keys(vnode)[0];
            const props = vnode[tagName] || {};

            // Check if it's a registered component
            if (this.juris.componentManager.components.has(tagName)) {
                const parentTracking = this.juris.stateManager.currentTracking;
                this.juris.stateManager.currentTracking = null;

                const result = this.juris.componentManager.create(tagName, props);

                this.juris.stateManager.currentTracking = parentTracking;
                return result;
            }

            // Validate tagName before creating element
            if (typeof tagName !== 'string' || tagName.length === 0) {
                console.error('Invalid tagName:', tagName, 'from vnode:', vnode);
                return null;
            }

            // FINE-GRAINED MODE: Use direct DOM updates
            if (this.renderMode === 'fine-grained') {
                return this._createElementFineGrained(tagName, props);
            }

            // BATCH MODE: Try optimized reconciliation with automatic fallback
            try {
                const key = props.key || this._generateKey(tagName, props);
                const cachedElement = this.elementCache.get(key);

                if (cachedElement && this._canReuseElement(cachedElement, tagName, props)) {
                    this._updateElementProperties(cachedElement, props);
                    return cachedElement;
                }

                return this._createElementOptimized(tagName, props, key);
            } catch (error) {
                console.warn('Batch rendering failed, falling back to fine-grained mode:', error.message);
                this.failureCount++;

                if (this.failureCount >= this.maxFailures) {
                    console.log('Too many batch failures, switching to fine-grained mode permanently');
                    this.renderMode = 'fine-grained';
                }

                return this._createElementFineGrained(tagName, props);
            }
        }

        // ==================== ENHANCED ASYNC HANDLING ====================

        /**
         * Lean async detection using promisify
         */
        _hasAsyncProps(props) {
            return Object.entries(props).some(([key, value]) => {
                if (key.startsWith('on')) return false; // Skip event handlers
                return this._isPromiseLike(value);
            });
        }

        /**
         * Unified promise detection
         */
        _isPromiseLike(value) {
            return value && typeof value.then === 'function';
        }

        /**
         * Enhanced fine-grained element creation with lean async handling
         */
        _createElementFineGrained(tagName, props) {
            if (typeof tagName !== 'string') {
                console.error('Invalid tagName in _createElementFineGrained:', tagName);
                return null;
            }

            const element = document.createElement(tagName);
            const subscriptions = [];
            const eventListeners = [];

            // Check for async props and handle accordingly
            if (this._hasAsyncProps(props)) {
                this._setupAsyncElement(element, props, subscriptions, eventListeners);
            } else {
                this._setupSyncElement(element, props, subscriptions, eventListeners);
            }

            if (subscriptions.length > 0 || eventListeners.length > 0) {
                this.subscriptions.set(element, { subscriptions, eventListeners });
            }

            return element;
        }

        /**
         * Lean async element setup using promisify
         */
        _setupAsyncElement(element, props, subscriptions, eventListeners) {
            const syncProps = {};
            const asyncProps = {};

            // Separate sync and async props
            Object.entries(props).forEach(([key, value]) => {
                if (key.startsWith('on')) {
                    // Handle events immediately
                    this._handleEvent(element, key, value, eventListeners);
                } else if (this._isPromiseLike(value)) {
                    asyncProps[key] = value;
                    this._setPlaceholder(element, key);
                } else {
                    syncProps[key] = value;
                }
            });

            // Apply sync props first
            this._setupSyncElement(element, syncProps, subscriptions, eventListeners);

            // Resolve async props using promisify
            if (Object.keys(asyncProps).length > 0) {
                this._resolveAsyncProps(element, asyncProps, subscriptions);
            }
        }

        /**
         * Standard sync element setup
         */
        _setupSyncElement(element, props, subscriptions, eventListeners) {
            Object.entries(props).forEach(([key, value]) => {
                if (key === 'children') {
                    this._handleChildren(element, value, subscriptions);
                } else if (key === 'text') {
                    this._handleText(element, value, subscriptions);
                } else if (key === 'style') {
                    this._handleStyle(element, value, subscriptions);
                } else if (key.startsWith('on')) {
                    this._handleEvent(element, key, value, eventListeners);
                } else if (typeof value === 'function') {
                    this._handleReactiveAttribute(element, key, value, subscriptions);
                } else if (key !== 'key') {
                    this._setStaticAttribute(element, key, value);
                }
            });
        }

        /**
         * Lean placeholder system
         */
        _setPlaceholder(element, key) {
            const placeholderMap = {
                text: () => {
                    element.textContent = '...';
                    element.classList.add('juris-async-loading');
                },
                children: () => {
                    const placeholder = document.createElement('span');
                    placeholder.textContent = 'Loading...';
                    placeholder.className = 'juris-async-loading';
                    element.appendChild(placeholder);
                },
                className: () => element.classList.add('juris-async-loading'),
                style: () => {
                    element.style.opacity = '0.7';
                    element.classList.add('juris-async-loading');
                }
            };

            const handler = placeholderMap[key];
            if (handler) {
                handler();
            } else if (key.startsWith('data-') || key.startsWith('aria-')) {
                element.setAttribute(key, 'loading');
            }
        }

        /**
         * Enhanced async props resolution using promisify
         */
        _resolveAsyncProps(element, asyncProps, subscriptions) {
            const cacheKey = this._generateAsyncCacheKey(asyncProps);

            // Check cache first
            if (this.asyncCache.has(cacheKey)) {
                const cached = this.asyncCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 5000) {
                    this._applyResolvedProps(element, cached.props, subscriptions);
                    return;
                }
            }

            // Resolve all async props in parallel using promisify
            const resolvePromises = Object.entries(asyncProps).map(([key, value]) => {
                return promisify(value)
                    .then(resolved => ({ key, value: resolved, success: true }))
                    .catch(error => ({ key, error: error.message, success: false }));
            });

            Promise.all(resolvePromises).then(results => {
                const resolvedProps = {};

                results.forEach(({ key, value, error, success }) => {
                    resolvedProps[key] = success ? value : { __asyncError: error };
                });

                // Cache results
                this.asyncCache.set(cacheKey, {
                    props: resolvedProps,
                    timestamp: Date.now()
                });

                // Apply to element
                this._applyResolvedProps(element, resolvedProps, subscriptions);
            });
        }

        /**
         * Apply resolved async props to element
         */
        _applyResolvedProps(element, resolvedProps, subscriptions) {
            // Remove loading classes
            element.classList.remove('juris-async-loading');

            Object.entries(resolvedProps).forEach(([key, value]) => {
                if (value && value.__asyncError) {
                    console.error(`Async prop '${key}' failed:`, value.__asyncError);
                    this._setErrorState(element, key, value.__asyncError);
                    return;
                }

                // Apply the resolved value using appropriate handler
                if (key === 'children') {
                    this._handleAsyncChildren(element, value, subscriptions);
                } else if (key === 'text') {
                    this._handleAsyncText(element, value);
                } else if (key === 'style') {
                    this._handleAsyncStyle(element, value, subscriptions);
                } else if (key === 'innerHTML') {
                    element.innerHTML = value;
                } else {
                    this._setStaticAttribute(element, key, value);
                }
            });
        }

        /**
         * Lean error state handling
         */
        _setErrorState(element, key, error) {
            element.classList.add('juris-async-error');

            if (key === 'text') {
                element.textContent = `Error: ${error}`;
            } else if (key === 'children') {
                element.innerHTML = `<span class="juris-async-error">Error: ${error}</span>`;
            }
        }

        /**
         * Enhanced async children handling with promisify
         */
        _handleAsyncChildren(element, children, subscriptions) {
            element.innerHTML = ''; // Clear placeholders

            if (Array.isArray(children)) {
                children.forEach(child => {
                    const childElement = this.render(child);
                    if (childElement) {
                        element.appendChild(childElement);
                    }
                });
            } else if (children) {
                const childElement = this.render(children);
                if (childElement) {
                    element.appendChild(childElement);
                }
            }
        }

        /**
         * Enhanced async text handling
         */
        _handleAsyncText(element, text) {
            element.style.opacity = ''; // Remove placeholder opacity
            element.textContent = text;
        }

        /**
         * Enhanced async style handling with promisify
         */
        _handleAsyncStyle(element, style, subscriptions) {
            element.style.opacity = ''; // Remove placeholder opacity

            if (typeof style === 'object') {
                Object.assign(element.style, style);
            } else if (typeof style === 'function') {
                this._handleReactiveStyle(element, style, subscriptions);
            }
        }

        /**
         * Generate cache key for async props
         */
        _generateAsyncCacheKey(asyncProps) {
            return JSON.stringify(asyncProps, (key, value) => {
                return this._isPromiseLike(value) ? '[Promise]' : value;
            });
        }

        // ==================== ENHANCED CHILDREN HANDLING ====================

        /**
         * Enhanced children handling with promisify integration
         */
        _handleChildren(element, children, subscriptions) {
            if (this.renderMode === 'fine-grained') {
                this._handleChildrenFineGrained(element, children, subscriptions);
            } else {
                this._handleChildrenOptimized(element, children, subscriptions);
            }
        }

        /**
         * Fine-grained children handling with async support
         */
        _handleChildrenFineGrained(element, children, subscriptions) {
            if (typeof children === 'function') {
                this._handleReactiveChildren(element, children, subscriptions);
            } else if (this._isPromiseLike(children)) {
                this._handleAsyncChildrenDirect(element, children);
            } else {
                this._updateChildrenFineGrained(element, children);
            }
        }

        /**
         * Optimized children handling (batch mode)
         */
        _handleChildrenOptimized(element, children, subscriptions) {
            if (typeof children === 'function') {
                let lastChildrenState = null;
                let childElements = [];
                let useOptimizedPath = true;

                const updateChildren = () => {
                    try {
                        const newChildren = children();

                        // Handle async children
                        if (this._isPromiseLike(newChildren)) {
                            promisify(newChildren)
                                .then(resolvedChildren => {
                                    if (resolvedChildren !== "ignore" && !this._childrenEqual(lastChildrenState, resolvedChildren)) {
                                        if (useOptimizedPath) {
                                            try {
                                                childElements = this._reconcileChildren(element, childElements, resolvedChildren);
                                                lastChildrenState = resolvedChildren;
                                            } catch (error) {
                                                console.warn('Reconciliation failed, falling back to safe rendering:', error.message);
                                                useOptimizedPath = false;
                                                this._updateChildrenSafe(element, resolvedChildren);
                                                lastChildrenState = resolvedChildren;
                                            }
                                        } else {
                                            this._updateChildrenSafe(element, resolvedChildren);
                                            lastChildrenState = resolvedChildren;
                                        }
                                    }
                                })
                                .catch(error => {
                                    console.error('Error in async children function:', error);
                                    this._renderChildrenError(element, error);
                                    useOptimizedPath = false;
                                });
                        } else {
                            // Sync handling
                            if (newChildren !== "ignore" && !this._childrenEqual(lastChildrenState, newChildren)) {
                                if (useOptimizedPath) {
                                    try {
                                        childElements = this._reconcileChildren(element, childElements, newChildren);
                                        lastChildrenState = newChildren;
                                    } catch (error) {
                                        console.warn('Reconciliation failed, falling back to safe rendering:', error.message);
                                        useOptimizedPath = false;
                                        this._updateChildrenSafe(element, newChildren);
                                        lastChildrenState = newChildren;
                                    }
                                } else {
                                    this._updateChildrenSafe(element, newChildren);
                                    lastChildrenState = newChildren;
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error in children function:', error);
                        useOptimizedPath = false;
                        try {
                            this._updateChildrenSafe(element, []);
                        } catch (fallbackError) {
                            console.error('Even safe fallback failed:', fallbackError);
                        }
                    }
                };

                this._createReactiveUpdate(element, updateChildren, subscriptions);

                try {
                    const initialChildren = children();
                    if (this._isPromiseLike(initialChildren)) {
                        promisify(initialChildren)
                            .then(resolvedInitial => {
                                childElements = this._reconcileChildren(element, [], resolvedInitial);
                                lastChildrenState = resolvedInitial;
                            })
                            .catch(error => {
                                console.warn('Initial async children failed, using safe method:', error.message);
                                useOptimizedPath = false;
                                this._updateChildrenSafe(element, []);
                            });
                    } else {
                        childElements = this._reconcileChildren(element, [], initialChildren);
                        lastChildrenState = initialChildren;
                    }
                } catch (error) {
                    console.warn('Initial reconciliation failed, using safe method:', error.message);
                    useOptimizedPath = false;
                    const initialChildren = children();
                    this._updateChildrenSafe(element, initialChildren);
                    lastChildrenState = initialChildren;
                }

            } else if (this._isPromiseLike(children)) {
                this._handleAsyncChildrenDirect(element, children);
            } else {
                try {
                    this._reconcileChildren(element, [], children);
                } catch (error) {
                    console.warn('Static reconciliation failed, using safe method:', error.message);
                    this._updateChildrenSafe(element, children);
                }
            }
        }

        /**
         * Handle async children directly using promisify
         */
        _handleAsyncChildrenDirect(element, childrenPromise) {
            // Set placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'juris-async-loading';
            placeholder.textContent = 'Loading content...';
            element.appendChild(placeholder);

            // Mark as async placeholder
            this.asyncPlaceholders.set(element, { type: 'children', placeholder });

            // Resolve using promisify
            promisify(childrenPromise)
                .then(resolvedChildren => {
                    if (placeholder.parentNode) {
                        element.removeChild(placeholder);
                    }
                    this._updateChildren(element, resolvedChildren);
                    this.asyncPlaceholders.delete(element);
                })
                .catch(error => {
                    console.error('Async children failed:', error);
                    placeholder.textContent = `Error loading content: ${error.message}`;
                    placeholder.className = 'juris-async-error';
                });
        }

        /**
         * Handle reactive children with promisify support
         */
        _handleReactiveChildren(element, childrenFn, subscriptions) {
            let lastChildrenResult = null;
            let isInitialized = false;

            const updateChildren = () => {
                try {
                    const result = childrenFn();

                    // Check if result is a promise
                    if (this._isPromiseLike(result)) {
                        promisify(result)
                            .then(resolvedResult => {
                                if (resolvedResult !== "ignore" &&
                                    (!isInitialized || !deepEquals(resolvedResult, lastChildrenResult))) {
                                    this._updateChildrenFineGrained(element, resolvedResult);
                                    lastChildrenResult = resolvedResult;
                                    isInitialized = true;
                                }
                            })
                            .catch(error => {
                                console.error('Error in async reactive children:', error);
                                this._renderChildrenError(element, error);
                            });
                    } else {
                        // Sync handling
                        if (result !== "ignore" &&
                            (!isInitialized || !deepEquals(result, lastChildrenResult))) {
                            this._updateChildrenFineGrained(element, result);
                            lastChildrenResult = result;
                            isInitialized = true;
                        }
                    }
                } catch (error) {
                    console.error('Error in reactive children function:', error);
                    this._renderChildrenError(element, error);
                }
            };

            this._createReactiveUpdate(element, updateChildren, subscriptions);
        }

        /**
         * Render children error state
         */
        _renderChildrenError(element, error) {
            element.innerHTML = '';
            const errorEl = document.createElement('div');
            errorEl.className = 'juris-children-error';
            errorEl.style.cssText = 'color: red; padding: 8px; border: 1px solid red; background: #ffe6e6;';
            errorEl.textContent = `Children Error: ${error.message}`;
            element.appendChild(errorEl);
        }

        // ==================== ENHANCED TEXT HANDLING ====================

        /**
         * Enhanced text handling with promisify integration
         */
        _handleText(element, text, subscriptions) {
            if (typeof text === 'function') {
                this._handleReactiveText(element, text, subscriptions);
            } else if (this._isPromiseLike(text)) {
                this._handleAsyncTextDirect(element, text);
            } else {
                element.textContent = text;
            }
        }

        /**
         * Handle async text directly using promisify
         */
        _handleAsyncTextDirect(element, textPromise) {
            element.textContent = 'Loading...';
            element.classList.add('juris-async-loading');

            promisify(textPromise)
                .then(resolvedText => {
                    element.textContent = resolvedText;
                    element.classList.remove('juris-async-loading');
                })
                .catch(error => {
                    console.error('Async text failed:', error);
                    element.textContent = `Error: ${error.message}`;
                    element.classList.add('juris-async-error');
                });
        }

        /**
         * Handle reactive text with promisify support
         */
        _handleReactiveText(element, textFn, subscriptions) {
            let lastTextValue = null;
            let isInitialized = false;

            const updateText = () => {
                try {
                    const result = textFn();

                    if (this._isPromiseLike(result)) {
                        promisify(result)
                            .then(resolvedText => {
                                if (!isInitialized || resolvedText !== lastTextValue) {
                                    element.textContent = resolvedText;
                                    lastTextValue = resolvedText;
                                    isInitialized = true;
                                }
                            })
                            .catch(error => {
                                console.error('Error in async reactive text:', error);
                                element.textContent = `Error: ${error.message}`;
                            });
                    } else {
                        // Sync handling
                        if (!isInitialized || result !== lastTextValue) {
                            element.textContent = result;
                            lastTextValue = result;
                            isInitialized = true;
                        }
                    }
                } catch (error) {
                    console.error('Error in reactive text function:', error);
                    element.textContent = `Text Error: ${error.message}`;
                }
            };

            this._createReactiveUpdate(element, updateText, subscriptions);
        }

        // ==================== ENHANCED STYLE HANDLING ====================

        /**
         * Enhanced style handling with promisify integration
         */
        _handleStyle(element, style, subscriptions) {
            if (typeof style === 'function') {
                this._handleReactiveStyle(element, style, subscriptions);
            } else if (this._isPromiseLike(style)) {
                this._handleAsyncStyleDirect(element, style);
            } else if (typeof style === 'object') {
                Object.assign(element.style, style);
            }
        }

        /**
         * Handle async style directly using promisify
         */
        _handleAsyncStyleDirect(element, stylePromise) {
            element.style.opacity = '0.7';
            element.classList.add('juris-async-loading');

            promisify(stylePromise)
                .then(resolvedStyle => {
                    element.style.opacity = '';
                    element.classList.remove('juris-async-loading');
                    if (typeof resolvedStyle === 'object') {
                        Object.assign(element.style, resolvedStyle);
                    }
                })
                .catch(error => {
                    console.error('Async style failed:', error);
                    element.classList.add('juris-async-error');
                });
        }

        /**
         * Handle reactive style with promisify support
         */
        _handleReactiveStyle(element, styleFn, subscriptions) {
            let lastStyleValue = null;
            let isInitialized = false;

            const updateStyle = () => {
                try {
                    const result = styleFn();

                    if (this._isPromiseLike(result)) {
                        promisify(result)
                            .then(resolvedStyle => {
                                if (!isInitialized || !deepEquals(resolvedStyle, lastStyleValue)) {
                                    if (typeof resolvedStyle === 'object') {
                                        Object.assign(element.style, resolvedStyle);
                                        lastStyleValue = { ...resolvedStyle };
                                        isInitialized = true;
                                    }
                                }
                            })
                            .catch(error => {
                                console.error('Error in async reactive style:', error);
                            });
                    } else {
                        // Sync handling
                        if (!isInitialized || !deepEquals(result, lastStyleValue)) {
                            if (typeof result === 'object') {
                                Object.assign(element.style, result);
                                lastStyleValue = { ...result };
                                isInitialized = true;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error in reactive style function:', error);
                }
            };

            this._createReactiveUpdate(element, updateStyle, subscriptions);
        }

        // ==================== REMAINING ORIGINAL METHODS ====================
        // All other methods remain unchanged from the original implementation

        _createElementOptimized(tagName, props, key) {
            let element = this._getRecycledElement(tagName);

            if (!element) {
                element = document.createElement(tagName);
            }

            if (key) {
                this.elementCache.set(key, element);
                element._jurisKey = key;
            }

            const subscriptions = [];
            const eventListeners = [];

            this._processProperties(element, props, subscriptions, eventListeners);

            if (subscriptions.length > 0 || eventListeners.length > 0) {
                this.subscriptions.set(element, { subscriptions, eventListeners });
            }

            return element;
        }

        _processProperties(element, props, subscriptions, eventListeners) {
            Object.keys(props).forEach(key => {
                const value = props[key];

                if (key === 'children') {
                    this._handleChildren(element, value, subscriptions);
                } else if (key === 'text') {
                    this._handleText(element, value, subscriptions);
                } else if (key === 'innerHTML') {
                    if (typeof value === 'function') {
                        this._handleReactiveAttribute(element, key, value, subscriptions);
                    } else {
                        element.innerHTML = value;
                    }
                } else if (key === 'style') {
                    this._handleStyle(element, value, subscriptions);
                } else if (key.startsWith('on')) {
                    this._handleEvent(element, key, value, eventListeners);
                } else if (typeof value === 'function') {
                    this._handleReactiveAttribute(element, key, value, subscriptions);
                } else if (key !== 'key') {
                    this._setStaticAttribute(element, key, value);
                }
            });
        }

        /**
         * Update children with proper cleanup and safety checks
         */
        _updateChildren(element, children) {
            if (children === "ignore") return;

            // Use fine-grained approach for safety
            this._updateChildrenFineGrained(element, children);
        }

        /**
         * Fine-grained children update with proper cleanup
         */
        _updateChildrenFineGrained(element, children) {
            if (children === "ignore") {
                return;
            }

            const childrenToRemove = Array.from(element.children);
            childrenToRemove.forEach(child => {
                this.cleanup(child);
            });

            element.textContent = '';

            const fragment = document.createDocumentFragment();

            if (Array.isArray(children)) {
                children.forEach(child => {
                    const childElement = this.render(child);
                    if (childElement) {
                        fragment.appendChild(childElement);
                    }
                });
            } else if (children) {
                const childElement = this.render(children);
                if (childElement) {
                    fragment.appendChild(childElement);
                }
            }

            if (fragment.hasChildNodes()) {
                element.appendChild(fragment);
            }
        }

        /**
         * Safe children update fallback
         */
        _updateChildrenSafe(element, children) {
            if (children === "ignore") {
                return;
            }

            const childrenToRemove = Array.from(element.children);
            childrenToRemove.forEach(child => {
                try {
                    this.cleanup(child);
                } catch (error) {
                    console.warn('Error cleaning up child:', error);
                }
            });

            element.textContent = '';

            const fragment = document.createDocumentFragment();

            if (Array.isArray(children)) {
                children.forEach(child => {
                    try {
                        const childElement = this.render(child);
                        if (childElement && childElement !== element) {
                            fragment.appendChild(childElement);
                        }
                    } catch (error) {
                        console.warn('Error rendering child:', error);
                    }
                });
            } else if (children) {
                try {
                    const childElement = this.render(children);
                    if (childElement && childElement !== element) {
                        fragment.appendChild(childElement);
                    }
                } catch (error) {
                    console.warn('Error rendering single child:', error);
                }
            }

            try {
                if (fragment.hasChildNodes()) {
                    element.appendChild(fragment);
                }
            } catch (error) {
                console.error('Failed to append fragment, trying individual children:', error);
                Array.from(fragment.children).forEach(child => {
                    try {
                        if (child && child !== element) {
                            element.appendChild(child);
                        }
                    } catch (individualError) {
                        console.warn('Failed to append individual child:', individualError);
                    }
                });
            }
        }

        /**
         * Children equality check
         */
        _childrenEqual(oldChildren, newChildren) {
            return deepEquals && deepEquals(oldChildren, newChildren);
        }

        /**
         * Reconcile children (batch mode optimization)
         */
        _reconcileChildren(parent, oldChildren, newChildren) {
            if (!Array.isArray(newChildren)) {
                newChildren = newChildren ? [newChildren] : [];
            }

            const newChildElements = [];
            const fragment = document.createDocumentFragment();

            const oldChildrenByKey = new Map();
            oldChildren.forEach((child, index) => {
                const key = child._jurisKey || `auto-${index}`;
                oldChildrenByKey.set(key, child);
            });

            const usedElements = new Set();

            newChildren.forEach((newChild, index) => {
                if (!newChild || typeof newChild !== 'object') return;

                const tagName = Object.keys(newChild)[0];
                const props = newChild[tagName] || {};

                const key = props.key || this._generateKey(tagName, props, index);

                const existingElement = oldChildrenByKey.get(key);

                if (existingElement &&
                    !usedElements.has(existingElement) &&
                    this._canReuseElement(existingElement, tagName, props) &&
                    !this._wouldCreateCircularReference(parent, existingElement)) {

                    if (existingElement.parentNode) {
                        existingElement.parentNode.removeChild(existingElement);
                    }

                    this._updateElementProperties(existingElement, props);
                    newChildElements.push(existingElement);
                    fragment.appendChild(existingElement);
                    usedElements.add(existingElement);
                    oldChildrenByKey.delete(key);
                } else {
                    const newElement = this.render(newChild);
                    if (newElement && !this._wouldCreateCircularReference(parent, newElement)) {
                        newElement._jurisKey = key;
                        newChildElements.push(newElement);
                        fragment.appendChild(newElement);
                    }
                }
            });

            oldChildrenByKey.forEach(unusedChild => {
                if (!usedElements.has(unusedChild)) {
                    this._recycleElement(unusedChild);
                }
            });

            try {
                parent.textContent = '';
                if (fragment.hasChildNodes()) {
                    parent.appendChild(fragment);
                }
            } catch (error) {
                console.error('Error in reconcileChildren:', error);
                parent.textContent = '';
                newChildElements.forEach(child => {
                    try {
                        if (child && !this._wouldCreateCircularReference(parent, child)) {
                            parent.appendChild(child);
                        }
                    } catch (e) {
                        console.warn('Failed to append child, skipping:', e);
                    }
                });
            }

            return newChildElements;
        }

        /**
         * Check for circular reference
         */
        _wouldCreateCircularReference(parent, child) {
            if (!parent || !child) return false;
            if (parent === child) return true;

            try {
                let current = parent.parentNode;
                while (current) {
                    if (current === child) {
                        return true;
                    }
                    current = current.parentNode;
                }

                if (child.contains && child.contains(parent)) {
                    return true;
                }

                if (child.children) {
                    for (let descendant of child.children) {
                        if (this._wouldCreateCircularReference(parent, descendant)) {
                            return true;
                        }
                    }
                }

            } catch (error) {
                console.warn('Error checking circular reference, assuming unsafe:', error);
                return true;
            }

            return false;
        }

        /**
         * Recycle element for performance
         */
        _recycleElement(element) {
            if (!element || !element.tagName) return;

            const tagName = element.tagName.toLowerCase();

            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }

            if (!this.recyclePool.has(tagName)) {
                this.recyclePool.set(tagName, []);
            }

            const pool = this.recyclePool.get(tagName);

            if (pool.length < this.recyclePoolSize) {
                this.cleanup(element);
                this._resetElement(element);
                pool.push(element);
            }
        }

        _handleEvent(element, eventName, handler, eventListeners) {
            if (eventName === 'onclick') {
                element.style.touchAction = 'manipulation';
                element.style.webkitTapHighlightColor = 'transparent';
                element.style.webkitTouchCallout = 'none';

                element.addEventListener('click', handler);
                eventListeners.push({ eventName: 'click', handler });

                let touchStartTime = 0;
                let touchMoved = false;
                let startX = 0;
                let startY = 0;

                const touchStart = (e) => {
                    touchStartTime = Date.now();
                    touchMoved = false;
                    if (e.touches && e.touches[0]) {
                        startX = e.touches[0].clientX;
                        startY = e.touches[0].clientY;
                    }
                };

                const touchMove = (e) => {
                    if (e.touches && e.touches[0]) {
                        const deltaX = Math.abs(e.touches[0].clientX - startX);
                        const deltaY = Math.abs(e.touches[0].clientY - startY);
                        if (deltaX > 10 || deltaY > 10) {
                            touchMoved = true;
                        }
                    }
                };

                const touchEnd = (e) => {
                    const touchDuration = Date.now() - touchStartTime;
                    if (!touchMoved && touchDuration < 300) {
                        e.preventDefault();
                        e.stopPropagation();
                        handler(e);
                    }
                };

                element.addEventListener('touchstart', touchStart, { passive: true });
                element.addEventListener('touchmove', touchMove, { passive: true });
                element.addEventListener('touchend', touchEnd, { passive: false });

                eventListeners.push({ eventName: 'touchstart', handler: touchStart });
                eventListeners.push({ eventName: 'touchmove', handler: touchMove });
                eventListeners.push({ eventName: 'touchend', handler: touchEnd });

            } else {
                const actualEventName = this.eventMap[eventName.toLowerCase()] || eventName.slice(2).toLowerCase();
                element.addEventListener(actualEventName, handler);
                eventListeners.push({ eventName: actualEventName, handler });
            }
        }

        _handleReactiveAttribute(element, attr, valueFn, subscriptions) {
            let lastValue = null;
            let isInitialized = false;

            const updateAttribute = () => {
                try {
                    const result = valueFn();

                    if (this._isPromiseLike(result)) {
                        promisify(result)
                            .then(resolvedValue => {
                                if (!isInitialized || !deepEquals(resolvedValue, lastValue)) {
                                    this._setStaticAttribute(element, attr, resolvedValue);
                                    lastValue = resolvedValue;
                                    isInitialized = true;
                                }
                            })
                            .catch(error => {
                                console.error(`Error in async reactive attribute '${attr}':`, error);
                            });
                    } else {
                        if (!isInitialized || !deepEquals(result, lastValue)) {
                            this._setStaticAttribute(element, attr, result);
                            lastValue = result;
                            isInitialized = true;
                        }
                    }
                } catch (error) {
                    console.error(`Error in reactive attribute '${attr}':`, error);
                }
            };

            this._createReactiveUpdate(element, updateAttribute, subscriptions);
        }

        _setStaticAttribute(element, attr, value) {
            if (attr === 'children' || attr === 'key') return;

            if (typeof value === 'function') {
                if (attr === 'value' && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')) {
                    element.value = value();
                    return;
                }
                console.warn(`Function value for attribute '${attr}' should be handled reactively`);
                return;
            }

            if (attr === 'className') {
                element.className = value;
            } else if (attr === 'htmlFor') {
                element.setAttribute('for', value);
            } else if (attr === 'tabIndex') {
                element.tabIndex = value;
            } else if (attr.startsWith('data-') || attr.startsWith('aria-')) {
                element.setAttribute(attr, value);
            } else if (attr in element && typeof element[attr] !== 'function') {
                try {
                    const descriptor = Object.getOwnPropertyDescriptor(element, attr) ||
                        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), attr);

                    if (!descriptor || descriptor.writable !== false) {
                        element[attr] = value;
                    } else {
                        element.setAttribute(attr, value);
                    }
                } catch (error) {
                    element.setAttribute(attr, value);
                }
            } else {
                element.setAttribute(attr, value);
            }
        }

        _createReactiveUpdate(element, updateFn, subscriptions) {
            const dependencies = this.juris.stateManager.startTracking();

            const originalTracking = this.juris.stateManager.currentTracking;
            this.juris.stateManager.currentTracking = dependencies;

            try {
                updateFn();
            } catch (error) {
                console.error('Error capturing dependencies:', error);
            } finally {
                this.juris.stateManager.currentTracking = originalTracking;
            }

            dependencies.forEach(path => {
                const unsubscribe = this.juris.stateManager.subscribeInternal(path, updateFn);
                subscriptions.push(unsubscribe);
            });
        }

        updateElementContent(element, newContent) {
            this._updateChildren(element, [newContent]);
        }

        cleanup(element) {
            this.juris.componentManager.cleanup(element);

            const data = this.subscriptions.get(element);
            if (data) {
                if (data.subscriptions) {
                    data.subscriptions.forEach(unsubscribe => {
                        try {
                            unsubscribe();
                        } catch (error) {
                            console.warn('Error during subscription cleanup:', error);
                        }
                    });
                }

                if (data.eventListeners) {
                    data.eventListeners.forEach(({ eventName, handler }) => {
                        try {
                            element.removeEventListener(eventName, handler);
                        } catch (error) {
                            console.warn('Error during event listener cleanup:', error);
                        }
                    });
                }

                this.subscriptions.delete(element);
            }

            if (element._jurisKey) {
                this.elementCache.delete(element._jurisKey);
            }

            // Clean up async placeholders
            if (this.asyncPlaceholders.has(element)) {
                this.asyncPlaceholders.delete(element);
            }

            try {
                const children = Array.from(element.children || []);
                children.forEach(child => {
                    try {
                        this.cleanup(child);
                    } catch (error) {
                        console.warn('Error cleaning up child element:', error);
                    }
                });
            } catch (error) {
                console.warn('Error during children cleanup:', error);
            }
        }

        // ==================== UTILITY METHODS ====================

        _generateKey(tagName, props) {
            if (props.key) return props.key;

            const keyProps = ['id', 'className', 'text'];
            const keyParts = [tagName];

            keyProps.forEach(prop => {
                if (props[prop] && typeof props[prop] !== 'function') {
                    keyParts.push(`${prop}:${props[prop]}`);
                }
            });

            const propsHash = this._hashProps(props);
            keyParts.push(`hash:${propsHash}`);

            return keyParts.join('|');
        }

        _hashProps(props) {
            const str = JSON.stringify(props, (key, value) => {
                return typeof value === 'function' ? '[function]' : value;
            });

            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return Math.abs(hash).toString(36);
        }

        _getRecycledElement(tagName) {
            const pool = this.recyclePool.get(tagName);
            if (pool && pool.length > 0) {
                const element = pool.pop();
                this._resetElement(element);
                return element;
            }
            return null;
        }

        _resetElement(element) {
            element.textContent = '';
            element.className = '';
            element.removeAttribute('style');

            const attributesToKeep = ['id', 'data-juris-key'];
            const attributes = Array.from(element.attributes);

            attributes.forEach(attr => {
                if (!attributesToKeep.includes(attr.name)) {
                    element.removeAttribute(attr.name);
                }
            });
        }

        _canReuseElement(element, tagName, props) {
            return element.tagName.toLowerCase() === tagName.toLowerCase();
        }

        _updateElementProperties(element, props) {
            Object.keys(props).forEach(key => {
                if (key === 'key' || key === 'children' || key === 'text' || key === 'style') {
                    return;
                }

                const value = props[key];
                if (typeof value !== 'function') {
                    this._setStaticAttribute(element, key, value);
                }
            });
        }

        // Clear async cache
        clearAsyncCache() {
            this.asyncCache.clear();
        }

        // Get async stats
        getAsyncStats() {
            return {
                cachedAsyncProps: this.asyncCache.size,
                activePlaceholders: this.asyncPlaceholders.size
            };
        }
    }

    /**
* Simplified DOM Enhancer - Focus on core functionality
* Removed complex nested selector logic and selectors category for clarity
*/
    class DOMEnhancer {
        constructor(juris) {
            this.juris = juris;
            this.observers = new Map();
            this.enhancedElements = new WeakSet();
            this.enhancementRules = new Map();
            this.containerEnhancements = new WeakMap(); // Track selectors category enhancements

            // Simplified performance options
            this.options = {
                debounceMs: 5,
                batchUpdates: true,
                observeSubtree: true,
                observeChildList: true
            };

            this.pendingEnhancements = new Set();
            this.enhancementTimer = null;
        }

        // ===== CORE ENHANCEMENT METHOD =====
        enhance(selector, definition, options = {}) {
            const config = { ...this.options, ...options };

            // Check if this uses the selectors category
            if (this._hasSelectorsCategory(definition)) {
                return this._enhanceWithSelectors(selector, definition, config);
            }

            // Store the enhancement rule
            this.enhancementRules.set(selector, { definition, config, type: 'simple' });

            // Process existing elements
            this._enhanceExistingElements(selector, definition, config);

            // Setup mutation observer for new elements
            if (config.observeNewElements !== false) {
                this._setupMutationObserver(selector, definition, config);
            }

            // Return cleanup function
            return () => this._unenhance(selector);
        }

        _hasSelectorsCategory(definition) {
            // Check object definition
            if (definition && typeof definition === 'object' && definition.selectors) {
                return true;
            }

            // Check function definition
            if (typeof definition === 'function') {
                try {
                    const testContext = this.juris.createContext();
                    const result = definition(testContext);
                    return result && typeof result === 'object' && result.selectors;
                } catch (error) {
                    // If test fails, assume it's not selectors category
                    return false;
                }
            }

            return false;
        }

        // ===== SELECTORS CATEGORY ENHANCEMENT =====
        _enhanceWithSelectors(containerSelector, definition, config) {
            // Store the enhancement rule
            this.enhancementRules.set(containerSelector, {
                definition,
                config,
                type: 'selectors'
            });

            // Process existing containers
            this._enhanceExistingContainers(containerSelector, definition, config);

            // Setup mutation observer for new containers and elements
            if (config.observeNewElements !== false) {
                this._setupSelectorsObserver(containerSelector, definition, config);
            }

            // Return cleanup function
            return () => this._unenhanceSelectors(containerSelector);
        }

        _enhanceExistingContainers(containerSelector, definition, config) {
            const containers = document.querySelectorAll(containerSelector);
            containers.forEach(container => {
                this._enhanceContainer(container, definition, config);
            });
        }

        _enhanceContainer(container, definition, config) {
            if (this.enhancedElements.has(container)) {
                return;
            }

            try {
                // Mark container as enhanced
                this.enhancedElements.add(container);
                container.setAttribute('data-juris-enhanced-container', Date.now());

                // Get the definition
                let actualDefinition = definition;
                if (typeof definition === 'function') {
                    const context = this.juris.createContext(container);
                    actualDefinition = definition(context);
                }

                if (!actualDefinition || !actualDefinition.selectors) {
                    console.warn('Selectors enhancement must have a "selectors" property');
                    return;
                }

                // Track this container's enhancements
                const containerData = new Map();
                this.containerEnhancements.set(container, containerData);

                // Apply container-level properties (excluding selectors)
                this._applyContainerProperties(container, actualDefinition);

                // Process each selector
                Object.entries(actualDefinition.selectors).forEach(([selector, selectorDefinition]) => {
                    this._enhanceSelector(container, selector, selectorDefinition, containerData, config);
                });

            } catch (error) {
                console.error('Error enhancing container:', error);
                this.enhancedElements.delete(container);
            }
        }

        _applyContainerProperties(container, definition) {
            const containerProps = { ...definition };
            delete containerProps.selectors;

            if (Object.keys(containerProps).length > 0) {
                this._applyEnhancements(container, containerProps);
            }
        }

        _enhanceSelector(container, selector, definition, containerData, config) {
            const elements = container.querySelectorAll(selector);
            const enhancedElements = new Set();

            elements.forEach(element => {
                if (!this.enhancedElements.has(element)) {
                    this._enhanceSelectorElement(element, definition, container, selector);
                    enhancedElements.add(element);
                }
            });

            // Store selector data for cleanup and new element handling
            containerData.set(selector, {
                definition,
                enhancedElements
            });
        }

        _enhanceSelectorElement(element, definition, container, selector) {
            try {
                // Mark as enhanced
                this.enhancedElements.add(element);
                element.setAttribute('data-juris-enhanced-selector', Date.now());

                // Get the actual definition
                let actualDefinition = definition;

                // If definition is a function, call it with context
                if (typeof definition === 'function') {
                    const context = this.juris.createContext(element);
                    actualDefinition = definition(context);

                    if (!actualDefinition || typeof actualDefinition !== 'object') {
                        console.warn(`Selector '${selector}' function must return a definition object`);
                        this.enhancedElements.delete(element);
                        return;
                    }
                }

                // Process element-aware functions (FIXED - no auto-execution)
                const processedDefinition = this._processElementAwareFunctions(element, actualDefinition);

                // Apply enhancements
                this._applyEnhancements(element, processedDefinition);

            } catch (error) {
                console.error('Error enhancing selector element:', error);
                this.enhancedElements.delete(element);
            }
        }

        _processElementAwareFunctions(element, definition) {
            const processed = {};

            Object.entries(definition).forEach(([key, value]) => {
                if (typeof value === 'function') {
                    // Check if this is an event handler (starts with 'on')
                    if (key.startsWith('on')) {
                        // Event handlers should never be auto-executed, always preserve them
                        processed[key] = value;
                    }
                    // Check if function expects parameters (element-aware) and is NOT an event handler
                    else if (value.length > 0) {
                        try {
                            // Create safe context for element-aware functions
                            const context = this.juris.createContext(element);
                            const result = value(context);

                            // Element-aware function should return an object
                            if (result && typeof result === 'object') {
                                processed[key] = result;
                            } else {
                                console.warn(`Element-aware function for '${key}' should return an object`);
                                processed[key] = value;
                            }
                        } catch (error) {
                            console.warn(`Error processing element-aware function '${key}':`, error);
                            processed[key] = value;
                        }
                    } else {
                        // No parameters = direct function (like computed properties)
                        processed[key] = value;
                    }
                } else {
                    processed[key] = value;
                }
            });

            return processed;
        }

        _setupSelectorsObserver(containerSelector, definition, config) {
            const observerKey = `selectors_${containerSelector}`;

            if (this.observers.has(observerKey)) {
                return;
            }

            const observer = new MutationObserver((mutations) => {
                if (config.debounceMs > 0) {
                    this._debouncedProcessSelectorsMutations(mutations, containerSelector, definition, config);
                } else {
                    this._processSelectorsMutations(mutations, containerSelector, definition, config);
                }
            });

            const observerConfig = {
                childList: config.observeChildList,
                subtree: config.observeSubtree
            };

            observer.observe(document.body, observerConfig);
            this.observers.set(observerKey, observer);
        }

        _processSelectorsMutations(mutations, containerSelector, definition, config) {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this._handleNewNodeForSelectors(node, containerSelector, definition, config);
                        }
                    });
                }
            });
        }

        _handleNewNodeForSelectors(node, containerSelector, definition, config) {
            // Check if the node itself is a new container
            if (node.matches && node.matches(containerSelector)) {
                this._enhanceContainer(node, definition, config);
            }

            // Check for new containers within the node
            if (node.querySelectorAll) {
                const newContainers = node.querySelectorAll(containerSelector);
                newContainers.forEach(container => {
                    this._enhanceContainer(container, definition, config);
                });
            }

            // Check for new elements within existing containers
            this._enhanceNewElementsInContainers(node);
        }

        _enhanceNewElementsInContainers(node) {
            const containers = document.querySelectorAll('[data-juris-enhanced-container]');

            containers.forEach(container => {
                if (!container.contains(node)) return;

                const containerData = this.containerEnhancements.get(container);
                if (!containerData) return;

                containerData.forEach((selectorData, selector) => {
                    const { definition, enhancedElements } = selectorData;

                    // Check if node matches selector
                    if (node.matches && node.matches(selector)) {
                        this._enhanceSelectorElement(node, definition, container, selector);
                        enhancedElements.add(node);
                    }

                    // Check descendants
                    if (node.querySelectorAll) {
                        const matchingElements = node.querySelectorAll(selector);
                        matchingElements.forEach(element => {
                            if (!this.enhancedElements.has(element)) {
                                this._enhanceSelectorElement(element, definition, container, selector);
                                enhancedElements.add(element);
                            }
                        });
                    }
                });
            });
        }

        _debouncedProcessSelectorsMutations(mutations, containerSelector, definition, config) {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.pendingEnhancements.add({
                                node,
                                containerSelector,
                                definition,
                                config,
                                type: 'selectors',
                                timestamp: Date.now()
                            });
                        }
                    });
                }
            });

            if (this.enhancementTimer) {
                clearTimeout(this.enhancementTimer);
            }

            this.enhancementTimer = setTimeout(() => {
                this._processPendingEnhancements();
                this.enhancementTimer = null;
            }, config.debounceMs);
        }

        _unenhanceSelectors(containerSelector) {
            const observerKey = `selectors_${containerSelector}`;

            // Disconnect observer
            const observer = this.observers.get(observerKey);
            if (observer) {
                observer.disconnect();
                this.observers.delete(observerKey);
            }

            // Remove enhancement rule
            this.enhancementRules.delete(containerSelector);

            // Clean up containers
            const containers = document.querySelectorAll(`${containerSelector}[data-juris-enhanced-container]`);
            containers.forEach(container => {
                this._cleanupContainer(container);
            });
        }

        _cleanupContainer(container) {
            const containerData = this.containerEnhancements.get(container);

            if (containerData) {
                containerData.forEach((selectorData) => {
                    selectorData.enhancedElements.forEach(element => {
                        this._cleanupElement(element);
                    });
                });
                this.containerEnhancements.delete(container);
            }

            this._cleanupElement(container);
            container.removeAttribute('data-juris-enhanced-container');
        }
        _enhanceExistingElements(selector, definition, config) {
            const elements = document.querySelectorAll(selector);

            if (config.batchUpdates && elements.length > 1) {
                this._batchEnhanceElements(Array.from(elements), definition, config);
            } else {
                elements.forEach(element => this._enhanceElement(element, definition, config));
            }
        }

        _batchEnhanceElements(elements, definition, config) {
            const elementsToProcess = elements.filter(element => !this.enhancedElements.has(element));
            elementsToProcess.forEach(element => this._enhanceElement(element, definition, config));
        }

        _enhanceElement(element, definition, config) {
            if (this.enhancedElements.has(element)) {
                return;
            }

            try {
                // Mark as enhanced
                this.enhancedElements.add(element);
                element.setAttribute('data-juris-enhanced', Date.now());

                // Get enhancement definition
                let actualDefinition = definition;
                if (typeof definition === 'function') {
                    const context = this.juris.createContext(element);
                    actualDefinition = definition(context);

                    if (!actualDefinition || typeof actualDefinition !== 'object') {
                        console.warn('Enhancement function must return a definition object');
                        this.enhancedElements.delete(element);
                        return;
                    }
                }

                // Apply enhancements using DOMRenderer
                this._applyEnhancements(element, actualDefinition);

                // Call onEnhanced callback if provided
                if (config.onEnhanced) {
                    const context = this.juris.createContext(element);
                    config.onEnhanced(element, context);
                }

            } catch (error) {
                console.error('Error enhancing element:', error);
                this.enhancedElements.delete(element);
            }
        }

        _applyEnhancements(element, definition) {
            const subscriptions = [];
            const eventListeners = [];
            const renderer = this.juris.domRenderer;

            Object.keys(definition).forEach(key => {
                const value = definition[key];

                try {
                    // Handle different property types
                    if (key === 'children') {
                        this._handleChildren(element, value, subscriptions, renderer);
                    } else if (key === 'text') {
                        renderer._handleText(element, value, subscriptions);
                    } else if (key === 'innerHTML') {
                        this._handleInnerHTML(element, value, subscriptions, renderer);
                    } else if (key === 'style') {
                        renderer._handleStyle(element, value, subscriptions);
                    } else if (key.startsWith('on')) {
                        renderer._handleEvent(element, key, value, eventListeners);
                    } else if (typeof value === 'function') {
                        renderer._handleReactiveAttribute(element, key, value, subscriptions);
                    } else {
                        renderer._setStaticAttribute(element, key, value);
                    }
                } catch (error) {
                    console.error(`Error processing enhancement property '${key}':`, error);
                }
            });

            // Store subscriptions for cleanup
            if (subscriptions.length > 0 || eventListeners.length > 0) {
                this.juris.domRenderer.subscriptions.set(element, { subscriptions, eventListeners });
            }
        }

        _handleChildren(element, children, subscriptions, renderer) {
            if (renderer.isFineGrained()) {
                renderer._handleChildrenFineGrained(element, children, subscriptions);
            } else {
                renderer._handleChildrenOptimized(element, children, subscriptions);
            }
        }

        _handleInnerHTML(element, innerHTML, subscriptions, renderer) {
            if (typeof innerHTML === 'function') {
                renderer._handleReactiveAttribute(element, 'innerHTML', innerHTML, subscriptions);
            } else {
                element.innerHTML = innerHTML;
            }
        }

        // ===== MUTATION OBSERVER =====
        _setupMutationObserver(selector, definition, config) {
            if (this.observers.has(selector)) {
                return; // Observer already exists
            }

            const observer = new MutationObserver((mutations) => {
                if (config.debounceMs > 0) {
                    this._debouncedProcessMutations(mutations, selector, definition, config);
                } else {
                    this._processMutations(mutations, selector, definition, config);
                }
            });

            const observerConfig = {
                childList: config.observeChildList,
                subtree: config.observeSubtree
            };

            observer.observe(document.body, observerConfig);
            this.observers.set(selector, observer);
        }

        _processMutations(mutations, selector, definition, config) {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this._enhanceNewNode(node, selector, definition, config);
                        }
                    });
                }
            });
        }

        _enhanceNewNode(node, selector, definition, config) {
            // Check if the node itself matches
            if (node.matches && node.matches(selector)) {
                this._enhanceElement(node, definition, config);
            }

            // Check for matching descendants
            if (node.querySelectorAll) {
                const matchingElements = node.querySelectorAll(selector);
                matchingElements.forEach(element => {
                    this._enhanceElement(element, definition, config);
                });
            }
        }

        _debouncedProcessMutations(mutations, selector, definition, config) {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.pendingEnhancements.add({
                                node,
                                selector,
                                definition,
                                config,
                                timestamp: Date.now()
                            });
                        }
                    });
                }
            });

            if (this.enhancementTimer) {
                clearTimeout(this.enhancementTimer);
            }

            this.enhancementTimer = setTimeout(() => {
                this._processPendingEnhancements();
                this.enhancementTimer = null;
            }, config.debounceMs);
        }

        _processPendingEnhancements() {
            const enhancements = Array.from(this.pendingEnhancements);
            this.pendingEnhancements.clear();

            enhancements.forEach(({ node, selector, definition, config, containerSelector, type }) => {
                try {
                    if (type === 'selectors') {
                        this._handleNewNodeForSelectors(node, containerSelector, definition, config);
                    } else {
                        this._enhanceNewNode(node, selector, definition, config);
                    }
                } catch (error) {
                    console.error('Error processing pending enhancement:', error);
                }
            });
        }

        // ===== CLEANUP METHODS =====
        _unenhance(selector) {
            // Disconnect observer
            const observer = this.observers.get(selector);
            if (observer) {
                observer.disconnect();
                this.observers.delete(selector);
            }

            // Remove enhancement rule
            this.enhancementRules.delete(selector);

            // Clean up enhanced elements
            const elements = document.querySelectorAll(`${selector}[data-juris-enhanced]`);
            elements.forEach(element => {
                this._cleanupElement(element);
            });
        }

        _cleanupElement(element) {
            // Use DOMRenderer cleanup
            this.juris.domRenderer.cleanup(element);

            // Remove from enhanced set
            this.enhancedElements.delete(element);

            // Remove enhancement attributes
            element.removeAttribute('data-juris-enhanced');
            element.removeAttribute('data-juris-enhanced-selector');
        }

        // ===== PUBLIC API =====
        configure(options) {
            Object.assign(this.options, options);
        }

        configureRenderOptimization(options = {}) {
            if (options.enableLogging !== undefined) {
                this.renderOptimization = this.renderOptimization || {};
                this.renderOptimization.enableLogging = options.enableLogging;
            }

            console.log('Render optimization configured:', this.renderOptimization);
        }
        getStats() {
            const enhancedElements = document.querySelectorAll('[data-juris-enhanced]').length;
            const enhancedContainers = document.querySelectorAll('[data-juris-enhanced-container]').length;
            const enhancedSelectors = document.querySelectorAll('[data-juris-enhanced-selector]').length;

            return {
                enhancementRules: this.enhancementRules.size,
                activeObservers: this.observers.size,
                pendingEnhancements: this.pendingEnhancements.size,
                enhancedElements,
                enhancedContainers,
                enhancedSelectors,
                totalEnhanced: enhancedElements + enhancedSelectors
            };
        }

        destroy() {
            // Disconnect all observers
            this.observers.forEach(observer => observer.disconnect());
            this.observers.clear();

            // Clear enhancement rules
            this.enhancementRules.clear();

            // Clear pending timer
            if (this.enhancementTimer) {
                clearTimeout(this.enhancementTimer);
                this.enhancementTimer = null;
            }

            // Clean up all enhanced elements
            const enhancedElements = document.querySelectorAll('[data-juris-enhanced], [data-juris-enhanced-selector]');
            enhancedElements.forEach(element => {
                this._cleanupElement(element);
            });

            const enhancedContainers = document.querySelectorAll('[data-juris-enhanced-container]');
            enhancedContainers.forEach(container => {
                this._cleanupContainer(container);
            });

            // Clear pending enhancements
            this.pendingEnhancements.clear();
        }
    }

    /**
    * Main Juris class with renderMode support
    */
    class Juris {
        constructor(config = {}) {
            this.services = config.services || {};
            this.layout = config.layout;

            this.stateManager = new StateManager(config.states || {}, config.middleware || []);
            this.headlessManager = new HeadlessManager(this);
            this.componentManager = new ComponentManager(this);
            this.domRenderer = new DOMRenderer(this);
            this.domEnhancer = new DOMEnhancer(this);


            if (config.headlessComponents) {
                Object.entries(config.headlessComponents).forEach(([name, config]) => {
                    if (typeof config === 'function') {
                        this.headlessManager.register(name, config);
                    } else {
                        this.headlessManager.register(name, config.fn, config.options);
                    }
                });
            }
            this.headlessManager.initializeQueued();

            // RENDER MODE: Check config for render mode
            if (config.renderMode === 'fine-grained') {
                this.domRenderer.setRenderMode('fine-grained');
            } else if (config.renderMode === 'batch') {
                this.domRenderer.setRenderMode('batch');
            }

            // BACKWARD COMPATIBILITY: Support legacy config
            if (config.legacyMode === true) {
                console.warn('legacyMode is deprecated. Use renderMode: "fine-grained" instead.');
                this.domRenderer.setRenderMode('fine-grained');
            }

            if (config.components) {
                Object.entries(config.components).forEach(([name, component]) => {
                    this.componentManager.register(name, component);
                });
            }

        }

        init() {

        }
        createHeadlessContext(element = null) {
            const context = {
                // Core state management
                getState: (path, defaultValue) => this.stateManager.getState(path, defaultValue),
                setState: (path, value, context) => this.stateManager.setState(path, value, context),
                subscribe: (path, callback) => this.stateManager.subscribe(path, callback),

                // Services access
                services: this.services,
                ...(this.services || {}),

                // Access to other headless APIs
                headless: this.headlessManager.context,
                ...(this.headlessAPIs || {}),

                // Component management
                components: {
                    register: (name, component) => this.componentManager.register(name, component),
                    registerHeadless: (name, component, options) => this.headlessManager.register(name, component, options),
                    get: (name) => this.componentManager.components.get(name),
                    getHeadless: (name) => this.headlessManager.getInstance(name),
                    initHeadless: (name, props) => this.headlessManager.initialize(name, props),
                    reinitHeadless: (name, props) => this.headlessManager.reinitialize(name, props)
                },

                // Utilities
                utils: {
                    render: (container) => this.render(container),
                    cleanup: () => this.cleanup(),
                    forceRender: () => this.render(),
                    getHeadlessStatus: () => this.headlessManager.getStatus()
                },

                // Direct access to Juris instance
                juris: this
            };

            // ✅ Add element reference when provided
            if (element) {
                context.element = element;
            }

            return context;
        }

        // Create unified context with enhanced headless support
        createContext(element = null) {
            const context = {
                // State management
                getState: (path, defaultValue) => this.stateManager.getState(path, defaultValue),
                setState: (path, value, context) => this.stateManager.setState(path, value, context),
                subscribe: (path, callback) => this.stateManager.subscribe(path, callback),

                // Services
                services: this.services,
                ...(this.services || {}),

                // Direct access to all headless APIs
                ...(this.headlessAPIs || {}),

                // Headless components context
                headless: this.headlessManager.context,

                // Component management
                components: {
                    register: (name, component) => this.componentManager.register(name, component),
                    registerHeadless: (name, component, options) => this.headlessManager.register(name, component, options),
                    get: (name) => this.componentManager.components.get(name),
                    getHeadless: (name) => this.headlessManager.getInstance(name),
                    initHeadless: (name, props) => this.headlessManager.initialize(name, props),
                    reinitHeadless: (name, props) => this.headlessManager.reinitialize(name, props),
                    getHeadlessAPI: (name) => this.headlessManager.getAPI(name),
                    getAllHeadlessAPIs: () => this.headlessManager.getAllAPIs()
                },

                // Utilities
                utils: {
                    render: (container) => this.render(container),
                    cleanup: () => this.cleanup(),
                    forceRender: () => this.render(),
                    setRenderMode: (mode) => this.setRenderMode(mode),
                    getRenderMode: () => this.getRenderMode(),
                    isFineGrained: () => this.isFineGrained(),
                    isBatchMode: () => this.isBatchMode(),
                    getHeadlessStatus: () => this.headlessManager.getStatus(),
                },

                // Direct access
                juris: this
            };

            // Add element reference when provided
            if (element) {
                context.element = element;
            }

            return context;
        }

        // Public API - State Management
        getState(path, defaultValue) {
            return this.stateManager.getState(path, defaultValue);
        }

        setState(path, value, context) {
            return this.stateManager.setState(path, value, context);
        }

        subscribe(path, callback, hierarchical = true) {
            return this.stateManager.subscribe(path, callback, hierarchical);
        }
        subscribeExact(path, callback) {
            return this.stateManager.subscribeExact(path, callback);
        }
        // Public API - Component Management
        registerComponent(name, component) {
            return this.componentManager.register(name, component);
        }

        registerHeadlessComponent(name, component, options) {
            return this.headlessManager.register(name, component, options);
        }

        getComponent(name) {
            return this.componentManager.components.get(name);
        }

        getHeadlessComponent(name) {
            return this.headlessManager.getInstance(name);
        }

        initializeHeadlessComponent(name, props) {
            return this.headlessManager.initialize(name, props);
        }

        // Public API - Render Mode Control
        setRenderMode(mode) {
            this.domRenderer.setRenderMode(mode);
        }

        getRenderMode() {
            return this.domRenderer.getRenderMode();
        }

        isFineGrained() {
            return this.domRenderer.isFineGrained();
        }

        isBatchMode() {
            return this.domRenderer.isBatchMode();
        }

        // DEPRECATED: Legacy method names for backward compatibility
        enableLegacyMode() {
            console.warn('enableLegacyMode() is deprecated. Use setRenderMode("fine-grained") instead.');
            this.setRenderMode('fine-grained');
        }

        disableLegacyMode() {
            console.warn('disableLegacyMode() is deprecated. Use setRenderMode("batch") instead.');
            this.setRenderMode('batch');
        }

        // Enhanced methods for headless component management
        _updateComponentContexts() {
            // This method can be called when headless components are added/removed
            // to ensure all component contexts have access to updated APIs
            if (this.headlessAPIs) {
                // The contexts will get updated APIs on next render cycle
                // due to the spread operator in createContext()
            }
        }

        registerAndInitHeadless(name, componentFn, options = {}) {
            this.headlessManager.register(name, componentFn, options);
            return this.headlessManager.initialize(name, options);
        }

        getHeadlessStatus() {
            return this.headlessManager.getStatus();
        }
        /**
         * Convert a vnode to an HTML element
         * @param {Object} vnode - The vnode to convert
         * @returns {Element} The HTML element
         */
        objectToHtml(vnode) {
            return this.domRenderer.render(vnode);
        }
        // Public API - Rendering
        render(container = '#app') {
            const containerEl = typeof container === 'string'
                ? document.querySelector(container)
                : container;

            if (!containerEl) {
                console.error('Container not found:', container);
                return;
            }

            // Cleanup existing content
            Array.from(containerEl.children).forEach(child => {
                this.domRenderer.cleanup(child);
            });
            containerEl.innerHTML = '';

            this.headlessManager.initializeQueued();

            try {
                if (!this.layout) {
                    containerEl.innerHTML = '<p>No layout configured</p>';
                    return;
                }

                const element = this.domRenderer.render(this.layout);
                if (element) {
                    containerEl.appendChild(element);
                }
            } catch (error) {
                console.error('Render error:', error);
                this._renderError(containerEl, error);
            }
        }

        _renderError(container, error) {
            const errorEl = document.createElement('div');
            errorEl.style.cssText = 'color: red; border: 2px solid red; padding: 16px; margin: 8px; background: #ffe6e6;';
            errorEl.innerHTML = `
  <h3>Render Error</h3>
  <p><strong>Message:</strong> ${error.message}</p>
  <pre style="background: #f5f5f5; padding: 8px; overflow: auto;">${error.stack || ''}</pre>
  `;
            container.appendChild(errorEl);
        }

        // Public API - DOM Enhancement
        enhance(selector, definition, options) {
            return this.domEnhancer.enhance(selector, definition, options);
        }

        configureEnhancement(options) {
            return this.domEnhancer.configure(options);
        }

        getEnhancementStats() {
            return this.domEnhancer.getStats();
        }

        // Public API - Cleanup
        cleanup() {
            this.headlessManager.cleanup();
        }

        destroy() {
            this.cleanup();
            this.domEnhancer.destroy();
            this.stateManager.subscribers.clear();
            this.stateManager.externalSubscribers.clear();
            this.componentManager.components.clear();
            this.headlessManager.components.clear();
        }
    }

    // Export Juris globally
    if (typeof window !== 'undefined') {
        window.Juris = Juris;
        window.deepEquals = deepEquals;
        window.setPromiseMode = setPromiseMode;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Juris;
        module.exports.deepEquals = deepEquals;
        module.exports.setPromiseMode = setPromiseMode;
    }

})();
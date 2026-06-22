/**
 * Custom React-Like UI Framework Engine
 * Core features: Virtual DOM, Structural Reconciliation, Hooks (useState, useEffect)
 * Exposed to the global scope to bypass local CORS limitations.
 */

(function (global) {
    let currentComponentInstance = null;
    let hookIndex = 0;
    const componentStateMap = new Map();

    // --- Virtual DOM Creation ---
    function createElement(type, props, ...children) {
        return {
            type,
            props: {
                ...props,
                children: children.flat().filter(child => child != null && child !== false)
            },
            key: props?.key ?? null
        };
    }

    function createDOMNode(vNode) {
        if (typeof vNode === 'string' || typeof vNode === 'number') {
            return document.createTextNode(String(vNode));
        }

        if (typeof vNode.type === 'function') {
            currentComponentInstance = {
                type: vNode.type,
                props: vNode.props,
                container: null,
                hookStates: []
            };
            hookIndex = 0;
            
            if (!componentStateMap.has(vNode.type)) {
                componentStateMap.set(vNode.type, []);
            }
            currentComponentInstance.hookStates = componentStateMap.get(vNode.type);

            const renderedVNode = vNode.type(vNode.props);
            const dom = createDOMNode(renderedVNode);
            dom._vNode = vNode;
            dom._renderedVNode = renderedVNode;
            return dom;
        }

        const dom = document.createElement(vNode.type);
        
        if (vNode.props) {
            Object.keys(vNode.props)
                .filter(key => key !== 'children')
                .forEach(name => {
                    if (name.startsWith('on') && typeof vNode.props[name] === 'function') {
                        const eventType = name.toLowerCase().substring(2);
                        dom.addEventListener(eventType, vNode.props[name]);
                    } else if (name === 'style' && typeof vNode.props[name] === 'object') {
                        Object.assign(dom.style, vNode.props[name]);
                    } else {
                        dom[name] = vNode.props[name];
                    }
                });
        }

        vNode.props.children.forEach(child => {
            dom.appendChild(createDOMNode(child));
        });

        dom._vNode = vNode;
        return dom;
    }

    let rootContainer = null;
    let rootVNode = null;
    let isRenderPending = false;

    function render(vNode, container) {
        rootContainer = container;
        rootVNode = vNode;
        container.innerHTML = '';
        container.appendChild(createDOMNode(vNode));
    }

    function scheduleRender() {
        if (isRenderPending) return;
        isRenderPending = true;
        
        queueMicrotask(() => {
            if (!rootContainer || !rootVNode) return;
            const oldDOM = rootContainer.firstChild;
            const oldVNode = oldDOM ? (oldDOM._vNode || rootVNode) : null;
            
            diff(rootContainer, oldDOM, oldVNode, rootVNode);
            isRenderPending = false;
        });
    }

    // --- Diff & Reconciliation Engine ---
    function diff(parent, dom, oldVNode, newVNode) {
        if (!dom) {
            const newDom = createDOMNode(newVNode);
            parent.appendChild(newDom);
            return newDom;
        }

        if (!newVNode) {
            if (oldVNode && typeof oldVNode.type === 'function') {
                const states = componentStateMap.get(oldVNode.type) || [];
                states.forEach(state => {
                    if (state.type === 'effect' && typeof state.cleanup === 'function') {
                        state.cleanup();
                    }
                });
            }
            parent.removeChild(dom);
            return null;
        }

        if ((typeof oldVNode === 'string' || typeof oldVNode === 'number') && 
            (typeof newVNode === 'string' || typeof newVNode === 'number')) {
            if (oldVNode !== newVNode) {
                dom.nodeValue = String(newVNode);
            }
            dom._vNode = newVNode;
            return dom;
        }

        if (oldVNode.type !== newVNode.type) {
            const newDom = createDOMNode(newVNode);
            parent.replaceChild(newDom, dom);
            return newDom;
        }

        if (typeof newVNode.type === 'function') {
            currentComponentInstance = {
                type: newVNode.type,
                props: newVNode.props,
                container: parent,
                hookStates: componentStateMap.get(newVNode.type) || []
            };
            hookIndex = 0;

            const nextRenderedVNode = newVNode.type(newVNode.props);
            const currentRenderedVNode = dom._renderedVNode;
            
            const updatedDom = diff(parent, dom, currentRenderedVNode, nextRenderedVNode);
            if (updatedDom) {
                updatedDom._vNode = newVNode;
                updatedDom._renderedVNode = nextRenderedVNode;
            }
            return updatedDom;
        }

        updateProps(dom, oldVNode.props, newVNode.props);
        dom._vNode = newVNode;

        diffChildren(dom, oldVNode.props.children || [], newVNode.props.children || []);
        return dom;
    }

    function updateProps(dom, oldProps = {}, newProps = {}) {
        Object.keys(oldProps)
            .filter(key => key !== 'children')
            .forEach(name => {
                if (!(name in newProps)) {
                    if (name.startsWith('on')) {
                        const eventType = name.toLowerCase().substring(2);
                        dom.removeEventListener(eventType, oldProps[name]);
                    } else {
                        dom[name] = '';
                    }
                }
            });

        Object.keys(newProps)
            .filter(key => key !== 'children')
            .forEach(name => {
                if (oldProps[name] !== newProps[name]) {
                    if (name.startsWith('on')) {
                        const eventType = name.toLowerCase().substring(2);
                        if (oldProps[name]) dom.removeEventListener(eventType, oldProps[name]);
                        dom.addEventListener(eventType, newProps[name]);
                    } else if (name === 'style' && typeof newProps[name] === 'object') {
                        dom.style.cssText = '';
                        Object.assign(dom.style, newProps[name]);
                    } else {
                        dom[name] = newProps[name];
                    }
                }
            });
    }

    function diffChildren(parentDOM, oldChildren, newChildren) {
        const oldKeysMap = new Map();
        oldChildren.forEach((child, idx) => {
            if (child && child.key !== null && child.key !== undefined) {
                oldKeysMap.set(child.key, { child, index: idx });
            }
        });

        const maxLen = Math.max(oldChildren.length, newChildren.length);
        let childDOM = parentDOM.firstChild;

        for (let i = 0; i < maxLen; i++) {
            const newChild = newChildren[i];
            const oldChild = oldChildren[i];

            if (newChild && newChild.key !== null && newChild.key !== undefined) {
                if (oldKeysMap.has(newChild.key)) {
                    const matched = oldKeysMap.get(newChild.key);
                    const targetDOM = parentDOM.childNodes[matched.index];
                    diff(parentDOM, targetDOM, matched.child, newChild);
                    oldKeysMap.delete(newChild.key);
                    continue;
                }
            }

            if (i < parentDOM.childNodes.length) {
                childDOM = parentDOM.childNodes[i];
                diff(parentDOM, childDOM, oldChild, newChild);
            } else if (newChild) {
                diff(parentDOM, null, null, newChild);
            }
        }

        oldKeysMap.forEach(matched => {
            const targetDOM = parentDOM.childNodes[matched.index];
            if (targetDOM) parentDOM.removeChild(targetDOM);
        });
    }

    // --- State & Side Effect Hooks ---
    function useState(initialValue) {
        const instance = currentComponentInstance;
        if (!instance) throw new Error("useState hook can only be invoked inside components.");
        
        const currentIndex = hookIndex;
        
        if (instance.hookStates[currentIndex] === undefined) {
            instance.hookStates[currentIndex] = {
                type: 'state',
                value: typeof initialValue === 'function' ? initialValue() : initialValue
            };
        }
        
        const stateNode = instance.hookStates[currentIndex];
        
        const setState = (newValue) => {
            const nextValue = typeof newValue === 'function' ? newValue(stateNode.value) : newValue;
            if (stateNode.value !== nextValue) {
                stateNode.value = nextValue;
                scheduleRender();
            }
        };
        
        hookIndex++;
        return [stateNode.value, setState];
    }

    function useEffect(callback, deps) {
        const instance = currentComponentInstance;
        if (!instance) throw new Error("useEffect hook can only be invoked inside components.");

        const currentIndex = hookIndex;
        const hasNoDeps = !deps;
        const oldHook = instance.hookStates[currentIndex];

        const hasChangedDeps = oldHook 
            ? !deps.every((el, i) => el === oldHook.deps[i]) 
            : true;

        if (hasNoDeps || hasChangedDeps) {
            queueMicrotask(() => {
                if (oldHook && typeof oldHook.cleanup === 'function') {
                    oldHook.cleanup();
                }
                const cleanup = callback();
                if (instance.hookStates[currentIndex]) {
                    instance.hookStates[currentIndex].cleanup = cleanup;
                }
            });

            instance.hookStates[currentIndex] = {
                type: 'effect',
                deps,
                cleanup: oldHook?.cleanup
            };
        }

        hookIndex++;
    }

    // Export primitives safely to global window scope
    global.createElement = createElement;
    global.render = render;
    global.useState = useState;
    global.useEffect = useEffect;

})(window);
/**
 * Application Dashboard Logic
 * Uses the custom structural reconciliation methods assigned globally.
 */

function TodoApp() {
    const [todos, setTodos] = useState(() => {
        const saved = localStorage.getItem('custom_framework_todos');
        return saved ? JSON.parse(saved) : [
            { id: 1, text: 'Build Virtual DOM core engine', completed: true },
            { id: 2, text: 'Optimize structural reconciler algorithms', completed: false }
        ];
    });
    
    const [inputValue, setInputValue] = useState('');
    const [filter, setFilter] = useState('All');

    useEffect(() => {
        localStorage.setItem('custom_framework_todos', JSON.stringify(todos));
    }, [todos]);

    const handleAddTodo = (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;
        
        const newTodo = {
            id: Date.now(),
            text: inputValue.trim(),
            completed: false
        };
        setTodos([...todos, newTodo]);
        setInputValue('');
    };

    const toggleTodo = (id) => {
        setTodos(todos.map(todo => 
            todo.id === id ? { ...todo, completed: !todo.completed } : todo
        ));
    };

    const deleteTodo = (id) => {
        setTodos(todos.filter(todo => todo.id !== id));
    };

    const clearCompleted = () => {
        setTodos(todos.filter(todo => !todo.completed));
    };

    // Drag and Drop Array Shifting Implementation
    const handleDragStart = (e, index) => {
        e.dataTransfer.setData('text/plain', index);
    };

    const handleDrop = (e, targetIndex) => {
        e.preventDefault();
        const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (sourceIndex === targetIndex) return;

        const reordered = [...todos];
        const [movedItem] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, movedItem);
        setTodos(reordered);
    };

    const handleDragOver = (e) => e.preventDefault();

    const filteredTodos = todos.filter(todo => {
        if (filter === 'Active') return !todo.completed;
        if (filter === 'Completed') return todo.completed;
        return true;
    });

    const itemsLeft = todos.filter(t => !t.completed).length;

    return createElement('div', { className: 'dashboard-container' },
        createElement('header', null,
            createElement('h1', null, '⚙️ Custom React Core'),
            createElement('p', { className: 'subtitle' }, 'Virtual DOM and Hook engine running natively')
        ),
        
        createElement('div', { className: 'todo-card' },
            createElement('form', { onSubmit: handleAddTodo, className: 'input-row' },
                createElement('input', {
                    type: 'text',
                    placeholder: 'What needs to be done?',
                    value: inputValue,
                    onInput: (e) => setInputValue(e.target.value)
                }),
                createElement('button', { type: 'submit' }, 'Add')
            ),

            createElement('div', { className: 'filter-bar' },
                createElement('button', { 
                    className: filter === 'All' ? 'active' : '', 
                    onClick: () => setFilter('All') 
                }, 'All'),
                createElement('button', { 
                    className: filter === 'Active' ? 'active' : '', 
                    onClick: () => setFilter('Active') 
                }, 'Active'),
                createElement('button', { 
                    className: filter === 'Completed' ? 'active' : '', 
                    onClick: () => setFilter('Completed') 
                }, 'Completed')
            ),

            createElement('ul', { className: 'todo-list' },
                filteredTodos.map((todo, idx) => 
                    createElement('li', {
                        key: String(todo.id),
                        className: `todo-item ${todo.completed ? 'completed' : ''}`,
                        draggable: true,
                        onDragStart: (e) => handleDragStart(e, idx),
                        onDragOver: handleDragOver,
                        onDrop: (e) => handleDrop(e, idx)
                    },
                        createElement('input', {
                            type: 'checkbox',
                            checked: todo.completed,
                            onChange: () => toggleTodo(todo.id)
                        }),
                        createElement('span', { className: 'todo-text' }, todo.text),
                        createElement('button', {
                            className: 'delete-btn',
                            onClick: () => deleteTodo(todo.id)
                        }, '✕')
                    )
                )
            ),

            createElement('footer', { className: 'todo-footer' },
                createElement('span', null, `${itemsLeft} items left`),
                createElement('button', { 
                    className: 'clear-btn', 
                    onClick: clearCompleted 
                }, 'Clear Completed')
            )
        )
    );
}

// Initializing compilation stack target setup
render(createElement(TodoApp, null), document.getElementById('app'));

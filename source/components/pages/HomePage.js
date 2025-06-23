const HomePage = (props, { getState, setState, api, juris }) => {
	const { endpoints } = api;
	const { users } = api.endpoints();
	const { data, loading, error } = users;
	//if (!data && !loading) await api.users();
	return ({
		div: {
			style: { padding: '20px' },
			children: () => [{
				h1: { text: 'Welcome Home!' }
			}, {
				div: {
					style: { marginTop: '20px' },
					children: () => [{
						h2: { text: () => `Counter: ${getState('counter', 0)}` }
					}, {
						button: {
							text: 'Increment',
							onclick: () => setState('counter', getState('counter', 0) + 1),
							style: { padding: '8px 16px', marginRight: '8px' }
						}
					}, {
						button: {
							text: 'Reset',
							onclick: () => setState('counter', 0),
							style: { padding: '8px 16px' }
						}
					}]
				}
			}]
		}
	})
}
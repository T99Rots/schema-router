class PageChangeEvent extends Event {
	constructor(newPage) {
		super('pagechange');
		this.page = newPage;
	}
}

export class Router extends EventTarget {
	constructor(routerSchema) {
		super();
		this._schema = routerSchema;

		window.addEventListener('popstate', () => {
			this.navigate(window.location.href);
		})

		document.body.addEventListener('click', e => {
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

			const anchor = e.composedPath().find(n => n.tagName === 'A');
		
			if (
				!anchor 
				|| anchor.target 
				|| anchor.hasAttribute('download') 
				|| anchor.getAttribute('rel') === 'external'
			) return;
		
			const href = anchor.href;
			if (!href || href.indexOf('mailto:') !== -1) return;
		
			const location = window.location;
			const origin = location.origin || location.protocol + '//' + location.host;
			if (href.indexOf(origin) !== 0) return;
		
			e.preventDefault();
			if (href !== location.href) this.navigate(href);
		});
	}

	navigate(path, replace) {
		console.log('aaaa');
		const newUrl = new URL(path, location.href);
		const pageObject = this.resolve(newUrl.href);
		if(location.href !== newUrl.href) {
			if(replace) {
				window.history.replaceState({}, pageObject.title || '', newUrl.href);
			} else {
				window.history.pushState({}, pageObject.title || '', newUrl.href);
			}	
		}
		this.dispatchEvent(new PageChangeEvent(pageObject));
	}

	_resolvePageObject(pageObject) {
		const resolvedObject = {...pageObject};
		for(let [property, value] of Object.entries(this._schema.default)) {
			if (!(property in resolvedObject)) resolvedObject[property] = value;
		}
		for(let [property, value] of Object.entries(resolvedObject)) {
			if(typeof value === 'function') {
				const resolvedValue = value(pageObject);
				if(typeof resolvedValue !== 'function') {
					resolvedObject[property] = resolvedValue;
				} else {
					throw new Error('The result of a schema function can\'t be a function');
				}
			};
		}
		return resolvedObject;
	}

	resolve(path) {
		const matchPathToSchema = (pathPart, schemaPart) => {
			const match = /^(:\w+)(\(.+\))?$/.exec(schemaPart);
			if(match) {
				if(match[2]) {
					const regex = new RegExp(match[1]);
					if(regex.test(pathPart)) {
						return {
							params: {
								[match[1].slice(1)]: pathPart
							},
							match: true
						}
					}
				} else {
					return {
						params: {
							[match[1].slice(1)]: pathPart
						},
						match: true
					}
				}
			} else {
				const regex = new RegExp(`^${schemaPart.replace(/[\/.*^${}|[\]\\]/g, '\\$&').replace(/(\\\*)/g, '.*')}$`);
				if(regex.test(pathPart)) {
					return {
						params: {},
						match: true
					}	
				} else {
					return {
						match: false
					}
				}
			}
		}

		const pathname = new URL(path, location.href).pathname;

		const pathParts = pathname.split('/').filter(str => str.length>0);

		const findPageObject = (schemaPages, depth = 0, baseParams = {}) => {

			console.log(schemaPages,depth);
			for(const schemaPath in schemaPages) {
				const schemaPathParts = schemaPath.split('/').filter(str => str.length>0);
				let matching = true;
				let params = {};

				for(let i = 0; i < schemaPathParts.length; i++) {
					const pathPart = pathParts[i + depth];
					const schemaPathPart = schemaPathParts[i];
					
					if(!pathPart) {
						matching = false;
						break;
					};

					const match = matchPathToSchema(pathPart, schemaPathPart);

					if(!match.match) {
						matching = false;
						break;
					} else {
						params = {...params, ...match.params};
					}
				}

				if(matching) {
					if(pathParts.length === schemaPathParts.length + depth) {
						return this._resolvePageObject({
							...schemaPages[schemaPath],
							params: {
								...params,
								...baseParams
							}
						})
					}
					if('subPages' in schemaPages[schemaPath]) {
						const resolvedPageObject = findPageObject(
							schemaPages[schemaPath].subPages,
							depth + schemaPathParts.length,
							{
								...baseParams,
								...params
							}
						)
						if(resolvedPageObject) {
							return resolvedPageObject;
						}
					}
				}
			}
		}

		let pageObject;

		if(pathParts.length < 1) {
			if('root' in this._schema) {
				pageObject = this._resolvePageObject(this._schema.root);
			}
		} else {
			if('pages' in this._schema) {
				pageObject = findPageObject(this._schema.pages);
			} else {
				throw new Error('routeSchema must have a pages property');
			}
		}

		if(!pageObject) {
			if('404' in this._schema) {
				pageObject = this._resolvePageObject(this._schema['404']);				
			} else {
				throw new Error('routeSchema must have a 404 route');
			}
		}

		return pageObject;
	}

	resolveId(id) {
		const findPageById = (pages) => {
			for(let page of Object.values(pages)) {
				if(page.id === id) return this._resolvePageObject({...page, params: {}});
				if('subPages' in page) {
					const page = findPageById(page.subPages);
					if(page) return page;	
				}
			}
		}

		if(this._schema.root && this._schema.root.id === id) return this._resolvePageObject({...this._schema.root, params: {}});
		if(this._schema['404'] && this._schema['404'].id === id) return this._resolvePageObject({...this._schema['404'], params: {}});

		return findPageById(this._schema.pages);
	}
}

export const defaultTitle = page => page.id ? page.id[0].toUpperCase() + page.id.substr(1) : 'Title not found';
export const defaultScript = page => page.id ? `${page.id}.js` : false;
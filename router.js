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
			this.navigate(window.location.href,false,true);
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
		this.navigate(window.location.href, false, true);
	}

	navigate(path, replace, force) {
		const currentLocation = window.location.href
		let newUrl = new URL(path, currentLocation);
		const pageObject = this.resolve(newUrl.href);

		if(pageObject.redirected) {
			newUrl = new URL(pageObject.redirect.target, window.location.origin);
		}

		if(currentLocation !== newUrl.href) {
			if(replace) {
				window.history.replaceState({}, pageObject.title || '', newUrl.href);
			} else {
				window.history.pushState({}, pageObject.title || '', newUrl.href);
			}
		}

		if(currentLocation !== newUrl.href || force) {
			this._activePage = pageObject;
			this.dispatchEvent(new PageChangeEvent(pageObject));
		}
	}

	_resolvePageObject(pageObject) {
		const resolvedObject = {...pageObject};
		const applyTemplate = (template) => {
			for(let [property, value] of Object.entries(template)) {
				if (!(property in resolvedObject)) resolvedObject[property] = value;
			}
		}
		if(typeof pageObject.template == 'string') {
			if(pageObject.template in this._schema.templates) {
				applyTemplate(this._schema.templates[pageObject.template])
			}
		}
		applyTemplate(this._schema.default);
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
				pageObject = this._resolvePageObject({...this._schema.root, params: {}, route: '/'});
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
				pageObject = this._resolvePageObject({...this._schema['404'],params: {}});				
			} else {
				throw new Error('routeSchema must have a 404 route');
			}
		}

		if(pageObject.redirect) {
			const resolvedPageObject = this.resolve(pageObject.redirect);
			return {
				...resolvedPageObject,
				redirected: true,
				redirect: {
					origin: pageObject.route,
					originId: pageObject.id,
					target: pageObject.redirect,
					targetId: resolvedPageObject.id
				}
			};
		}

		return pageObject;
	}

	resolveId(id) {
		const findPageById = (pages, basePath = '') => {
			for(let [route, page] of Object.entries(pages)) {
				const currentPath = basePath + route.split('/').filter(s=>s.length>0).join('/');
				if(page.id === id) return this._resolvePageObject({...page, params: {}, route: currentPath});
				if('subPages' in page) {
					const page = findPageById(page.subPages, currentPath);
					if(page) return page;	
				}
			}
		}

		if(this._schema.root && this._schema.root.id === id) return this._resolvePageObject({...this._schema.root, params: {}});
		if(this._schema['404'] && this._schema['404'].id === id) return this._resolvePageObject({...this._schema['404'], params: {}});

		return findPageById(this._schema.pages);
	}

	get activePage () {
		return this._activePage;
	}

	resolveAll() {
		const resolvePages = (pages, basePath = '') => {
			const resolvedPages = [];
			for(let [route, page] of Object.entries(pages)) {
				const currentPath = basePath + `/${route.split('/').filter(s=>s.length>0).join('/')}`;
				resolvedPages.push(this._resolvePageObject({...page, params: {}, route: currentPath}));
				if(page.subPages) resolvedPages.push(...resolvePages(page.subPages, currentPath));
			}
			return resolvedPages;
		}

		const resolvedPages = [];

		if('pages' in this._schema) {
			resolvedPages.push(...resolvePages(this._schema.pages));
		} else {
			throw new Error('routeSchema must have a pages property');
		}

		if('root' in this._schema) resolvedPages.push(this._resolvePageObject({...this._schema.root, params: {}, route: '/'}));
		if('404' in this._schema) resolvedPages.push(this._resolvePageObject({...this._schema['404'], params: {}}));

		return resolvedPages.filter(page => !page.redirect);
	}
}

export const defaultTitle = page => page.id ? page.id[0].toUpperCase() + page.id.substr(1) : 'Title not found';
export const defaultScript = page => page.id ? `${page.id}.js` : false;
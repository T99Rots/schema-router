export class Router extends EventTarget {
  static PageChangeEvent = class extends Event {
    constructor(newPage) {
      super('page-change');
      this.page = newPage;
    }
  }

  constructor(routerSchema) {
    super();

    // validate the router schema to make sure there doesn't show up any
    // unexpected behaviour or errors
    this.constructor.validateSchema(routerSchema);

    this._schema = routerSchema;
    this._activePage = {};

    const clickHandler = e => {

			const anchor = e.composedPath().find(n => n.tagName === 'A');
      
			if (
        !anchor 
				|| anchor.target 
				|| anchor.hasAttribute('download') 
				|| anchor.getAttribute('rel') === 'external'
      ) return;

      const pageId = anchor.getAttribute('page-id');
      const href = anchor.href;

      const parseParams = () => {
        let params = anchor.getAttribute('params');

        if(params) {
          params = params
            .split(';')
            .map(a => a.split(':').map(a => a.trim()))
            .reduce((previous, [name, value]) => {
              return {
                ...previous,
                [name]: value
              }
            },{})
        }
        return params || {}
      }

      if(
        e.type === 'click'
        &&!(
          e.defaultPrevented
          ||e.button !== 0
          ||e.metaKey
          ||e.ctrlKey
          ||e.shiftKey
        )
      ) {
        if(pageId) {
          try{
            this.navigateId(pageId, {params: parseParams(), strict: true});
            e.preventDefault();          
          } catch(err) {
            console.warn(err);
          }
        } else if(!href || href.indexOf('mailto:') !== -1) {
          const location = window.location;
          const origin = location.origin || location.protocol + '//' + location.host;
          if (href.indexOf(origin) !== 0) return;
          
          e.preventDefault();
          if (href !== location.href) this.navigate(href, {relative: true});
        }
      } else if(e.button !== 0 && pageId) {
        try{
          const pageObject = this.resolveId(pageId, {params: parseParams(), strict: true, page404: true});
          anchor.href = pageObject.url;
        } catch(err) {
          console.warn(err);
        }
      }
    }

    document.body.addEventListener('click', clickHandler);
    document.body.addEventListener('mousedown', clickHandler);

    window.addEventListener('popstate', () => {
      this.navigate(window.location.href);
    })

    this.navigate(window.location.href);
  }

  static validateSchema(schema) {
    const routeIds = [];

    const reservedKeywords = [
      'url',
      'redirected',
      'redirectOrigin',
      'redirectPath'
    ]

    // validate a route object to make sure it isn't missing any required properties 
    // and doesn't include and restricted properties.
    const validateRoute = (obj, keyPath, {subRoutes = true, isTemplate = false, id = true} = {}) => {
      const type = isTemplate? 'template': 'route';
      
      if(!('id' in obj) && id) throw new Error(`id missing from ${type}\n@ ${keyPath}`);
      if('subRoutes' in obj && !subRoutes) throw new Error( `you can\'t use subRoutes in templates, root or 404\n@ ${keyPath}`);
      if('templates' in obj && isTemplate) throw new Error( `you can\'t use templates in templates\n@ ${keyPath}`);
      if(routeIds.includes(obj.id)) throw new Error( `id "${obj.id}" is used more then once\n@ ${keyPath}`);

      if(obj.redirect) {
        if(['object','string','function'].includes(typeof obj.redirect)) {
          if(typeof obj.redirect === 'object' && !('id' in obj.redirect)) {
            throw new Error(`is is missing from redirect object\n@ ${keyPath}`)
          }
        } else {
          throw new Error(`redirect has to be false or typeof Object, String or Function\n@ ${keyPath}`)
        }
      }

      const restricted = Object.keys(obj).filter(key => reservedKeywords.includes(key));
      if(restricted.length > 0) throw new Error(`${type} ${obj.id} includes one or multiple restricted keywords: ${restricted.join(', ')}\n@ ${keyPath}`);
      
      routeIds.push(obj.id);
    }

    // A validation function for RouterSchema.routes
    const validateRoutes = (obj, base, conf) => {
      for(let [key, route] of Object.entries(obj)) {
        const keyPath = base+'.'+key;
        validateRoute(route, keyPath, conf);
        if('subRoutes' in route) {
          validateRoutes(route.subRoutes, keyPath);
        }
      }
    }

    // The schema must include 404 route otherwise it won't be able to handle non existing routes
    if(!('404' in schema)) throw new Error('The router schema does not include the "404" attribute');
    if(!('routes' in schema)) throw new Error('The router schema does not include the "routes" attribute');

    validateRoute(schema['404'], 'schema.404', {subRoutes: false});
    if('root' in schema) validateRoute(schema.root, 'schema.root',{subRoutes: false});
    if('default' in schema) validateRoute(schema.default, 'schema.default',{isTemplate: true, id: false});
    if('routes' in schema) validateRoutes(schema.routes, 'schema.routes');
    if('templates' in schema) validateRoutes(schema.templates, 'schema.templates',{isTemplate: true});
  }

	navigate(path, {replace = false, relative = false} = {}) {
    const currentLocation = window.location.href;
    let newUrl;

    if(relative) {
      newUrl = new URL(path, currentLocation);
    } else {
      newUrl = new URL(path, location.origin);
    }

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

    if(this._activePage.id !== pageObject.id) {
      this._activePage = pageObject;
			this.dispatchEvent(new this.constructor.PageChangeEvent(pageObject)); 
    }
  }
  
  navigateId(id, {params, replace, page404 = true}) {
    if(this._activePage.id === id) return;

    const pageObject = this.resolveId(id, {params, strict: true, page404});
    const newUrl = new URL(pageObject.url, location.origin);

    if(window.location.href !== newUrl.href) {
      if(replace) {
        window.history.replaceState({}, pageObject.title || '', newUrl.href);
      } else {
        window.history.pushState({}, pageObject.title || '', newUrl.href);
      }
    }

    this._activePage = pageObject;
    this.dispatchEvent(new this.constructor.PageChangeEvent(pageObject)); 
  }

	_resolvePageObject(pageObject, {redirect = true} = {}) {
    // if redirect is enabled resolve the redirect argument of the pageObject
    if(redirect && pageObject.redirect) {
      if(typeof pageObject.redirect === 'function') {
        redirect = pageObject.redirect();
      }
      if(
        typeof redirect === 'string'
        || typeof redirect === 'object'
        || pageObject.redirect === false
      ) {
        redirect = pageObject.redirect;
      } else {
        throw new Error(`A redirect function has to return a string, object or false\n@ ${pageObject.id}`);
      }
    } else {
      redirect = false;
    }
    
    // when redirect is enabled resolve the route the redirect is pointing to instead of
    // the pageObject passed on as an argument
    if(redirect) {
      let resolvedObject;
      if(typeof redirect === 'object') {
        if(!('id' in redirect)) throw new Error(`Redirect id is missing\n@ ${pageObject.id}`);
        resolvedObject = this.resolveId(redirect.id, {
          params: redirect.params,
          strict: true
        });
      } else {
        resolvedObject = this.resolve(redirect);
      } 
      resolvedObject.redirected = true;
      resolvedObject.redirectOrigin = {
        url: pageObject.url,
        id: pageObject.id
      }
      if('redirectPath' in resolvedObject) {
        resolvedObject.redirectPath = {
          urls: [resolvedObject.redirectPath.urls, pageObject.url],
          urls: [resolvedObject.redirectPath.ids, pageObject.id]
        }
      } else {
        resolvedObject.redirectPath = {
          urls: [pageObject.url],
          ids: [pageObject.id]
        }
      }
      return resolvedObject;
    }
    
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

	resolve(path, {redirect} = {}) {
		const matchPathToSchema = (pathPart, schemaPart) => {
			const match = /^(:\w+)(\((.+)\))?$/.exec(schemaPart);
			if(match) {
				if(match[3]) {
					const regex = new RegExp(match[3]);
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

		const pathname = `/${new URL(path, location.href).pathname.replace(/(^\/+)?((?<=\/)\/+)?(\/+$)?/g,'')}`;
		const pathParts = pathname.split('/').filter(str => str.length>0);

		const findRouteObject = (schemaRoutes, depth = 0, baseParams = {}) => {

			for(const schemaPath in schemaRoutes) {
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
							...schemaRoutes[schemaPath],
							params: {
								...params,
								...baseParams
              },
              url: pathname
						}, {redirect})
					}
					if('subRoutes' in schemaRoutes[schemaPath]) {
						const resolvedPageObject = findRouteObject(
							schemaRoutes[schemaPath].subRoutes,
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
				pageObject = this._resolvePageObject({...this._schema.root, params: {}, url: '/'}, {redirect});
			}
		} else {
			if('routes' in this._schema) {
				pageObject = findRouteObject(this._schema.routes);
			} else {
				throw new Error('routeSchema must have a routes property');
			}
    }

		if(!pageObject) {
			if('404' in this._schema) {
				pageObject = this._resolvePageObject({...this._schema['404'],params: {}, url: pathname}, {redirect});				
			} else {
				throw new Error('routeSchema must have a 404 route');
			}
		}
		return pageObject;
	}

	resolveId(id, {params = {}, strict = false, redirect, page404 = false} = {}) {
		const findRouteById = (routes) => {
			for(let [path, route] of Object.entries(routes)) {

        // resolving variable path parameters
        const resolvePath = () => {
          const pathParts = path.split('/').filter(str => str.length>0);

          for(let i = 0; i < pathParts.length; i++) {
            pathParts[i] = pathParts[i].replace(/(^\/+)?((?<=\/)\/+)?(\/+$)?/g,'');
            const match = /^:(\w+)(\(.*\))?$/.exec(pathParts[i]);

            if(match) {
              if(match[1] in params) {
                pathParts[i] = params[match[1]];
              } else if(strict) {
                throw new Error(`variable path parameter ${match[1]} is missing while resolving id in strict mode`)
              }
            }
          }
          return '/' + pathParts.join('/');
        }

				if(route.id === id) return {...route, params, url: resolvePath()};

        if('subRoutes' in route) {
					const resolvedRoute = findRouteById(route.subRoutes);
					if(resolvedRoute) {
            return {
              ...resolvedRoute,
              url: resolvePath()+resolvedRoute.url
            }
          };	
				}
			}
		}

    let pageObject = findRouteById(this._schema.routes);

		if(this._schema.root && this._schema.root.id === id) pageObject = {...this._schema.root, params, url: '/'};
		if(this._schema['404'] && (this._schema['404'].id === id || (page404 && !pageObject))) {
      if(!strict || page404) {
        pageObject = {
          ...this._schema['404'],
          params,
          url: '/' + (this._schema['404'].path.replace(/(^\/+)?((?<=\/)\/+)?(\/+$)?/g,'') || 'not_found')
        };
      } else {
        throw new Error('Can\'t resolve 404 page url in strict mode')
      }
    }
    if(pageObject) {
      return this._resolvePageObject(pageObject, {redirect});
    } else {
      throw new Error(`No page with id ${id}`);
    }
	}

	get activePage () {
		return this._activePage;
	}

	resolveAll() {
		const resolveRoutes = (routes, basePath = '') => {
			const resolvedRoutes = [];
			for(let [path, route] of Object.entries(routes)) {
				const currentPath = basePath + `/${path.replace(/(^\/+)?((?<=\/)\/+)?(\/+$)?/g,'')}`;
				resolvedRoutes.push(this._resolvePageObject({...route, params: {}, url: currentPath},{redirect: false}));
				if(route.subRoutes) resolvedRoutes.concat(resolveRoutes(route.subRoutes, currentPath));
			}
			return resolvedRoutes;
		}

		const resolvedRoutes = [];

		if('routes' in this._schema) {
			resolvedRoutes.push(...resolveRoutes(this._schema.routes));
		} else {
			throw new Error('routeSchema must have a routes property');
		}

		if('root' in this._schema) resolvedRoutes.push(
      this._resolvePageObject({...this._schema.root, params: {}, route: '/'},{redirect: false})
    );

		if('404' in this._schema) resolvedRoutes.push(
      this._resolvePageObject({
        ...this._schema['404'],
        params: {},
        url: '/' + (this._schema['404'].path.replace(/(^\/+)?((?<=\/)\/+)?(\/+$)?/g,'') || 'not_found')
      },{redirect: false})
    );

		return resolvedRoutes.filter(route => !route.redirect);
	}
}

export const defaultTitle = route => route.id ? route.id[0].toUpperCase() + route.id.substr(1) : 'Title not found';
export const defaultScript = route => route.id ? `${route.id}.js` : false;
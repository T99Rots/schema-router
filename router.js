let instance;

export class Router extends EventTarget {
  constructor(routerSchema) {
    super();
    const $this = this;

    // Make sure there won't be more then one instance of Router running
    // as this will cause interference with other instances 
    if(instance) {
      throw new Error('There already is a instance of Router on this page');
    }

    instance = this;

    // validate the router schema to make sure there doesn't show up any
    // unexpected behaviour or errors
    this.constructor.validateSchema(routerSchema);

    this._schema = routerSchema;
    this._activePage = {};

    if(routerSchema.basePath) {
      this._basePath = new URL(routerSchema.basePath, location.origin).pathname;
    } else {
      const baseElement = document.getElementsByTagName('base')[0];
      if(baseElement) {
        this._basePath = new URL(baseElement.href).pathname || false;
      } else {
        this._basePath = false;
      }
    }

    document.body.addEventListener('click',  e => {

			if (e.defaultPrevented || e.button !== 0 ||
        e.metaKey || e.ctrlKey || e.shiftKey) return;

      const anchor = e.composedPath().filter(n => n.tagName === 'A')[0];
      
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

      if(href !== location.href) this.navigate(href);
    });

    window.addEventListener('popstate', () => {
      this.navigate(window.location.href);
    })

    this.navigate(window.location.href);

    this.RouterLink = class extends HTMLElement {

      static get observedAttributes() {
        return ['page-id','params'];
      }
    
      constructor() {
        super();
        this._anchor = document.createElement('a');
        const shadow = this.attachShadow({mode: 'open'});
        const styles = document.createElement('style');
        shadow.appendChild(document.createElement('slot'));
        styles.innerHTML = /*css*/ `
          :host {
            display: inline;
            text-decoration: underline;
            color: rgb(0,0,238); 
            position: relative;
          }
          a {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: inherit;
            display: inherit;
            @apply --anchor-mixin;
          }
        `
        shadow.appendChild(styles);
        shadow.appendChild(this._anchor);
        this._params = {};
        this._resetParamsProxy();
        this.pageId = this.getAttribute('page-id');
        this.params = this._parseParams(this.getAttribute('params'));
        this._update();
      }

      _resetParamsProxy() {
        if(this._paramsProxy) this._paramsProxy.revoke();
        this._paramsProxy = Proxy.revocable(this._params, {
          set: (obj, key, val) => {
            if(typeof val !== 'string') throw new Error('A parameter must be a string');
            obj[key] = val;
            this._scheduleUpdate();
          }
        });
      }

      _parseParams(params) {
        if(params) {
          try {
            return JSON.parse(params);
          } catch (e) {
            return params
            .split(';')
            .map(a => a.split(':').map(a => a.trim()))
            .reduce((previous, [name, value]) => {
              return {
                ...previous,
                [name]: value
              }
            },{})
          }
        }
      }
    
      attributeChangedCallback(name, oldVal, newVal) {
        if(oldVal === newVal) return;
        if(name === 'page-id') {
          this.pageId = newVal;
        } else if(name === 'params') {
          this.params = this._parseParams(newVal);
        }
      }
    
      _scheduleUpdate() {
        if(this._updateScheduled) return;
        this._updateScheduled = true;
        requestAnimationFrame(() => {
          this._updateScheduled = false;
          this._update()
        });
      } 

      _update() {
        if(!this.pageId) return;
        
        try {
          const pageObject = $this.resolveId(this.pageId, {
            redirect: false,
            params: this._params || {},
            page404: true
          });
      
          this._anchor.href = pageObject.url;
        } catch (err){
          console.warn(err);
        }
      }
      
      get anchor() {
        return this._anchor;
      }

      get pageId() {
        return this._pageId;
      }
    
      set pageId(newVal) {
        if(typeof newVal !== 'string') return;
        this._pageId = newVal;
        this._update();
      }
    
      get params() {
        return this._paramsProxy.proxy;
      }
    
      set params(newVal) {
        if(typeof newVal !== 'object') return;
        for(const [key, value] of Object.entries(newVal)) {
          if(typeof value !== 'string') return;
          if(key in this._params) {
            if(value !== this._params[key]) {
              this._params = newVal;
              this._resetParamsProxy();
              this._update();
              return;
            }
          } else {
            this._params = newVal;
            this._resetParamsProxy();
            this._update();
            return;
          }
        }
      }
    }

    window.customElements.define('router-link', this.RouterLink);
  }

  static validateSchema(schema) {
    const routeIds = [];

    const reservedKeywords = [
      'url',
      'redirected',
      'redirectOrigin',
      'redirectPath',
      'depth',
      'parentId',
      'searchParams'
    ]

    // validate a route object to make sure it isn't missing any required properties 
    // and doesn't include and restricted properties.
    const validateRoute = (obj, keyPath, {subRoutes = true, isTemplate = false, id = true} = {}) => {
      const type = isTemplate? 'template': 'route';
      
      if(typeof obj !== 'object') throw new Error(`A page has to be a object\n@ ${keyPath}`)
      if(!('id' in obj) && id) throw new Error(`id missing from ${type}\n@ ${keyPath}`);
      if(id && routeIds.includes(obj.id)) throw new Error( `id "${obj.id}" is used more then once\n@ ${keyPath}`);
      if('subRoutes' in obj && !subRoutes) throw new Error( `you can\'t use subRoutes in templates, root or 404\n@ ${keyPath}`);
      if('templates' in obj && isTemplate) throw new Error( `you can\'t use templates in templates\n@ ${keyPath}`);

      if(obj.redirect) {
        if(['object','string','function'].includes(typeof obj.redirect)) {
          if(typeof obj.redirect === 'object' && !('id' in obj.redirect)) {
            throw new Error(`id is missing from redirect object\n@ ${keyPath}`)
          }
        } else {
          throw new Error(`redirect has to be false or typeof Object, String or Function\n@ ${keyPath}`)
        }
      }

      const restricted = Object.keys(obj).filter(key => reservedKeywords.includes(key));
      if(restricted.length > 0) throw new Error(`${type} ${obj.id} includes one or multiple restricted keywords: ${restricted.join(', ')}\n@ ${keyPath}`);
      
      if(id) routeIds.push(obj.id);
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

    if(
      'basePath' in schema
      &&typeof schema.basePath !== 'string'
      &&schema.basePath !== false
    ) throw new Error('The basePath has to be either a string or false');

    validateRoute(schema['404'], 'schema.404', {subRoutes: false});
    if('root' in schema) validateRoute(schema.root, 'schema.root',{subRoutes: false});
    if('default' in schema) validateRoute(schema.default, 'schema.default',{isTemplate: true, id: false});
    if('routes' in schema) validateRoutes(schema.routes, 'schema.routes');
    if('templates' in schema) validateRoutes(schema.templates, 'schema.templates',{isTemplate: true, id: false});
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
      newUrl = new URL(pageObject.url, window.location.origin);
    }

    if(currentLocation !== newUrl.href) {
      if(replace) {
        window.history.replaceState({}, pageObject.title || '', newUrl.href);
      } else {
        window.history.pushState({}, pageObject.title || '', newUrl.href);
      }
    }

    this._activePage = pageObject;
    this.dispatchEvent(new this.constructor.PageChangeEvent(pageObject)); 
  }
  
  navigateId(id, {params, replace, page404 = true, searchParams} = {}) {
    const pageObject = this.resolveId(id, {params, strict: true, page404, searchParams});
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
    //apply all templates to a copy of the pageObject 
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

    // if redirect is enabled resolve the redirect argument of the resolvedObject
    if(redirect && resolvedObject.redirect) {
      let redirectLink;
      if(typeof resolvedObject.redirect === 'function') {
        redirectLink = resolvedObject.redirect(pageObject);
        resolvedObject.redirect = redirectLink;
      } else {
        redirectLink = resolvedObject.redirect;
      }
      if(
        typeof redirectLink === 'string'
        || typeof redirectLink === 'object'
        || redirectLink === false
      ) {
        redirect = redirectLink;
      } else {
        throw new Error(`A redirect function has to return a string, object or false\n@ ${resolvedObject.id}`);
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
        resolvedObject = this.resolve(redirect, {basePathIncluded: false});
      } 
      resolvedObject.redirected = true;
      resolvedObject.redirectOrigin = {
        url: pageObject.url,
        id: pageObject.id
      }
      if('redirectPath' in resolvedObject) {
        resolvedObject.redirectPath = {
          urls: [...resolvedObject.redirectPath.urls, pageObject.url],
          ids: [...resolvedObject.redirectPath.ids, pageObject.id]
        }
      } else {
        resolvedObject.redirectPath = {
          urls: [pageObject.url],
          ids: [pageObject.id]
        }
      }
      return resolvedObject;
    }
    
    // resolve the value of all router function properties
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

	resolve(path, {redirect, basePathIncluded = true} = {}) {
		const matchPathToSchema = (pathPart, schemaPart) => {
			const match = /^(:\w+)(\((.+)\))?$/.exec(schemaPart);
			if(match) {
				if(match[3]) {
					const regex = new RegExp(match[3]);
					if(regex.test(pathPart)) {
						return {
							params: {
								[match[1].slice(1)]: decodeURIComponent(pathPart)
							},
							match: true
						}
					} else {
            return {
              match: false
            }
          }
				} else {
					return {
						params: {
							[match[1].slice(1)]: decodeURIComponent(pathPart)
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

    const pathToPathParts = path => path.split('/').filter(str => str.length>0);

    const url = new URL(path, location.href);
    let pathname = `${url.pathname.replace(/\/+/g,'/')}`;
    let pathParts;
    let searchParams = {};

    url.searchParams.forEach((value, key) => {
      searchParams[key] = value;
    })

    if(this._basePath) {
      if(basePathIncluded) {
        const base = this._basePath.replace(/\/[^/]*$/, '');
        if(pathname.startsWith(base)) {
          pathParts = pathToPathParts(pathname.slice(base.length));
        } else {
          pathParts = pathToPathParts(pathname);
        }
      } else {
        pathParts = pathToPathParts(pathname);
        pathname = new URL(pathname.replace(/^\//,''), new URL(this._basePath, location.origin)).pathname
      }
    } else {
      pathParts = pathToPathParts(pathname);
    }

		const findRouteObject = (schemaRoutes, depth = 0, baseParams = {}, parentId = null) => {

			for(const schemaPath in schemaRoutes) {
				const schemaPathParts = pathToPathParts(schemaPath);
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
              depth,
              parentId,
							params: {
								...params,
								...baseParams
              },
              searchParams,
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
              },
              schemaRoutes[schemaPath].id
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
				pageObject = this._resolvePageObject({
          ...this._schema.root,
          params: {},
          searchParams,
          url: '/',
          depth: 0,
          parentId: null
        }, {redirect});
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
				pageObject = this._resolvePageObject({
          ...this._schema['404'],
          params: {},
          searchParams: {},
          url: pathname,
          parentId: null,
          depth: 0
        }, {redirect});				
			} else {
				throw new Error('routeSchema must have a 404 route');
			}
		}
		return pageObject;
	}

	resolveId(id, {params = {}, strict = false, redirect, page404 = false, searchParams} = {}) {
		const findRouteById = (routes, depth = 0, parentId = null) => {
			for(let [path, route] of Object.entries(routes)) {

        // resolving variable path parameters
        const resolvePath = () => {
          const pathParts = path.split('/').filter(str => str.length>0);

          for(let i = 0; i < pathParts.length; i++) {
            pathParts[i] = pathParts[i].replace(/\/+/g,'/');
            const match = /^:(\w+)(\(.*\))?$/.exec(pathParts[i]);

            if(match) {
              if(match[1] in params) {
                pathParts[i] = params[match[1]];
              } else if(strict) {
                throw new Error(`variable path parameter ${match[1]} is missing while resolving id in strict mode`)
              }
            }
          }
          return '/' + pathParts.map(pathPart => encodeURIComponent(pathPart)).join('/');
        }

				if(route.id === id) {
          const finalRoute = {
            ...route,
            params,
            depth,
            parentId,
            url: resolvePath(),
            searchParams: {...searchParams}
          };

          if(searchParams) {
            const searchParamsObj = new URLSearchParams();

            for(const [key, value] of Object.entries(searchParams)) {
              if(value !== undefined && value !== null) searchParamsObj.set(key, value);
            }

            finalRoute.url+= `?${searchParamsObj.toString()}`
          }

          return finalRoute;
        }

        
        if('subRoutes' in route) {
          const resolvedRoute = findRouteById(route.subRoutes, depth + 1, route.id);
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

		if(this._schema.root && this._schema.root.id === id) pageObject = {
      ...this._schema.root,
      depth: 0,
      parentId: null,
      params,
      searchParams: {},
      url: '/'
    };
		if(this._schema['404'] && (this._schema['404'].id === id || (page404 && !pageObject))) {
      if(!strict || page404) {
        pageObject = {
          ...this._schema['404'],
          depth: 0,
          parentId: null,
          params,
          searchParams: {},
          url: '/' + (this._schema['404'].path? this._schema['404'].path.replace(/\/+/g,'/'): 'not_found')
        };
      } else {
        throw new Error('Can\'t resolve 404 page url in strict mode')
      }
    }
    if(pageObject) {
      if(this._basePath) {
        pageObject.url = new URL(pageObject.url.replace(/^\//,''), new URL(this._basePath, location.origin)).pathname
      }  
      return this._resolvePageObject(pageObject, {redirect});
    } else {
      throw new Error(`No page with id ${id}`);
    }
  }
  
  setSearchParams (searchParams, {
    replace,
    page404 = true
  } = {}) {
    if(typeof searchParams !== 'object') return;
    const searchEntries = Object.entries(searchParams);
    if(Object.keys(this._activePage.searchParams).length === searchEntries.length) {
      const index = searchEntries.findIndex(([key, val]) => this._activePage.searchParams[key] !== val);
      if(index === -1) return;
    }

    this.navigateId(this._activePage.id, {
      params: this._activePage.params,
      replace,
      page404,
      searchParams
    })
  }

  updateSearchParams (searchParams = {}, options) {
    this.setSearchParams({
      ...this._activePage.searchParams,
      ...searchParams
    }, options);
  }

	get activePage () {
		return this._activePage;
	}

	resolveAll() {
		const resolveRoutes = (routes, basePath = '', depth = 0, parentId = null) => {
			const resolvedRoutes = [];
			for(let [path, route] of Object.entries(routes)) {
				const currentPath = basePath + `/${path.replace(/\/+/g,'/')}`;
				resolvedRoutes.push(this._resolvePageObject({
          ...route,
          params: {},
          searchParams: {},
          url: currentPath,
          depth,
          parentId
        },{redirect: false}));
				if(route.subRoutes) resolvedRoutes.push(...resolveRoutes(route.subRoutes, currentPath, depth + 1, route.id));
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
      this._resolvePageObject({
        ...this._schema.root,
        params: {},
        searchParams: {},
        route: '/',
        parentId: null,
        depth: 0
      },{redirect: false})
    );

		if('404' in this._schema) resolvedRoutes.push(
      this._resolvePageObject({
        ...this._schema['404'],
        params: {},
        searchParams: {},
        url: '/' + (
          typeof this._schema['404'].path === 'string'
          ? this._schema['404'].path.replace(/\/+/g,'/')
          : 'not_found'
        ),
        depth: 0,
        parentId: null
      },{redirect: false})
    );

    return resolvedRoutes;
  }
  
  get basePath () {
    return this._basePath;
  }
}

Router.PageChangeEvent = class extends Event {
  constructor(newPage) {
    super('page-change');
    this.page = newPage;
  }
}
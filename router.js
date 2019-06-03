import EventTarget from './node_modules/event-target-shim/dist/event-target-shim.mjs';

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
        this._anchor.appendChild(document.createElement('slot'));
        const shadow = this.attachShadow({mode: 'open'});
        const styles = document.createElement('style');
        styles.innerHTML = /*css*/ `
          :host {
            display: inline;
            text-decoration: underline;
            color: rgb(0,0,238); 
          }
          a {
            color: inherit;
            display: inherit;
            text-decoration: inherit;
            width: 100%;
            height: 100%;
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
      'redirectPath'
    ]

    // validate a route object to make sure it isn't missing any required properties 
    // and doesn't include and restricted properties.
    const validateRoute = (obj, keyPath, {subRoutes = true, isTemplate = false, id = true} = {}) => {
      const type = isTemplate? 'template': 'route';
      
      if(!('id' in obj) && id) throw new Error(`id missing from ${type}\n@ ${keyPath}`);
      if('subRoutes' in obj && !subRoutes) throw new Error( `you can\'t use subRoutes in templates, root or 404\n@ ${keyPath}`);
      if('templates' in obj && isTemplate) throw new Error( `you can\'t use templates in templates\n@ ${keyPath}`);
      if(id && routeIds.includes(obj.id)) throw new Error( `id "${obj.id}" is used more then once\n@ ${keyPath}`);

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
  
    console.log(pageObject);

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
  
  navigateId(id, {params, replace, page404 = true}) {
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
      let redirectLink;
      if(typeof pageObject.redirect === 'function') {
        redirectLink = pageObject.redirect();
      } else {
        redirectLink = pageObject.redirect;
      }
      if(
        typeof redirectLink === 'string'
        || typeof redirectLink === 'object'
        || redirectLink === false
      ) {
        redirect = redirectLink;
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
          ids: [resolvedObject.redirectPath.ids, pageObject.id]
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

		const pathname = `${new URL(path, location.href).pathname.replace(/\/+/g,'/')}`;
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
          url: '/' + (this._schema['404'].path? this._schema['404'].path.replace(/\/+/g,'/'): 'not_found')
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
				const currentPath = basePath + `/${path.replace(/\/+/g,'/')}`;
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
        url: '/' + (
          typeof this._schema['404'].path === 'string'
          ? this._schema['404'].path.replace(/\/+/g,'/')
          : 'not_found'
        )
      },{redirect: false})
    );

    return resolvedRoutes;
	}
}

Router.PageChangeEvent = class extends Event {
  constructor(newPage) {
    super('page-change');
    this.page = newPage;
  }
}
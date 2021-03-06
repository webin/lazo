define(['underscore', 'backbone', 'utils/template', 'resolver/main', 'flexo', 'renderer', 'l!viewManager', 'uiStateMixin', 'utils/uniqueId'],
    function (_, Backbone, template, resolver, flexo, renderer, viewManager, uiStateMixin, uniqueId) {

    'use strict';

    var viewOptions = [
        'model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events',
        'ctl', 'cid', 'template', 'name', 'render', 'templateEngine', 'templatePath', 'ref',
        'basePath', 'isBase', 'hasTemplate', 'getInnerHtml', 'compiledTemplatePath', 'viewDefinitions',
        'getTemplate', 'itemViewOptions', 'itemView', 'itemViews', 'emptyView', 'emptyViews'
    ];

    return _.extend({

        hasTemplate: false,

        templateEngine: 'handlebars',

        eventNameSpace: 'lazo:view',

        attributeNameSpace: 'lazo',

        render: function (options) {
            if (this.isServer) {
                throw 'view, ' + this.name + ', attempted to call render on the server.';
            }
            var self = this;

            renderer.getTreeHtml(this.ctl, this.cid, 'view', function (html) {
                viewManager.cleanup(self.ctl);
                self.ctl._getEl().html(html);
                self.trigger(self.eventNameSpace + ':rendered', self);
                viewManager.attachViews(self.ctl, function (err, result) {
                    if (err && options && _.isFunction(options.error)) {
                        return options.error(err);
                    }
                    if (options && _.isFunction(options.success)) {
                        options.success(html);
                    }
                });
            });

            return this;
        },

        getWidgetByEl: function (el) {
            var widgets = this._getWidgetInstances(this);

            for (var k in widgets) {
                for (var i = 0; i < widgets[k].length; i++) {
                    if (widgets[k][i].el === el) {
                        return widgets[k][i];
                    }
                }
            }
        },

        getWidgetsByName: function (name) {
            var widgets = this._getWidgetInstances(this);
            return widgets[name] || [];
        },

        getAttributes: function () {
            var keys;
            var val;
            var retVal = {};
            var attributes = {
                'lazo-view-name': 'name',
                'lazo-view-id': 'cid',
                'lazo-model-name': 'model.name',
                'lazo-model-id': 'model.cid',
                'lazo-collection-name': 'collection.name',
                'lazo-collection-id': 'collection.cid'
            };

            for (var k in attributes) {
                val = this;
                keys = attributes[k].split('.');
                for (var i = 0; i < attributes[k].length; i++) {
                    if (!(val = val[keys[i]])) {
                        delete attributes[k];
                        break;
                    } else {
                        retVal[k] = val;
                    }
                }
            }

            return retVal;
        },

        getExclusions: function () {
            return { ctl: true, $el: true, el: true, parent: true, options: true }; // properties that are not serialized
        },

        serializeData: function (options) { // serialize data for rendering
            var data = _.extend(this._serialize(this.ctl.ctx, this.getExclusions()), this._serialize(this, this.getExclusions()));
            this.transformData(data, options);
        },

        augment: function (options) {
            // TODO: temporary work around for nested collections
            options.collection = this.collection || options.collection;
            _.extend(this, _.pick(options, viewOptions));
        },

        getTemplateEngine: function (options) {
            var engineName = this.templateEngine;

            template.loadTemplateEngine({
                name: engineName,
                handler: template.engHandlerMaker(engineName),
                exp: null,
                extension: template.getDefaultExt(engineName)
            }, {
                error: function (err) {
                    options.error(err);
                },
                success: function (engine) {
                    options.success(engine);
                }
            });
        },

        getRenderer: function (options) {
            var self = this;

            if (this.renderer) {
                return options.success(this.renderer);
            }

            this.getTemplateEngine({
                error: options.error,
                success: function (engine) {
                    self.renderer = engine;

                    self.getTemplate({
                        error: options.error,
                        success: function (template) {
                            var compiledTemplate = engine.compile(template);
                            self.template = template;

                            self.renderer = function (context, options) {
                                options.success(compiledTemplate(context));
                            };

                            options.success(self.renderer);
                        }
                    });
                }
            });
        },

        getTemplate: function (options) {
            var self = this;
            this.templatePath =  this.templatePath || resolver.getTemplatePath(this);

            LAZO.require(['text!' + self.templatePath], function (template) {
                self.hasTemplate = true;
                options.success(template);
            }, function (err) {
                options.error(err);
            });
        },

        loadChild: function (viewName, options) {
            this._loadView(viewName, {
                error: options.error,
                success: function (View) {
                    options.success(View);
                }
            });
        },

        resolveChild: function (viewName, options) {
            var self = this;
            self.getChildren({
                success: function (views) {
                    var viewNameVal = views[viewName];
                    if (!viewNameVal) {
                        options.error(new Error('Could not resolve child view, ' + viewName));
                    }

                    viewNameVal = _.isObject(viewNameVal) && viewNameVal.cid ? viewNameVal.name : viewNameVal;
                    self.loadChild(viewNameVal, {
                        error: options.error,
                        success: function (View) {
                            self.children = self.children || {};
                            var view = self.children[viewName] = new View(self.getChildOptions({
                                name: viewNameVal
                            }));
                            options.success(view);
                        }
                    });
                },
                error: options.error
            });
        },

        getChildOptions: function (options) {
            return this._getChildOptions(_.extend({
                ctl: this.ctl,
                ref: this.ctl._getPath(options.name, 'view'),
                baseBath: this.ctl._getBasePath(options.name, 'view'),
                cid: uniqueId('view')
            }, options));
        },

        getChildren: function (options) {
            if (!this.viewDefinitions) {
                this.viewDefinitions = _.result(this, 'viewDefinitions', {});
            }

            options.success(this.viewDefinitions);
        },

        attachChildren: function (options) {
            var $views = this.$('[lazo-view-name]');
            var self = this;
            var $viewContainers;

            function isDone() {
                attached++;
                if (attached >= expected) {
                    self.trigger(self.eventNameSpace + ':children:attached', self);
                    options.success(true);
                }
            }

            // get child view containers that are direct descendants of view
            $viewContainers = this.$('[lazo-view]').filter(function () {
                var childViewContainerNode = this;
                var directDescendantOfSelf = true;
                $views.each(function () {
                    if ($.contains(this, childViewContainerNode)) {
                        directDescendantOfSelf = false;
                        return false;
                    }
                });

                return directDescendantOfSelf;
            });

            var expected = $viewContainers.length;
            var attached = 0;
            this.attachWidgets({
                success: isDone,
                error: options.error
            });

            $viewContainers.each(function () {
                var $container = $(this);
                var viewName = $container.attr('lazo-view');
                if (!viewName) {
                    return options.error(new Error('View ' + self.name + ' child [lazo-view="' + viewName + '"] is empty'));
                }

                self.resolveChild(viewName, {
                    error: options.error,
                    success: function (view) {
                        // wait for widgets
                        view.once(view.eventNameSpace + ':children:attached', function (view) {
                            view.afterRender();
                        });
                        view.attach($container.find('> [lazo-view-name]')[0], {
                            error: options.error,
                            success: isDone
                        });
                    }
                });
            });
        },

        _serialize: function (obj, exceptions) { // serialize an object
            var data = {};

            var serializeModelCollection = function (morc) {
                var obj;
                if (morc instanceof Backbone.Collection) {
                    obj = morc.map(function (model) {
                        var o = model.toJSON();
                        if (model.id) {
                            o.id = model.id;
                        }
                        return o;
                    });
                }
                else {
                    obj = morc.toJSON();
                    if (morc.id) {
                        obj.id = morc.id;
                    }
                }
                return obj;
            };

            var addChildren = function (data, mdl) {
                for (var i = 0, il = mdl._childNames.length; i < il; i++) {
                    var name = mdl._childNames[i];
                    if (mdl[name].toJSON) {
                        data[name] = serializeModelCollection(mdl[name]);
                    }
                    else {
                        data[name] = mdl[name];
                    }

                    if (mdl[name]._childNames) {
                        addChildren(data[name], mdl[name]);
                    }
                }
            };

            for (var k in obj) { // do not use _.each; it uses hasOwnProp;
                if (!exceptions[k] && !_.isFunction(obj[k])) {
                    if (k === 'models' || k === 'collections') { // serialize the models and collections from ctl.ctx
                        data[k] = {};
                        for (var j in obj[k]) {
                            if (obj[k][j].toJSON) {
                                data[k][j] = serializeModelCollection(obj[k][j]);
                            } else {
                                data[k][j] = obj[k][j];
                            }

                            if (obj[k][j]._childNames) {   // serialize parsed sub models and collections
                                addChildren(data[k][j], obj[k][j]);
                            }
                        }
                    } else if (obj[k] instanceof Backbone.Collection || obj[k] instanceof Backbone.Model) {
                        data[k] = serializeModelCollection(obj[k]);
                    } else {
                        data[k] = obj[k];
                    }
                }
            }

            if (obj._rootCtx) {
                data.crumb = obj.getCookie('crumb');
                // work around; need to define a better way of serializing assets and other objects
                // for rendering
                data.assets = _.clone(data.assets);
                data.assets.app = {};
                _.extend(data.assets.app, _.clone(LAZO.app.assets));
                _.extend(data, obj._rootCtx.data);
            }

            return data;
        },

        _loadView: function (viewName, options) {
            LAZO.require([resolver.getPath(viewName, this.ctl.name, 'view')], function (View) {
                options.success(View);
            },
            function (err) {
                options.error(err);
            });
        },

        _getAttributes: function () {
            var self = this;
            var attrs = flexo.View.prototype._getAttributes.call(this);
            attrs.class = attrs.class || '';

            if (this._uiStates) {
                attrs.class += _.reduce(this._uiStates, function (memo, state) {
                    return memo + (memo.length ? ' ' : '') + self._getStateClass(state);
                }, attrs.class);
            }

            attrs.class += (attrs.class.length ? ' ' : '' + self._getStateClass('detached'));

            return attrs;
        }

    }, uiStateMixin);
});
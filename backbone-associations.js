//
//  Backbone-associations.js 0.4.2
//
//  (c) 2013 Dhruva Ray, Jaynti Kanani, Persistent Systems Ltd.
//  Backbone-associations may be freely distributed under the MIT license.
//  For all details and documentation:
//  https://github.com/dhruvaray/backbone-associations/
//

// Initial Setup
// --------------
(function (root) {
    "use strict";

    // Save a reference to the global object (`window` in the browser, `exports`
    // on the server).
    var root = this;

    // The top-level namespace. All public Backbone classes and modules will be attached to this.
    // Exported for the browser and CommonJS.
    var _, Backbone, BackboneModel, BackboneCollection, ModelProto,
        CollectionProto, defaultEvents, AssociatedModel, pathChecker;

		var _ = root._ || require('underscore');
		var Backbone = root.Backbone || require('backbone');
    
    // Create local reference `Model` prototype.
		function extendBackbone(Backbone) {
			BackboneModel = Backbone.Model;
			BackboneCollection = Backbone.Collection;
			ModelProto = BackboneModel.prototype;
			CollectionProto = BackboneCollection.prototype;
			pathChecker = /[\.\[\]]+/g;

			// Built-in Backbone `events`.
			defaultEvents = ["change", "add", "remove", "reset", "destroy",
					"sync", "error", "sort", "request"];

			// Backbone.AssociatedModel
			// --------------

			//Add `Many` and `One` relations to Backbone Object.
			Backbone.Many = "Many";
			Backbone.One = "One";
			// Define `AssociatedModel` (Extends Backbone.Model).
			AssociatedModel = Backbone.AssociatedModel = BackboneModel.extend({
					// Define relations with Associated Model.
					relations:undefined,
					// Define `Model` property which can keep track of already fired `events`,
					// and prevent redundant event to be triggered in case of cyclic model graphs.
					_proxyCalls:undefined,

					// Get the value of an attribute.
					get:function (attr) {
							var obj = ModelProto.get.call(this, attr);
							return obj ? obj : this.getAttr.apply(this, arguments);
					},

					// Set a hash of model attributes on the Backbone Model.
					set:function (key, value, options) {
							var attributes, attr, modelMap, modelId, obj, result = this;
							// Duplicate backbone's behavior to allow separate key/value parameters,
							// instead of a single 'attributes' object.
							if (_.isObject(key) || key == null) {
									attributes = key;
									options = value;
							} else {
									attributes = {};
									attributes[key] = value;
							}
							if (!attributes) return this;
							for (attr in attributes) {
									//Create a map for each unique object whose attributes we want to set
									modelMap || (modelMap = {});
									if (attr.match(pathChecker)) {
											var pathTokens = getPathArray(attr), initials = _.initial(pathTokens),
													last = pathTokens[pathTokens.length - 1],
													parentModel = this.get(initials);
											if (parentModel instanceof AssociatedModel) {
													obj = modelMap[parentModel.cid] || (modelMap[parentModel.cid] = {'model':parentModel, 'data':{}});
													obj.data[last] = attributes[attr];
											}
									} else {
											obj = modelMap[this.cid] || (modelMap[this.cid] = {'model':this, 'data':{}});
											obj.data[attr] = attributes[attr];
									}
							}
							if (modelMap) {
									for (modelId in modelMap) {
											obj = modelMap[modelId];
											this.setAttr.call(obj.model, obj.data, options) || (result = false);
									}
							} else {
									return this.setAttr.call(this, attributes, options);
							}
							return result;
					},

					// Set a hash of model attributes on the object,
					// fire Backbone `event` with options.
					// It maintains relations between models during the set operation.
					// It also bubbles up child events to the parent.
					setAttr:function (attributes, options) {
							var attr;
							// Extract attributes and options.
							options || (options = {});
							if (options.unset) for (attr in attributes) attributes[attr] = void 0;
							this.parents = this.parents || [];

							if (this.relations) {
									// Iterate over `this.relations` and `set` model and collection values
									// if `relations` are available.
									_.each(this.relations, function (relation) {
											var relationKey = relation.key, relatedModel = relation.relatedModel,
													collectionType = relation.collectionType,
													map = relation.map,
													val, relationOptions, data, relationValue;

											//Get class if relation and map is stored as a string.
											relatedModel && _.isString(relatedModel) && (relatedModel = eval(relatedModel));
											collectionType && _.isString(collectionType) && (collectionType = eval(collectionType));
											map && _.isString(map) && (map = eval(map));
											// Merge in `options` specific to this relation.
											relationOptions = relation.options ? _.extend({}, relation.options, options) : options;

											if (attributes[relationKey]) {
													//Get value of attribute with relation key in `val`.
													val = _.result(attributes, relationKey);
													//Map `val` if a transformation function is provided.
													val = map ? map(val) : val;

													// If `relation.type` is `Backbone.Many`,
													// create `Backbone.Collection` with passed data and perform Backbone `set`.
													if (relation.type === Backbone.Many) {
															// `collectionType` of defined `relation` should be instance of `Backbone.Collection`.
															if (collectionType && !collectionType.prototype instanceof BackboneCollection) {
																	throw new Error('collectionType must inherit from Backbone.Collection');
															}

															if (val instanceof BackboneCollection) {
																	data = val;
																	attributes[relationKey] = data;
															} else {
																	data = collectionType ? new collectionType() : this._createCollection(relatedModel);
																	data.add(val, relationOptions);
																	attributes[relationKey] = data;
															}

													} else if (relation.type === Backbone.One && relatedModel) {
															data = val instanceof AssociatedModel ? val : new relatedModel(val, relationOptions);
															attributes[relationKey] = data;
													}

													relationValue = data;

													// Add proxy events to respective parents.
													// Only add callback if not defined.
													if (relationValue && !relationValue._proxyCallback) {
															relationValue._proxyCallback = function () {
																	return this._bubbleEvent.call(this, relationKey, relationValue, arguments);
															};
															relationValue.on("all", relationValue._proxyCallback, this);
													}

											}
											//Distinguish between the value of undefined versus a set no-op
											if (attributes.hasOwnProperty(relationKey)) {
													//Maintain reverse pointers - a.k.a parents
													var updated = attributes[relationKey];
													var original = this.attributes[relationKey];
													if (updated) {
															updated.parents = updated.parents || [];
															(updated.parents.indexOf(this) == -1) && updated.parents.push(this);
													} else if (original && original.parents.length > 0) {
															original.parents = _.difference(original.parents, [this]);
													}
											}
									}, this);
							}
							// Return results for `BackboneModel.set`.
							return ModelProto.set.call(this, attributes, options);
					},
					// Bubble-up event to `parent` Model
					_bubbleEvent:function (relationKey, relationValue, eventArguments) {
							var args = eventArguments,
									opt = args[0].split(":"),
									eventType = opt[0],
									eventObject = args[1],
									options = args.length > 0 && args[args.length - 1],
									simulated = options.simulated,
									simulatedChange = "nested-change" == eventType,
									indexEventObject = -1,
									_proxyCalls = relationValue._proxyCalls,
									eventPath,
									basecolEventPath,
									triggerCollectionEvent = false;
							// Change the event name to a fully qualified path.
							_.size(opt) > 1 && (eventPath = opt[1]);

							//Don't bubble `nested-change` events
							if (simulatedChange) return;

							// Find the specific object in the collection which has changed.
							if (relationValue instanceof BackboneCollection && "change" === eventType && eventObject && !simulated) {
									var pathTokens = getPathArray(eventPath),
											initialTokens = _.initial(pathTokens), colModel;

									colModel = relationValue.find(function (model) {
											if (eventObject === model) return true;
											if (model) {
													var changedModel = model.get(initialTokens);
													if ((changedModel instanceof AssociatedModel || changedModel instanceof BackboneCollection) &&
															eventObject === changedModel) return true;
													changedModel = model.get(pathTokens);
													return ((changedModel instanceof AssociatedModel || changedModel instanceof BackboneCollection)
															&& eventObject === changedModel);
											}
											return false;
									});
									colModel && (indexEventObject = relationValue.indexOf(colModel));
							}

							triggerCollectionEvent = ("change" == eventType && !eventPath && indexEventObject !== -1);

							// Manipulate `eventPath`.
							eventPath = relationKey + (indexEventObject !== -1 ?
									"[" + indexEventObject + "]" : "") + (eventPath ? "." + eventPath : "");
							args[0] = eventType + ":" + eventPath;

							// If event has been already triggered as result of same source `eventPath`,
							// no need to re-trigger event to prevent cycle.
							if (_proxyCalls) {
									if (this._isEventAvailable.call(this, _proxyCalls, eventPath)) return this;
							} else {
									_proxyCalls = relationValue._proxyCalls = {};
							}
							// Add `eventPath` in `_proxyCalls` to keep track of already triggered `event`.
							_proxyCalls[eventPath] = true;

							//Set up previous attributes correctly.
							if ("change" === eventType) {
									this._previousAttributes[relationKey] = relationValue._previousAttributes;
									this.changed[relationKey] = relationValue;
							}

							// Bubble up event to parent `model` with new changed arguments.
							this.trigger.apply(this, args);

							// Remove `eventPath` from `_proxyCalls`,
							// if `eventPath` and `_proxyCalls` are available,
							// which allow event to be triggered on for next operation of `set`.
							if (_proxyCalls && eventPath) delete _proxyCalls[eventPath];

							//Simulate events to ease application programming with an object graph
							//1. Create a nested-change event
							if (!simulated && this._fireNestedChange(eventType, eventPath, args[2])) {
									var ncargs = [];
									ncargs.push("nested-change");
									ncargs.push(relationKey);
									ncargs.push.apply(ncargs, args);
									ncargs.push({simulated:true});
									this.trigger.apply(this, ncargs);
							}
							//2. Create a collection modified event without specifying the item in the collection which was modified
							if (triggerCollectionEvent) {
									basecolEventPath = relationKey;
									if (!this._isEventAvailable.call(this, _proxyCalls, basecolEventPath)) {
											var ccargs = [];
											ccargs.push.apply(ccargs, args);
											ccargs.push({simulated:true});
											ccargs[0] = eventType + ":" + basecolEventPath;

											_proxyCalls[basecolEventPath] = true;
											this.trigger.apply(this, ccargs);
											if (_proxyCalls && basecolEventPath) delete _proxyCalls[basecolEventPath];

									}

							}

							return this;
					},

					//Determine whether to fire a nested-change event for grand-parents and higher objects
					_fireNestedChange:function (eventType, fqpn, value) {
							return (
									("change" !== eventType) ||
											(this.getAttr.call(this, fqpn) != value) //Not a change:attribute event
									);
					},

					_isEventAvailable:function (_proxyCalls, path) {
							return _.find(_proxyCalls, function (value, eventKey) {
									return path.indexOf(eventKey, path.length - eventKey.length) !== -1;
							});
					},

					// Returns New `collection` of type `relation.relatedModel`.
					_createCollection:function (type) {
							var collection, relatedModel = type;
							_.isString(relatedModel) && (relatedModel = eval(relatedModel));
							// Creates new `Backbone.Collection` and defines model class.
							if (relatedModel && relatedModel.prototype instanceof AssociatedModel) {
									collection = new BackboneCollection();
									collection.model = relatedModel;
							} else {
									throw new Error('type must inherit from Backbone.AssociatedModel');
							}
							return collection;
					},
					// The JSON representation of the model.
					toJSON:function (options) {
							var json, aJson;
							if (!this.visited) {
									this.visited = true;
									// Get json representation from `BackboneModel.toJSON`.
									json = ModelProto.toJSON.apply(this, arguments);
									// If `this.relations` is defined, iterate through each `relation`
									// and added it's json representation to parents' json representation.
									if (this.relations) {
											_.each(this.relations, function (relation) {
													var attr = this.attributes[relation.key];
													if (attr) {
															aJson = attr.toJSON(options);
															json[relation.key] = _.isArray(aJson) ? _.compact(aJson) : aJson;
													} else {
															json[relation.key] = []; //add empty if none set
													}
											}, this);
									}
									delete this.visited;
							}
							return json;
					},

					// Create a new model with identical attributes to this one.
					clone:function () {
							return new this.constructor(this.toJSON());
					},

					//Navigate the path to the leaf object in the path to query for the attribute value
					getAttr:function (path) {

							var result = this,
							//Tokenize the path
									attrs = getPathArray(path),
									key,
									i;
							if (_.size(attrs) < 1) return;
							for (i = 0; i < attrs.length; i++) {
									key = attrs[i];
									if (!result) break;
									//Navigate the path to get to the result
									result = result instanceof BackboneCollection && (!isNaN(key)) ? result.at(key) : result.attributes[key];
							}
							return result;
					}
			});

			var delimiters = /[^\.\[\]]+/g;

			// Tokenize the fully qualified event path
			var getPathArray = function (path) {
					if (path === '') return [''];
					return _.isString(path) ? (path.match(delimiters)) : path || [];
			};

			//Infer the relation from the collection's parents and find the appropriate map for the passed in `models`
			var map2models = function (parents, target, models) {
					var relation;
					//Iterate over collection's parents
					_.find(parents, function (parent) {
							//Iterate over relations
							relation = _.find(parent.relations, function (rel) {
									return parent.get(rel.key) === target;
							}, this);
							if (relation) return true;//break;
					}, this);

					//If we found a relation and it has a mapping function
					if (relation && relation.map) {
							return relation.map(models)
					}
					return models;
			};

			var proxies = {};
			// Proxy Backbone collection methods
			_.each(['set', 'remove', 'reset'], function (method) {
					proxies[method] = BackboneCollection.prototype[method];

					CollectionProto[method] = function (models, options) {
							//Short-circuit if this collection doesn't hold `AssociatedModels`
							if (this.model.prototype instanceof AssociatedModel && this.parents) {
									//Find a map function if available and perform a transformation
									arguments[0] = map2models(this.parents, this, models);
							}
							return proxies[method].apply(this, arguments);
					}
			});
		}
		// Expose as the module for CommonJS, and globally for the browser.
		if (typeof exports !== 'undefined') {
			if (typeof module !== 'undefined' && module.exports) {
				exports = module.exports = extendBackbone;
			}
			exports = extendBackbone;
		}
		extendBackbone(Backbone);
}).call(this);
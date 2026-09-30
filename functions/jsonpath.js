const { JSONPath } = require('jsonpath-plus');

// Application queries only traverse data; executable filter expressions are disabled.
exports.query = (json, path) => JSONPath({ json, path, eval: false });

// Route parameters are data, never part of a JSONPath expression.
exports.queryByGuid = (plugins, guid, property) => plugins
  .filter((plugin) => plugin.guid === guid && Object.hasOwn(plugin, property))
  .map((plugin) => plugin[property]);

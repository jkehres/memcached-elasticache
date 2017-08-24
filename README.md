# memcached-elasticache

Drop-in replacement for [`memcached`](https://github.com/3rd-Eden/memcached) module (a fully featured Memcached client for Node.js) that adds support for [auto-discovery](http://docs.aws.amazon.com/AmazonElastiCache/latest/UserGuide/AutoDiscovery.html) of nodes in an AWS ElastiCache cluster running the Memcached engine. Works with all AWS supported cache engine versions.

## Installation

`npm install memcached-elasticache`

## Setting up the client

The constructor of the client takes two arguments `server locations` and `options`:

```js
const Memcached = require('memcached-elasticache');
const memcached = new Memcached(Server locations, options);
```

### Server locations

When auto-discovery is enabled (default), specify the configuration endpoint of the cluster as a string in the following format: `hostname:port`. The configuration endpoint will be polled at regular intervals (see `autoDiscoverInterval` option) to detect changes to the cluster. Nodes will be automatically added/removed from the client accordingly.

When auto-discovery is disabled, same as [`memcached`](https://github.com/3rd-Eden/memcached) module - specify one or more nodes that make up your cluster.

### Options

Same as [`memcached`](https://github.com/3rd-Eden/memcached) module with the following extra options:

#### `autoDiscover`

A flag indicating whether the client should automatically discover the nodes of the cluster or not. If false, client behaviour is identical to [`memcached`](https://github.com/3rd-Eden/memcached) module and you must manually specify the nodes of the cluster when constructing the client. Defaults to `true`.

#### `autoDiscoverInterval`

The number of milliseconds between attempts to discover changes to the cluster - added/removed nodes. When auto-discovery is disabled, no polling occurs and this value is ignored. Defaults to `60000` (i.e. one minute).

#### `autoDiscoverOverridesRemove`

A flag indicating whether a dead node removed via the `remove` config option can be re-added by auto-discovery. When auto-discovery is disabled, this value is ignored. Defaults to `false`.

## API

Same as [`memcached`](https://github.com/3rd-Eden/memcached) module - except private methods are not exposed.

NOTE: When auto-discovery is enabled, calling `end()` stops the polling for changes to the cluster in addition to closing all active connections.

## Events

Same as [`memcached`](https://github.com/3rd-Eden/memcached) module with the following extra events:

### `autoDiscover`

Emitted when a change to the cluster is detected - added/removed nodes. Payload is an array of server locations for the current nodes in the cluster. When auto-discovery is disabled, this event is not emitted.

### `autoDiscoverFailure`

Emitted when a error occurs while attempting to check for changes to the cluster. Payload is an `Error` object. When auto-discovery is disabled, this event is not emitted.

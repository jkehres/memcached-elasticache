'use strict';

const EventEmitter = require('events');
const Promise = require('bluebird');
const Memcached = require('memcached');
const _ = require('lodash');

const GET_CLUSTER_COMMAND_OLD = 'get AmazonElastiCache:cluster';
const GET_CLUSTER_COMMAND_NEW = 'config get cluster';

const DEFAULT_AUTO_DISCOVER = true;
const DEFAULT_AUTO_DISCOVER_INTERVAL = 60000;

function getOption(options, name, defaultValue) {
	if (_.has(options, name)) {
		return options[name];
	} else {
		return defaultValue;
	}
}

function deleteOption(options, name) {
	if (_.has(options, name)) {
		delete options[name];
	}
}

class Client extends EventEmitter {

    constructor(configEndpoint, options) {
        super();

		// extract outer client options so they aren't passed to inner client
		const autoDiscover = getOption(options, 'autoDiscover', DEFAULT_AUTO_DISCOVER);
		const autoDiscoverInterval = getOption(options, 'autoDiscoverInterval', DEFAULT_AUTO_DISCOVER_INTERVAL);
		this._options = _.clone(options);
		deleteOption(this._options, 'autoDiscover');
		deleteOption(this._options, 'autoDiscoverInterval');

        this._configEndpoint = configEndpoint;
        this._clusterVersion = null;

        // when auto-discovery is enabled, the configuration endpoint is a valid
        // cluster node so use it to for the initial inner client until cluser
        // discovery is complete and the inner client is replaced/updated with
        // all the nodes in the cluster; when auto-discovery is disabled, the
        // inner client never changes and this class is just a dumb wrapper
        this._createInnerClient(configEndpoint);

        // start auto-discovery, if enabled
        if (autoDiscover) {
            this._getCluster();
            this._timer = setInterval(this._getCluster.bind(this), autoDiscoverInterval);
        }
    }

    end() {

        // stop auto-discovery
        if (this._timer) {
            clearInterval(this._timer);
            this.timer = null;
        }

        this._innerClient.end();
    }

    _getCluster() {

        // connect to configuration endpoint
        const configClient = new Memcached(this._configEndpoint, this._options);

        new Promise((resolve, reject) => {

            // get cache engine version
            configClient.version((err, version) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(version);
                }
            });
        })
        .then((version) => {

            // select cluster command based on cache engine version
            const major = parseInt(version[0].major);
            const minor = parseInt(version[0].minor);
            const bugfix = parseInt(version[0].bugfix);
            const clusterCommand =
                (major > 1) || (major === 1 && minor > 4) || (major === 1 && minor === 4 && bugfix >= 14) ?
                GET_CLUSTER_COMMAND_NEW : GET_CLUSTER_COMMAND_OLD;

            // request nodes from configuration endpoint
            return new Promise((resolve, reject) => {
                configClient.command(() => {
                    return {
                        command: clusterCommand,
                        callback: (err, data) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(data);
                            }
                        }
                    };
                });
            });
        })
        .then((data) => this._parseNodes(data))
        .then((data) => {

			// don't update inner client if nodes have not changed
            if (this._clusterVersion === null || data.version > this._clusterVersion) {
                this._clusterVersion = data.version;
                this._createInnerClient(data.nodes);
                this.emit('autoDiscover', data.nodes);
            }
            configClient.end();
        })
        .catch((err) => {
            this.emit('autoDiscoverFailure', err);
            configClient.end();
        })
    }

    _parseNodes(data) {
		const lines = data.split('\n');
		const version = parseInt(lines[0]);
		const nodes = lines[1].split(' ').map((entry) => {
            const parts = entry.split('|');
            return `${parts[0]}:${parts[2]}`;
        });

        return {
			version,
			nodes
		};
    }

    _createInnerClient(servers) {

        // (re)create inner client object - do not call end() on previous inner
        // client as this will cancel any in-flight operations
        this._innerClient = new Memcached(servers, this._options);

        // passthrough method calls from outer object to inner object - except
        // end(), which we explicitly override
        [
            'touch',
            'get',
            'gets',
            'getMulti',
            'set',
            'replace',
            'add',
            'cas',
            'append',
            'prepend',
            'incr',
            'decr',
            'del',
            'version',
            'flush',
            'stats',
            'settings',
            'slabs',
            'items',
            'cachedump'
        ].forEach((func) => {
            this[func] = this._innerClient[func].bind(this._innerClient);
        });

        // passthrough emitted events from inner object to outer object
        this._innerClient.emit = this.emit.bind(this);
    }
}

module.exports = Client;

'use strict';

const EventEmitter = require('events');
const Memcached = require('memcached');
const _ = require('lodash');

const GET_CLUSTER_COMMAND_OLD = 'get AmazonElastiCache:cluster';
const GET_CLUSTER_COMMAND_NEW = 'config get cluster';

const DEFAULT_OPTIONS = {
    autoDiscover: true,
    autoDiscoverInterval: 60000
};

class Client extends EventEmitter {

    constructor(configEndpoint, options) {
        super();

        this._options = Object.assign({}, DEFAULT_OPTIONS, options);
        this._configEndpoint = configEndpoint;
        this._nodes = [];

        // when auto-discovery is enabled, the configuration endpoint is a valid
        // cluster node so use it to for the initial inner client until cluser
        // discovery is complete and the inner client is replaced/updated with
        // all the nodes in the cluster; when auto-discovery is disabled, the
        // inner client never changes and this class is just a dumb wrapper
        this._createInnerClient(configEndpoint);

        // start auto-discovery, if enabled
        if (this._options.autoDiscover) {
            this._getCluster();
            this._timer = setInterval(this._getCluster.bind(this), this._options.autoDiscoverInterval);
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
        .then((nodes) => {

			// don't update inner client if nodes have not changed
            if (!_.isEqual(this._nodes, nodes)) {
                this._nodes = nodes;
                this._createInnerClient(nodes);
                this.emit('autoDiscover', nodes);
            }
            configClient.end();
        })
        .catch((err) => {
            this.emit('autoDiscoverFailure', err);
            configClient.end();
        })
    }

    _parseNodes(data) {
        return data.split('\n')[1].split(' ').map((entry) => {
            const parts = entry.split('|');
            return `${parts[0]}:${parts[2]}`;
        }).sort();
    }

    _createInnerClient(servers) {

        // (re)create inner client object - do not call end() on previous inner
        // client as this will cancel any in-flight operations
        this._innerClient = new Memcached(servers, this.options);

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

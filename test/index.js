'use strict';

const Promise = require('bluebird');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();
const sinon = require('sinon');
const assert = require('chai').assert;

const GET_CLUSTER_COMMAND_OLD = 'get AmazonElastiCache:cluster';
const GET_CLUSTER_COMMAND_NEW = 'config get cluster';

const TEST_VERSION = '1.4.14';
const TEST_COMMAND = GET_CLUSTER_COMMAND_NEW;

const DUMMY_ENDPOINT = 'endpoint:11211';

const DUMMY_NODE1 = {
	hostname: 'node1',
	address: '1.1.1.1',
	port: '11211'
};
const DUMMY_NODE2 = {
	hostname: 'node2',
	address: '2.2.2.2',
	port: '11211'
};

// fix to make promises work properly with fake timer
Promise.setScheduler((fn) => {
	setTimeout(fn, 0);
});

function createMemcachedInstanceStubs(count) {
    let stubs = [];
    for (let i = 0; i < count; i++) {
        const stub = {};
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
            'cachedump',
            'end',
            'command'
        ].forEach((func) => {
            stub[func] = sinon.stub();
        });
        stubs.push(stub);
    }
    return stubs;
}

function createMemachedClassStub(instances) {
    const stub = sinon.stub().throws(new Error('No instance registered'));
    for (let i = 0; i < instances.length; i++) {
        stub.onCall(i).returns(instances[i]);
    }
    return stub;
}

function getMemcachedElastiCache(memachedClassStub) {
    return proxyquire('../index.js', {'memcached': memachedClassStub});
}

function mockVersionSuccess(stub, version) {
	const parts = version.split('.');
    stub.version.callsArgWith(0, null, [{
		server: `${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`,
		version: version,
		major: parts[0],
		minor: parts[1],
		bugfix: parts[2]
	}]);
}

function mockVersionFailure(stub) {
    stub.version.callsArgWith(0, new Error('foobar'));
}

function mockCommandSuccess(stub, command, version, nodes) {
	const nodeData = nodes.map((node) => `${node.hostname}|${node.address}|${node.port}`).join(' ');

    stub.command.withArgs(sinon.match.func).callsFake((callback) => {
        const data = callback();
		if (command === data.command) {
			data.callback(null, `${version}\n${nodeData}\n\r\n`);
		} else {
			throw new Error('Unexpected command');
		}
    })
}

function mockCommandFailure(stub, command) {
    stub.command.withArgs(sinon.match.func).callsFake((callback) => {
        const data = callback();
		if (command === data.command) {
			data.callback(new Error('foobar'));
		} else {
			throw new Error('Unexpected command');
		}
    })
}

/* eslint no-undef:0 */
describe('Client', () => {

    beforeEach(() => {
		this.clock = sinon.useFakeTimers();
	});

	afterEach(() => {
		this.clock.restore();
	});

	it('should pass server and no config options to inner client', () => {

        const instanceStubs = createMemcachedInstanceStubs(1);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

		/* eslint no-unused-vars:0 */
		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscover: false});

        assert.isTrue(classStub.calledWith(DUMMY_ENDPOINT));
	});

    it('should pass server and custom config options to inner client', () => {

        const instanceStubs = createMemcachedInstanceStubs(1);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

		/* eslint no-unused-vars:0 */
		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscover: false, timeout: 1000});

		assert.isTrue(classStub.calledWith(DUMMY_ENDPOINT, {timeout: 1000}));
	});

	it('should map public API call to inner client', () => {

        const instanceStubs = createMemcachedInstanceStubs(1);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

        instanceStubs[0].set.callsArgWith(3, null);
        const callback = sinon.mock().once().withArgs(null);

		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscover: false});
		memcached.set('foo', 'bar', 10, callback);
	});

    it('should propogate event from inner client', () => {

        const instanceStubs = createMemcachedInstanceStubs(1);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

        const callback = sinon.mock().once().withArgs(null);

		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscover: false});
        memcached.on('issue', callback);

        // simulate internal event
        instanceStubs[0].emit('issue', null);
	});

    [
		{version: '1.4.13', newCommand: false},
		{version: '1.3.14', newCommand: false},
		{version: '1.3.15', newCommand: false},
		{version: '0.4.14', newCommand: false},
		{version: '0.5.15', newCommand: false},

		{version: '1.4.14', newCommand: true},
		{version: '1.4.15', newCommand: true},
		{version: '1.5.0', newCommand: true},
		{version: '2.0.0', newCommand: true}
	]
	.forEach((config) => {
		it(`should auto-discover nodes with ${config.newCommand ? 'new' : 'old'} command for version ${config.version}`, (done) => {

            const instanceStubs = createMemcachedInstanceStubs(3);
            const classStub = createMemachedClassStub(instanceStubs);
            const Memcached = getMemcachedElastiCache(classStub);

			const command = config.newCommand ? GET_CLUSTER_COMMAND_NEW : GET_CLUSTER_COMMAND_OLD;
            mockVersionSuccess(instanceStubs[1], config.version);
			mockCommandSuccess(instanceStubs[1], command, 0, [DUMMY_NODE1, DUMMY_NODE2]);

			const nodes = [
                `${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`,
                `${DUMMY_NODE2.hostname}:${DUMMY_NODE2.port}`
            ];
            const successCallback = sinon.mock().once().withArgs(nodes);
			const failureCallback = sinon.mock().never();

			const memcached = new Memcached(DUMMY_ENDPOINT);
			memcached.on('autoDiscover', successCallback);
			memcached.on('autoDiscoverFailure', failureCallback);

			// wait for Promise chain to resolve
			setTimeout(() => {
				assert.equal(instanceStubs.length, classStub.callCount);
				assert.isTrue(classStub.getCall(0).calledWith(DUMMY_ENDPOINT));
				assert.isTrue(classStub.getCall(1).calledWith(DUMMY_ENDPOINT));
				assert.isTrue(classStub.getCall(2).calledWith(nodes));

				// verify inner client was recreated with discovered nodes
				instanceStubs[2].set.callsArgWith(3, null);
				const callback = sinon.mock().once().withArgs(null);
				memcached.set('foo', 'bar', 10, callback);

				done();
			}, 10);
			this.clock.tick(11);
		});
	});


	it('should fail auto-discovery when version() returns an error', (done) => {

        const instanceStubs = createMemcachedInstanceStubs(2);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

        mockVersionFailure(instanceStubs[1]);
		mockCommandSuccess(instanceStubs[1], TEST_COMMAND, 0, [DUMMY_NODE1, DUMMY_NODE2]);

        const successCallback = sinon.mock().never();
		const failureCallback = sinon.mock().once().withArgs(sinon.match.instanceOf(Error));

		const memcached = new Memcached(DUMMY_ENDPOINT);
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for Promise chain to resolve
		setTimeout(done, 10);
		this.clock.tick(11);
	});

	it('should fail auto-discovery when command() returns an error', (done) => {

        const instanceStubs = createMemcachedInstanceStubs(2);
        const classStub = createMemachedClassStub(instanceStubs);
        const Memcached = getMemcachedElastiCache(classStub);

        mockVersionSuccess(instanceStubs[1], TEST_VERSION);
		mockCommandFailure(instanceStubs[1], TEST_COMMAND);

        const successCallback = sinon.mock().never();
		const failureCallback = sinon.mock().once().withArgs(sinon.match.instanceOf(Error));

		const memcached = new Memcached(DUMMY_ENDPOINT);
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for Promise chain to resolve
		setTimeout(done, 10);
		this.clock.tick(11);
	});

	it('should detect modified cluster during auto-discovery (default interval)', (done) => {

		const instanceStubs = createMemcachedInstanceStubs(5);
		const classStub = createMemachedClassStub(instanceStubs);
		const Memcached = getMemcachedElastiCache(classStub);

		mockVersionSuccess(instanceStubs[1], TEST_VERSION);
		mockCommandSuccess(instanceStubs[1], TEST_COMMAND, 0, [DUMMY_NODE1]);

		mockVersionSuccess(instanceStubs[3], TEST_VERSION);
		mockCommandSuccess(instanceStubs[3], TEST_COMMAND, 1, [DUMMY_NODE1, DUMMY_NODE2]);

		const nodes1 = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`
		];
		const nodes2 = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`,
			`${DUMMY_NODE2.hostname}:${DUMMY_NODE2.port}`
		];
		const successCallback = sinon.mock().twice();
		const failureCallback = sinon.mock().never();

		const memcached = new Memcached(DUMMY_ENDPOINT);
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for auto-discovery timer and Promise chain to resolve
		setTimeout(() => {
			assert.isTrue(successCallback.getCall(0).calledWith(nodes1));
			assert.isTrue(successCallback.getCall(1).calledWith(nodes2));

			assert.equal(instanceStubs.length, classStub.callCount);
			assert.isTrue(classStub.getCall(0).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(1).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(2).calledWith(nodes1));
			assert.isTrue(classStub.getCall(3).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(4).calledWith(nodes2));

			// verify inner client was recreated with discovered nodes
			instanceStubs[2].set.callsArgWith(3, null);
			const callback1 = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback1);

			instanceStubs[4].set.callsArgWith(3, null);
			const callback2 = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback2);

			done();
		}, 60010);
		this.clock.tick(60011);
	});

	it('should detect modified cluster during auto-discovery (custom interval)', (done) => {

		const instanceStubs = createMemcachedInstanceStubs(5);
		const classStub = createMemachedClassStub(instanceStubs);
		const Memcached = getMemcachedElastiCache(classStub);

		mockVersionSuccess(instanceStubs[1], TEST_VERSION);
		mockCommandSuccess(instanceStubs[1], TEST_COMMAND, 0, [DUMMY_NODE1]);

		mockVersionSuccess(instanceStubs[3], TEST_VERSION);
		mockCommandSuccess(instanceStubs[3], TEST_COMMAND, 1, [DUMMY_NODE1, DUMMY_NODE2]);

		const nodes1 = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`
		];
		const nodes2 = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`,
			`${DUMMY_NODE2.hostname}:${DUMMY_NODE2.port}`
		];
		const successCallback = sinon.mock().twice();
		const failureCallback = sinon.mock().never();

		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscoverInterval: 30000});
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for auto-discovery timer and Promise chain to resolve
		setTimeout(() => {
			assert.isTrue(successCallback.getCall(0).calledWith(nodes1));
			assert.isTrue(successCallback.getCall(1).calledWith(nodes2));

			assert.equal(instanceStubs.length, classStub.callCount);
			assert.isTrue(classStub.getCall(0).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(1).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(2).calledWith(nodes1));
			assert.isTrue(classStub.getCall(3).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(4).calledWith(nodes2));

			// verify inner client was recreated with discovered nodes
			instanceStubs[2].set.callsArgWith(3, null);
			const callback1 = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback1);

			instanceStubs[4].set.callsArgWith(3, null);
			const callback2 = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback2);

			done();
		}, 30010);
		this.clock.tick(30011);
	});

	it('should not detect modified cluster during auto-discovery', (done) => {

		const instanceStubs = createMemcachedInstanceStubs(4);
		const classStub = createMemachedClassStub(instanceStubs);
		const Memcached = getMemcachedElastiCache(classStub);

		mockVersionSuccess(instanceStubs[1], TEST_VERSION);
		mockCommandSuccess(instanceStubs[1], TEST_COMMAND, 1, [DUMMY_NODE1]);

		mockVersionSuccess(instanceStubs[3], TEST_VERSION);
		mockCommandSuccess(instanceStubs[3], TEST_COMMAND, 0, [DUMMY_NODE1, DUMMY_NODE2]);

		const nodes = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`
		];
		const successCallback = sinon.mock().once();
		const failureCallback = sinon.mock().never();

		const memcached = new Memcached(DUMMY_ENDPOINT);
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for auto-discovery timer and Promise chain to resolve
		setTimeout(() => {
			assert.isTrue(successCallback.getCall(0).calledWith(nodes));

			assert.equal(instanceStubs.length, classStub.callCount);
			assert.isTrue(classStub.getCall(0).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(1).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(2).calledWith(nodes));
			assert.isTrue(classStub.getCall(3).calledWith(DUMMY_ENDPOINT));

			// verify inner client was recreated with discovered nodes
			instanceStubs[2].set.callsArgWith(3, null);
			const callback1 = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback1);

			done();
		}, 60010);
		this.clock.tick(60011);
	});

	it('should not auto-discover nodes when auto-discovery disabled', (done) => {

		const instanceStubs = createMemcachedInstanceStubs(1);
		const classStub = createMemachedClassStub(instanceStubs);
		const Memcached = getMemcachedElastiCache(classStub);

		const successCallback = sinon.mock().never();
		const failureCallback = sinon.mock().never();

		const memcached = new Memcached(DUMMY_ENDPOINT, {autoDiscover: false});
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);

		// wait for auto-discovery timer and Promise chain to resolve
		setTimeout(() => {
			assert.equal(instanceStubs.length, classStub.callCount);
			done();
		}, 60010);
		this.clock.tick(60011);
	});

	it('should not auto-discover nodes after end() is called', (done) => {

		const instanceStubs = createMemcachedInstanceStubs(3);
		const classStub = createMemachedClassStub(instanceStubs);
		const Memcached = getMemcachedElastiCache(classStub);

		mockVersionSuccess(instanceStubs[1], TEST_VERSION);
		mockCommandSuccess(instanceStubs[1], TEST_COMMAND, 0, [DUMMY_NODE1, DUMMY_NODE2]);

		const nodes = [
			`${DUMMY_NODE1.hostname}:${DUMMY_NODE1.port}`,
			`${DUMMY_NODE2.hostname}:${DUMMY_NODE2.port}`
		];
		const successCallback = sinon.mock().once().withArgs(nodes);
		const failureCallback = sinon.mock().never();

		const memcached = new Memcached(DUMMY_ENDPOINT);
		memcached.on('autoDiscover', successCallback);
		memcached.on('autoDiscoverFailure', failureCallback);
		memcached.end();

		// wait for auto-discovery timer and Promise chain to resolve
		setTimeout(() => {
			assert.equal(instanceStubs.length, classStub.callCount);
			assert.isTrue(classStub.getCall(0).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(1).calledWith(DUMMY_ENDPOINT));
			assert.isTrue(classStub.getCall(2).calledWith(nodes));

			// verify inner client was recreated with discovered nodes
			instanceStubs[2].set.callsArgWith(3, null);
			const callback = sinon.mock().once().withArgs(null);
			memcached.set('foo', 'bar', 10, callback);

			done();
		}, 60010);
		this.clock.tick(60011);
	});
});

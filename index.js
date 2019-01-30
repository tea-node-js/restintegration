const assert = require('assert');
const axios = require('axios');
const _ = require('lodash');

const inMocha = _.isFunction(global.describe) && _.isFunction(global.it);
const queue = [];
let last = {
  res: null,
  data: null,
};

const execQueue = () => {
  const fn = queue.shift();
  if (fn) {
    fn(execQueue);
  }
};

if (!inMocha) {
  global.it = (name, callback) => {
    queue.push(callback);
  };
}
/* global it */
class Restintegration {
  constructor(opts) {
    this.startedAt = new Date();
    this.tests = 0;
    this.assertions = 0;
    this.failures = 0;
    this.skipped = 0;
    this.options = {
      name: 'default integration',
      urlRoot: null,
      cases: [],
      globals: null,
      hooks: {},
    };
    this.initialize(opts);
    this.run();
  }

  initialize(opts) {
    this.options = _.defaults(opts, this.options);
    if (this.options.globals
      && this.options.globals.request
      && this.options.globals.request.headers) {
      this.options.headers = this.options.globals.request.headers;
    }
  }

  run() {
    this.tests = this.options.cases.length;
    _.each(this.options.cases, (_case, index) => {
      let caseName;

      if (typeof _case !== 'function') {
        caseName = _case.name;
      } else {
        caseName = `The test case is function ${index}`;
      }

      it(caseName, (done) => {
        if (typeof _case !== 'function') {
          this.testCase(_case, done);
          return;
        }
        _case = _case(last.data, last.res);
        if (_case.then && _case.catch) {
          _case.then((v) => {
            this.testCase(v, done);
          }).catch(() => {
            done();
          });
        } else {
          this.testCase(_case, done);
        }
      });
    });

    it('The last one test case', (done) => {
      assert.ok(true);
      this.done();
      done();
    });

    if (!inMocha) execQueue();
  }

  testCase(_case, cb) {
    if (!_case) {
      cb();
      return;
    }

    const options = {
      baseURL: this.options.urlRoot,
      url: _case.uri,
      method: _case.method || 'get',
      headers: Object.assign({}, this.options.headers, _case.headers),
    };

    if (_case.data) options.data = _case.data;

    const assertHanlder = (res, done) => {
      let hasError = false;

      const { data } = res;

      last.res = res;
      last.data = data;

      const keys = Object.keys(_case.expects);

      _.each(keys, (k) => {
        try {
          this[`assert${k}`](_case.expects[k], res);
        } catch (e) {
          if (inMocha) {
            process.stdout.write(`\nCase: ${JSON.stringify(_case, null, 2)}`);
            process.stdout.write(`\nHeaders: ${JSON.stringify(res.headers, null, 2)}`);
            process.stdout.write(`\nStatusCode: ${res.status}`);
            process.stdout.write(`\nBody: ${JSON.stringify(data, null, 2)}`);
            return done(e);
          }
          hasError = true;
        }
      });

      if (inMocha) {
        return done();
      }

      if (hasError) {
        this.failures += 1;
        process.stdout.write('F');
        process.stdout.write(`\n${this.failures})${_case.name}`);
        process.stdout.write(`\nExpects: ${JSON.stringify(_case.expects, null, 2)}`);
        process.stdout.write(`\nStatusCode: ${res.status}`);
        process.stdout.write(`\nHeaders: ${JSON.stringify(res.headers, null, 2)}`);
        process.stdout.write(`\nBody: ${JSON.stringify(data, null, 2)}`);
      } else {
        process.stdout.write('.');
      }

      return done();
    };

    axios(options).then((res) => assertHanlder(res, cb)).catch((err) => assertHanlder(err.response, cb));
  }

  error(err, _case) {
    console.error(`${err.message} in ${_case.name}`);
  }

  equal(actual, expected) {
    this.assertions += 1;
    if (_.isFunction(expected)) {
      expected(actual, assert);
    } else {
      assert.equal(actual, expected);
    }
  }

  typeEqual(actual, expected) {
    if (actual === null) return;
    this.assertions += 1;
    if (_.isFunction(expected)) {
      expected(actual, assert);
    } else {
      assert.equal(actual instanceof expected, true);
    }
  }

  assertStatus(expect, res) {
    this.equal(+res.status, expect);
  }

  assertHeader(expect, res) {
    this.equal(res.headers[expect[0].toLowerCase()], expect[1]);
  }

  assertHeaders(expect, res) {
    expect.forEach((header) => {
      this.assertHeader(header, res);
    });
  }

  assertJSON(expect, res) {
    if (!_.isArray(expect)) {
      this.assertObject(res.data, expect);
    } else if (expect[0] === '*') {
      _.each(res.data, (v) => {
        this.assertObject(v, expect[1]);
      });
    } else {
      this.assertObject(res.data[expect[0]], expect[1]);
    }
  }

  assertJSONTypes(expect, res) {
    if (!_.isArray(expect)) {
      this.assertObjectTypes(res.data, expect);
    } else if (expect[0] === '*') {
      _.each(res.data, (v) => {
        this.assertObjectTypes(v, expect[1]);
      });
    } else {
      this.assertObjectTypes(res.data[expect[0]], expect[1]);
    }
  }

  assertJSONLength(expect, res) {
    this.equal(res.data.length, expect);
  }

  assertObject(actual, expect) {
    if (_.isObject(expect) && !_.isFunction(expect)) {
      _.each(expect, (v, k) => {
        this.assertObject(actual[k], v);
      });
    } else {
      this.equal(actual, expect);
    }
  }

  assertObjectTypes(actual, expect) {
    if (_.isObject(expect) && !_.isFunction(expect)) {
      _.each(expect, (v, k) => {
        this.assertObjectTypes(actual[k], v);
      });
    } else {
      this.typeEqual(actual, expect);
    }
  }

  stats() {
    if (inMocha) return _.pick(this, ['tests', 'assertions', 'failures', 'skipped']);
    return [
      [this.tests, 'tests'],
      [this.assertions, 'assertions'],
      [this.failures, 'failures'],
      [this.skipped, 'skipped'],
    ].map(x => x.join(' ')).join(', ');
  }

  done() {
    if (!inMocha) {
      process.stdout.write('\n\n');
      console.log(`Finished ${this.consumed()} in seconds`);
      console.log(this.stats(), '\n\n');
    }

    if (this.options.hooks.done) {
      this.options.hooks.done(this.stats());
    }
  }

  consumed() {
    return (new Date() - this.startedAt) / 1000;
  }
}

module.exports = Restintegration;

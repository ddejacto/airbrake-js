import IFuncWrapper from './func_wrapper';
import jsonifyNotice from './jsonify_notice';
import Notice from './notice';

import Processor from './processor/processor';
import stacktracejsProcessor from './processor/stacktracejs';

import angularMessageFilter from './filter/angular_message';
import makeDebounceFilter from './filter/debounce';
import Filter from './filter/filter';
import ignoreNoiseFilter from './filter/ignore_noise';
import uncaughtMessageFilter from './filter/uncaught_message';

import { makeRequester, Requester } from './http_req';

import Options from './options';

export class BaseClient {
  protected opt: Options;
  protected url: string;

  protected processor: Processor;
  protected requester: Requester;
  protected filters: Filter[] = [];

  protected onClose: Array<() => void> = [];

  constructor(opt: Options) {
    if (!opt.projectId || !opt.projectKey) {
      throw new Error('airbrake: projectId and projectKey are required');
    }

    this.opt = opt;
    this.opt.host = this.opt.host || 'https://api.airbrake.io';
    this.opt.timeout = this.opt.timeout || 10000;
    this.opt.keysBlacklist = this.opt.keysBlacklist || [/password/, /secret/];
    this.url = `${this.opt.host}/api/v3/projects/${this.opt.projectId}/notices?key=${this.opt.projectKey}`;

    this.processor = this.opt.processor || stacktracejsProcessor;
    this.requester = makeRequester(this.opt);

    this.addFilter(ignoreNoiseFilter);
    this.addFilter(makeDebounceFilter());
    this.addFilter(uncaughtMessageFilter);
    this.addFilter(angularMessageFilter);

    if (this.opt.environment) {
      this.addFilter((notice: Notice): Notice | null => {
        notice.context.environment = this.opt.environment;
        return notice;
      });
    }
  }

  public close(): void {
    for (let fn of this.onClose) {
      fn();
    }
  }

  public addFilter(filter: Filter): void {
    this.filters.push(filter);
  }

  public notify(err: any): Promise<Notice> {
    let notice: Notice = {
      errors: [],
      context: {
        severity: 'error',
        ...err.context,
      },
      params: err.params || {},
      environment: err.environment || {},
      session: err.session || {},
    };

    if (typeof err !== 'object' || err.error === undefined) {
      err = { error: err };
    }

    if (!err.error) {
      notice.error = new Error(
        `airbrake: got err=${JSON.stringify(err.error)}, wanted an Error`
      );
      return Promise.resolve(notice);
    }

    if (this.opt.ignoreWindowError && err.context && err.context.windowError) {
      notice.error = new Error('airbrake: window error is ignored');
      return Promise.resolve(notice);
    }

    let error = this.processor(err.error);
    notice.errors.push(error);

    for (let filter of this.filters) {
      let r = filter(notice);
      if (r === null) {
        notice.error = new Error('airbrake: error is filtered');
        return Promise.resolve(notice);
      }
      notice = r;
    }

    if (!notice.context) {
      notice.context = {};
    }
    notice.context.language = 'JavaScript';
    notice.context.notifier = {
      name: 'airbrake-js',
      version: 'VERSION',
      url: 'https://github.com/airbrake/airbrake-js',
    };
    return this.sendNotice(notice);
  }

  protected sendNotice(notice: Notice): Promise<Notice> {
    let body = jsonifyNotice(notice, {
      keysBlacklist: this.opt.keysBlacklist,
    });
    if (this.opt.reporter) {
      if (typeof this.opt.reporter === 'function') {
        return this.opt.reporter(notice);
      } else {
        console.warn('airbrake: options.reporter must be a function');
      }
    }

    let req = {
      method: 'POST',
      url: this.url,
      body,
    };
    return this.requester(req)
      .then((resp) => {
        notice.id = resp.json.id;
        return notice;
      })
      .catch((err) => {
        notice.error = err;
        return notice;
      });
  }

  // TODO: fix wrapping for multiple clients
  public wrap(fn, props: string[] = []): IFuncWrapper {
    if (fn._airbrake) {
      return fn;
    }

    // tslint:disable-next-line:no-this-assignment
    let client = this;
    let airbrakeWrapper = function() {
      let fnArgs = Array.prototype.slice.call(arguments);
      let wrappedArgs = client.wrapArguments(fnArgs);
      try {
        return fn.apply(this, wrappedArgs);
      } catch (err) {
        client.notify({ error: err, params: { arguments: fnArgs } });
        this.historian.ignoreNextWindowError();
        throw err;
      }
    } as IFuncWrapper;

    for (let prop in fn) {
      if (fn.hasOwnProperty(prop)) {
        airbrakeWrapper[prop] = fn[prop];
      }
    }
    for (let prop of props) {
      if (fn.hasOwnProperty(prop)) {
        airbrakeWrapper[prop] = fn[prop];
      }
    }

    airbrakeWrapper._airbrake = true;
    airbrakeWrapper.inner = fn;

    return airbrakeWrapper;
  }

  protected wrapArguments(args: any[]): any[] {
    for (let i = 0; i < args.length; i++) {
      let arg = args[i];
      if (typeof arg === 'function') {
        args[i] = this.wrap(arg);
      }
    }
    return args;
  }

  public call(fn, ..._args: any[]): any {
    let wrapper = this.wrap(fn);
    return wrapper.apply(this, Array.prototype.slice.call(arguments, 1));
  }
}
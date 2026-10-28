/** 将采集器秘密护栏的同一份回归纳入默认 npm test；不触发真实CLI。 */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPO_ROOT} from '../helpers/fixture.js';
await import(pathToFileURL(path.join(REPO_ROOT,'scripts/acceptance/kimi-qoder-cn/qoder-secrets.test.mjs')).href);

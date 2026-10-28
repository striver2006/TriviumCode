/** 将无厂商调用的Driver采集器回归纳入默认npm test。 */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPO_ROOT} from '../helpers/fixture.js';
await import(pathToFileURL(path.join(REPO_ROOT,'scripts/acceptance/kimi-qoder-cn/driver-cli.test.mjs')).href);

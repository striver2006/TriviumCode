// 本次真实验收的持久预算；历史48次入口不消费本模块。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hashFile = file => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };
function openBudget(root, pool) {
  if (!root || !path.isAbsolute(root) || !['admission', 'review'].includes(pool)) throw Error('预算根/池必须显式指定');
  const dir = path.join(root, 'ledger', pool);
  fs.mkdirSync(dir, { recursive: true });
  function limit() {
    const approval = JSON.parse(fs.readFileSync(path.join(root, 'approval.json')));
    const limits = { ...approval.initial_limits };
    for (const p of ['admission', 'review']) if (!Number.isSafeInteger(limits[p]) || limits[p] < 0) throw Error('批准上限无效');
    const files = fs.readdirSync(root).filter(n => /^extension-\d+\.json$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    for (let i = 0; i < files.length; i++) {
      if (files[i] !== `extension-${i + 1}.json`) throw Error('扩容序列缺口');
      const e = JSON.parse(fs.readFileSync(path.join(root, files[i])));
      if (i > 0 && (typeof e.key !== 'string' || !e.key.trim())) throw Error('现行扩容缺少幂等键');
      if (!['admission', 'review'].includes(e.pool) || !Number.isSafeInteger(e.additional) || e.additional <= 0 ||
        !Number.isSafeInteger(e.new_limit) || e.previous_limit !== limits[e.pool] || e.new_limit !== e.previous_limit + e.additional) throw Error('扩容记录无效');
      limits[e.pool] = e.new_limit;
    }
    return limits[pool];
  }
  function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  function reserve(metadata) {
    const cap = limit();
    for (let index = 1; index <= cap; index++) {
      const record = { ...metadata, index, pool, limit_at_start: cap, reserved_at: new Date().toISOString() };
      try { write(path.join(dir, `reserved-${String(index).padStart(4, '0')}.json`), record); return record; }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    throw Error(`新增${pool}启动预算达到${cap}，拒绝spawn；预占不回收，扩容后才继续`);
  }
  function complete(record, outcome) {
    write(path.join(dir, `launch-${String(record.index).padStart(4, '0')}.json`), {
      ...record, ...outcome, completed_at: new Date().toISOString(),
    });
  }
  // 同一扩容键恰一次；只有Driver调用，其他并发写者拒绝，不自动解除陌生锁。
  function extend(key, additional, reason) {
    if (!key || !Number.isSafeInteger(additional) || additional <= 0) throw Error('扩容键/增量无效');
    const lock = path.join(root, '.extension-lock');
    const receipts = path.join(root, 'extensions-by-key');
    fs.mkdirSync(receipts, { recursive: true });
    const receipt = path.join(receipts, crypto.createHash('sha256').update(`${pool}:${key}`).digest('hex') + '.json');
    function existing() {
      limit();
      const published = fs.readdirSync(root).filter(n => /^extension-\d+\.json$/.test(n))
        .map(n => JSON.parse(fs.readFileSync(path.join(root, n)))).filter(e => e.pool === pool && e.key === key);
      if (published.length > 1) throw Error('扩容键重复');
      const record = published[0];
      if (record && (record.additional !== additional || record.reason !== reason)) throw Error('扩容键参数漂移');
      if (fs.existsSync(receipt)) {
        if (!record || JSON.stringify(JSON.parse(fs.readFileSync(receipt))) !== JSON.stringify(record)) throw Error('扩容回执与正式序列不一致');
      }
      return record;
    }
    const prior = existing();
    if (prior) return prior;
    fs.mkdirSync(lock);
    let tmp;
    try {
      const priorLocked = existing();
      if (priorLocked) return priorLocked;
      const previous = limit();
      const n = fs.readdirSync(root).filter(x => /^extension-\d+\.json$/.test(x)).length + 1;
      const record = { pool, key, additional, previous_limit: previous, new_limit: previous + additional,
        reason, authorized_by: '2026-10-10用户已授权按需扩容', published_at: new Date().toISOString() };
      if (!Number.isSafeInteger(record.new_limit)) throw Error('扩容上限溢出');
      tmp = path.join(root, `.extension-${n}-${crypto.randomUUID()}.tmp`);
      write(tmp, record);
      fs.renameSync(tmp, path.join(root, `extension-${n}.json`)); tmp = null;
      // 崩溃在发布与receipt之间时，从正式序列按key恢复，不能二次追加。
      write(receipt, record);
      return record;
    } finally {
      if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
      fs.rmdirSync(lock);
    }
  }
  return { root, pool, dir, limit, reserve, complete, extend, write };
}
function vendorOf(bin, args = []) {
  if (!Array.isArray(args)) args = [];
  const direct = /^(codex|cld|claude|agy|zcode)(?:\.cjs|\.js)?$/;
  if (direct.test(path.basename(bin))) return path.basename(bin).replace(/\.(cjs|js)$/, '');
  const wrapped = args.find(a => typeof a === 'string' && direct.test(path.basename(a)));
  if (wrapped && ['node', 'nodejs', 'script', 'npx', 'npm', 'bash', 'sh', 'zsh'].includes(path.basename(bin))) return path.basename(wrapped).replace(/\.(cjs|js)$/, '');
  return null;
}
module.exports = { openBudget, vendorOf, hashFile };

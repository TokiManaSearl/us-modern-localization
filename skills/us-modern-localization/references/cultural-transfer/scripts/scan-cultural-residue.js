#!/usr/bin/env node
/**
 * 残留中国文化依赖扫描器
 *
 * 用法：
 *   node scan-cultural-residue.js <文件或目录...> [选项]
 *
 * 选项：
 *   --ledger <mapping.json>       读锁定映射台账，反查未替换的来源名称
 *   --whitelist <file>            白名单，每行「命中文本|原因|依据」
 *   --severity <high|medium|low>  只输出该级别及以上
 *   --json                        输出 JSON
 *   --out <file>                  结果写入文件
 *   --max-per-term <n>            同一词条最多报几处（默认 20）
 *
 * 退出码：0 无 high；1 存在 high；2 参数或读取错误。
 * 仅做定位标记，不判断是否属于剧情必要保留，需逐条人工判定。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { low: 1, medium: 2, high: 3 };

const RULES = [
  {
    category: 'institution', severity: 'high',
    terms: ['居委会', '居民委员会', '村委会', '村民委员会', '街道办', '街道办事处',
      '派出所', '公安局', '事业单位', '国企', '网格员', '联防队', '城管',
      '社区居委会', '单位领导', '单位分房', '福利分房']
  },
  {
    category: 'document', severity: 'high',
    terms: ['户口本', '户口簿', '户口', '户籍', '身份证', '暂住证', '居住证',
      '粮油关系', '人事档案', '档案袋', '个人档案', '组织关系']
  },
  {
    category: 'emergency_number', severity: 'high',
    terms: ['110', '119', '120', '122', '114', '96110', '12345'],
    numeric: true
  },
  {
    category: 'medical_system', severity: 'high',
    terms: ['三甲', '二甲', '三乙', '二级甲等', '三级甲等', '挂号处', '挂专家号',
      '医保', '社保卡', '新农合', '合作医疗', '社区卫生服务中心',
      '乡镇卫生院', '县医院', '住院部', '门诊部',
      '中医院', '中医科', '针灸科', '赤脚医生']
  },
  {
    category: 'legal_system', severity: 'high',
    terms: ['检察院', '人民检察院', '政法委', '劳动教养', '信访办', '信访',
      '人民调解委员会', '人民调解员', '行政复议', '治安拘留', '收容遣送',
      '派出所所长', '片警']
  },
  {
    category: 'education_system', severity: 'high',
    terms: ['高考', '中考', '小升初', '班主任', '年级主任', '教导主任', '政教处',
      '重点中学', '重点高中', '学区房', '保送', '统招', '自主招生', '会考',
      '少先队', '红领巾', '政审']
  },
  {
    category: 'money_unit', severity: 'high',
    terms: ['人民币', '块钱', '毛钱', '角钱', '公积金', '社保缴费', '五险一金',
      '粮票', '布票', '粮油票'],
    weights: [
      { term: '斤', severity: 'medium' },
      { term: '两', severity: 'medium' },
      { term: '里', severity: 'medium' },
      { term: '亩', severity: 'medium' },
      { term: '寸', severity: 'low' },
      { term: '丈', severity: 'low' }
    ]
  },
  {
    category: 'title_address', severity: 'medium',
    terms: ['同志', '师傅', '科长', '处长', '局长', '所长', '书记',
      '大爷', '大娘', '大嫂', '老大爷', '大妈', '婶子']
  },
  {
    category: 'custom', severity: 'medium',
    terms: ['春节', '中秋', '元宵', '端午', '清明', '重阳', '除夕', '年三十',
      '拜年', '红包', '压岁钱', '随礼', '份子钱', '满月酒',
      '上坟', '烧纸', '祭祖', '族谱', '家谱', '祠堂',
      '饭局', '敬酒', '劝酒', '酒桌', '接风', '洗尘', '坐月子']
  },
  {
    category: 'idiom', severity: 'high',
    terms: ['敬酒不吃吃罚酒', '塞翁失马', '画蛇添足', '守株待兔', '叶公好龙',
      '东施效颦', '邯郸学步', '刻舟求剑', '朝三暮四', '南辕北辙', '杯弓蛇影',
      '杞人忧天', '愚公移山', '精卫填海', '夸父逐日', '嫦娥奔月', '卧薪尝胆',
      '三顾茅庐', '草木皆兵', '破釜沉舟', '四面楚歌', '指鹿为马', '负荆请罪',
      '完璧归赵', '围魏救赵', '纸上谈兵', '唇亡齿寒', '削足适履']
  },
  {
    category: 'politeness', severity: 'medium',
    terms: ['您慢走', '吃过没有', '吃了吗', '劳您费心', '不好意思打扰了',
      '给您添麻烦', '不吝赐教', '久仰大名', '失敬', '见笑']
  },
  {
    category: 'name_order', severity: 'medium',
    patterns: [
      { re: /[老小][\u4e00-\u9fa5](?=[，。！？、：；」』）\s])/g, stop: true },
      { re: /[\u4e00-\u9fa5]{1,2}(先生|女士|太太|小姐|师傅|大娘|大爷|阿姨|嫂子|婶子|叔叔|伯伯)(?=[，。！？、：；」』）\s]|$)/g }
    ]
  },
  {
    category: 'food', severity: 'low',
    terms: ['麻婆豆腐', '涮羊肉', '月饼', '粽子', '汤圆', '腊八粥', '药膳',
      '二锅头', '黄酒', '小笼包', '盖浇饭', '油条', '豆浆', '馒头']
  }
];

// 计量词需要「数字前置」或「量词后接」才算计量语境
const MEASURE_AFTER = /^[的]?(米|路|地|长|宽|高|重|远|多|钱|粮|肉|水|酒|布|绸|棉|左右|开外)/;

const CJK = /[\u4e00-\u9fa5]/;

// 「老/小 + 字」形近但非称谓的常用词
const NAME_STOP = new Set([
  '老家', '老人', '老实', '老是', '老板', '老师', '老伴', '老大', '老二', '老三',
  '老婆', '老公', '老鼠', '老虎', '老家', '老年', '老式', '老旧', '老练',
  '小心', '小时', '小孩', '小区', '小路', '小说', '小声', '小组', '小店', '小巷',
  '小队', '小偷', '小数', '小费', '小吃', '小城', '小镇', '小村', '小手', '小腿',
  '小腹', '小臂', '小腿', '小命', '小费', '小姑', '小姨', '小叔', '小舅', '小名'
]);

function parseArgs(argv) {
  const files = [];
  const opts = { ledger: null, whitelist: null, severity: 'low', json: false, out: null, maxPerTerm: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ledger') opts.ledger = argv[++i];
    else if (a === '--whitelist') opts.whitelist = argv[++i];
    else if (a === '--severity') opts.severity = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--max-per-term') opts.maxPerTerm = parseInt(argv[++i], 10) || 20;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
      process.exit(0);
    }
    else if (a.startsWith('--')) { console.error('未知选项: ' + a); process.exit(2); }
    else files.push(a);
  }
  if (!LEVELS[opts.severity]) { console.error('--severity 只能是 high/medium/low'); process.exit(2); }
  return { files, opts };
}

function collectFiles(targets) {
  const out = [];
  for (const t of targets) {
    let st;
    try { st = fs.statSync(t); } catch { console.error('无法读取: ' + t); process.exit(2); }
    if (st.isFile()) out.push(t);
    else {
      for (const e of fs.readdirSync(t, { withFileTypes: true })) {
        const full = path.join(t, e.name);
        if (e.isDirectory()) out.push(...collectFiles([full]));
        else if (/\.(md|txt|markdown)$/i.test(e.name)) out.push(full);
      }
    }
  }
  return out;
}

function lineStarts(text) {
  const arr = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') arr.push(i + 1);
  return arr;
}

function locate(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: idx - starts[lo] + 1 };
}

function loadWhitelist(file) {
  if (!file) return [];
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .map(l => l.split('|')[0].trim()).filter(Boolean);
  } catch (e) { console.error('白名单读取失败: ' + e.message); process.exit(2); }
}

function loadLedger(file) {
  if (!file) return { terms: [], conflicts: [] };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.error('台账读取失败（注意不要带 BOM）: ' + e.message); process.exit(2); }
  const entities = Array.isArray(data) ? data : (data.entities || []);
  const terms = [];
  const byTarget = new Map();
  const conflicts = [];
  for (const ent of entities) {
    const src = ent.source || ent.sources || [];
    const list = Array.isArray(src) ? src : [src];
    for (const s of list) {
      if (typeof s === 'string' && s.trim()) {
        const term = s.trim();
        // 来源与锁定目标完全相同说明未被替换，无需反查
        if (ent.target && String(ent.target).trim() === term) continue;
        terms.push({ term, id: ent.id || '', target: ent.target || '', category: ent.category || 'ledger' });
      }
    }
    if (ent.target) {
      const key = String(ent.target).trim();
      if (byTarget.has(key) && byTarget.get(key) !== ent.id) {
        conflicts.push({ target: key, ids: [byTarget.get(key), ent.id] });
      } else byTarget.set(key, ent.id);
    }
  }
  return { terms, conflicts };
}

function isMeasureContext(text, idx, term) {
  const before = text.slice(Math.max(0, idx - 3), idx);
  const after = text.slice(idx + term.length, idx + term.length + 4);
  const numberBefore = /[0-9一二三四五六七八九十百千万半几]$/.test(before);
  return numberBefore || MEASURE_AFTER.test(after);
}

function scanText(text, file, opts, whitelist, ledger) {
  const starts = lineStarts(text);
  const findings = [];
  const perTerm = new Map();

  const push = (f) => {
    if (whitelist.some(w => f.term === w || f.excerpt.includes(w))) return;
    const key = f.category + '|' + f.term;
    const n = perTerm.get(key) || 0;
    if (n >= opts.maxPerTerm) return;
    perTerm.set(key, n + 1);
    const loc = locate(starts, f.index);
    findings.push({
      file, line: loc.line, column: loc.column, category: f.category,
      severity: f.severity, term: f.term, excerpt: f.excerpt, note: f.note || ''
    });
  };

  for (const rule of RULES) {
    for (const term of (rule.terms || [])) {
      let idx = -1;
      while ((idx = text.indexOf(term, idx + 1)) !== -1) {
        if (rule.numeric) {
          const prev = text[idx - 1] || '';
          const next = text[idx + term.length] || '';
          if (/[0-9]/.test(prev) || /[0-9]/.test(next)) continue;
          if (/^[元块年人月日时分秒个岁次条件张名位号]/.test(text.slice(idx + term.length))) continue;
        }
        push({
          category: rule.category, severity: rule.severity, term, index: idx,
          excerpt: text.slice(Math.max(0, idx - 12), idx + term.length + 12).replace(/\n/g, ' ')
        });
      }
    }
    for (const w of (rule.weights || [])) {
      let idx = -1;
      while ((idx = text.indexOf(w.term, idx + 1)) !== -1) {
        if (!isMeasureContext(text, idx, w.term)) continue;
        push({
          category: rule.category, severity: w.severity || rule.severity, term: w.term, index: idx,
          excerpt: text.slice(Math.max(0, idx - 12), idx + w.term.length + 12).replace(/\n/g, ' ')
        });
      }
    }
    for (const p of (rule.patterns || [])) {
      const re = new RegExp(p.re.source, p.re.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!m[0] || m[0].length < 2) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
        if (p.stop && NAME_STOP.has(m[0])) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
        push({
          category: rule.category, severity: rule.severity, term: m[0], index: m.index,
          excerpt: text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12).replace(/\n/g, ' ')
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  for (const t of ledger.terms) {
    let idx = -1;
    while ((idx = text.indexOf(t.term, idx + 1)) !== -1) {
      push({
        category: 'ledger:' + t.category, severity: 'high', term: t.term, index: idx,
        note: '台账 ' + t.id + ' 应改为「' + t.target + '」',
        excerpt: text.slice(Math.max(0, idx - 12), idx + t.term.length + 12).replace(/\n/g, ' ')
      });
    }
  }

  return findings;
}

function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (!files.length) { console.error('请给出要扫描的文件或目录'); process.exit(2); }
  const targets = collectFiles(files);
  if (!targets.length) { console.error('没有找到可扫描的 .md/.txt 文件'); process.exit(2); }
  const whitelist = loadWhitelist(opts.whitelist);
  const ledger = loadLedger(opts.ledger);
  const min = LEVELS[opts.severity];

  let all = [];
  let scanned = 0;
  for (const f of targets) {
    const text = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '');
    if (!CJK.test(text)) continue;
    scanned++;
    all = all.concat(scanText(text, f, opts, whitelist, ledger));
  }

  // 同一文件内：被更长词条完整覆盖的重叠命中去掉（如「户口本」优于「户口」）
  const sortedAll = all.slice().sort((a, b) => b.term.length - a.term.length);
  const kept = [];
  for (const x of sortedAll) {
    const overlapped = kept.some(k =>
      k.file === x.file && k.category === x.category &&
      k.term.length > x.term.length &&
      k.term.includes(x.term) &&
      Math.abs(k.line - x.line) <= 1
    );
    if (!overlapped) kept.push(x);
  }
  all = kept;

  const filtered = all.filter(x => LEVELS[x.severity] >= min);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const x of filtered) counts[x.severity] = (counts[x.severity] || 0) + 1;

  if (opts.json) {
    const payload = {
      scanned_files: scanned,
      counts, conflicts: ledger.conflicts,
      findings: filtered.sort((a, b) => LEVELS[b.severity] - LEVELS[a.severity]
        || a.file.localeCompare(b.file) || a.line - b.line)
    };
    const s = JSON.stringify(payload, null, 2);
    if (opts.out) fs.writeFileSync(opts.out, s, 'utf8');
    console.log(s);
  } else {
    const lines = [];
    lines.push('扫描文件：' + scanned + ' 个');
    lines.push('命中：high ' + counts.high + ' / medium ' + counts.medium + ' / low ' + counts.low);
    if (whitelist.length) lines.push('白名单：' + whitelist.length + ' 条');
    if (ledger.conflicts.length) {
      lines.push('');
      lines.push('映射冲突（同一目标名对应多个实体，先解决）：');
      for (const c of ledger.conflicts) lines.push('  ' + c.target + ' <- ' + c.ids.join(', '));
    }
    const byFile = new Map();
    for (const x of filtered) {
      if (!byFile.has(x.file)) byFile.set(x.file, []);
      byFile.get(x.file).push(x);
    }
    for (const [file, items] of byFile) {
      lines.push('');
      lines.push('== ' + file);
      for (const x of items) {
        lines.push('  ' + x.line + ':' + x.column + '  [' + x.severity + '] ' + x.category + '  「' + x.term + '」');
        lines.push('      …' + x.excerpt + '…');
        if (x.note) lines.push('      ' + x.note);
      }
    }
    if (!filtered.length) {
      lines.push('');
      lines.push('未命中词表条目。这不等于没有残留：机构流程、亲属礼序、文化喻体仍需通读判断。');
    }
    const s = lines.join('\n');
    if (opts.out) fs.writeFileSync(opts.out, s, 'utf8');
    console.log(s);
  }
  process.exit(counts.high > 0 ? 1 : 0);
}

main();

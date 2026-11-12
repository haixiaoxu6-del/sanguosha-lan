'use strict';
// 从无名杀批量提取标准包「界限突破」武将：条目、立绘、技能待实现清单
// 用法: node tools/import-refreshed.js
const fs = require('fs');
const path = require('path');

const APP = process.env.WUMING_APP || 'E:/三国杀/电脑版+皮肤包+教程！/v1.10.3.1整合包1009（电脑版自带骨骼皮肤）/v1.10.3.1整合包1009（电脑版）/无名杀/resources/app';
const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  're_caocao', 're_simayi', 're_xiahoudun', 're_zhangliao', 're_xuzhu', 're_guojia', 're_zhenji',
  're_liubei', 're_machao', 're_huangyueying', 're_zhugeliang',
  're_sunquan', 're_ganning', 're_lvmeng', 're_huanggai', 're_zhouyu', 're_daqiao', 're_luxun', 're_sunshangxiang',
  're_huatuo', 're_lvbu', 're_diaochan',
];
const FACTION = { wei: '魏', shu: '蜀', wu: '吴', qun: '群', shen: '神', jin: '晋' };
// 已实现的技能（引擎里已有实际效果）
const IMPLEMENTED = new Set([
  're_wusheng', 'yijue', 're_paoxiao', 'liyong', 're_longdan', 'yajiao',
]);

const defs = new Map();   // id -> { gender, faction, hp, skills }
const texts = new Map();  // key -> 中文文本

const charDir = path.join(APP, 'character');
const files = fs.readdirSync(charDir).filter(f => f.endsWith('.js'));
for (const file of files) {
  const src = fs.readFileSync(path.join(charDir, file), 'utf8');
  // 武将定义: id:['male','shu',4,['skill1','skill2']]
  const defRe = /([A-Za-z0-9_]+)\s*:\s*\[\s*'([a-z]+)'\s*,\s*'([a-z]+)'\s*,\s*(\d+(?:\/\d+)?)\s*,\s*\[([^\]]*)\]/g;
  let m;
  while ((m = defRe.exec(src))) {
    defs.set(m[1], {
      gender: m[2],
      faction: m[3],
      hp: Number(String(m[4]).split('/')[0]),
      skills: m[5].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
    });
  }
  // 翻译: 兼容 "id":"文本" / "id":'文本' / id:'文本' / id:"文本"
  const patterns = [
    /"([A-Za-z0-9_]+)"\s*:\s*"([^"]*)"/g,
    /"([A-Za-z0-9_]+)"\s*:\s*'([^']*)'/g,
    /([A-Za-z0-9_]+)\s*:\s*'([^']*)'/g,
    /([A-Za-z0-9_]+)\s*:\s*"([^"]*)"/g,
  ];
  for (const txtRe of patterns) {
    while ((m = txtRe.exec(src))) {
      const key = m[1], val = m[2];
      const isCJK = /[\u4e00-\u9fff]/.test(val);
      const prev = texts.get(key);
      if (prev === undefined || (isCJK && !/[\u4e00-\u9fff]/.test(prev))) texts.set(key, val);
    }
  }
}

const NAME_FIX = { re_zhenji: '界甄姬' };

const out = [];
const missingPortrait = [];
const usedSkills = new Map(); // skill -> Set(generals)

for (const id of TARGETS) {
  const d = defs.get(id);
  if (!d) { out.push({ id, missing: true }); continue; }
  const name = NAME_FIX[id] || texts.get(id) || id;
  const skills = d.skills;
  skillDescs: {
  }
  const skillDescs = {};
  for (const s of skills) {
    const sname = texts.get(s) || s;
    const sinfo = texts.get(s + '_info') || '';
    skillDescs[s] = { name: sname, desc: sinfo, implemented: IMPLEMENTED.has(s) };
    if (!usedSkills.has(s)) usedSkills.set(s, new Set());
    usedSkills.get(s).add(name);
  }
  const desc = skills.map(s => `${skillDescs[s].name}：${skillDescs[s].desc}`).join('');
  const portrait = `${id}.jpg`;
  const srcImg = path.join(APP, 'image', 'character', portrait);
  if (fs.existsSync(srcImg)) {
    fs.copyFileSync(srcImg, path.join(ROOT, 'public', 'assets', 'generals', portrait));
  } else {
    missingPortrait.push(id);
  }
  out.push({ id, name, faction: FACTION[d.faction] || d.faction, gender: d.gender, hp: d.hp, skills, skillDescs, desc, portrait });
}

// 生成 data 片段
const js = `'use strict';\n// 自动生成：标准包界限突破武将（22 名）\n// 由 tools/import-refreshed.js 从无名杀提取；技能未实现的武将请勿直接并入对局\nconst REFRESHED_GENERALS = ${JSON.stringify(out.filter(x => !x.missing), null, 2)};\n\nmodule.exports = { REFRESHED_GENERALS };\n`;
fs.writeFileSync(path.join(ROOT, 'refreshed-generals.js'), js, 'utf8');

// 技能清单
const lines = ['# 标准包界限突破：技能待实现清单', '', `生成时间：${new Date().toISOString()}`, ''];
lines.push('| 武将 | 技能 | 是否已实现 | 技能描述 |');
lines.push('|---|---|---|---|');
for (const g of out.filter(x => !x.missing)) {
  for (const s of g.skills) {
    const sd = g.skillDescs[s];
    lines.push(`| ${g.name} | ${sd.name} (${s}) | ${sd.implemented ? '✅' : '❌'} | ${String(sd.desc).replace(/\|/g, '\\|')} |`);
  }
}
lines.push('', '## 缺失立绘', '', missingPortrait.length ? missingPortrait.join(', ') : '无');
lines.push('', '## 未被识别的武将', '', out.filter(x => x.missing).map(x => x.id).join(', ') || '无');
fs.writeFileSync(path.join(ROOT, 'SKILLS_TODO.md'), lines.join('\n'), 'utf8');

console.log(`提取武将: ${out.filter(x => !x.missing).length}/${TARGETS.length}`);
console.log(`缺失立绘: ${missingPortrait.length ? missingPortrait.join(',') : '无'}`);
console.log(`未识别: ${out.filter(x => x.missing).map(x => x.id).join(',') || '无'}`);
console.log(`技能总数: ${usedSkills.size}，已实现: ${[...usedSkills.keys()].filter(s => IMPLEMENTED.has(s)).length}`);
console.log('输出: refreshed-generals.js / SKILLS_TODO.md');

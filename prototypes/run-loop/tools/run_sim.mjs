import fs from 'fs';
const html = fs.readFileSync(new URL('../../live-day/PROTOTYPE-live-day.html', import.meta.url), 'utf8');
const code = html.split('// ===================== SIM-START')[1].split('// ===================== SIM-END')[0];
const LiveDay = new Function('code', code.replace(/^[^\n]*\n/, '') + '\nreturn LiveDay;')();
const clone = x => JSON.parse(JSON.stringify(x));
const def = (p='allrounder') => ({ preset:p, week:1, dow:0, twist:'none', seed:1, startStrikes:0, airport: clone(LiveDay.PRESETS[p]) });
export { LiveDay, def };

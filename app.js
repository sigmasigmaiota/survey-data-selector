// Survey Data Selector — static, runs entirely in the browser.
// Data are Parquet files under data/<id>/; DuckDB-WASM reads only the columns requested (HTTP range requests).
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';
import { zipSync, strToU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BASE = new URL('.', location.href).href;

// Per-dataset extras that are not in the build metadata
const FILTERS = {
  brfss2024: { var: '_STATE', label: 'Limit to states (optional)',
    hint: 'Leave empty for all states. States are sampling strata, so a single-state file still supports design-based estimates. Hold Ctrl/⌘ to pick several.' },
};
const ABOUT = {
  namcs2024: 'Visit-level records from community health centers. Weight VISWT gives national visit estimates; HCID_S is the PSU and STRATUM_S the stratum.',
  brfss2024: 'Telephone survey of U.S. adults in all states and territories. Use _LLCPWT with strata _STSTR and PSU _PSU. Module questions asked on only some questionnaire versions may need version weights — check the weighting description.',
  rss7: 'Probability-based online panel survey by NCHS. WEIGHT is the combined-panel weight; P1_CALWT and P2_CALWT are for single-panel analyses.',
  nhis2025_adult: 'One randomly selected adult per household. Use WTFA_A with strata PSTRAT and PSU PPSU.',
  nhis2025_child: 'One randomly selected child per household. Use WTFA_C with strata PSTRAT and PSU PPSU.',
  nhis2025_adultinc: 'Ten multiply-imputed versions of family income for each sample adult (IMPNUM_A = 1–10). Weights and design variables are copied in from the Sample Adult file; join to it on HHX.',
  nhis2025_childinc: 'Ten multiply-imputed versions of family income for each sample child (IMPNUM_C = 1–10). Weights and design variables are copied in from the Sample Child file; join to it on HHX.',
  nhis2025_paradata: 'Interview process data (contact attempts, mode, timing) for each household. Use WTIA_PD with PSTRAT and PPSU.',
};

let datasets = [], groups = [], cur = null, meta = null;
const selected = new Set(), optSel = new Set();
let db = null, conn = null;

// ------------------------------------------------------------------ DuckDB
async function getDB() {
  if (conn) return conn;
  setStatus('Starting the data engine (first time only)…');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  try { await db.open({ filesystem: { allowFullHTTPReads: true } }); } catch (e) { /* older builds */ }
  conn = await db.connect();
  return conn;
}
const registered = new Set();
async function parquetList(ds) {
  await getDB();
  const names = [];
  for (const p of ds.parts) {
    const name = `${ds.id}__${p}`;
    if (!registered.has(name)) {
      await db.registerFileURL(name, new URL(`data/${ds.id}/${p}`, BASE).href, duckdb.DuckDBDataProtocol.HTTP, false);
      registered.add(name);
    }
    names.push(`'${name}'`);
  }
  return `read_parquet([${names.join(',')}])`;
}
const qi = (n) => `"${n.replace(/"/g, '""')}"`;

// ------------------------------------------------------------------ boot
async function boot() {
  datasets = await (await fetch('meta/datasets.json')).json();
  const order = ['NHIS 2025', 'BRFSS 2024', 'NAMCS 2024', 'RSS Round 7'];
  for (const s of order) { const files = datasets.filter((d) => d.survey === s); if (files.length) groups.push({ survey: s, files }); }
  const sv = $('#surveys');
  sv.innerHTML = groups.map((g, i) => {
    const n = g.files.reduce((a, d) => Math.max(a, d.n), 0);
    const sub = g.files.length > 1 ? `${g.files.length} files` : `${n.toLocaleString()} records`;
    return `<button type="button" role="radio" aria-checked="false" data-i="${i}">${esc(g.survey)}<small>${sub}</small></button>`;
  }).join('');
  sv.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pickSurvey(+b.dataset.i); });
  sv.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const bs = [...sv.querySelectorAll('button')]; const i = bs.indexOf(document.activeElement); if (i < 0) return;
    const j = (i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length; bs[j].focus(); pickSurvey(j);
  });
  $('#fileSel').addEventListener('change', (e) => loadDataset(e.target.value));
  $('#q').addEventListener('input', renderList);
  $('#section').addEventListener('change', renderList);
  $('#onlySel').addEventListener('change', renderList);
  $('#clearBtn').addEventListener('click', () => { selected.clear(); renderList(); renderSlip(); });
  $('#fmt').addEventListener('change', renderSlip);
  $('#filterSel').addEventListener('change', renderSlip);
  $('#dlBtn').addEventListener('click', download);
  $('#pvBtn').addEventListener('click', preview);
  addEventListener('hashchange', () => { const h = location.hash.slice(1); const g = groups.findIndex((x) => x.files.some((f) => f.id === h)); if (g >= 0 && h !== cur?.id) pickSurvey(g, h); });
  const hash = location.hash.slice(1);
  const gi = Math.max(0, groups.findIndex((g) => g.files.some((f) => f.id === hash)));
  pickSurvey(gi, hash);
}

function pickSurvey(i, fileId) {
  [...$('#surveys').children].forEach((b, j) => { b.setAttribute('aria-checked', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
  const g = groups[i];
  const fs = $('#fileSel');
  fs.innerHTML = g.files.map((d) => `<option value="${d.id}">${esc(d.title.replace(/^.*? — /, ''))} (${d.n.toLocaleString()} rows, ${d.nvars} variables)</option>`).join('');
  $('#files').hidden = g.files.length < 2;
  const id = g.files.some((f) => f.id === fileId) ? fileId : g.files[0].id;
  fs.value = id; loadDataset(id);
}

async function loadDataset(id) {
  if (cur?.id === id) return;
  cur = datasets.find((d) => d.id === id); selected.clear(); optSel.clear();
  history.replaceState(null, '', '#' + id);
  $('#varlist').innerHTML = '<li class="loading">Loading variable list…</li>';
  meta = await (await fetch(`meta/${id}.json`)).json();
  meta.byName = Object.fromEntries(meta.vars.map((v) => [v.name, v]));
  meta.req = new Set(meta.required);
  $('#dsDesc').textContent = `${meta.title}. Unit: ${meta.unit}. ${ABOUT[id] || ''}`;
  const secs = [...new Set(meta.vars.map((v) => v.section).filter(Boolean))];
  $('#sectionWrap').hidden = !secs.length;
  $('#section').innerHTML = '<option value="">All sections</option>' + secs.map((s) => `<option>${esc(s)}</option>`).join('');
  $('#q').value = ''; $('#onlySel').checked = false;
  // filter
  const f = FILTERS[id];
  $('#filterWrap').hidden = !f;
  if (f) {
    $('#filterLab').textContent = f.label; $('#filterHint').textContent = f.hint;
    $('#filterSel').innerHTML = (meta.byName[f.var]?.values || []).filter(([v]) => /^\d+$/.test(v))
      .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  }
  // docs
  $('#docs').innerHTML = meta.codebooks.map((p) => `<li><a href="${p}" download>${esc(p.split('/').pop())}</a></li>`).join('');
  $('#previewSec').hidden = true;
  renderList(); renderSlip();
}

// ------------------------------------------------------------------ variable list
function matches(v, q) {
  if (!q) return true;
  const hay = `${v.name} ${v.label} ${v.question || ''} ${v.section || ''}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}
function renderList() {
  const q = $('#q').value.trim().toLowerCase(), sec = $('#section').value, only = $('#onlySel').checked;
  const rows = meta.vars.filter((v) => (!sec || v.section === sec) && (!only || selected.has(v.name) || meta.req.has(v.name)) && matches(v, q));
  $('#count').textContent = `Showing ${rows.length.toLocaleString()} of ${meta.vars.length.toLocaleString()} variables`;
  const ul = $('#varlist');
  if (!rows.length) { ul.innerHTML = `<li class="loading">No variables match “${esc(q)}”. Try a shorter word or clear the section filter.</li>`; return; }
  ul.innerHTML = rows.map((v) => {
    const req = meta.req.has(v.name), sel = selected.has(v.name);
    const hasMore = v.values?.length || v.question || v.notes || v.universe;
    return `<li class="var${req ? ' is-req' : ''}${sel ? ' is-sel' : ''}" data-n="${esc(v.name)}">
      <div class="var-row">
        <input type="checkbox" id="c_${esc(v.name)}" ${req || sel ? 'checked' : ''} ${req ? 'disabled' : ''} aria-describedby="l_${esc(v.name)}">
        <label for="c_${esc(v.name)}"><span class="var-name">${esc(v.name)}</span>${req ? '<span class="tag">always included</span>' : ''}
          <span class="var-label" id="l_${esc(v.name)}">${esc(v.label) || '<i>No label in codebook</i>'}</span>
          ${v.section ? `<span class="var-sec">${esc(v.section)}</span>` : ''}</label>
        ${hasMore ? `<button class="morebtn" type="button" aria-expanded="false">Details</button>` : '<span></span>'}
      </div></li>`;
  }).join('');
}
$('#varlist').addEventListener('change', (e) => {
  const li = e.target.closest('.var'); if (!li) return;
  const n = li.dataset.n; e.target.checked ? selected.add(n) : selected.delete(n);
  li.classList.toggle('is-sel', e.target.checked); renderSlip();
});
$('#varlist').addEventListener('click', (e) => {
  const b = e.target.closest('.morebtn'); if (!b) return;
  const li = b.closest('.var'); const open = b.getAttribute('aria-expanded') === 'true';
  b.setAttribute('aria-expanded', String(!open));
  li.querySelector('.detail')?.remove();
  if (open) return;
  const v = meta.byName[li.dataset.n];
  const vals = (v.values || []).map(([c, l]) => `<tr><td>${esc(c)}</td><td>${esc(l)}</td></tr>`).join('');
  li.insertAdjacentHTML('beforeend', `<div class="detail">
    ${v.question && !/^NA - /.test(v.question) ? `<p><b>Question:</b> ${esc(v.question)}</p>` : ''}
    ${v.universe ? `<p><b>Asked of:</b> ${esc(v.universe)}</p>` : ''}
    ${v.notes ? `<p><b>Note:</b> ${esc(v.notes)}</p>` : ''}
    <p><b>Type:</b> ${v.type}</p>
    ${vals ? `<table class="vals"><tbody>${vals}</tbody></table>` : ''}</div>`);
});

// ------------------------------------------------------------------ slip
function columns() {
  const order = meta.vars.map((v) => v.name);
  const want = new Set([...meta.required, ...optSel, ...selected]);
  return order.filter((n) => want.has(n));
}
function renderSlip() {
  $('#slipDs').textContent = meta.title;
  $('#fixedList').innerHTML = meta.required.map((n) => `<li><code>${esc(n)}</code><span>${esc(roleOf(n))}</span></li>`).join('');
  $('#optWrap').hidden = !meta.optional_weights.length;
  $('#optList').innerHTML = meta.optional_weights.map((n) => `<li><label><input type="checkbox" data-w="${esc(n)}" ${optSel.has(n) ? 'checked' : ''}>
    <span><code>${esc(n)}</code><br>${esc(meta.byName[n]?.label || '')}</span></label></li>`).join('');
  const chosen = [...selected];
  $('#selN').textContent = chosen.length;
  $('#chosen').innerHTML = chosen.length ? chosen.map((n) => `<li class="chip">${esc(n)}<button type="button" aria-label="Remove ${esc(n)}" data-rm="${esc(n)}">×</button></li>`).join('')
    : '<li class="empty">Tick variables in the list to add them here.</li>';
  $('#clearBtn').hidden = !chosen.length;
  const ncol = columns().length;
  const nrow = estRows();
  const mb = (nrow * ncol * ($('#fmt').value === 'csv' ? 3.2 : 0.9)) / 1e6;
  const big = mb > 350;
  $('#est').className = 'est' + (big ? ' warn' : '');
  $('#est').textContent = `${nrow.toLocaleString()} rows × ${ncol} columns, about ${mb < 1 ? '<1' : Math.round(mb)} MB before zipping.` +
    (big ? ' That is large for a browser — pick fewer variables or limit rows.' : '');
  $('#dlBtn').disabled = !chosen.length || mb > 900;
  $('#pvBtn').disabled = !chosen.length;
}
function estRows() {
  const f = FILTERS[cur.id]; const picks = f ? [...$('#filterSel').selectedOptions] : [];
  if (!picks.length) return meta.n;
  return Math.round(meta.n * picks.length / Math.max(1, $('#filterSel').options.length)); // rough
}
function roleOf(n) {
  const d = meta.design;
  if (n === d.weights) return 'survey weight';
  if (n === d.strata) return 'stratum';
  if (n === d.ids) return 'PSU / cluster';
  if (n === d.mi) return 'imputation number';
  return 'record ID';
}
$('#optList').addEventListener('change', (e) => { const n = e.target.dataset.w; e.target.checked ? optSel.add(n) : optSel.delete(n); renderSlip(); });
$('#chosen').addEventListener('click', (e) => {
  const n = e.target.dataset.rm; if (!n) return; selected.delete(n); renderSlip();
  const li = document.querySelector(`.var[data-n="${CSS.escape(n)}"]`);
  if (li) { li.classList.remove('is-sel'); li.querySelector('input').checked = false; }
});

// ------------------------------------------------------------------ query building
function whereClause() {
  const f = FILTERS[cur.id]; if (!f) return { sql: '', text: '' };
  const picks = [...$('#filterSel').selectedOptions];
  if (!picks.length) return { sql: '', text: '' };
  return { sql: ` WHERE ${qi(f.var)} IN (${picks.map((o) => +o.value).join(',')})`,
           text: `${f.var} in (${picks.map((o) => `${o.value} = ${o.textContent}`).join('; ')})` };
}
function setStatus(t, err) { const s = $('#status'); s.textContent = t; s.className = 'status' + (err ? ' err' : ''); }

async function preview() {
  try {
    $('#pvBtn').disabled = true; setStatus('Reading a few rows…');
    const c = await getDB(); const src = await parquetList(meta);
    const cols = columns(); const w = whereClause();
    const res = await c.query(`SELECT ${cols.map(qi).join(',')} FROM ${src}${w.sql} LIMIT 10`);
    const rows = res.toArray().map((r) => r.toJSON());
    $('#pvTable').innerHTML = `<thead><tr>${cols.map((n) => `<th scope="col">${esc(n)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r) => `<tr>${cols.map((n) => `<td>${r[n] == null ? '' : esc(r[n])}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $('#pvNote').textContent = `— first ${rows.length} rows of ${cur.id}${w.text ? ', filtered' : ''}`;
    $('#previewSec').hidden = false; $('#previewSec').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setStatus('');
  } catch (e) { console.error(e); setStatus('Preview failed: ' + e.message, true); }
  finally { $('#pvBtn').disabled = false; }
}

async function download() {
  const btn = $('#dlBtn');
  try {
    btn.disabled = true;
    const c = await getDB(); const src = await parquetList(meta);
    const cols = columns(); const w = whereClause(); const fmt = $('#fmt').value;
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${cur.id}_extract_${stamp}`;
    const outName = `${base}.${fmt}`;
    setStatus(`Reading ${cols.length} columns…`);
    const sel = cols.map(qi).join(',');
    const cnt = Number((await c.query(`SELECT count(*) AS n FROM ${src}${w.sql}`)).toArray()[0].n);
    const opts = fmt === 'csv' ? `(FORMAT CSV, HEADER, DELIMITER ',')` : `(FORMAT PARQUET, COMPRESSION ZSTD)`;
    await c.query(`COPY (SELECT ${sel} FROM ${src}${w.sql}) TO '${outName}' ${opts}`);
    const data = await db.copyFileToBuffer(outName);
    await db.dropFile(outName).catch(() => {});
    setStatus('Packing the zip…');
    const files = {
      [outName]: [data, { level: fmt === 'csv' ? 6 : 0 }],
      [`${base}_codebook.csv`]: strToU8(codebookCSV(cols)),
      [`${base}_codebook.html`]: strToU8(codebookHTML(cols, cnt, w.text, stamp)),
      [`load_${cur.id}.R`]: strToU8(rScript(outName, cols, fmt, w.text)),
      ['README.txt']: strToU8(readme(outName, cols, cnt, w.text, stamp)),
    };
    const zip = zipSync(files);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([zip], { type: 'application/zip' })), download: `${base}.zip` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    setStatus(`Downloaded ${base}.zip — ${cnt.toLocaleString()} rows, ${cols.length} columns.`);
  } catch (e) { console.error(e); setStatus('Download failed: ' + e.message, true); }
  finally { btn.disabled = false; renderSlip(); }
}

// ------------------------------------------------------------------ bundled documents
const csvq = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
function valueText(v) { return (v.values || []).map(([c, l]) => `${c} = ${l}`).join('; '); }
function codebookCSV(cols) {
  const head = 'variable,role,label,question,universe,section,type,values';
  return [head, ...cols.map((n) => { const v = meta.byName[n];
    return [n, meta.req.has(n) ? roleOf(n) : (meta.optional_weights.includes(n) ? 'optional weight' : 'selected'), v.label, v.question, v.universe, v.section, v.type, valueText(v)].map(csvq).join(','); })].join('\r\n');
}
function codebookHTML(cols, n, filt, stamp) {
  const rows = cols.map((c) => { const v = meta.byName[c];
    const vals = (v.values || []).map(([k, l]) => `<tr><td>${esc(k)}</td><td>${esc(l)}</td></tr>`).join('');
    return `<section><h2>${esc(c)}</h2><p class="lab">${esc(v.label)}</p>
      ${v.question && !/^NA - /.test(v.question) ? `<p><b>Question:</b> ${esc(v.question)}</p>` : ''}
      ${v.universe ? `<p><b>Asked of:</b> ${esc(v.universe)}</p>` : ''}${v.notes ? `<p><b>Note:</b> ${esc(v.notes)}</p>` : ''}
      ${v.section ? `<p><b>Section:</b> ${esc(v.section)}</p>` : ''}<p><b>Type:</b> ${v.type}${meta.req.has(c) ? ` · <b>Role:</b> ${roleOf(c)}` : ''}</p>
      ${vals ? `<table><thead><tr><th>Value</th><th>Label</th></tr></thead><tbody>${vals}</tbody></table>` : ''}</section>`; }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Codebook — ${esc(meta.title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 16px;color:#14233C}h1{font-size:1.6rem}
section{border-top:1px solid #ccd;padding:.6rem 0}h2{font:600 1.05rem ui-monospace,Consolas,monospace;margin:.4rem 0 0}.lab{margin:.1rem 0 .4rem;font-weight:600}
table{border-collapse:collapse;font-size:.9rem}td,th{text-align:left;padding:.15rem 1rem .15rem 0;vertical-align:top}td:first-child{font-family:ui-monospace,Consolas,monospace;color:#555}</style></head>
<body><h1>Codebook for your extract</h1><p>${esc(meta.title)} — ${n.toLocaleString()} rows, ${cols.length} variables${filt ? `, rows limited to ${esc(filt)}` : ''}. Created ${stamp}.</p>
<p>Survey design: weights <code>${meta.design.weights}</code>, strata <code>${meta.design.strata}</code>, PSU <code>${meta.design.ids}</code>. Values and labels are taken from the official codebook; consult it for frequencies and skip patterns.</p>${rows}</body></html>`;
}
function rScript(file, cols, fmt, filt) {
  const d = meta.design; const bt = (n) => (/^[A-Za-z][A-Za-z0-9._]*$/.test(n) ? n : '`' + n + '`');
  const charCols = cols.filter((n) => meta.byName[n].type === 'string');
  const labels = cols.map((n) => `  ${bt(n)} = ${JSON.stringify(meta.byName[n].label || '')}`).join(',\n');
  const read = fmt === 'csv'
    ? `dat <- readr::read_csv("${file}", guess_max = Inf${charCols.length ? `,\n  col_types = readr::cols(${charCols.map((n) => `${bt(n)} = readr::col_character()`).join(', ')}, .default = readr::col_guess())` : ''})`
    : `dat <- arrow::read_parquet("${file}")   # install.packages("arrow") if needed`;
  const lonely = cur.id === 'brfss2024' ? '\noptions(survey.lonely.psu = "adjust")  # some strata have a single PSU' : '';
  const des = d.mi
    ? `# Income was multiply imputed: build one design per implicate and combine with mitools
library(mitools)
imps <- imputationList(split(dat, dat$${d.mi}))
des  <- svydesign(ids = ~${bt(d.ids)}, strata = ~${bt(d.strata)}, weights = ~${bt(d.weights)}, nest = TRUE, data = imps)
# Example: MIcombine(with(des, svymean(~RATCAT_A, na.rm = TRUE)))`
    : `des <- svydesign(ids = ~${bt(d.ids)}, strata = ~${bt(d.strata)}, weights = ~${bt(d.weights)},
                 nest = TRUE, data = dat)
# Examples:
# svymean(~${bt(cols.find((n) => !meta.req.has(n)) || d.weights)}, des, na.rm = TRUE)
# For subgroups use subset() on the design, not on dat, so standard errors stay correct:
# des_sub <- subset(des, <condition>)`;
  return `# Load ${meta.title} extract and set up the complex survey design
# Generated by the Survey Data Selector${filt ? `\n# Rows limited to: ${filt}` : ''}
# install.packages(c("readr", "survey"${d.mi ? ', "mitools"' : ''}))

library(survey)
${read}

# Variable labels (shown in RStudio's View() and by attr(dat$x, "label"))
var_labels <- list(
${labels}
)
for (v in names(var_labels)) attr(dat[[v]], "label") <- var_labels[[v]]

# Survey design — weights, strata and PSUs are already in the file${lonely}
${des}
`;
}
function readme(file, cols, n, filt, stamp) {
  const d = meta.design;
  return `${meta.title}
Extract created ${stamp} with the Survey Data Selector

Files
  ${file}  — ${n.toLocaleString()} rows, ${cols.length} columns${filt ? `\n                rows limited to ${filt}` : ''}
  *_codebook.html / *_codebook.csv  — labels and value codes for every column in this extract
  load_${cur.id}.R  — reads the data into R, adds variable labels and builds the survey design

Survey design variables (always included)
  weight  ${d.weights}
  strata  ${d.strata}
  PSU     ${d.ids}${d.mi ? `\n  implicate ${d.mi} (multiply imputed — analyze all 10 and combine)` : ''}

Missing values: empty cells are system missing. Codes such as 7/9, 77/99 or negative numbers
(refused, don't know, not ascertained) are kept as numbers — recode them before analysis.
See the codebook for each variable.

Unweighted counts describe the sample only. Use the weight and design variables for
population estimates and standard errors.

Full documentation for this survey is available on the selector page.
`;
}

boot().catch((e) => { console.error(e); $('#varlist').innerHTML = `<li class="loading">Could not load the dataset list (${esc(e.message)}). If you opened index.html directly from disk, run a local web server instead — see the README.</li>`; });

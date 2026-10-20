"""Build Parquet data files + JSON variable catalogs for the Survey Data Selector app.

Usage (from the repo root):
    pip install -r prep/requirements.txt
    python prep/build_data.py --src "C:/Users/steph/OneDrive/CUNY_CSOM/SOHLER" --out .

--src  folder that contains NAMCS2024/, NHIS2025/, BRFSS/ and RSS7/ exactly as downloaded from CDC/NCHS
--out  the app folder (writes data/, meta/ and codebooks/ inside it)
--work scratch folder for unzipped files (default: ./_work, git-ignored)

NHIS label programs (.sps) and NHIS codebook PDFs are fetched from the NCHS FTP site
the first time; everything else comes from --src.
"""
import json, re, html, shutil, os, glob, gc, argparse, zipfile, urllib.request
from pathlib import Path
import pandas as pd
import pyarrow as pa, pyarrow.parquet as pq
import pyreadstat, pyreadr

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True); ap.add_argument('--out', default='.'); ap.add_argument('--work', default='_work')
args = ap.parse_args()
UP = Path(args.src); RAW = Path(args.work); APP = Path(args.out)
DATA = APP/'data'; META = APP/'meta'; CB = APP/'codebooks'
for d in (DATA, META, CB, RAW): d.mkdir(parents=True, exist_ok=True)

NHIS_DOC = 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Dataset_Documentation/NHIS/2025/'
NHIS_SPS = 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Program_Code/NHIS/2025/'
def prepare():
    """Unzip source archives and fetch NHIS label programs + documentation into the work folder."""
    for z in (UP/'NHIS2025').glob('*csv.zip'):
        zipfile.ZipFile(z).extractall(RAW/'nhis')
    xpt = RAW/'brfss'/'LLCP2024.XPT'
    if not xpt.exists():
        zf = zipfile.ZipFile(UP/'BRFSS'/'LLCP2024XPT.zip')
        member = [n for n in zf.namelist() if n.strip().upper().endswith('.XPT')][0]   # CDC's file name has a trailing space
        (RAW/'brfss').mkdir(exist_ok=True)
        with zf.open(member) as src, open(xpt, 'wb') as dst: shutil.copyfileobj(src, dst, 16 << 20)
    (RAW/'brfss_cb').mkdir(exist_ok=True)
    shutil.copy(UP/'BRFSS'/'codebook24'/'USCODE24_LLCP_082125.HTML', RAW/'brfss_cb'/'USCODE24_LLCP_082125.HTML')
    for sub, base, names in (('nhis_sas', NHIS_SPS, ['adult.sps','adultinc.sps','child.sps','childinc.sps','paradata.sps']),
                             ('nhis_doc', NHIS_DOC, ['Adult-codebook.pdf','Adult-summary.pdf','Adultinc-summary.pdf','Child-codebook.pdf',
                               'Child-summary.pdf','Childinc-summary.pdf','Paradata-codebook.pdf','Paradata-summary.pdf',
                               'NHIS-PairWeights-README.txt','NHIS2025-imputation-techdoc-508.pdf','srvydesc-508.pdf','srvydescr-paradata-508.pdf'])):
        (RAW/sub).mkdir(exist_ok=True)
        for n in names:
            dest = RAW/sub/n
            if not dest.exists():
                print('downloading', base + n); urllib.request.urlretrieve(base + n, dest)
MAX_PART_BYTES = 24 * 1024**2   # under GitHub (100 MB) and Cloudflare Pages (25 MiB) per-file limits

def write_parquet(df, ds_id, rows_per_group=50_000):
    out = DATA/ds_id; shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
    tbl = pa.Table.from_pandas(df, preserve_index=False)
    path = out/'part-000.parquet'
    pq.write_table(tbl, path, compression='zstd', row_group_size=rows_per_group)
    sz = path.stat().st_size
    if sz > MAX_PART_BYTES:   # split by rows
        path.unlink(); n = int(sz // MAX_PART_BYTES) + 1; step = -(-len(df)//n)
        for i in range(n):
            pq.write_table(tbl.slice(i*step, step), out/f'part-{i:03d}.parquet', compression='zstd', row_group_size=rows_per_group)
    return sorted(p.name for p in out.glob('*.parquet'))

def coltype(s):
    return 'numeric' if pd.api.types.is_numeric_dtype(s) else 'string'

# ---------------------------------------------------------------- NHIS (SPSS syntax labels)
def parse_sps(path):
    txt = Path(path).read_text(encoding='latin-1')
    vl = txt[txt.index('VARIABLE LABELS'):]; vl = vl[:vl.index('\n.')]
    labels = dict(re.findall(r'^\s+(\w+)\s+"(.*)"\s*$', vl, re.M))
    vals = {}
    if 'VALUE LABELS' in txt:
        b = txt[txt.index('VALUE LABELS')+12:]; b = b[:b.index('\n.')]
        cur = None
        for line in b.splitlines():
            line = line.strip()
            if not line: continue
            m = re.match(r'^/?\s*([A-Za-z_]\w*)\s*$', line)
            if m: cur = m.group(1); vals.setdefault(cur, []); continue
            m = re.match(r'^(\S+)\s+"(.*)"$', line)
            if m and cur:
                code, lab = m.groups()
                lab = re.sub(r'^' + re.escape(code) + r'\s+', '', lab)
                vals[cur].append([code, lab])
    return labels, vals

def nhis():
    out = []
    files = {
        'adult': ('adult25.csv', 'adult.sps'), 'child': ('child25.csv', 'child.sps'),
        'adultinc': ('adultinc25.csv', 'adultinc.sps'), 'childinc': ('childinc25.csv', 'childinc.sps'),
        'paradata': ('paradata25.csv', 'paradata.sps')}
    dfs, labs = {}, {}
    for k, (csv, sps) in files.items():
        dfs[k] = pd.read_csv(RAW/'nhis'/csv, low_memory=False)
        labs[k] = parse_sps(RAW/'nhis_sas'/sps)
    pair = pd.read_csv(RAW/'nhis'/'final_pair_weight2025.csv')
    # Attach pair weight to adult & child; attach design/weights to income files (which ship without them)
    dfs['adult'] = dfs['adult'].merge(pair, on='HHX', how='left')
    dfs['child'] = dfs['child'].merge(pair, on='HHX', how='left')
    dfs['adultinc'] = dfs['adultinc'].merge(dfs['adult'][['HHX','WTFA_A','PSTRAT','PPSU']], on='HHX', how='left')
    dfs['childinc'] = dfs['childinc'].merge(dfs['child'][['HHX','WTFA_C','PSTRAT','PPSU']], on='HHX', how='left')
    extra_lab = {'final_pair_weight': 'Adult-child pair weight (from final_pair_weight2025; use only for parent-child pair analyses)'}
    for k in ('adultinc','childinc'):
        src = 'adult' if k=='adultinc' else 'child'
        for v in ('WTFA_A','WTFA_C','PSTRAT','PPSU'):
            if v in labs[src][0]: extra_lab.setdefault(v, labs[src][0][v])
    spec = {
      'adult':   dict(title='NHIS 2025 — Sample Adult', unit='adult', req=['HHX','WTFA_A','PSTRAT','PPSU'], opt=['final_pair_weight'],
                      design=dict(ids='PPSU', strata='PSTRAT', weights='WTFA_A', nest=True),
                      cb=['Adult-codebook.pdf','Adult-summary.pdf','srvydesc-508.pdf','NHIS-PairWeights-README.txt']),
      'child':   dict(title='NHIS 2025 — Sample Child', unit='child', req=['HHX','WTFA_C','PSTRAT','PPSU'], opt=['final_pair_weight'],
                      design=dict(ids='PPSU', strata='PSTRAT', weights='WTFA_C', nest=True),
                      cb=['Child-codebook.pdf','Child-summary.pdf','srvydesc-508.pdf','NHIS-PairWeights-README.txt']),
      'adultinc':dict(title='NHIS 2025 — Sample Adult Imputed Income (10 implicates)', unit='adult × implicate', req=['HHX','IMPNUM_A','WTFA_A','PSTRAT','PPSU'], opt=[],
                      design=dict(ids='PPSU', strata='PSTRAT', weights='WTFA_A', nest=True, mi='IMPNUM_A'),
                      cb=['Adultinc-summary.pdf','NHIS2025-imputation-techdoc-508.pdf']),
      'childinc':dict(title='NHIS 2025 — Sample Child Imputed Income (10 implicates)', unit='child × implicate', req=['HHX','IMPNUM_C','WTFA_C','PSTRAT','PPSU'], opt=[],
                      design=dict(ids='PPSU', strata='PSTRAT', weights='WTFA_C', nest=True, mi='IMPNUM_C'),
                      cb=['Childinc-summary.pdf','NHIS2025-imputation-techdoc-508.pdf']),
      'paradata':dict(title='NHIS 2025 — Paradata', unit='household interview', req=['HHX','WTIA_PD','PSTRAT','PPSU'], opt=[],
                      design=dict(ids='PPSU', strata='PSTRAT', weights='WTIA_PD', nest=True),
                      cb=['Paradata-codebook.pdf','Paradata-summary.pdf','srvydescr-paradata-508.pdf']),
    }
    for k, df in dfs.items():
        ds_id = f'nhis2025_{k}'; s = spec[k]; L, V = labs[k]
        parts = write_parquet(df, ds_id)
        cbdir = CB/ds_id; cbdir.mkdir(exist_ok=True)
        for f in s['cb']: shutil.copy(RAW/'nhis_doc'/f, cbdir/f)
        vars_ = [dict(name=c, label=L.get(c, extra_lab.get(c, '')), type=coltype(df[c]), values=V.get(c, [])) for c in df.columns]
        out.append(dict(id=ds_id, survey='NHIS 2025', title=s['title'], unit=s['unit'], n=len(df), parts=parts,
                        required=s['req'], optional_weights=s['opt'], design=s['design'],
                        codebooks=[f'codebooks/{ds_id}/{f}' for f in s['cb']], vars=vars_))
        print(ds_id, df.shape, parts)
    return out

# ---------------------------------------------------------------- BRFSS (XPT + HTML codebook)
def parse_brfss_html(path):
    h = Path(path).read_bytes().decode('utf-8', errors='replace')
    h = re.sub('\ufffd(?=(&nbsp;|\\s)*Go to)', ' → ', h).replace('\ufffd', "'")
    meta = {}
    for tbl in re.split(r'<table class="table"', h)[1:]:
        hd = re.search(r'colspan="5">(.*?)</td>', tbl, re.S)
        if not hd: continue
        head = html.unescape(re.sub(r'<br>', '\n', hd.group(1))).replace('\xa0', ' ')
        f = dict(re.findall(r'^([A-Za-z ]+?):[ \t]*(.*)$', head, re.M))
        name = f.get('SAS Variable Name', '').strip()
        if not name: continue
        rows = re.findall(r'<tr>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', tbl.split('</thead>')[-1], re.S)
        vals = []
        for v, l in rows:
            v = html.unescape(re.sub('<[^>]+>', '', v)).replace('\xa0',' ').strip()
            l = html.unescape(re.sub('<br>', ' ', l)); l = re.sub('<[^>]+>', '', l).replace('\xa0',' ').strip()
            if v and v.lower() != 'value': vals.append([v, re.sub(r'\s+', ' ', l)])
        meta[name] = dict(label=f.get('Label','').strip(), section=f.get('Section Name','').strip(),
                          question=f.get('Question','').strip(), values=vals)
    return meta

def brfss():
    ds_id = 'brfss2024'
    cbm = parse_brfss_html(RAW/'brfss_cb'/'USCODE24_LLCP_082125.HTML')
    df, m = pyreadstat.read_xport(RAW/'brfss'/'LLCP2024.XPT', encoding='latin1')
    for c in df.columns:   # store whole-number float columns compactly
        if df[c].dtype == 'float64':
            s = df[c]
            if s.notna().all() and (s % 1 == 0).all() and s.abs().max() < 2**31: df[c] = s.astype('int32')
            elif (s.dropna() % 1 == 0).all() and s.abs().max() < 2**31: df[c] = s.astype('Int32')
    parts = write_parquet(df, ds_id, rows_per_group=60_000)
    vars_ = []
    for c in df.columns:
        x = cbm.get(c, {})
        vars_.append(dict(name=c, label=x.get('label') or m.column_names_to_labels.get(c) or '', section=x.get('section',''),
                          question=x.get('question',''), type=coltype(df[c]), values=x.get('values', [])))
    cbdir = CB/ds_id; cbdir.mkdir(exist_ok=True)
    docs = {'USCODE24_LLCP_082125.HTML': UP/'BRFSS/codebook24/USCODE24_LLCP_082125.HTML',
            '2024-Weighting-Description-508.pdf': UP/'BRFSS/2024-Weightning-Description-508.pdf',
            'Overview_2024-508.pdf': UP/'BRFSS/Overview_2024-508.pdf',
            'llcp_varlayout_24_onecolumn.html': UP/'BRFSS/llcp_varlayout_24_onecolumn.html',
            'summary_matrix_24.html': UP/'BRFSS/summary_matrix_24.html',
            'llcp_multiq.html': UP/'BRFSS/llcp_multiq.html'}
    for k, p in docs.items(): shutil.copy(p, cbdir/k)
    out = dict(id=ds_id, survey='BRFSS 2024', title='BRFSS 2024 — Land-line & Cell-phone (LLCP)', unit='adult respondent',
               n=len(df), parts=parts, required=['SEQNO','_STATE','_LLCPWT','_STSTR','_PSU'],
               optional_weights=['_CLLCPWT','_LLCPWT2','_STRWT','_WT2RAKE'],
               design=dict(ids='_PSU', strata='_STSTR', weights='_LLCPWT', nest=True),
               codebooks=[f'codebooks/{ds_id}/{k}' for k in docs], vars=vars_)
    print(ds_id, df.shape, parts); del df; gc.collect()
    return [out]

# ---------------------------------------------------------------- RSS7 (PDF codebook text)
STD = {'-5':'Edited response (invalid logic, out of range, or outlier)','-6':'Skipped/Implied refusal','-7':'Explicit refusal/REF',
       '-8':'Question not asked','-9':"Don't know"}
ROW = re.compile(r'^(.*?)\s*(-?\d+(?:\.\d+)?)\s+[\d,]+\s+[\d.]+\s+[\d,]+\s+[\d.]+$')
def parse_rss7(txtpath):
    """Parse `pdftotext -raw` output of the RSS-7 codebook."""
    meta = {}; cur = None; field = None; intable = False; pending = []
    for s in (l.strip() for l in Path(txtpath).read_text().splitlines()):
        if not s or s.startswith('NCHS Rapid Surveys System Round 7'): continue
        m = re.match(r'^Variable:\s+(\S+)', s)
        if m:
            cur = m.group(1); meta[cur] = dict(label='', question='', universe='', notes='', values=[]); field=None; intable=False; pending=[]; continue
        if cur is None: continue
        if s.startswith('Value Label'): intable = True; field = None; pending = []; continue
        if intable:
            if s in ('Weighted','Frequency','Percent'): continue
            if s.startswith('Total'): intable = False; continue
            mm = ROW.match(s)
            if mm:
                lab, val = mm.group(1).strip(), mm.group(2)
                if val in STD: lab = STD[val]
                elif pending: lab = (' '.join(pending) + ' ' + lab).strip()
                meta[cur]['values'].append([val, lab]); pending = []
            else: pending.append(s)
            continue
        m = re.match(r'^(Label|Question|Universe|Notes|Data Type):\s*(.*)$', s)
        if m:
            field = m.group(1).lower().replace(' ', '_')
            if field in meta[cur]: meta[cur][field] = m.group(2).strip()
            continue
        if field in meta[cur]: meta[cur][field] = (meta[cur][field] + ' ' + s).strip()
    return meta

def pdf_text_raw(pdf, txt):
    """Text in reading order (equivalent to `pdftotext -raw`). Uses poppler if installed, else pypdf."""
    if shutil.which('pdftotext'):
        import subprocess; subprocess.run(['pdftotext', '-raw', str(pdf), str(txt)], check=True)
    else:
        from pypdf import PdfReader
        Path(txt).write_text('\n'.join(pg.extract_text() or '' for pg in PdfReader(str(pdf)).pages), encoding='utf-8')
    return txt

def rss7():
    ds_id = 'rss7'
    df = pd.read_csv(UP/'RSS7/RSS7_PUF.csv', low_memory=False)
    cbm = parse_rss7(pdf_text_raw(UP/'RSS7/codebook.pdf', RAW/'rss7_raw.txt'))
    parts = write_parquet(df, ds_id)
    vars_ = [dict(name=c, label=cbm.get(c,{}).get('label',''), question=cbm.get(c,{}).get('question',''), notes=cbm.get(c,{}).get('notes',''),
                  universe=cbm.get(c,{}).get('universe',''), type=coltype(df[c]), values=cbm.get(c,{}).get('values',[])) for c in df.columns]
    cbdir = CB/ds_id; cbdir.mkdir(exist_ok=True)
    docs = ['codebook.pdf','questionnaire.pdf','RSS7-SurveyDescription.pdf']
    for f in docs: shutil.copy(UP/'RSS7'/f, cbdir/f)
    print(ds_id, df.shape, parts, 'labelled:', sum(1 for v in vars_ if v['label']))
    return [dict(id=ds_id, survey='RSS Round 7', title='NCHS Rapid Surveys System — Round 7 (Jul–Aug 2025)', unit='adult panelist',
                 n=len(df), parts=parts, required=['ID_R','WEIGHT','P_STRATA_R','P_PSU_R'], optional_weights=['P1_CALWT','P2_CALWT'],
                 design=dict(ids='P_PSU_R', strata='P_STRATA_R', weights='WEIGHT', nest=True),
                 codebooks=[f'codebooks/{ds_id}/{f}' for f in docs], vars=vars_)]

# ---------------------------------------------------------------- NAMCS 2024 HC (labels from the 2-page PDF codebook)
def namcs():
    ds_id = 'namcs2024'
    r = pyreadr.read_r(UP/'NAMCS2024/namcshc2024_R.rds'); df = list(r.values())[0]
    for c in df.columns:
        if str(df[c].dtype) == 'category':
            s = df[c].astype(str).replace({'nan': None})
            num = pd.to_numeric(s, errors='coerce')
            df[c] = num.astype('Int32') if num.notna().sum() == s.notna().sum() else s
        elif df[c].dtype == object or str(df[c].dtype) in ('str', 'string'):
            s = df[c].replace({'.': None, '': None}); num = pd.to_numeric(s, errors='coerce')
            if num.notna().sum() == s.notna().sum() and c not in ('MARITAL',): df[c] = num
    miss = [['-9','Missing']]
    L = {'PUF_ID':('Unique visit identifier on the PUF',[]), 'HCID_S':('Scrambled health center ID (PSU)',[]),
         'DAY':('Day of the week on which the encounter occurred',[[str(i),d] for i,d in enumerate(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],1)]),
         'MONTH':('Month in which the encounter occurred',[[str(i),m] for i,m in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'],1)]),
         'YEAR':('Survey year',[]),
         'MARITAL':('Patient marital status', miss+[['D','Divorced'],['L','Legally Separated'],['M','Married'],['O','Other'],['S','Single'],['T','Domestic Partner'],['U','Unmarried'],['W','Widowed']]),
         'AGE':('Patient age in years (89 = 89 years and older)',[['89','89 years and older']]),
         'AGE_GROUP':('Patient age group',[['-9','Blank'],['1','Less than 18 years'],['2','18-44 years'],['3','45-64 years'],['4','65 years or more']]),
         'AGE_U1_MONTH':('Age in months for patients less than 1 year old',[['-9','Missing'],['-7','Not applicable'],['0-11','Months']]),
         'ETHNICITY':('Patient Hispanic ethnicity',miss+[['1','Hispanic or Latino'],['2','Not Hispanic or Latino']]),
         'RACE':('Patient race',miss+[['1','Asian'],['2','Black'],['3','White'],['4','Other']]),
         'RACERETH':('Patient race and Hispanic ethnicity',miss+[['1','White'],['2','Black'],['3','Hispanic'],['4','Other']]),
         'SEX':('Patient sex',miss+[['1','Male'],['2','Female']]),
         'VISWT':('Visit level weight',[]), 'STRATUM_S':('Scrambled stratum of the HC',[])}
    for i in range(1,31):
        L[f'DX{i}'] = (f'Diagnosis #{i} (ICD-10-CM, truncated to 4 characters, no decimal)', miss)
        L[f'DX_TYPE{i}'] = (f'Diagnosis type #{i}', miss+[['1','Primary'],['2','Not Primary']])
    parts = write_parquet(df, ds_id)
    vars_ = [dict(name=c, label=L.get(c,('',[]))[0], type=coltype(df[c]), values=L.get(c,('',[]))[1]) for c in df.columns]
    cbdir = CB/ds_id; cbdir.mkdir(exist_ok=True)
    docs = ['2024-NAMCS-HC-Component-Codebook.pdf','2024-NAMCS-HC-Component-Technical-Documentation2.pdf']
    for f in docs: shutil.copy(UP/'NAMCS2024'/f, cbdir/f)
    print(ds_id, df.shape, parts)
    return [dict(id=ds_id, survey='NAMCS 2024', title='NAMCS 2024 — Health Center (HC) Component', unit='health center visit',
                 n=len(df), parts=parts, required=['PUF_ID','VISWT','STRATUM_S','HCID_S'], optional_weights=[],
                 design=dict(ids='HCID_S', strata='STRATUM_S', weights='VISWT', nest=True),
                 codebooks=[f'codebooks/{ds_id}/{f}' for f in docs], vars=vars_)]

if __name__ == '__main__':
    prepare()
    allds = namcs() + nhis() + rss7() + brfss()
    index = []
    for d in allds:
        (META/f"{d['id']}.json").write_text(json.dumps(d, separators=(',',':')))
        index.append({k: d[k] for k in ('id','survey','title','unit','n','codebooks')} | {'nvars': len(d['vars'])})
    (META/'datasets.json').write_text(json.dumps(index, indent=1))
    print('done')

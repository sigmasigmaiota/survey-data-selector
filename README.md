# Survey Data Selector

A variable-picker for student use. Students choose a survey, tick the variables they need, and download a .zip that contains:

- the data (CSV or Parquet), with the survey **weight, strata, PSU and record ID always included**
- a codebook (HTML + CSV) for exactly the variables they picked
- an R script that reads the file, attaches variable labels and builds the `survey::svydesign()` object
- a README with the design variables and missing-value notes

The full official documentation for each survey (codebooks, questionnaires, technical/weighting documentation) is linked on the page for download.

| Survey | File(s) | Rows | Variables | Weight / strata / PSU always included |
|---|---|---:|---:|---|
| NHIS 2025 | Sample Adult | 24,215 | 578 | `WTFA_A`, `PSTRAT`, `PPSU` (+ optional `final_pair_weight`) |
| | Sample Child | 6,049 | 356 | `WTFA_C`, `PSTRAT`, `PPSU` (+ optional `final_pair_weight`) |
| | Adult imputed income (10 implicates) | 242,150 | 10 | `WTFA_A`, `PSTRAT`, `PPSU`, `IMPNUM_A` (weights joined in from Sample Adult) |
| | Child imputed income (10 implicates) | 60,490 | 10 | `WTFA_C`, `PSTRAT`, `PPSU`, `IMPNUM_C` (weights joined in from Sample Child) |
| | Paradata | 58,229 | 123 | `WTIA_PD`, `PSTRAT`, `PPSU` |
| BRFSS 2024 | LLCP (all states) | 457,670 | 301 | `_LLCPWT`, `_STSTR`, `_PSU` (+ optional `_CLLCPWT`, `_LLCPWT2`, `_STRWT`, `_WT2RAKE`); optional state filter |
| NAMCS 2024 | Health Center component | 503,799 | 75 | `VISWT`, `STRATUM_S`, `HCID_S` |
| RSS Round 7 | Public-use file | 8,118 | 231 | `WEIGHT`, `P_STRATA_R`, `P_PSU_R` (+ optional `P1_CALWT`, `P2_CALWT`) |

## How it works (and why it costs nothing to host)

There is no server. The page is plain HTML/JS; the data sit next to it as compressed Parquet files (about 46 MB for all four surveys). When a student clicks **Download**, [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) runs inside their browser, fetches *only the columns they selected* from the Parquet files (HTTP range requests), writes the CSV/Parquet, and zips it. Any static web host therefore works, and a 6-variable BRFSS extract moves only a few MB over the network.

```
index.html  app.js  style.css      ← the app
meta/       datasets.json + one variable catalog per file (labels, questions, value codes)
data/       <dataset>/part-NNN.parquet   (each file < 25 MB)
codebooks/  official PDFs/HTML per dataset
prep/       build_data.py — rebuilds data/, meta/, codebooks/ from your SOHLER folder
```

Total size ≈ 100 MB (46 MB data, 51 MB documentation). No file exceeds 25 MB, so it fits GitHub, GitHub Pages, Cloudflare Pages and Netlify limits.

---

## Deployment options

### Option 1 — GitHub Pages (recommended; $0)

Free, uses GitHub directly, no build step.

1. Create a new repository on github.com, e.g. `survey-data-selector`. On a free GitHub account Pages requires the repo to be **public**. That's fine here because all of these are public-use files. To keep the repo private, you need GitHub Pro/Team. Faculty can get that free through GitHub Education.
2. Upload the contents of this folder (not the folder itself) to the repo root. The easiest way is **GitHub Desktop**: *File → Add local repository*, then commit and *Publish*. With command-line git:
   ```bash
   cd survey-data-selector
   git init && git add . && git commit -m "Survey Data Selector"
   git branch -M main
   git remote add origin https://github.com/<your-user>/survey-data-selector.git
   git push -u origin main
   ```
   (The web "Add file → Upload files" button also works because every file is under 25 MB. It takes at most 100 files per upload, so drag the folders in a few batches.)
3. In the repo, open **Settings → Pages → Build and deployment**. Set *Source: Deploy from a branch*, *Branch: main / (root)*, then **Save**.
4. After a minute or two the site is live at `https://<your-user>.github.io/survey-data-selector/`. Share that link with students, or link to a specific file with `…/#brfss2024`, `…/#nhis2025_adult`, `…/#namcs2024`, `…/#rss7`.

Limits that matter: published site ≤ 1 GB (this is ~0.1 GB), soft bandwidth cap of 100 GB/month, and files ≤ 100 MB. A class of 50–100 students running several extracts each stays far below the bandwidth cap. The biggest transfers are the codebook PDFs, not the data.

### Option 2 — Cloudflare Pages connected to the GitHub repo ($0, unlimited bandwidth)

Use this if you want the repo to stay **private** on a free GitHub account, or if you're worried about bandwidth.

1. Push the repo to GitHub as in Option 1 (it can be private).
2. In the Cloudflare dashboard, open **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
3. Set the framework preset to *None*, leave the build command empty, and set the output directory to `/`. Then deploy.
4. You get `https://survey-data-selector.pages.dev`. Every `git push` redeploys the site automatically.

Free tier: unlimited bandwidth and requests, with a 25 MiB cap per file. The build script already splits data to stay under that.

### Option 3 — Netlify or Vercel ($0 tiers)

These work the same way as Cloudflare: connect the GitHub repo, use no build command, and publish the repo root. Their free tiers cap monthly bandwidth (around 100 GB), which is still plenty for a class. Pick one only if you already use it.

### Option 4 — Any CUNY / departmental web space ($0 if available)

Because the app is just static files, you can copy the folder to any web server, such as a school web directory or a SharePoint-hosted site that serves raw files. The server must allow normal file downloads. If it doesn't support HTTP range requests, the app falls back to downloading whole Parquet files, which still works but is slower for BRFSS.

### Option 5 — R Shiny instead (not recommended for this use)

You could rewrite the selector as a Shiny app (shinyapps.io, Posit Connect Cloud, or Hugging Face Spaces, all of which have free tiers). The trade-offs:

- Every download runs on a server. Free tiers have small memory (BRFSS alone is ~1 GB in R) and capped monthly active hours.
- Apps go to sleep and take a while to wake up, and class-sized concurrent use can push you onto paid plans.

The static version above has none of these limits and is easier to keep running for years.

**Cost summary:** Options 1–4 are $0. Options 1 and 2 both deploy from GitHub. Option 1 is the fewest clicks. Option 2 is the best choice if the repo must be private or traffic gets heavy.

---

## Updating the data (new survey year, extra files)

Requires Python 3.10+ (Anaconda is fine):

```bash
pip install -r prep/requirements.txt
python prep/build_data.py --src "C:/Users/steph/OneDrive/CUNY_CSOM/SOHLER" --out .
```

The script reads `NAMCS2024/namcshc2024_R.rds`, `NHIS2025/*csv.zip`, `BRFSS/LLCP2024XPT.zip` (+ `BRFSS/codebook24/…HTML`) and `RSS7/RSS7_PUF.csv` (+ `RSS7/codebook.pdf`). It also downloads the NHIS SPSS label programs and codebook PDFs from the NCHS FTP site, then rewrites `data/`, `meta/` and `codebooks/`. After that, commit and push. Variable labels and value codes come from:

- **NHIS:** the NCHS SPSS programs (`adult.sps`, etc.)
- **BRFSS:** the CDC HTML codebook
- **RSS-7:** the public-use codebook PDF
- **NAMCS:** the 2024 HC codebook (75 variables, hand-entered in the script)

For a new year, update the file names and weight variable names in the `nhis()`, `brfss()`, `rss7()` and `namcs()` functions.

## Running locally

Browsers block `fetch()` from `file://`, so serve the folder:

```bash
python -m http.server 8000      # then open http://localhost:8000
```

## Notes for instructors

- Missing/refused codes (7, 9, 77, 99, negative RSS codes) are left as numbers, exactly as in the public-use files. The bundled README and codebook remind students to recode them.
- Subsetting rows before building a survey design gives wrong standard errors. The only row filter offered is BRFSS state, and states are BRFSS sampling strata. The generated R script tells students to use `subset(design, …)` for everything else.
- NHIS income files are multiply imputed. For those files the R script builds the design with `mitools::imputationList()`.
- BRFSS optional modules asked on only some questionnaire versions may need version-specific weights. See `2024-Weighting-Description-508.pdf`.
- The page uses DuckDB-WASM and fflate from the jsDelivr CDN, with pinned versions, and Google Fonts. No accounts, cookies or analytics.

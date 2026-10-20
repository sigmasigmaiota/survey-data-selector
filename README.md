# Survey Data Selector

A web app for choosing variables from public-use health survey files and downloading them as one extract.

**Live site:** https://sigmasigmaiota.github.io/survey-data-selector/

Each download is a .zip that contains:

- the data (CSV or Parquet), with the survey **weight, strata, PSU and record ID always included**
- a codebook (HTML + CSV) for exactly the variables selected
- an R script that reads the file, attaches variable labels and builds the `survey::svydesign()` object
- a README with the design variables and missing-value notes

The full official documentation for each survey (codebooks, questionnaires, technical and weighting documentation) is available for download on the page.

## Datasets

| Survey | File | Rows | Variables | Weight / strata / PSU always included |
|---|---|---:|---:|---|
| NHIS 2025 | Sample Adult | 24,215 | 578 | `WTFA_A`, `PSTRAT`, `PPSU` (+ optional `final_pair_weight`) |
| | Sample Child | 6,049 | 356 | `WTFA_C`, `PSTRAT`, `PPSU` (+ optional `final_pair_weight`) |
| | Adult imputed income (10 implicates) | 242,150 | 10 | `WTFA_A`, `PSTRAT`, `PPSU`, `IMPNUM_A` (weights joined from Sample Adult) |
| | Child imputed income (10 implicates) | 60,490 | 10 | `WTFA_C`, `PSTRAT`, `PPSU`, `IMPNUM_C` (weights joined from Sample Child) |
| | Paradata | 58,229 | 123 | `WTIA_PD`, `PSTRAT`, `PPSU` |
| BRFSS 2024 | LLCP (all states) | 457,670 | 301 | `_LLCPWT`, `_STSTR`, `_PSU` (+ optional `_CLLCPWT`, `_LLCPWT2`, `_STRWT`, `_WT2RAKE`); optional state filter |
| NAMCS 2024 | Health Center component | 503,799 | 75 | `VISWT`, `STRATUM_S`, `HCID_S` |
| RSS Round 7 | Public-use file | 8,118 | 231 | `WEIGHT`, `P_STRATA_R`, `P_PSU_R` (+ optional `P1_CALWT`, `P2_CALWT`) |

Direct links to each dataset: `#brfss2024`, `#nhis2025_adult`, `#nhis2025_child`, `#nhis2025_adultinc`, `#nhis2025_childinc`, `#nhis2025_paradata`, `#namcs2024`, `#rss7`.

## How it works

The app is a static site with no server. The data are stored next to the page as compressed Parquet files (about 46 MB for all four surveys). On download, [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) runs in the browser, reads only the selected columns, writes the CSV or Parquet file, and zips it with the codebook and R script. Nothing selected on the page is sent anywhere.

```
index.html  app.js  style.css      the app
meta/       datasets.json + one variable catalog per file (labels, questions, value codes)
data/       <dataset>/part-NNN.parquet   (each file < 25 MB)
codebooks/  official PDF/HTML documentation per dataset
prep/       build_data.py, which builds data/, meta/ and codebooks/ from the source files
```

## Sources of labels and value codes

- **NHIS:** NCHS SPSS label programs (`adult.sps`, `child.sps`, etc.)
- **BRFSS:** the CDC 2024 LLCP HTML codebook
- **RSS-7:** the NCHS public-use codebook PDF
- **NAMCS:** the 2024 Health Center component codebook

## Data notes

- Missing, refused and don't-know codes (7, 9, 77, 99, negative RSS codes) are kept as numbers, exactly as in the public-use files. The bundled codebook lists them for each variable.
- The only row filter is BRFSS state. States are BRFSS sampling strata, so a single-state extract still supports design-based estimates. The generated R script uses `subset(design, …)` for other subgroups so standard errors stay correct.
- The NHIS imputed income files are multiply imputed. The generated R script builds their design with `mitools::imputationList()`.
- BRFSS optional modules asked on only some questionnaire versions may need version-specific weights. See `2024-Weighting-Description-508.pdf`.
- All files are public-use data from the National Center for Health Statistics (NAMCS, NHIS, RSS) and the CDC Behavioral Risk Factor Surveillance System. NCHS data-use restrictions apply.

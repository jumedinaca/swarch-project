# GeoPicto — Performance Testing & Resource Monitoring Suite (Persona 8)

Automated execution, Docker resource telemetry, statistical analysis, high-resolution English charts, and Markdown report generation for **Prototype 3 (Performance & Scalability Analysis)**.

Designed on branch `feat/performance-analysis` so that once the integrated Prototype 3 branch (TLS + Reverse Proxy + Network Segmentation + Rate Limiting + Token Blacklist) is ready, running the full suite and generating the report takes **a single command**.

---

## 1. Quick Start (One-Command Execution)

### A. Run on the Integrated Prototype 3 Branch (`p3-hardened`)
1. Start the integrated Prototype 3 stack with **Rate Limiting disabled** for capacity/knee measurement (recommended so HTTP `429` does not mask true architectural saturation):
   ```bash
   RATE_LIMIT_ENABLED=false docker compose up --build -d --wait
   ```
2. Run the full suite (**Load**, **Stress up to 2000 VUs**, **Spike up to 1000 VUs**):
   ```bash
   ./performance/run-performance-suite.sh --label p3-hardened
   ```
3. *(Optional — Scenario 4 validation)* Re-enable Rate Limiting and run the protected burst profile:
   ```bash
   RATE_LIMIT_ENABLED=true docker compose up -d gateway
   ./performance/run-performance-suite.sh --label p3-ratelimit --profiles "ratelimit" --skip-seed
   ```

### B. *(Recommended Bonus)* Run Baseline on `main` (Prototype 2) & Compare Trade-offs
To quantify the exact **Security vs. Performance** overhead of Prototype 3 without modifying `main`:
1. Start Prototype 2 on `main` (`http://localhost:8080`) and run:
   ```bash
   ./performance/run-performance-suite.sh --label p2-baseline
   ```
2. After running `--label p3-hardened` on the Prototype 3 branch, generate the comparison chart (`06_p2_vs_p3_security_tradeoff.png`) and trade-off section:
   ```bash
   python3 performance/analyze_results.py \
     --compare performance/results/p2-baseline performance/results/p3-hardened
   ```

---

## 2. Generated Deliverables (Ready for Prototype 3 Document)

All outputs are stored under `performance/results/<label>/` (and symlinked at `performance/results/latest/`):

| Output | Description |
| :--- | :--- |
| `p3_performance_section.md` | Complete **English** Markdown section with environment specs, SEI Performance QAS, all quantitative tables, chart links, and automated bottleneck analysis. |
| `charts/01_load_latency_throughput.png` | Nominal Load Test (`25 → 50 → 100 VUs`) latency percentiles (`p50/p90/p95/p99`) & throughput. |
| `charts/02_stress_performance_curve_knee.png` | Stress Test (`25 → 2000 VUs`) performance curve, **Knee of the Curve** annotation, saturation zone, RPS & error rate. |
| `charts/03_spike_behavior_recovery.png` | Spike Test (`25 → 1000 → 25 VUs`) time-series latency, RPS, error rate & measured recovery time. |
| `charts/04_flows_latency_comparison.png` | Per-flow latency comparison (`Nearby PostGIS`, `Write + RabbitMQ`, `Auth Argon2id`, `Network GraphQL`). |
| `charts/05_resources_cpu_ram_top.png` | Top 10 containers by Peak/Avg CPU (%) and RAM (MiB) + CPU timeline across stress levels. |
| `charts/06_p2_vs_p3_security_tradeoff.png` | *(With `--compare`)* Prototype 2 Baseline vs. Prototype 3 Hardened latency overhead & knee shift. |
| `tables/*.csv` & `tables/knee_analysis.json` | Raw structured tables for spreadsheets or custom formatting. |

---

## 3. Useful Overrides & Integration with Persona 7

All load levels and timings can be tuned via environment variables:

```bash
# Example: custom stress sweep or 2000-VU spike
LOAD_LEVELS="25 50 100" \
STRESS_LEVELS="25 100 250 500 1000 2000" \
SPIKE_VUS=1500 \
REQ_TIMEOUT="5s" \
./performance/run-performance-suite.sh --label p3-hardened

# Example: profile a single isolated flow (nearby | write | auth | graphql | mixed)
./performance/run-performance-suite.sh --label p3-auth-only --flow auth --profiles "stress"

# Example: plug in a custom Persona 7 k6 script while keeping Persona 8 metrics & reporting
CUSTOM_K6_SCRIPT=performance/scenarios/nearby.js \
./performance/run-performance-suite.sh --label p3-p7-nearby --profiles "stress"
```

- **Seeding contract with Persona 7:** If `performance/seed-data.mjs` exists, `run-performance-suite.sh` executes it first. If `performance/.seed-manifest.json` is not present afterward, it automatically runs `performance/profiles/seed-fallback.mjs`.

---

## 4. Pipeline Self-Test (No Running Stack Required)

Verify the entire statistical engine, knee calculation, all 6 PNG charts, and English Markdown generator with synthetic 2000-VU datasets at any time:

```bash
python3 performance/validate_pipeline.py
```

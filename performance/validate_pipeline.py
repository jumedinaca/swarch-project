#!/usr/bin/env python3
"""
GeoPicto — Automated Pipeline Verification Suite (Persona 8)
============================================================
Validates analyze_results.py (single-run & --compare modes) using realistic
synthetic datasets covering:
  - Load Test: 25 -> 50 -> 100 VUs
  - Stress Test: 25 -> 100 -> 250 -> 500 -> 1000 -> 2000 VUs (saturation & knee)
  - Spike Test: 25 -> 1000 -> 25 VUs (time-series burst & recovery)
  - Protected Rate-Limit Burst: 100 VUs (HTTP 429 vs 5xx separation)
  - Docker container telemetry for 25 P3 containers (including reverse-proxy)
  - P2 Baseline vs. P3 Hardened security trade-off comparison

Usage:
  python3 performance/validate_pipeline.py
  python3 performance/validate_pipeline.py --keep-dir /tmp/geopicto_perf_preview
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def make_k6_summary(
    vus: int,
    rps: float,
    avg_ms: float,
    p50_ms: float,
    p90_ms: float,
    p95_ms: float,
    p99_ms: float,
    max_ms: float,
    real_err_pct: float,
    rate_429_pct: float = 0.0,
    duration_s: int = 30,
) -> dict:
    samples = max(1, int(rps * duration_s))
    r429_count = int(samples * rate_429_pct / 100.0)
    err_count = int(samples * real_err_pct / 100.0)
    total_fail_rate = min(1.0, (real_err_pct + rate_429_pct) / 100.0)

    # Realistic per-flow latency ratios grounded in GeoPicto stack
    return {
        "metrics": {
            "vus_max": {"values": {"max": vus, "min": vus, "value": vus}},
            "http_reqs": {"values": {"count": samples, "rate": rps}},
            "http_req_duration": {
                "values": {
                    "avg": avg_ms,
                    "min": max(3.0, p50_ms * 0.25),
                    "med": p50_ms,
                    "p(90)": p90_ms,
                    "p(95)": p95_ms,
                    "p(99)": p99_ms,
                    "max": max_ms,
                }
            },
            "http_req_failed": {"values": {"rate": total_fail_rate}},
            "real_error_rate": {"values": {"rate": real_err_pct / 100.0}},
            "rate_limited_rate": {"values": {"rate": rate_429_pct / 100.0}},
            "http_429_responses": {"values": {"count": r429_count}},
            "http_5xx_or_timeout": {"values": {"count": err_count}},
            "flow_nearby_duration": {
                "values": {
                    "avg": avg_ms * 0.65,
                    "min": 4.2,
                    "med": p50_ms * 0.62,
                    "p(90)": p90_ms * 0.68,
                    "p(95)": p95_ms * 0.70,
                    "p(99)": p99_ms * 0.72,
                    "max": max_ms * 0.72,
                }
            },
            "flow_nearby_reqs": {"values": {"count": int(samples * 0.50), "rate": rps * 0.50}},
            "flow_graphql_duration": {
                "values": {
                    "avg": avg_ms * 0.95,
                    "min": 7.5,
                    "med": p50_ms * 0.92,
                    "p(90)": p90_ms * 0.98,
                    "p(95)": p95_ms * 1.02,
                    "p(99)": p99_ms * 1.06,
                    "max": max_ms * 1.05,
                }
            },
            "flow_graphql_reqs": {"values": {"count": int(samples * 0.20), "rate": rps * 0.20}},
            "flow_write_duration": {
                "values": {
                    "avg": avg_ms * 1.25,
                    "min": 11.0,
                    "med": p50_ms * 1.18,
                    "p(90)": p90_ms * 1.28,
                    "p(95)": p95_ms * 1.32,
                    "p(99)": p99_ms * 1.36,
                    "max": max_ms * 1.35,
                }
            },
            "flow_write_reqs": {"values": {"count": int(samples * 0.20), "rate": rps * 0.20}},
            "flow_auth_duration": {
                "values": {
                    "avg": avg_ms * 2.15,
                    "min": 42.0,
                    "med": p50_ms * 2.05,
                    "p(90)": p90_ms * 2.15,
                    "p(95)": p95_ms * 2.25,
                    "p(99)": p99_ms * 2.35,
                    "max": max_ms * 2.40,
                }
            },
            "flow_auth_reqs": {"values": {"count": int(samples * 0.10), "rate": rps * 0.10}},
        }
    }


def write_synthetic_run(run_dir: Path, is_p3: bool) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    overhead = 1.14 if is_p3 else 1.00
    label = "p3-hardened" if is_p3 else "p2-baseline"

    # 1. host_info.json
    containers = [
        "geopicto-gateway-1", "geopicto-frontend-1", "geopicto-profile-web-1",
        "geopicto-auth-1", "geopicto-messages-1", "geopicto-moderation-1",
        "geopicto-network-1", "geopicto-profile-1", "geopicto-rating-1",
        "geopicto-reputation-1", "geopicto-socket-gateway-1", "geopicto-email-1",
        "geopicto-auth-db-1", "geopicto-messages-db-1", "geopicto-moderation-db-1",
        "geopicto-network-db-1", "geopicto-profile-db-1", "geopicto-rating-db-1",
        "geopicto-reputation-db-1", "geopicto-email-db-1",
        "geopicto-redis-1", "geopicto-rabbitmq-1", "geopicto-minio-1", "geopicto-mailpit-1",
    ]
    if is_p3:
        containers.insert(0, "geopicto-reverse-proxy-1")

    host_info = {
        "captured_at_utc": "2026-11-22T22:00:00+00:00",
        "run_label": label,
        "git_branch": "prototype-3" if is_p3 else "main",
        "git_commit": "abc1234" if is_p3 else "c7ee883",
        "target": {
            "base_url": "https://localhost" if is_p3 else "http://localhost:8080",
            "protocol": "HTTPS" if is_p3 else "HTTP",
            "reverse_proxy_detected": is_p3,
            "rate_limit_mode": "disabled" if is_p3 else "not_configured",
            "compose_project": "geopicto",
        },
        "host": {
            "os": "Darwin 24.6.0",
            "arch": "arm64",
            "cpu_model": "Apple M-Series (Synthetic Validation)",
            "cpu_cores_logical": 10,
            "ram_total_gb": 16.0,
        },
        "docker_engine": {
            "version": "Docker version 28.0.0",
            "allocated_cpus": 8,
            "allocated_ram_gb": 8.0,
            "active_containers_count": len(containers),
            "active_containers": containers,
        },
        "tools": {"k6": "k6 v0.57.0", "node": "v20.20.2", "python": "3.14.0"},
    }
    (run_dir / "host_info.json").write_text(json.dumps(host_info, indent=2), encoding="utf-8")

    # 2. Load Test (25 -> 50 -> 100 VUs)
    load_points = [
        (25, 24.5 / overhead, 34 * overhead, 26 * overhead, 55 * overhead, 74 * overhead, 118 * overhead, 185 * overhead, 0.0),
        (50, 48.2 / overhead, 52 * overhead, 41 * overhead, 88 * overhead, 116 * overhead, 175 * overhead, 270 * overhead, 0.0),
        (100, 91.8 / overhead, 96 * overhead, 75 * overhead, 165 * overhead, 218 * overhead, 340 * overhead, 520 * overhead, 0.0),
    ]
    for vus, rps, avg, p50, p90, p95, p99, mx, err in load_points:
        data = make_k6_summary(vus, rps, avg, p50, p90, p95, p99, mx, err)
        (run_dir / f"summary_load_{vus}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    # 3. Stress Test (25 -> 100 -> 250 -> 500 -> 1000 -> 2000 VUs)
    # P2 knee at 500 VUs, P3 knee at 250 VUs (realistic TLS + Redis trade-off)
    if is_p3:
        stress_points = [
            (25, 23.8, 39.0, 30.0, 62.0, 84.0, 132.0, 210.0, 0.0),
            (100, 88.5, 110.0, 86.0, 188.0, 248.0, 385.0, 610.0, 0.0),
            (250, 186.4, 245.0, 195.0, 410.0, 520.0, 760.0, 1180.0, 0.25),
            (500, 242.0, 680.0, 540.0, 1180.0, 1490.0, 2150.0, 3400.0, 3.80),
            (1000, 231.5, 1620.0, 1380.0, 2650.0, 3180.0, 4420.0, 5000.0, 18.40),
            (2000, 194.2, 2980.0, 2710.0, 4380.0, 4820.0, 5000.0, 5000.0, 44.60),
        ]
    else:
        stress_points = [
            (25, 25.1, 32.0, 24.0, 52.0, 70.0, 112.0, 175.0, 0.0),
            (100, 95.2, 92.0, 72.0, 158.0, 210.0, 325.0, 510.0, 0.0),
            (250, 212.8, 198.0, 155.0, 330.0, 425.0, 620.0, 950.0, 0.0),
            (500, 279.6, 465.0, 380.0, 790.0, 980.0, 1420.0, 2150.0, 0.65),
            (1000, 268.1, 1340.0, 1120.0, 2240.0, 2760.0, 3920.0, 5000.0, 13.20),
            (2000, 225.4, 2610.0, 2350.0, 3980.0, 4590.0, 5000.0, 5000.0, 36.80),
        ]
    for vus, rps, avg, p50, p90, p95, p99, mx, err in stress_points:
        data = make_k6_summary(vus, rps, avg, p50, p90, p95, p99, mx, err)
        (run_dir / f"summary_stress_{vus}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    # 4. Protected Rate-Limit burst (only on P3)
    if is_p3:
        rl_data = make_k6_summary(100, 145.0, 28.0, 18.0, 55.0, 78.0, 125.0, 210.0, real_err_pct=0.0, rate_429_pct=41.5)
        (run_dir / "summary_ratelimit_100.json").write_text(json.dumps(rl_data, indent=2), encoding="utf-8")

    # 5. Spike Test (25 -> 1000 -> 25 VUs)
    spike_meta = {
        "base_vus": 25,
        "spike_vus": 1000,
        "base_duration_s": 20,
        "ramp_up_s": 5,
        "spike_duration_s": 25,
        "ramp_down_s": 5,
        "recovery_duration_s": 40,
    }
    (run_dir / "spike_meta.json").write_text(json.dumps(spike_meta, indent=2), encoding="utf-8")
    (run_dir / "summary_spike.json").write_text(
        json.dumps(make_k6_summary(1000, 124.0, 620.0, 185.0, 1850.0, 2650.0, 3950.0, 5000.0, 6.2, duration_s=95), indent=2),
        encoding="utf-8",
    )

    with (run_dir / "spike_timeseries.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["elapsed_s", "epoch_s", "vus", "rps", "avg_ms", "p50_ms", "p95_ms", "p99_ms", "err_pct", "rate_429_pct", "total_reqs"])
        base_epoch = 1763848800
        for sec in range(0, 96, 2):
            if sec <= 20:
                vus_v, rps_v, p50_v, p95_v, p99_v, err_v = 25.0, 24.0, 32.0, 82.0, 125.0, 0.0
            elif sec <= 25:
                frac = (sec - 20) / 5.0
                vus_v = 25.0 + 975.0 * frac
                rps_v = 24.0 + 205.0 * frac
                p50_v = 32.0 + 920.0 * frac
                p95_v = 82.0 + 2150.0 * frac
                p99_v = 125.0 + 3100.0 * frac
                err_v = 11.0 * frac
            elif sec <= 50:
                wave = math.sin(sec * 0.4) * 0.08
                vus_v = 1000.0
                rps_v = 232.0 * (1.0 + wave)
                p50_v = 1180.0 * (1.0 + wave)
                p95_v = 2850.0 * (1.0 + wave)
                p99_v = 4120.0 * (1.0 + wave * 0.6)
                err_v = 15.8 + wave * 25.0
            elif sec <= 55:
                frac = (sec - 50) / 5.0
                vus_v = 1000.0 - 975.0 * frac
                rps_v = 230.0 - 180.0 * frac
                p50_v = 1100.0 - 750.0 * frac
                p95_v = 2600.0 - 1850.0 * frac
                p99_v = 3800.0 - 2600.0 * frac
                err_v = max(0.0, 14.0 * (1.0 - frac))
            else:
                # Exponential decay back to baseline within ~8 seconds
                dt = sec - 55
                decay = math.exp(-dt / 4.2)
                vus_v = 25.0
                rps_v = 24.5 + 14.0 * decay
                p50_v = 34.0 + 310.0 * decay
                p95_v = 86.0 + 640.0 * decay
                p99_v = 132.0 + 1050.0 * decay
                err_v = max(0.0, 4.5 * decay - 0.5)
            avg_v = p50_v * 1.18
            w.writerow([
                sec, base_epoch + sec, f"{vus_v:.1f}", f"{rps_v:.2f}",
                f"{avg_v:.2f}", f"{p50_v:.2f}", f"{p95_v:.2f}", f"{p99_v:.2f}",
                f"{err_v:.2f}", "0.00", int(rps_v * 2),
            ])

    # 6. Docker stats CSV for Stress Test across 25 containers
    profiles_map = [
        ("auth", "microservices", 16.0, 210.0, 142.0, 215.0, 0.8),
        ("gateway", "edge", 18.0, 178.0, 310.0, 445.0, 2.4),
        ("messages-db", "databases", 14.0, 152.0, 220.0, 380.0, 1.9),
        ("messages", "microservices", 11.0, 118.0, 48.0, 92.0, 1.8),
        ("network", "microservices", 9.0, 96.0, 130.0, 195.0, 0.9),
        ("network-db", "databases", 7.0, 74.0, 260.0, 365.0, 0.8),
        ("rabbitmq", "infra", 6.0, 68.0, 195.0, 285.0, 1.1),
        ("rating", "microservices", 5.5, 62.0, 42.0, 78.0, 0.6),
        ("redis", "infra", 4.0, 54.0 if is_p3 else 18.0, 24.0, 48.0, 1.2 if is_p3 else 0.3),
        ("moderation", "microservices", 5.0, 49.0, 118.0, 164.0, 0.4),
        ("rating-db", "databases", 4.0, 44.0, 95.0, 145.0, 0.5),
        ("auth-db", "databases", 3.5, 39.0, 88.0, 132.0, 0.4),
        ("reputation", "microservices", 2.0, 22.0, 36.0, 58.0, 0.2),
        ("socket-gateway", "microservices", 2.5, 18.0, 86.0, 112.0, 0.2),
        ("profile", "microservices", 1.5, 12.0, 98.0, 118.0, 0.1),
        ("profile-web", "edge", 1.0, 8.0, 145.0, 162.0, 0.05),
        ("frontend", "edge", 0.5, 4.0, 28.0, 34.0, 0.05),
        ("minio", "infra", 0.8, 3.5, 110.0, 124.0, 0.02),
        ("email", "microservices", 0.4, 2.5, 72.0, 80.0, 0.02),
        ("moderation-db", "databases", 1.2, 14.0, 74.0, 96.0, 0.1),
        ("profile-db", "databases", 0.6, 5.0, 68.0, 78.0, 0.02),
        ("reputation-db", "databases", 0.9, 10.0, 66.0, 84.0, 0.05),
        ("email-db", "databases", 0.3, 2.0, 58.0, 62.0, 0.01),
        ("mailpit", "infra", 0.2, 1.2, 24.0, 28.0, 0.01),
    ]
    if is_p3:
        profiles_map.insert(2, ("reverse-proxy", "edge", 12.0, 134.0, 32.0, 68.0, 3.2))

    phases = [
        ("stress_25vus", 0.15),
        ("stress_100vus", 0.35),
        ("stress_250vus", 0.62),
        ("stress_500vus", 0.84),
        ("stress_1000vus", 0.96),
        ("stress_2000vus", 1.00),
    ]

    with (run_dir / "stress_docker_stats.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "timestamp_iso", "epoch_s", "elapsed_s", "phase", "container", "tier",
            "cpu_pct", "mem_used_mb", "mem_limit_mb", "mem_pct",
            "net_rx_mb", "net_tx_mb", "block_read_mb", "block_write_mb", "pids",
        ])
        elapsed = 0
        epoch0 = 1763848000
        cum_net = {c[0]: [1.0, 1.0] for c in profiles_map}
        for phase_name, factor in phases:
            for tick in range(5):
                elapsed += 6
                jitter = 1.0 + math.sin(elapsed * 0.3) * 0.06
                for cname, tier, cpu_lo, cpu_hi, mem_lo, mem_hi, net_step in profiles_map:
                    cpu_val = (cpu_lo + (cpu_hi - cpu_lo) * factor) * jitter
                    mem_val = mem_lo + (mem_hi - mem_lo) * (0.3 + 0.7 * factor)
                    mem_lim = 8192.0
                    cum_net[cname][0] += net_step * factor
                    cum_net[cname][1] += net_step * 0.85 * factor
                    w.writerow([
                        "2026-11-22T22:00:00Z", epoch0 + elapsed, elapsed, phase_name, cname, tier,
                        f"{cpu_val:.2f}", f"{mem_val:.2f}", f"{mem_lim:.2f}", f"{(mem_val / mem_lim) * 100:.2f}",
                        f"{cum_net[cname][0]:.3f}", f"{cum_net[cname][1]:.3f}", "1.500", "2.100", int(18 + 30 * factor),
                    ])


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate GeoPicto Persona 8 performance analytics pipeline.")
    parser.add_argument("--keep-dir", help="Keep generated synthetic outputs in this directory for visual inspection")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    analyzer = script_dir / "analyze_results.py"

    if args.keep_dir:
        work_dir = Path(args.keep_dir).resolve()
        if work_dir.exists():
            shutil.rmtree(work_dir)
        work_dir.mkdir(parents=True, exist_ok=True)
        cleanup = False
    else:
        work_dir = Path(tempfile.mkdtemp(prefix="geopicto_perf_val_"))
        cleanup = True

    try:
        p2_dir = work_dir / "p2-baseline"
        p3_dir = work_dir / "p3-hardened"
        write_synthetic_run(p2_dir, is_p3=False)
        write_synthetic_run(p3_dir, is_p3=True)

        # 1. Run single-run analysis on P2 and P3
        subprocess.run([sys.executable, str(analyzer), str(p2_dir)], check=True)
        subprocess.run([sys.executable, str(analyzer), str(p3_dir)], check=True)

        # 2. Run P2 vs P3 comparison mode
        subprocess.run([sys.executable, str(analyzer), "--compare", str(p2_dir), str(p3_dir)], check=True)

        # 3. Assertions on all expected tables, charts, knee detection, and English report
        expected_tables = [
            "load_summary.csv",
            "stress_summary.csv",
            "knee_analysis.json",
            "flows_summary.csv",
            "spike_summary.csv",
            "resources_summary.csv",
            "p2_vs_p3_comparison.csv",
        ]
        for fname in expected_tables:
            fpath = p3_dir / "tables" / fname
            assert fpath.exists() and fpath.stat().st_size > 20, f"Missing or empty table: {fpath}"

        expected_charts = [
            "01_load_latency_throughput.png",
            "02_stress_performance_curve_knee.png",
            "03_spike_behavior_recovery.png",
            "04_flows_latency_comparison.png",
            "05_resources_cpu_ram_top.png",
            "06_p2_vs_p3_security_tradeoff.png",
        ]
        for cname in expected_charts:
            cpath = p3_dir / "charts" / cname
            assert cpath.exists() and cpath.stat().st_size > 15_000, f"Missing or invalid PNG chart: {cpath}"

        knee = json.loads((p3_dir / "tables" / "knee_analysis.json").read_text(encoding="utf-8"))
        assert knee["knee_vus"] == 250, f"Expected P3 knee at 250 VUs, got {knee}"
        assert knee["max_tested_vus"] == 2000, f"Expected max_tested_vus == 2000, got {knee}"
        assert knee["first_error_vus"] == 500, f"Expected first_error_vus == 500, got {knee}"

        report = (p3_dir / "p3_performance_section.md").read_text(encoding="utf-8")
        for required_phrase in [
            "Performance & Scalability Analysis",
            "Test Environment & Tools",
            "Performance Quality Attribute Scenario",
            "Load Test Results",
            "Stress Test Results & Knee of the Performance Curve",
            "Spike Test & Recovery Resilience",
            "Per-Flow Latency Breakdown",
            "Protected Burst Validation",
            "Container Hardware Resource Utilization",
            "Architectural Trade-off: Prototype 2 (Baseline) vs. Prototype 3 (Hardened Security)",
            "Critical Architectural Bottleneck Analysis & Conclusions",
            "2000",
            "p99 (ms)",
            "06_p2_vs_p3_security_tradeoff.png",
        ]:
            assert required_phrase in report, f"Report missing expected section/content: '{required_phrase}'"

        print("\n[OK] All Persona 8 pipeline assertions passed!")
        print(f"[OK] Verified 7 structured tables, 6 PNG charts, knee detection (250 VUs / 2000 VUs max), and English Markdown report.")
        if not cleanup:
            print(f"[INFO] Preview artifacts kept at: {p3_dir}")
    finally:
        if cleanup and work_dir.exists():
            shutil.rmtree(work_dir)


if __name__ == "__main__":
    main()

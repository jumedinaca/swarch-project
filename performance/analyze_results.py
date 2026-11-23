#!/usr/bin/env python3
"""
GeoPicto — Performance Results Analyzer, Chart Generator & Report Builder (Persona 8)
======================================================================================
Processes k6 summary JSONs, spike time-series CSV, and Docker container resource
CSVs to generate:
  - Structured CSV/JSON tables (tables/)
  - High-resolution English PNG charts (charts/, 180 DPI)
  - Ready-to-paste English Markdown section for Prototype 3 (p3_performance_section.md)
  - Optional Prototype 2 Baseline vs. Prototype 3 Hardened comparison (--compare)

Dependencies: Python 3 stdlib + numpy + matplotlib (no pandas required).

Usage:
  python3 performance/analyze_results.py performance/results/p3-hardened
  python3 performance/analyze_results.py --compare performance/results/p2-baseline performance/results/p3-hardened
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


# ------------------------------------------------------------------------------
# Visual Theme & Architectural Metadata
# ------------------------------------------------------------------------------

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "axes.titlesize": 12.5,
        "axes.titleweight": "bold",
        "axes.labelsize": 10.5,
        "xtick.labelsize": 9.5,
        "ytick.labelsize": 9.5,
        "legend.fontsize": 9.0,
        "figure.facecolor": "#ffffff",
        "axes.facecolor": "#ffffff",
        "axes.edgecolor": "#cbd5e1",
        "axes.linewidth": 0.9,
    }
)

TIER_COLORS = {
    "edge": "#7c3aed",          # Purple (reverse-proxy, gateway, frontends)
    "microservices": "#2563eb", # Blue (auth, messages, network, rating, etc.)
    "databases": "#ea580c",     # Orange (PostgreSQL/PostGIS, MongoDB)
    "infra": "#0d9488",         # Teal (Redis, RabbitMQ, MinIO)
    "other": "#64748b",
}

TIER_LABELS = {
    "edge": "Edge & Gateway",
    "microservices": "Microservices",
    "databases": "Databases",
    "infra": "Infra (Redis/MQ/MinIO)",
    "other": "Other",
}

FLOW_METADATA = [
    ("nearby_read", "flow_nearby_duration", "flow_nearby_reqs", "Nearby Read\n(PostGIS)", "GET /api/messages/nearby (PostGIS spatial query)"),
    ("write_events", "flow_write_duration", "flow_write_reqs", "Write + Events\n(RabbitMQ)", "POST /api/messages & PUT /api/ratings/:id (DB + RabbitMQ)"),
    ("auth_login", "flow_auth_duration", "flow_auth_reqs", "Auth Login\n(Argon2id)", "POST /api/auth/login (Argon2id password hash)"),
    ("network_graphql", "flow_graphql_duration", "flow_graphql_reqs", "Social Graph\n(GraphQL+Mongo)", "POST /api/network/graphql (GraphQL + MongoDB)"),
]

BOTTLENECK_EXPLANATIONS = {
    "auth": "Argon2id password verification is intentionally CPU- and memory-hard, making `auth` saturate CPU early under concurrent login requests.",
    "auth-db": "Concurrent login session writes and user lookups contend on PostgreSQL connections and disk flush operations in `auth-db`.",
    "messages": "High concurrency on geospatial queries and message publication drives Go goroutine scheduling, `pgxpool` contention, and RabbitMQ publishing.",
    "messages-db": "PostGIS `ST_DWithin` / `ST_Distance` spatial index scans over `GEOGRAPHY(Point, 4326)` combined with concurrent inserts pressure CPU and shared buffers.",
    "gateway": "Spring Cloud Gateway (WebFlux) performs JWT signature validation, Redis token-blacklist lookups (Scenario 5), rate-limit Lua evaluation (Scenario 4), and upstream proxying on every request.",
    "reverse-proxy": "Nginx edge TLS 1.2/1.3 handshake/encryption and reverse-proxy connection multiplexing add measurable CPU overhead at high VU counts (Scenarios 1 & 2).",
    "rating": "Transactional `SELECT ... FOR UPDATE` row locking on `message_rating_stats` serializes concurrent votes on hot messages and enforces an in-memory per-user vote limit.",
    "rating-db": "Row-level lock contention (`FOR UPDATE`) during concurrent likes/dislikes increases transaction wait times in `rating-db`.",
    "network": "Python/FastAPI + Strawberry GraphQL query parsing and resolver execution over MongoDB is sensitive to single-process GIL/event-loop saturation.",
    "network-db": "MongoDB document scans and connection pool contention under concurrent social-graph reads increase tail latencies (`p95`/`p99`).",
    "moderation": "Asynchronous consumption of `message.submitted.v1` events and rule evaluation in Python creates backlog lag during write bursts.",
    "rabbitmq": "Burst message publishing (`message.submitted.v1`, `rating.changed.v1`) increases broker queue depth and Erlang VM memory/CPU usage.",
    "redis": "Per-request Token Blacklist lookups and Token Bucket Lua scripts (Scenarios 4 & 5) turn Redis into a critical shared hot path for the API Gateway.",
}


# ------------------------------------------------------------------------------
# Parsing Helpers
# ------------------------------------------------------------------------------

def _metric_block(metrics: dict[str, Any], name: str) -> dict[str, Any]:
    block = metrics.get(name) or {}
    # k6 summary-export puts values either directly under block or inside block["values"]
    if isinstance(block.get("values"), dict):
        return block["values"]
    return block


def parse_k6_summary(path: Path, vus_override: int | None = None) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)

    metrics = raw.get("metrics") or {}
    dur = _metric_block(metrics, "http_req_duration")
    reqs = _metric_block(metrics, "http_reqs")
    failed = _metric_block(metrics, "http_req_failed")
    vus_max = _metric_block(metrics, "vus_max")
    real_err = _metric_block(metrics, "real_error_rate")
    rl_rate = _metric_block(metrics, "rate_limited_rate")
    rl_count = _metric_block(metrics, "http_429_responses")
    err_count = _metric_block(metrics, "http_5xx_or_timeout")

    samples = int(reqs.get("count", 0) or 0)
    rps = float(reqs.get("rate", 0.0) or 0.0)
    vus = vus_override if vus_override is not None else int(vus_max.get("max", vus_max.get("value", 0)) or 0)

    p50 = float(dur.get("med", dur.get("p(50)", 0.0)) or 0.0)
    p90 = float(dur.get("p(90)", p50) or 0.0)
    p95 = float(dur.get("p(95)", p90) or 0.0)
    # p(99) is present when --summary-trend-stats includes it; graceful fallback to max
    p99 = float(dur.get("p(99)", dur.get("max", p95)) or 0.0)

    # k6 exposes Rate metrics as 'value' (legacy summary-export) or 'rate' (newer)
    def rate_pct(block: dict[str, Any]) -> float:
        if "rate" in block:
            return float(block["rate"] or 0.0) * 100.0
        if "value" in block:
            return float(block["value"] or 0.0) * 100.0
        return 0.0

    http_failed_pct = rate_pct(failed)
    real_error_pct = rate_pct(real_err) if real_err else http_failed_pct
    rate_429_pct = rate_pct(rl_rate) if rl_rate else 0.0
    rate_429_n = int(rl_count.get("count", 0) or 0)
    err_5xx_n = int(err_count.get("count", 0) or 0)

    # Extract per-flow latency trends if present
    flows: dict[str, dict[str, float]] = {}
    for flow_key, dur_metric, req_metric, _, _ in FLOW_METADATA:
        fd = _metric_block(metrics, dur_metric)
        fr = _metric_block(metrics, req_metric)
        if fd and (fd.get("avg") is not None or fd.get("med") is not None):
            fp50 = float(fd.get("med", fd.get("p(50)", 0.0)) or 0.0)
            fp90 = float(fd.get("p(90)", fp50) or 0.0)
            fp95 = float(fd.get("p(95)", fp90) or 0.0)
            fp99 = float(fd.get("p(99)", fd.get("max", fp95)) or 0.0)
            flows[flow_key] = {
                "count": int(fr.get("count", 0) or 0),
                "rps": float(fr.get("rate", 0.0) or 0.0),
                "avg_ms": float(fd.get("avg", 0.0) or 0.0),
                "min_ms": float(fd.get("min", 0.0) or 0.0),
                "p50_ms": fp50,
                "p90_ms": fp90,
                "p95_ms": fp95,
                "p99_ms": fp99,
                "max_ms": float(fd.get("max", fp99) or 0.0),
            }

    return {
        "file": path.name,
        "vus": vus,
        "samples": samples,
        "rps": rps,
        "avg_ms": float(dur.get("avg", 0.0) or 0.0),
        "min_ms": float(dur.get("min", 0.0) or 0.0),
        "p50_ms": p50,
        "p90_ms": p90,
        "p95_ms": p95,
        "p99_ms": p99,
        "max_ms": float(dur.get("max", 0.0) or 0.0),
        "http_failed_pct": http_failed_pct,
        "real_error_pct": real_error_pct,
        "rate_429_pct": rate_429_pct,
        "rate_429_count": rate_429_n,
        "err_5xx_count": err_5xx_n,
        "flows": flows,
    }


def load_profile_summaries(run_dir: Path, prefix: str) -> list[dict[str, Any]]:
    pattern = re.compile(rf"^summary_{re.escape(prefix)}_(\d+)\.json$")
    rows = []
    for path in sorted(run_dir.glob(f"summary_{prefix}_*.json")):
        m = pattern.match(path.name)
        if not m:
            continue
        vus = int(m.group(1))
        rows.append(parse_k6_summary(path, vus_override=vus))
    rows.sort(key=lambda r: r["vus"])
    return rows


def load_host_info(run_dir: Path) -> dict[str, Any]:
    path = run_dir / "host_info.json"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def find_knee(stress_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Identifies the Knee of the Performance Curve:
      - Primary criterion: highest VU level that maintains real_error_pct <= 1.0%
        AND does not exhibit severe latency runaway (> 3x baseline p95 with flat/falling RPS).
      - Also records the first VU level where real errors exceed 1.0% and peak RPS.
    """
    if not stress_rows:
        return {}

    healthy = [r for r in stress_rows if r["real_error_pct"] <= 1.0]
    first_err = next((r for r in stress_rows if r["real_error_pct"] > 1.0), None)
    peak_rps_row = max(stress_rows, key=lambda r: r["rps"])

    if healthy:
        # Check if throughput already plateaued/dropped while p95 surged inside healthy region
        knee_row = healthy[-1]
        best_healthy_rps = max(r["rps"] for r in healthy)
        for idx, r in enumerate(healthy):
            if idx > 0 and r["rps"] >= 0.90 * best_healthy_rps:
                knee_row = r
                # If next healthy step has >2.5x p95 jump with <10% RPS gain, stop here
                if idx + 1 < len(healthy):
                    nxt = healthy[idx + 1]
                    rps_gain = (nxt["rps"] - r["rps"]) / max(r["rps"], 1e-6)
                    p95_ratio = nxt["p95_ms"] / max(r["p95_ms"], 1e-6)
                    if p95_ratio >= 2.5 and rps_gain < 0.12:
                        break
    else:
        knee_row = stress_rows[0]

    return {
        "knee_vus": knee_row["vus"],
        "knee_avg_ms": round(knee_row["avg_ms"], 2),
        "knee_p50_ms": round(knee_row["p50_ms"], 2),
        "knee_p95_ms": round(knee_row["p95_ms"], 2),
        "knee_p99_ms": round(knee_row["p99_ms"], 2),
        "knee_rps": round(knee_row["rps"], 2),
        "knee_real_error_pct": round(knee_row["real_error_pct"], 2),
        "peak_rps": round(peak_rps_row["rps"], 2),
        "peak_rps_vus": peak_rps_row["vus"],
        "first_error_vus": first_err["vus"] if first_err else None,
        "first_error_pct": round(first_err["real_error_pct"], 2) if first_err else 0.0,
        "max_tested_vus": stress_rows[-1]["vus"],
    }


def analyze_spike(run_dir: Path) -> tuple[list[dict[str, float]], dict[str, Any]]:
    ts_path = run_dir / "spike_timeseries.csv"
    meta_path = run_dir / "spike_meta.json"
    summary_path = run_dir / "summary_spike.json"

    meta = {
        "base_vus": 25,
        "spike_vus": 1000,
        "base_duration_s": 20,
        "ramp_up_s": 5,
        "spike_duration_s": 25,
        "ramp_down_s": 5,
        "recovery_duration_s": 40,
    }
    if meta_path.exists():
        with meta_path.open("r", encoding="utf-8") as fh:
            meta.update(json.load(fh))

    points: list[dict[str, float]] = []
    if ts_path.exists():
        with ts_path.open("r", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                points.append(
                    {
                        "elapsed_s": float(row["elapsed_s"]),
                        "epoch_s": float(row.get("epoch_s", 0)),
                        "vus": float(row["vus"]),
                        "rps": float(row["rps"]),
                        "avg_ms": float(row["avg_ms"]),
                        "p50_ms": float(row["p50_ms"]),
                        "p95_ms": float(row["p95_ms"]),
                        "p99_ms": float(row["p99_ms"]),
                        "err_pct": float(row["err_pct"]),
                        "rate_429_pct": float(row.get("rate_429_pct", 0.0)),
                        "total_reqs": int(float(row.get("total_reqs", 0))),
                    }
                )

    summary_overall = parse_k6_summary(summary_path) if summary_path.exists() else {}

    t_spike_start = meta["base_duration_s"]
    t_peak_end = t_spike_start + meta["ramp_up_s"] + meta["spike_duration_s"]
    t_rec_start = t_peak_end + meta["ramp_down_s"]

    pre = [p for p in points if p["elapsed_s"] <= t_spike_start]
    peak = [p for p in points if t_spike_start < p["elapsed_s"] <= t_peak_end]
    post = [p for p in points if p["elapsed_s"] >= t_rec_start]

    def phase_stats(name: str, items: list[dict[str, float]]) -> dict[str, Any]:
        if not items:
            return {
                "phase": name,
                "avg_vus": 0.0,
                "max_vus": 0.0,
                "avg_rps": 0.0,
                "peak_rps": 0.0,
                "avg_ms": 0.0,
                "p50_ms": 0.0,
                "p95_ms": 0.0,
                "p99_ms": 0.0,
                "avg_err_pct": 0.0,
                "peak_err_pct": 0.0,
            }
        return {
            "phase": name,
            "avg_vus": float(np.mean([x["vus"] for x in items])),
            "max_vus": float(np.max([x["vus"] for x in items])),
            "avg_rps": float(np.mean([x["rps"] for x in items])),
            "peak_rps": float(np.max([x["rps"] for x in items])),
            "avg_ms": float(np.mean([x["avg_ms"] for x in items])),
            "p50_ms": float(np.median([x["p50_ms"] for x in items])),
            "p95_ms": float(np.percentile([x["p95_ms"] for x in items], 95)),
            "p99_ms": float(np.max([x["p99_ms"] for x in items])),
            "avg_err_pct": float(np.mean([x["err_pct"] for x in items])),
            "peak_err_pct": float(np.max([x["err_pct"] for x in items])),
        }

    pre_s = phase_stats("Pre-Spike (Baseline)", pre)
    peak_s = phase_stats("Spike Peak", peak)
    post_s = phase_stats("Post-Spike (Recovery)", post)

    # Estimate recovery time: first time after ramp-down where 2 consecutive buckets
    # return within 1.5x baseline p95 (+ 40 ms floor) and err_pct <= 1.0%
    baseline_p95_ref = max(pre_s["p95_ms"] * 1.5, pre_s["p95_ms"] + 40.0, 100.0)
    recovery_time_s: float | None = None
    for i in range(len(post)):
        cur = post[i]
        nxt = post[i + 1] if i + 1 < len(post) else cur
        cur_ok = cur["p95_ms"] <= baseline_p95_ref and cur["err_pct"] <= 1.0
        nxt_ok = nxt["p95_ms"] <= baseline_p95_ref and nxt["err_pct"] <= 1.0
        if cur_ok and nxt_ok:
            recovery_time_s = max(0.0, round(cur["elapsed_s"] - t_rec_start, 1))
            break

    info = {
        "meta": meta,
        "phases": [pre_s, peak_s, post_s],
        "t_spike_start": t_spike_start,
        "t_peak_end": t_peak_end,
        "t_rec_start": t_rec_start,
        "recovery_time_s": recovery_time_s,
        "overall": summary_overall,
    }
    return points, info


def load_docker_stats(run_dir: Path) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """
    Loads all *_docker_stats.csv files inside run_dir.
    Returns:
      - aggregated summary rows per (profile, container, tier)
      - raw time-series records per profile (for CPU timeline plotting)
    """
    raw_by_profile: dict[str, list[dict[str, Any]]] = {}
    summary_rows: list[dict[str, Any]] = []

    for csv_path in sorted(run_dir.glob("*_docker_stats.csv")):
        profile = csv_path.name.replace("_docker_stats.csv", "")
        records = []
        by_container: dict[str, list[dict[str, Any]]] = defaultdict(list)

        with csv_path.open("r", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                try:
                    rec = {
                        "elapsed_s": float(row["elapsed_s"]),
                        "epoch_s": float(row["epoch_s"]),
                        "phase": row.get("phase", "default"),
                        "container": row["container"],
                        "tier": row.get("tier", "other"),
                        "cpu_pct": float(row["cpu_pct"]),
                        "mem_used_mb": float(row["mem_used_mb"]),
                        "mem_limit_mb": float(row["mem_limit_mb"]),
                        "mem_pct": float(row["mem_pct"]),
                        "net_rx_mb": float(row["net_rx_mb"]),
                        "net_tx_mb": float(row["net_tx_mb"]),
                        "block_read_mb": float(row.get("block_read_mb", 0.0)),
                        "block_write_mb": float(row.get("block_write_mb", 0.0)),
                        "pids": int(float(row.get("pids", 0))),
                    }
                except (KeyError, ValueError):
                    continue
                records.append(rec)
                by_container[rec["container"]].append(rec)

        raw_by_profile[profile] = records

        for container, items in sorted(by_container.items()):
            items.sort(key=lambda x: x["elapsed_s"])
            tier = items[0]["tier"]
            cpus = [x["cpu_pct"] for x in items]
            mems = [x["mem_used_mb"] for x in items]
            mem_pcts = [x["mem_pct"] for x in items]
            net_rx_delta = max(0.0, items[-1]["net_rx_mb"] - items[0]["net_rx_mb"])
            net_tx_delta = max(0.0, items[-1]["net_tx_mb"] - items[0]["net_tx_mb"])
            summary_rows.append(
                {
                    "profile": profile,
                    "container": container,
                    "tier": tier,
                    "samples": len(items),
                    "cpu_avg_pct": float(np.mean(cpus)),
                    "cpu_peak_pct": float(np.max(cpus)),
                    "mem_avg_mb": float(np.mean(mems)),
                    "mem_peak_mb": float(np.max(mems)),
                    "mem_peak_pct": float(np.max(mem_pcts)),
                    "net_rx_delta_mb": net_rx_delta,
                    "net_tx_delta_mb": net_tx_delta,
                    "pids_peak": int(max(x["pids"] for x in items)),
                }
            )

    return summary_rows, raw_by_profile


# ------------------------------------------------------------------------------
# CSV / JSON Export Helpers
# ------------------------------------------------------------------------------

def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            formatted = {}
            for k in fieldnames:
                v = r.get(k, "")
                if isinstance(v, float):
                    formatted[k] = f"{v:.2f}"
                else:
                    formatted[k] = v
            writer.writerow(formatted)


# ------------------------------------------------------------------------------
# Chart Builders (English, High-Resolution 180 DPI)
# ------------------------------------------------------------------------------

def plot_load_summary(load_rows: list[dict[str, Any]], charts_dir: Path, run_label: str) -> Path | None:
    if not load_rows:
        return None

    vus_labels = [f"{r['vus']} VUs" for r in load_rows]
    x = np.arange(len(load_rows))
    width = 0.2

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.5, 5.4))

    # Left panel: p50, p90, p95, p99 grouped bars
    series = [
        ("p50 (Median)", [r["p50_ms"] for r in load_rows], "#2563eb"),
        ("p90", [r["p90_ms"] for r in load_rows], "#0ea5e9"),
        ("p95", [r["p95_ms"] for r in load_rows], "#f59e0b"),
        ("p99", [r["p99_ms"] for r in load_rows], "#dc2626"),
    ]
    max_lat = max((max(vals) for _, vals, _ in series), default=10.0)

    for idx, (label, vals, color) in enumerate(series):
        offset = (idx - 1.5) * width
        bars = ax1.bar(x + offset, vals, width, label=label, color=color, edgecolor="#ffffff", linewidth=0.6)
        for bar, val in zip(bars, vals):
            ax1.text(
                bar.get_x() + bar.get_width() / 2.0,
                val + max_lat * 0.018,
                f"{val:.0f}",
                ha="center",
                va="bottom",
                fontsize=7.8,
                color="#1e293b",
            )

    ax1.set_title("Load Test — Latency Percentiles by Concurrency")
    ax1.set_xticks(x)
    ax1.set_xticklabels(vus_labels)
    ax1.set_ylabel("Response Time (ms)")
    ax1.set_ylim(0, max(max_lat * 1.24, 10.0))
    ax1.grid(axis="y", linestyle="--", alpha=0.35)
    ax1.legend(loc="upper left", frameon=True)

    # Right panel: Throughput (RPS) + Error Rate (%)
    rps_vals = [r["rps"] for r in load_rows]
    err_vals = [r["real_error_pct"] for r in load_rows]
    rl_vals = [r["rate_429_pct"] for r in load_rows]

    bars_rps = ax2.bar(x, rps_vals, width=0.48, color="#0284c7", alpha=0.88, label="Throughput (req/s)")
    max_rps = max(rps_vals, default=10.0)
    for bar, val in zip(bars_rps, rps_vals):
        ax2.text(
            bar.get_x() + bar.get_width() / 2.0,
            val + max_rps * 0.02,
            f"{val:.1f} rps",
            ha="center",
            va="bottom",
            fontsize=8.5,
            fontweight="bold",
            color="#0c4a6e",
        )

    ax2.set_title("Load Test — Throughput & Error Rate")
    ax2.set_xticks(x)
    ax2.set_xticklabels(vus_labels)
    ax2.set_ylabel("Throughput (req/s)", color="#0284c7")
    ax2.tick_params(axis="y", labelcolor="#0284c7")
    ax2.set_ylim(0, max(max_rps * 1.25, 10.0))
    ax2.grid(axis="y", linestyle="--", alpha=0.35)

    ax2_r = ax2.twinx()
    ax2_r.plot(x, err_vals, marker="o", linewidth=2.2, color="#dc2626", label="Real Error Rate (5xx/Timeout %)")
    if any(v > 0 for v in rl_vals):
        ax2_r.plot(x, rl_vals, marker="s", linewidth=1.8, linestyle="--", color="#d97706", label="Rate Limited (HTTP 429 %)")
    ax2_r.set_ylabel("Error / Rejection Rate (%)", color="#dc2626")
    ax2_r.tick_params(axis="y", labelcolor="#dc2626")
    ax2_r.set_ylim(-0.5, max(max(err_vals + rl_vals, default=0.0) * 1.35, 5.0))

    h1, l1 = ax2.get_legend_handles_labels()
    h2, l2 = ax2_r.get_legend_handles_labels()
    ax2.legend(h1 + h2, l1 + l2, loc="upper left", frameon=True)

    fig.suptitle(f"GeoPicto Nominal Load Test Summary ({run_label})", fontsize=14, fontweight="bold", y=0.99)
    plt.tight_layout(rect=[0, 0, 1, 0.94])
    out_path = charts_dir / "01_load_latency_throughput.png"
    plt.savefig(out_path, dpi=180)
    plt.close(fig)
    return out_path


def plot_stress_curve_and_knee(
    stress_rows: list[dict[str, Any]],
    knee: dict[str, Any],
    charts_dir: Path,
    run_label: str,
) -> Path | None:
    if not stress_rows:
        return None

    # Use evenly-spaced ordinal x positions so 25..2000 VUs never overlap visually
    x = np.arange(len(stress_rows))
    vus_labels = [str(r["vus"]) for r in stress_rows]
    p50 = [r["p50_ms"] for r in stress_rows]
    avg = [r["avg_ms"] for r in stress_rows]
    p95 = [r["p95_ms"] for r in stress_rows]
    p99 = [r["p99_ms"] for r in stress_rows]
    rps = [r["rps"] for r in stress_rows]
    err = [r["real_error_pct"] for r in stress_rows]
    r429 = [r["rate_429_pct"] for r in stress_rows]

    knee_idx = next((i for i, r in enumerate(stress_rows) if r["vus"] == knee.get("knee_vus")), 0)

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(12.2, 8.8), sharex=True, gridspec_kw={"height_ratios": [1.85, 1.05]}
    )

    # Panel 1: Latency Curves + Knee Marker
    ax1.plot(x, p99, marker="D", linewidth=2.0, linestyle=":", color="#991b1b", label="p99 Latency (ms)")
    ax1.plot(x, p95, marker="s", linewidth=2.4, linestyle="--", color="#ea580c", label="p95 Latency (ms)")
    ax1.plot(x, avg, marker="o", linewidth=2.6, color="#1d4ed8", label="Avg Latency (ms)")
    ax1.plot(x, p50, marker="^", linewidth=1.9, color="#0d9488", label="p50 Median (ms)")

    y_top = max(max(p99), max(p95), 100.0)
    for i, (p95_v, e_v) in enumerate(zip(p95, err)):
        if i == knee_idx:
            continue  # Knee callout box already displays p95 cleanly
        y_off = 10 if i == 0 else (-18 if i < len(p95) - 1 else -16)
        ax1.annotate(
            f"p95: {p95_v:.0f} ms",
            (x[i], p95_v),
            textcoords="offset points",
            xytext=(0, y_off),
            ha="center",
            fontsize=8.1,
            color="#991b1b" if e_v > 1.0 else "#1e293b",
            bbox=dict(facecolor="#ffffff", edgecolor="none", alpha=0.78, pad=1.2),
            zorder=5,
        )

    # Mark Knee
    kx = x[knee_idx]
    ky = p95[knee_idx]
    ax1.axvline(kx, color="#16a34a", linestyle=":", linewidth=2.2, alpha=0.9)
    ax1.scatter([kx], [ky], s=210, facecolors="none", edgecolors="#16a34a", linewidths=2.8, zorder=6)

    # Shade saturation zone after knee
    if knee_idx < len(x) - 1:
        ax1.axvspan(
            kx,
            len(x) - 0.65,
            color="#fee2e2",
            alpha=0.35,
            label=f"Saturation / Degradation Zone (> {knee['knee_vus']} VUs)",
        )

    # Place knee callout box in the open upper-left/mid-left region above the low-VU curve
    if kx >= 2:
        box_x = max(0.20, kx - 1.65)
    else:
        box_x = min(len(x) - 1.65, kx + 0.55)
    box_y = y_top * 0.58
    ax1.annotate(
        f"KNEE OF THE CURVE\n{knee['knee_vus']} VUs | RPS = {knee['knee_rps']:.1f}/s\n"
        f"p95 = {knee['knee_p95_ms']:.0f} ms | err = {knee['knee_real_error_pct']:.2f}%",
        xy=(kx, ky),
        xytext=(box_x, box_y),
        arrowprops=dict(arrowstyle="->", color="#15803d", lw=2.0, connectionstyle="arc3,rad=-0.18"),
        bbox=dict(boxstyle="round,pad=0.5", facecolor="#dcfce7", edgecolor="#16a34a", lw=1.5),
        fontsize=9.0,
        fontweight="bold",
        color="#14532d",
        zorder=7,
    )

    ax1.set_title(f"GeoPicto Stress Test — Performance Curve & Knee up to {stress_rows[-1]['vus']} VUs ({run_label})")
    ax1.set_ylabel("Response Time — http_req_duration (ms)")
    ax1.set_ylim(0, y_top * 1.24)
    ax1.grid(True, linestyle="--", alpha=0.35)
    ax1.legend(loc="upper left", frameon=True)

    # Panel 2: Throughput (RPS) & Error Rate (%)
    ax2.plot(x, rps, marker="o", linewidth=2.4, color="#0284c7", label="Throughput (req/s)")
    ax2.axvline(kx, color="#16a34a", linestyle=":", linewidth=2.2, alpha=0.9)
    if knee_idx < len(x) - 1:
        ax2.axvspan(kx, len(x) - 0.65, color="#fee2e2", alpha=0.25)
    ax2.set_xlabel("Concurrent Virtual Users (VUs)")
    ax2.set_ylabel("Throughput (req/s)", color="#0284c7")
    ax2.tick_params(axis="y", labelcolor="#0284c7")
    ax2.set_ylim(0, max(max(rps, default=10.0) * 1.28, 10.0))
    ax2.set_xticks(x)
    ax2.set_xticklabels(vus_labels)
    ax2.grid(True, linestyle="--", alpha=0.35)

    for i, rps_v in enumerate(rps):
        ax2.annotate(
            f"{rps_v:.0f}",
            (x[i], rps_v),
            textcoords="offset points",
            xytext=(0, 8),
            ha="center",
            fontsize=8.2,
            color="#0369a1",
        )

    ax2_r = ax2.twinx()
    ax2_r.plot(x, err, marker="^", linewidth=2.2, linestyle="-.", color="#dc2626", label="Real Error Rate (5xx/Timeout %)")
    if any(v > 0 for v in r429):
        ax2_r.plot(x, r429, marker="s", linewidth=1.8, linestyle="--", color="#d97706", label="Rate Limited (HTTP 429 %)")
    ax2_r.set_ylabel("Error / Rejection Rate (%)", color="#dc2626")
    ax2_r.tick_params(axis="y", labelcolor="#dc2626")
    ax2_r.set_ylim(-1.0, max(max(err + r429, default=0.0) * 1.28, 10.0))

    h1, l1 = ax2.get_legend_handles_labels()
    h2, l2 = ax2_r.get_legend_handles_labels()
    ax2.legend(h1 + h2, l1 + l2, loc="upper left", frameon=True)

    plt.tight_layout()
    out_path = charts_dir / "02_stress_performance_curve_knee.png"
    plt.savefig(out_path, dpi=180)
    plt.close(fig)
    return out_path


def plot_spike_recovery(
    points: list[dict[str, float]],
    spike_info: dict[str, Any],
    charts_dir: Path,
    run_label: str,
) -> Path | None:
    if not points:
        return None

    t = [p["elapsed_s"] for p in points]
    vus = [p["vus"] for p in points]
    rps = [p["rps"] for p in points]
    p50 = [p["p50_ms"] for p in points]
    p95 = [p["p95_ms"] for p in points]
    p99 = [p["p99_ms"] for p in points]
    err = [p["err_pct"] for p in points]

    t_spike_start = spike_info["t_spike_start"]
    t_peak_end = spike_info["t_peak_end"]
    t_rec_start = spike_info["t_rec_start"]
    rec_time = spike_info.get("recovery_time_s")
    meta = spike_info["meta"]

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(12.4, 8.4), sharex=True, gridspec_kw={"height_ratios": [1.6, 1.05]}
    )

    # Shaded regions for both panels
    for ax in (ax1, ax2):
        ax.axvspan(0, t_spike_start, color="#e0f2fe", alpha=0.35)
        ax.axvspan(t_spike_start, t_peak_end, color="#fee2e2", alpha=0.40)
        ax.axvspan(t_rec_start, max(t) + 2, color="#dcfce7", alpha=0.32)

    # Panel 1: Latency over time + Active VUs on secondary axis
    ax1.plot(t, p99, linewidth=1.8, linestyle=":", color="#991b1b", label="p99 Latency (ms)")
    ax1.plot(t, p95, linewidth=2.4, color="#ea580c", label="p95 Latency (ms)")
    ax1.plot(t, p50, linewidth=2.0, color="#1d4ed8", label="p50 Median (ms)")

    y_max = max(max(p99), max(p95), 100.0)
    ax1.set_ylim(0, y_max * 1.28)
    ax1.set_ylabel("Response Time (ms)")
    ax1.grid(True, linestyle="--", alpha=0.35)

    # Phase headers placed cleanly at top without intersecting vertical recovery line or legend
    ax1.text(t_spike_start * 0.5, y_max * 1.21, "Pre-Spike\nBaseline", ha="center", va="top", fontsize=9.0, fontweight="bold", color="#0369a1")
    ax1.text((t_spike_start + t_peak_end) * 0.5, y_max * 1.21, f"Spike Peak\n({meta['spike_vus']} VUs)", ha="center", va="top", fontsize=9.0, fontweight="bold", color="#b91c1c")

    if rec_time is not None:
        t_rec_done = t_rec_start + rec_time
        ax1.axvline(t_rec_done, color="#15803d", linestyle="--", linewidth=1.8)
        ax2.axvline(t_rec_done, color="#15803d", linestyle="--", linewidth=1.8)
        rec_x = min(max(t) - 6.0, max(t_rec_done + (max(t) - t_rec_done) * 0.48, t_rec_start + 8.0))
        rec_label = f"Post-Spike Recovery\n(Recovered in {rec_time:.0f}s)"
    else:
        rec_x = (t_rec_start + max(t)) * 0.5
        rec_label = "Post-Spike Recovery\n(Still stabilizing)"
    ax1.text(rec_x, y_max * 1.21, rec_label, ha="center", va="top", fontsize=9.0, fontweight="bold", color="#15803d")

    ax1_r = ax1.twinx()
    ax1_r.plot(t, vus, linewidth=1.9, linestyle="--", color="#475569", alpha=0.85, label="Active VUs")
    ax1_r.set_ylabel("Active Virtual Users (VUs)", color="#475569")
    ax1_r.tick_params(axis="y", labelcolor="#475569")
    ax1_r.set_ylim(0, max(max(vus, default=100.0) * 1.28, 50.0))

    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax1_r.get_legend_handles_labels()
    # Place legend horizontally above Panel 1 so it never overlaps any phase header
    ax1.legend(
        h1 + h2,
        l1 + l2,
        loc="lower center",
        bbox_to_anchor=(0.5, 1.01),
        ncol=4,
        frameon=True,
    )
    ax1.set_title(
        f"GeoPicto Spike Test — Surge ({meta['base_vus']} → {meta['spike_vus']} → {meta['base_vus']} VUs) & Recovery ({run_label})",
        pad=32,
    )

    # Panel 2: Throughput (RPS) & Error Rate (%)
    ax2.plot(t, rps, linewidth=2.3, color="#0284c7", label="Throughput (req/s)")
    ax2.set_xlabel("Elapsed Time (seconds)")
    ax2.set_ylabel("Throughput (req/s)", color="#0284c7")
    ax2.tick_params(axis="y", labelcolor="#0284c7")
    ax2.set_ylim(0, max(max(rps, default=10.0) * 1.25, 10.0))
    ax2.grid(True, linestyle="--", alpha=0.35)

    ax2_r = ax2.twinx()
    ax2_r.fill_between(t, err, color="#dc2626", alpha=0.18)
    ax2_r.plot(t, err, linewidth=2.0, color="#dc2626", label="Error Rate (%)")
    ax2_r.set_ylabel("Error Rate (%)", color="#dc2626")
    ax2_r.tick_params(axis="y", labelcolor="#dc2626")
    ax2_r.set_ylim(-0.5, max(max(err, default=0.0) * 1.3, 10.0))

    h3, l3 = ax2.get_legend_handles_labels()
    h4, l4 = ax2_r.get_legend_handles_labels()
    ax2.legend(h3 + h4, l3 + l4, loc="upper left", frameon=True)

    plt.tight_layout()
    out_path = charts_dir / "03_spike_behavior_recovery.png"
    plt.savefig(out_path, dpi=180)
    plt.close(fig)
    return out_path


def plot_flows_comparison(
    flow_rows: list[dict[str, Any]],
    charts_dir: Path,
    run_label: str,
    ref_label: str,
) -> Path | None:
    if not flow_rows:
        return None

    labels = [r["short_label"] for r in flow_rows]
    x = np.arange(len(flow_rows))
    width = 0.25

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.6, 5.4), gridspec_kw={"width_ratios": [1.65, 1.0]})

    p50 = [r["p50_ms"] for r in flow_rows]
    p95 = [r["p95_ms"] for r in flow_rows]
    p99 = [r["p99_ms"] for r in flow_rows]
    max_lat = max(p99 + p95 + [10.0])

    for idx, (name, vals, color) in enumerate([
        ("p50 (Median)", p50, "#2563eb"),
        ("p95", p95, "#f59e0b"),
        ("p99", p99, "#dc2626"),
    ]):
        bars = ax1.bar(x + (idx - 1) * width, vals, width, label=name, color=color, edgecolor="#ffffff", linewidth=0.6)
        for bar, val in zip(bars, vals):
            ax1.text(
                bar.get_x() + bar.get_width() / 2.0,
                val + max_lat * 0.018,
                f"{val:.0f}",
                ha="center",
                va="bottom",
                fontsize=8.0,
            )

    ax1.set_title(f"Latency by Architectural Flow ({ref_label})")
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels)
    ax1.set_ylabel("Response Time (ms)")
    ax1.set_ylim(0, max_lat * 1.24)
    ax1.grid(axis="y", linestyle="--", alpha=0.35)
    ax1.legend(loc="upper left", frameon=True)

    # Right panel: Request Share / Throughput per flow
    counts = [r["count"] for r in flow_rows]
    total_c = max(sum(counts), 1)
    shares = [c / total_c * 100.0 for c in counts]
    colors = ["#0284c7", "#ea580c", "#7c3aed", "#0d9488"][: len(flow_rows)]
    bars2 = ax2.bar(x, shares, width=0.52, color=colors, alpha=0.9)
    for bar, share, c in zip(bars2, shares, counts):
        ax2.text(
            bar.get_x() + bar.get_width() / 2.0,
            share + 1.5,
            f"{share:.1f}%\n({c} reqs)",
            ha="center",
            va="bottom",
            fontsize=8.2,
            color="#0f172a",
        )
    ax2.set_title("Workload Distribution by Flow")
    ax2.set_xticks(x)
    ax2.set_xticklabels(labels)
    ax2.set_ylabel("Share of Total Requests (%)")
    ax2.set_ylim(0, max(shares + [10.0]) * 1.28)
    ax2.grid(axis="y", linestyle="--", alpha=0.35)

    fig.suptitle(f"GeoPicto Architectural Flow Comparison ({run_label})", fontsize=14, fontweight="bold", y=0.99)
    plt.tight_layout(rect=[0, 0, 1, 0.94])
    out_path = charts_dir / "04_flows_latency_comparison.png"
    plt.savefig(out_path, dpi=180)
    plt.close(fig)
    return out_path


def plot_resources_dashboard(
    res_summary: list[dict[str, Any]],
    raw_by_profile: dict[str, list[dict[str, Any]]],
    charts_dir: Path,
    run_label: str,
) -> Path | None:
    if not res_summary:
        return None

    # Prefer 'stress' profile for peak resource dashboard, fallback to first available
    target_profile = "stress" if any(r["profile"] == "stress" for r in res_summary) else res_summary[0]["profile"]
    prof_rows = [r for r in res_summary if r["profile"] == target_profile]
    if not prof_rows:
        return None

    top_cpu = sorted(prof_rows, key=lambda r: r["cpu_peak_pct"], reverse=True)[:10]
    top_mem = sorted(prof_rows, key=lambda r: r["mem_peak_mb"], reverse=True)[:10]

    fig = plt.figure(figsize=(14.0, 9.8))
    gs = fig.add_gridspec(2, 2, height_ratios=[1.12, 1.0], hspace=0.48, wspace=0.28)
    ax_cpu = fig.add_subplot(gs[0, 0])
    ax_mem = fig.add_subplot(gs[0, 1])
    ax_ts = fig.add_subplot(gs[1, :])

    # Top-left: Top 10 CPU consumers (Peak + Avg)
    y_cpu = np.arange(len(top_cpu))
    c_names = [r["container"] for r in reversed(top_cpu)]
    c_peak = [r["cpu_peak_pct"] for r in reversed(top_cpu)]
    c_avg = [r["cpu_avg_pct"] for r in reversed(top_cpu)]
    c_colors = [TIER_COLORS.get(r["tier"], "#64748b") for r in reversed(top_cpu)]

    ax_cpu.barh(y_cpu, c_peak, height=0.62, color=c_colors, alpha=0.45, label="Peak CPU (%)")
    ax_cpu.barh(y_cpu, c_avg, height=0.62, color=c_colors, alpha=0.95, label="Avg CPU (%)")
    max_cpu = max(c_peak + [10.0])
    for i, (pk, av) in enumerate(zip(c_peak, c_avg)):
        ax_cpu.text(pk + max_cpu * 0.015, i, f"{av:.0f}% / {pk:.0f}%", va="center", fontsize=8.2, color="#0f172a")
    ax_cpu.set_yticks(y_cpu)
    ax_cpu.set_yticklabels(c_names)
    ax_cpu.set_xlabel("CPU Utilization (% of single core; >100% = multi-core)")
    ax_cpu.set_title(f"Top 10 Containers by CPU ({target_profile.title()} Test — Avg / Peak)")
    ax_cpu.set_xlim(0, max_cpu * 1.28)
    ax_cpu.grid(axis="x", linestyle="--", alpha=0.35)

    # Top-right: Top 10 RAM consumers (Peak + Avg)
    y_mem = np.arange(len(top_mem))
    m_names = [r["container"] for r in reversed(top_mem)]
    m_peak = [r["mem_peak_mb"] for r in reversed(top_mem)]
    m_avg = [r["mem_avg_mb"] for r in reversed(top_mem)]
    m_colors = [TIER_COLORS.get(r["tier"], "#64748b") for r in reversed(top_mem)]

    ax_mem.barh(y_mem, m_peak, height=0.62, color=m_colors, alpha=0.45)
    ax_mem.barh(y_mem, m_avg, height=0.62, color=m_colors, alpha=0.95)
    max_mem = max(m_peak + [50.0])
    for i, (pk, av) in enumerate(zip(m_peak, m_avg)):
        ax_mem.text(pk + max_mem * 0.015, i, f"{av:.0f} / {pk:.0f} MB", va="center", fontsize=8.2, color="#0f172a")
    ax_mem.set_yticks(y_mem)
    ax_mem.set_yticklabels(m_names)
    ax_mem.set_xlabel("Memory Usage (MiB)")
    ax_mem.set_title(f"Top 10 Containers by Memory ({target_profile.title()} Test — Avg / Peak)")
    ax_mem.set_xlim(0, max_mem * 1.32)
    ax_mem.grid(axis="x", linestyle="--", alpha=0.35)

    # Shared Tier Legend
    tier_patches = [mpatches.Patch(color=TIER_COLORS[k], label=TIER_LABELS[k]) for k in ("edge", "microservices", "databases", "infra")]
    ax_mem.legend(handles=tier_patches, loc="lower right", frameon=True, fontsize=8.2)

    # Bottom panel: CPU % timeline of Top 6 active services
    raw_recs = raw_by_profile.get(target_profile, [])
    top6_names = [r["container"] for r in top_cpu[:6]]
    series_map: dict[str, list[tuple[float, float]]] = defaultdict(list)
    phase_changes: list[tuple[float, str]] = []
    seen_phase = None

    for rec in sorted(raw_recs, key=lambda x: x["elapsed_s"]):
        if rec["phase"] != seen_phase and rec["phase"] not in ("stress_init", "load_init"):
            phase_changes.append((rec["elapsed_s"], rec["phase"]))
            seen_phase = rec["phase"]
        if rec["container"] in top6_names:
            series_map[rec["container"]].append((rec["elapsed_s"], rec["cpu_pct"]))

    palette = ["#dc2626", "#2563eb", "#7c3aed", "#ea580c", "#0d9488", "#ca8a04"]
    max_ts_cpu = 10.0
    for idx, cname in enumerate(top6_names):
        pts = series_map.get(cname, [])
        if not pts:
            continue
        ts_x = [p[0] for p in pts]
        ts_y = [p[1] for p in pts]
        max_ts_cpu = max(max_ts_cpu, max(ts_y))
        ax_ts.plot(ts_x, ts_y, linewidth=2.1, marker=".", markersize=4, color=palette[idx % len(palette)], label=cname)

    for px, plabel in phase_changes:
        ax_ts.axvline(px, color="#94a3b8", linestyle="--", linewidth=1.0, alpha=0.7)
        clean_lbl = plabel.replace("stress_", "").replace("load_", "").replace("vus", " VUs")
        ax_ts.text(px + 1.2, max_ts_cpu * 1.14, clean_lbl, fontsize=8.3, fontweight="bold", color="#475569", va="top")

    ax_ts.set_title(f"CPU Utilization Timeline — Top 6 Active Containers ({target_profile.title()} Test)", pad=30)
    ax_ts.set_xlabel("Elapsed Time (seconds)")
    ax_ts.set_ylabel("CPU Utilization (%)")
    ax_ts.set_ylim(0, max_ts_cpu * 1.24)
    ax_ts.grid(True, linestyle="--", alpha=0.35)
    ax_ts.legend(loc="lower center", bbox_to_anchor=(0.5, 1.01), ncol=6, frameon=True, fontsize=8.6)

    fig.suptitle(f"GeoPicto Container Hardware Telemetry Dashboard ({run_label})", fontsize=14, fontweight="bold", y=0.985)
    out_path = charts_dir / "05_resources_cpu_ram_top.png"
    plt.savefig(out_path, dpi=180, bbox_inches="tight")
    plt.close(fig)
    return out_path


def plot_p2_vs_p3_tradeoff(
    p2_stress: list[dict[str, Any]],
    p3_stress: list[dict[str, Any]],
    p2_knee: dict[str, Any],
    p3_knee: dict[str, Any],
    charts_dir: Path,
    p2_label: str,
    p3_label: str,
) -> Path | None:
    p2_map = {r["vus"]: r for r in p2_stress}
    p3_map = {r["vus"]: r for r in p3_stress}
    common_vus = sorted(set(p2_map.keys()) & set(p3_map.keys()))
    if not common_vus:
        return None

    x = np.arange(len(common_vus))
    vus_labels = [str(v) for v in common_vus]
    p2_p95 = [p2_map[v]["p95_ms"] for v in common_vus]
    p3_p95 = [p3_map[v]["p95_ms"] for v in common_vus]
    p2_rps = [p2_map[v]["rps"] for v in common_vus]
    p3_rps = [p3_map[v]["rps"] for v in common_vus]
    p2_err = [p2_map[v]["real_error_pct"] for v in common_vus]
    p3_err = [p3_map[v]["real_error_pct"] for v in common_vus]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14.0, 5.8))

    # Panel 1: p95 Latency Comparison
    ax1.plot(x, p2_p95, marker="o", linewidth=2.4, color="#0284c7", label=f"{p2_label} (P2 HTTP Baseline)")
    ax1.plot(x, p3_p95, marker="s", linewidth=2.4, linestyle="--", color="#7c3aed", label=f"{p3_label} (P3 HTTPS + Security)")

    max_y = max(p2_p95 + p3_p95 + [100.0])
    for i, (y2, y3) in enumerate(zip(p2_p95, p3_p95)):
        delta = y3 - y2
        sign = "+" if delta >= 0 else ""
        ax1.annotate(
            f"{sign}{delta:.0f} ms",
            (x[i], max(y2, y3)),
            textcoords="offset points",
            xytext=(0, 9),
            ha="center",
            fontsize=8.2,
            color="#5b21b6",
        )

    ax1.set_title("p95 Latency Overhead (P2 Baseline vs. P3 Hardened)")
    ax1.set_xticks(x)
    ax1.set_xticklabels(vus_labels)
    ax1.set_xlabel("Concurrent Virtual Users (VUs)")
    ax1.set_ylabel("p95 Response Time (ms)")
    ax1.set_ylim(0, max_y * 1.25)
    ax1.grid(True, linestyle="--", alpha=0.35)
    ax1.legend(loc="upper left", frameon=True)

    # Panel 2: Throughput (RPS) & Error Rate Comparison
    width = 0.36
    ax2.bar(x - width / 2, p2_rps, width, color="#0284c7", alpha=0.85, label=f"{p2_label} Throughput (req/s)")
    ax2.bar(x + width / 2, p3_rps, width, color="#7c3aed", alpha=0.85, label=f"{p3_label} Throughput (req/s)")
    ax2.set_title(
        f"Throughput & Knee Shift (P2 Knee: {p2_knee.get('knee_vus', 'N/A')} VUs vs. P3 Knee: {p3_knee.get('knee_vus', 'N/A')} VUs)"
    )
    ax2.set_xticks(x)
    ax2.set_xticklabels(vus_labels)
    ax2.set_xlabel("Concurrent Virtual Users (VUs)")
    ax2.set_ylabel("Throughput (req/s)")
    ax2.set_ylim(0, max(p2_rps + p3_rps + [10.0]) * 1.28)
    ax2.grid(axis="y", linestyle="--", alpha=0.35)

    ax2_r = ax2.twinx()
    ax2_r.plot(x, p2_err, marker="^", linewidth=1.8, color="#0369a1", linestyle=":", label=f"{p2_label} Error %")
    ax2_r.plot(x, p3_err, marker="v", linewidth=2.0, color="#dc2626", linestyle="-.", label=f"{p3_label} Error %")
    ax2_r.set_ylabel("Real Error Rate (%)", color="#dc2626")
    ax2_r.tick_params(axis="y", labelcolor="#dc2626")
    ax2_r.set_ylim(-1.0, max(p2_err + p3_err + [10.0]) * 1.28)

    h1, l1 = ax2.get_legend_handles_labels()
    h2, l2 = ax2_r.get_legend_handles_labels()
    ax2.legend(h1 + h2, l1 + l2, loc="upper left", frameon=True, fontsize=8.2)

    fig.suptitle("GeoPicto Architectural Trade-off: Security Hardening vs. Performance", fontsize=14, fontweight="bold", y=0.99)
    plt.tight_layout(rect=[0, 0, 1, 0.94])
    out_path = charts_dir / "06_p2_vs_p3_security_tradeoff.png"
    plt.savefig(out_path, dpi=180)
    plt.close(fig)
    return out_path


# ------------------------------------------------------------------------------
# Flow Aggregation Helper
# ------------------------------------------------------------------------------

def extract_flow_summary(load_rows: list[dict[str, Any]], stress_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    # Prefer the highest nominal Load Test step (e.g., 100 VUs) for clean un-saturated per-flow comparison;
    # fallback to a moderate Stress step if Load Test was skipped.
    ref_row = None
    ref_label = "Nominal Load"
    if load_rows:
        for r in reversed(load_rows):
            if r.get("flows"):
                ref_row = r
                ref_label = f"Load Test @ {r['vus']} VUs"
                break
    if ref_row is None and stress_rows:
        for r in stress_rows:
            if r.get("flows"):
                ref_row = r
                ref_label = f"Stress Test @ {r['vus']} VUs"
                if r["vus"] >= 100:
                    break

    if not ref_row:
        return [], ref_label

    rows = []
    for flow_key, _, _, short_label, description in FLOW_METADATA:
        fd = ref_row["flows"].get(flow_key)
        if not fd:
            continue
        rows.append(
            {
                "flow": flow_key,
                "short_label": short_label,
                "description": description,
                "count": fd["count"],
                "rps": fd["rps"],
                "avg_ms": fd["avg_ms"],
                "min_ms": fd["min_ms"],
                "p50_ms": fd["p50_ms"],
                "p90_ms": fd["p90_ms"],
                "p95_ms": fd["p95_ms"],
                "p99_ms": fd["p99_ms"],
                "max_ms": fd["max_ms"],
            }
        )
    return rows, ref_label


# ------------------------------------------------------------------------------
# Markdown Report Generator (English — Ready for Prototype 3 Document)
# ------------------------------------------------------------------------------

def build_markdown_report(
    run_dir: Path,
    host_info: dict[str, Any],
    load_rows: list[dict[str, Any]],
    stress_rows: list[dict[str, Any]],
    knee: dict[str, Any],
    spike_info: dict[str, Any],
    ratelimit_rows: list[dict[str, Any]],
    flow_rows: list[dict[str, Any]],
    flow_ref_label: str,
    res_summary: list[dict[str, Any]],
    charts: dict[str, Path | None],
    comparison_section: str = "",
) -> str:
    target = host_info.get("target") or {}
    host = host_info.get("host") or {}
    dk = host_info.get("docker_engine") or {}
    tools = host_info.get("tools") or {}
    run_label = host_info.get("run_label") or run_dir.name

    lines: list[str] = []
    lines.append(f"# Performance & Scalability Analysis — GeoPicto (`{run_label}`)")
    lines.append("")
    lines.append(
        "This section presents the empirical performance evaluation of **GeoPicto** under nominal load, "
        "progressive stress up to high concurrency, and sudden traffic spikes, together with per-container "
        "hardware telemetry (`CPU %`, `RAM`, and `Network I/O`) and architectural bottleneck identification."
    )
    lines.append("")

    # 1. Test Environment
    lines.append("## 1. Test Environment & Tools")
    lines.append("")
    lines.append("| Parameter | Value |")
    lines.append("| :--- | :--- |")
    lines.append(f"| **Run Label / Git Branch** | `{run_label}` (`{host_info.get('git_branch', 'unknown')}` @ `{host_info.get('git_commit', 'unknown')}`) |")
    lines.append(f"| **Target Endpoint & Protocol** | `{target.get('base_url', 'unknown')}` (`{target.get('protocol', 'unknown')}`) |")
    lines.append(f"| **Reverse Proxy Detected** | `{'Yes (Nginx Edge)' if target.get('reverse_proxy_detected') else 'No (Direct Gateway)'}` |")
    lines.append(f"| **Rate Limiting State** | `{target.get('rate_limit_mode', 'unknown')}` |")
    lines.append(f"| **Active Docker Containers** | `{dk.get('active_containers_count', 'N/A')}` containers (Compose project `{target.get('compose_project', 'geopicto')}`) |")
    lines.append(f"| **Host Machine** | {host.get('os', 'N/A')} ({host.get('arch', 'N/A')}) — {host.get('cpu_model', 'N/A')} ({host.get('cpu_cores_logical', 'N/A')} logical cores, {host.get('ram_total_gb', 'N/A')} GB RAM) |")
    lines.append(f"| **Docker Engine Resources** | {dk.get('version', 'N/A')} (Allocated: {dk.get('allocated_cpus', 'N/A')} vCPUs, {dk.get('allocated_ram_gb', 'N/A')} GB RAM) |")
    lines.append(f"| **Load Generator & Telemetry** | `{tools.get('k6', 'k6')}` · Docker `stats` collector (`collect-metrics.sh`) · Python `{tools.get('python', '3.x')}` (`matplotlib`/`numpy`) |")
    lines.append("")

    # 2. Performance Quality Attribute Scenario
    max_vus_str = str(stress_rows[-1]["vus"]) if stress_rows else "2000"
    lines.append("## 2. Performance Quality Attribute Scenario")
    lines.append("")
    lines.append("| Scenario Element | Description |")
    lines.append("| :--- | :--- |")
    lines.append("| **Source** | External concurrent GeoPicto clients simulated via **k6** Virtual Users (VUs). |")
    lines.append(
        f"| **Stimulus** | Mixed realistic workload (50% PostGIS `GET /api/messages/nearby`, 20% GraphQL `POST /api/network/graphql`, "
        f"20% writes `POST /api/messages` & `PUT /api/ratings/messages/:id`, 10% `POST /api/auth/login`) across **Load** "
        f"(nominal concurrency), **Stress** (up to **{max_vus_str} VUs**), and **Spike** (abrupt traffic surge & recovery) profiles. |"
    )
    lines.append(
        "| **Artifact** | End-to-end hardened GeoPicto stack (`reverse-proxy` → `gateway` → `auth`, `messages`, `moderation`, `rating`, `reputation`, `network` → PostgreSQL/PostGIS, MongoDB, Redis, RabbitMQ). |"
    )
    lines.append(
        "| **Environment** | Normal steady-state operation, progressive saturation ramp, and sudden traffic surge over seeded datasets of users, published geo-messages, and friendships. |"
    )
    lines.append(
        "| **Response** | The system processes requests through the perimeter Reverse Proxy, API Gateway security filters, domain microservices, and backing data stores while maintaining bounded tail latency and graceful recovery after spikes. |"
    )
    lines.append(
        "| **Response Measure** | Latency percentiles (`p50`, `p90`, `p95`, `p99`), sustained throughput (`req/s`), real error rate (`5xx`/timeout `%` separated from `HTTP 429`), **Knee of the Performance Curve**, spike recovery time (`s`), and container `CPU %` / `RAM (MiB)`. |"
    )
    lines.append("")

    # 3. Load Test Results
    if load_rows:
        lines.append("## 3. Load Test Results (Nominal Concurrency)")
        lines.append("")
        lines.append("| VUs | Requests | Throughput (req/s) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Real Error (%) | HTTP 429 (%) |")
        lines.append("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for r in load_rows:
            lines.append(
                f"| {r['vus']} | {r['samples']} | {r['rps']:.2f} | {r['avg_ms']:.2f} | "
                f"{r['p50_ms']:.2f} | {r['p90_ms']:.2f} | {r['p95_ms']:.2f} | {r['p99_ms']:.2f} | "
                f"{r['max_ms']:.2f} | {r['real_error_pct']:.2f}% | {r['rate_429_pct']:.2f}% |"
            )
        lines.append("")
        if charts.get("load"):
            lines.append(f"![Nominal Load Test Latency and Throughput](charts/{charts['load'].name})")
            lines.append("")

    # 4. Stress Test Results & Knee
    if stress_rows:
        lines.append("## 4. Stress Test Results & Knee of the Performance Curve")
        lines.append("")
        lines.append("| VUs | Requests | Throughput (req/s) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Real Error (%) | HTTP 429 (%) |")
        lines.append("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for r in stress_rows:
            marker = " **(Knee)**" if r["vus"] == knee.get("knee_vus") else ""
            lines.append(
                f"| {r['vus']}{marker} | {r['samples']} | {r['rps']:.2f} | {r['avg_ms']:.2f} | "
                f"{r['p50_ms']:.2f} | {r['p90_ms']:.2f} | {r['p95_ms']:.2f} | {r['p99_ms']:.2f} | "
                f"{r['max_ms']:.2f} | {r['real_error_pct']:.2f}% | {r['rate_429_pct']:.2f}% |"
            )
        lines.append("")
        lines.append(
            f"- **Detected Knee of the Performance Curve:** **{knee['knee_vus']} concurrent VUs** "
            f"(Throughput = **{knee['knee_rps']:.2f} req/s**, `p95` = **{knee['knee_p95_ms']:.2f} ms**, "
            f"`p99` = **{knee['knee_p99_ms']:.2f} ms**, Real Error Rate = **{knee['knee_real_error_pct']:.2f}%**)."
        )
        lines.append(
            f"- **Peak Observed Throughput:** **{knee['peak_rps']:.2f} req/s** at **{knee['peak_rps_vus']} VUs**."
        )
        if knee.get("first_error_vus") is not None:
            lines.append(
                f"- **Degradation / Error Onset:** Real errors (`5xx` / timeouts) surpassed the 1% SLO budget at "
                f"**{knee['first_error_vus']} VUs** (**{knee['first_error_pct']:.2f}%**)."
            )
        else:
            lines.append(
                f"- **Error Stability:** Real errors remained within the 1% SLO budget up to **{knee['max_tested_vus']} VUs**."
            )
        lines.append("")
        if charts.get("stress"):
            lines.append(f"![Stress Test Performance Curve and Knee](charts/{charts['stress'].name})")
            lines.append("")

    # 5. Spike Test Results
    if spike_info and spike_info.get("phases"):
        meta = spike_info["meta"]
        rec_t = spike_info.get("recovery_time_s")
        lines.append("## 5. Spike Test & Recovery Resilience")
        lines.append("")
        lines.append(
            f"The spike profile subjected GeoPicto to an abrupt surge from **{meta['base_vus']} VUs** to "
            f"**{meta['spike_vus']} VUs** ({meta['spike_vus'] / max(meta['base_vus'], 1):.0f}x burst) for "
            f"**{meta['spike_duration_s']}s**, followed by an immediate drop back to **{meta['base_vus']} VUs** "
            f"for **{meta['recovery_duration_s']}s** of recovery observation."
        )
        lines.append("")
        lines.append("| Spike Phase | Avg VUs | Max VUs | Avg RPS | Peak RPS | Avg (ms) | p50 (ms) | p95 (ms) | Peak p99 (ms) | Avg Err (%) | Peak Err (%) |")
        lines.append("| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for ph in spike_info["phases"]:
            lines.append(
                f"| {ph['phase']} | {ph['avg_vus']:.1f} | {ph['max_vus']:.0f} | {ph['avg_rps']:.2f} | "
                f"{ph['peak_rps']:.2f} | {ph['avg_ms']:.2f} | {ph['p50_ms']:.2f} | {ph['p95_ms']:.2f} | "
                f"{ph['p99_ms']:.2f} | {ph['avg_err_pct']:.2f}% | {ph['peak_err_pct']:.2f}% |"
            )
        lines.append("")
        if rec_t is not None:
            lines.append(
                f"- **Measured Recovery Time:** After the surge subsided, latency (`p95`) and error rate returned to "
                f"baseline levels within **{rec_t:.1f} seconds**, demonstrating graceful non-cascading recovery."
            )
        else:
            lines.append(
                "- **Measured Recovery Time:** Latency or error rate had not fully returned to baseline within the "
                "observation window, indicating lingering queue/connection backlog after the surge."
            )
        lines.append("")
        if charts.get("spike"):
            lines.append(f"![Spike Test Surge and Recovery](charts/{charts['spike'].name})")
            lines.append("")

    # 6. Per-Flow Comparison
    if flow_rows:
        lines.append(f"## 6. Per-Flow Latency Breakdown ({flow_ref_label})")
        lines.append("")
        lines.append("| Architectural Flow | Requests | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |")
        lines.append("| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for r in flow_rows:
            lines.append(
                f"| {r['description']} | {r['count']} | {r['avg_ms']:.2f} | {r['p50_ms']:.2f} | "
                f"{r['p90_ms']:.2f} | {r['p95_ms']:.2f} | {r['p99_ms']:.2f} | {r['max_ms']:.2f} |"
            )
        lines.append("")
        if charts.get("flows"):
            lines.append(f"![Architectural Flow Comparison](charts/{charts['flows'].name})")
            lines.append("")

    # Optional: Protected Rate-Limit Burst Validation
    if ratelimit_rows:
        lines.append("## 6b. Protected Burst Validation (`RATE_LIMIT_ENABLED=true`)")
        lines.append("")
        lines.append("| VUs | Requests | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | HTTP 429 Rejected (%) | Real Server Error 5xx (%) |")
        lines.append("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for r in ratelimit_rows:
            lines.append(
                f"| {r['vus']} | {r['samples']} | {r['rps']:.2f} | {r['p50_ms']:.2f} | "
                f"{r['p95_ms']:.2f} | {r['p99_ms']:.2f} | {r['rate_429_pct']:.2f}% ({r['rate_429_count']}) | {r['real_error_pct']:.2f}% |"
            )
        lines.append("")
        lines.append(
            "With Redis Token-Bucket Rate Limiting active (Scenario 4), excess burst traffic is shed early at the "
            "API Gateway with `HTTP 429 Too Many Requests` instead of reaching downstream services and databases, "
            "preserving near-zero `5xx` server errors."
        )
        lines.append("")

    # 7. Hardware Resource Utilization
    if res_summary:
        ref_prof = "stress" if any(r["profile"] == "stress" for r in res_summary) else res_summary[0]["profile"]
        prof_rows = sorted(
            [r for r in res_summary if r["profile"] == ref_prof],
            key=lambda r: r["cpu_peak_pct"],
            reverse=True,
        )
        lines.append(f"## 7. Container Hardware Resource Utilization ({ref_prof.title()} Test)")
        lines.append("")
        lines.append("| Container | Tier | Avg CPU (%) | Peak CPU (%) | Avg RAM (MiB) | Peak RAM (MiB) | Net RX Δ (MB) | Net TX Δ (MB) | Peak PIDs |")
        lines.append("| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for r in prof_rows:
            lines.append(
                f"| `{r['container']}` | {TIER_LABELS.get(r['tier'], r['tier'])} | {r['cpu_avg_pct']:.1f}% | "
                f"**{r['cpu_peak_pct']:.1f}%** | {r['mem_avg_mb']:.1f} | {r['mem_peak_mb']:.1f} | "
                f"{r['net_rx_delta_mb']:.2f} | {r['net_tx_delta_mb']:.2f} | {r['pids_peak']} |"
            )
        lines.append("")
        if charts.get("resources"):
            lines.append(f"![Container CPU and RAM Utilization Dashboard](charts/{charts['resources'].name})")
            lines.append("")

    # Optional Comparison Section (P2 Baseline vs P3 Hardened)
    if comparison_section:
        lines.append(comparison_section)

    # 8. Critical Bottleneck Analysis & Conclusions
    lines.append("## 8. Critical Architectural Bottleneck Analysis & Conclusions")
    lines.append("")
    if flow_rows:
        slowest_flow = max(flow_rows, key=lambda r: r["p95_ms"])
        fastest_flow = min(flow_rows, key=lambda r: r["p95_ms"])
        lines.append(
            f"1. **Highest-Latency Flow:** `{slowest_flow['description']}` exhibited the highest tail latency "
            f"(`p95` = **{slowest_flow['p95_ms']:.2f} ms**, `p99` = **{slowest_flow['p99_ms']:.2f} ms**), compared "
            f"to the fastest flow `{fastest_flow['description']}` (`p95` = **{fastest_flow['p95_ms']:.2f} ms**)."
        )

    if res_summary:
        ref_prof = "stress" if any(r["profile"] == "stress" for r in res_summary) else res_summary[0]["profile"]
        prof_rows = [r for r in res_summary if r["profile"] == ref_prof]
        top_cpu_svc = max(prof_rows, key=lambda r: r["cpu_peak_pct"])
        top_mem_svc = max(prof_rows, key=lambda r: r["mem_peak_mb"])
        lines.append(
            f"2. **Primary CPU Bottleneck:** Container `{top_cpu_svc['container']}` reached the highest CPU peak "
            f"(**{top_cpu_svc['cpu_peak_pct']:.1f}%**, avg **{top_cpu_svc['cpu_avg_pct']:.1f}%**). "
            + BOTTLENECK_EXPLANATIONS.get(top_cpu_svc["container"], "Sustained concurrency saturated compute allocation on this service.")
        )
        lines.append(
            f"3. **Primary Memory Consumer:** Container `{top_mem_svc['container']}` consumed the highest memory "
            f"footprint (**{top_mem_svc['mem_peak_mb']:.1f} MiB** peak, **{top_mem_svc['mem_avg_mb']:.1f} MiB** avg)."
        )

        # Add secondary architectural bottlenecks observed among top 4 CPU containers
        secondary_notes = []
        for r in sorted(prof_rows, key=lambda x: x["cpu_peak_pct"], reverse=True)[1:4]:
            exp = BOTTLENECK_EXPLANATIONS.get(r["container"])
            if exp:
                secondary_notes.append(f"   - **`{r['container']}` (Peak CPU {r['cpu_peak_pct']:.1f}%):** {exp}")
        if secondary_notes:
            lines.append("4. **Secondary Contention Points:**")
            lines.extend(secondary_notes)

    if knee:
        lines.append(
            f"5. **Capacity Ceiling & Scaling Recommendations:** The single-node Docker deployment maintains reliable "
            f"SLOs up to the **knee at {knee['knee_vus']} concurrent VUs ({knee['knee_rps']:.1f} req/s)**. Beyond this "
            f"threshold, queuing delays and timeouts grow sharply. To scale beyond {knee['knee_vus']} VUs in production:"
        )
        lines.append("   - Horizontally replicate stateless hot-path services (`gateway`, `auth`, `messages`, `network`) behind Nginx load balancing.")
        lines.append("   - Introduce read replicas or spatial query caching (Redis geospatial cache) for `GET /api/messages/nearby` hotspots.")
        lines.append("   - Tune PostgreSQL `max_connections` / `pgxpool` sizing and decouple write-heavy vote aggregation in `rating` to minimize `SELECT ... FOR UPDATE` lock contention.")
        lines.append("   - Keep Redis-backed **Rate Limiting (Scenario 4)** enabled in production so abusive traffic sheds cleanly with `HTTP 429` before reaching CPU saturation.")

    lines.append("")
    return "\n".join(lines)


# ------------------------------------------------------------------------------
# Single-Run & Comparison Entry Points
# ------------------------------------------------------------------------------

def analyze_single_run(run_dir: Path, extra_comparison_md: str = "") -> dict[str, Any]:
    tables_dir = run_dir / "tables"
    charts_dir = run_dir / "charts"
    tables_dir.mkdir(parents=True, exist_ok=True)
    charts_dir.mkdir(parents=True, exist_ok=True)

    host_info = load_host_info(run_dir)
    run_label = host_info.get("run_label") or run_dir.name

    load_rows = load_profile_summaries(run_dir, "load")
    stress_rows = load_profile_summaries(run_dir, "stress")
    # Graceful fallback for legacy Lab 6 summary_vus_*.json naming
    if not stress_rows:
        stress_rows = load_profile_summaries(run_dir, "vus")
    ratelimit_rows = load_profile_summaries(run_dir, "ratelimit")

    knee = find_knee(stress_rows)
    spike_points, spike_info = analyze_spike(run_dir)
    flow_rows, flow_ref_label = extract_flow_summary(load_rows, stress_rows)
    res_summary, raw_by_profile = load_docker_stats(run_dir)

    # Save structured tables
    k6_cols = [
        "vus", "samples", "rps", "avg_ms", "min_ms",
        "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms",
        "real_error_pct", "rate_429_pct", "rate_429_count", "http_failed_pct",
    ]
    if load_rows:
        write_csv(tables_dir / "load_summary.csv", k6_cols, load_rows)
    if stress_rows:
        write_csv(tables_dir / "stress_summary.csv", k6_cols, stress_rows)
        with (tables_dir / "knee_analysis.json").open("w", encoding="utf-8") as fh:
            json.dump(knee, fh, indent=2)
    if flow_rows:
        write_csv(
            tables_dir / "flows_summary.csv",
            ["flow", "description", "count", "rps", "avg_ms", "min_ms", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms"],
            flow_rows,
        )
    if spike_info and spike_info.get("phases"):
        write_csv(
            tables_dir / "spike_summary.csv",
            ["phase", "avg_vus", "max_vus", "avg_rps", "peak_rps", "avg_ms", "p50_ms", "p95_ms", "p99_ms", "avg_err_pct", "peak_err_pct"],
            spike_info["phases"],
        )
    if res_summary:
        write_csv(
            tables_dir / "resources_summary.csv",
            ["profile", "container", "tier", "samples", "cpu_avg_pct", "cpu_peak_pct", "mem_avg_mb", "mem_peak_mb", "mem_peak_pct", "net_rx_delta_mb", "net_tx_delta_mb", "pids_peak"],
            res_summary,
        )

    # Generate high-res PNG charts
    charts = {
        "load": plot_load_summary(load_rows, charts_dir, run_label),
        "stress": plot_stress_curve_and_knee(stress_rows, knee, charts_dir, run_label),
        "spike": plot_spike_recovery(spike_points, spike_info, charts_dir, run_label),
        "flows": plot_flows_comparison(flow_rows, charts_dir, run_label, flow_ref_label),
        "resources": plot_resources_dashboard(res_summary, raw_by_profile, charts_dir, run_label),
    }

    # Build English Markdown report ready for Prototype 3
    report_md = build_markdown_report(
        run_dir=run_dir,
        host_info=host_info,
        load_rows=load_rows,
        stress_rows=stress_rows,
        knee=knee,
        spike_info=spike_info,
        ratelimit_rows=ratelimit_rows,
        flow_rows=flow_rows,
        flow_ref_label=flow_ref_label,
        res_summary=res_summary,
        charts=charts,
        comparison_section=extra_comparison_md,
    )
    report_path = run_dir / "p3_performance_section.md"
    report_path.write_text(report_md, encoding="utf-8")

    print(f"[analyze] Processed run: {run_dir}")
    print(f"[analyze]   Tables : {tables_dir}")
    print(f"[analyze]   Charts : {charts_dir}")
    print(f"[analyze]   Report : {report_path}")
    if knee:
        print(
            f"[analyze]   Knee   : {knee['knee_vus']} VUs "
            f"(RPS={knee['knee_rps']}, p95={knee['knee_p95_ms']} ms, err={knee['knee_real_error_pct']}%)"
        )

    return {
        "host_info": host_info,
        "load_rows": load_rows,
        "stress_rows": stress_rows,
        "knee": knee,
        "charts": charts,
        "report_path": report_path,
    }


def run_comparison(p2_dir: Path, p3_dir: Path, out_dir: Path) -> None:
    p2_host = load_host_info(p2_dir)
    p3_host = load_host_info(p3_dir)
    p2_label = p2_host.get("run_label") or p2_dir.name
    p3_label = p3_host.get("run_label") or p3_dir.name

    p2_stress = load_profile_summaries(p2_dir, "stress") or load_profile_summaries(p2_dir, "vus")
    p3_stress = load_profile_summaries(p3_dir, "stress") or load_profile_summaries(p3_dir, "vus")
    p2_knee = find_knee(p2_stress)
    p3_knee = find_knee(p3_stress)

    charts_dir = out_dir / "charts"
    tables_dir = out_dir / "tables"
    charts_dir.mkdir(parents=True, exist_ok=True)
    tables_dir.mkdir(parents=True, exist_ok=True)

    chart_path = plot_p2_vs_p3_tradeoff(
        p2_stress, p3_stress, p2_knee, p3_knee, charts_dir, p2_label, p3_label
    )

    p2_map = {r["vus"]: r for r in p2_stress}
    p3_map = {r["vus"]: r for r in p3_stress}
    common_vus = sorted(set(p2_map.keys()) & set(p3_map.keys()))

    comp_rows = []
    md_lines = [
        "## 7b. Architectural Trade-off: Prototype 2 (Baseline) vs. Prototype 3 (Hardened Security)",
        "",
        "To quantify the performance cost of incorporating the 5 Prototype 3 security patterns "
        "(TLS 1.2/1.3 Secure Channel, Nginx Reverse Proxy, Docker Network Segmentation, Redis Rate Limiting, "
        "and Redis Distributed Token Revocation Blacklist), the identical stress suite was executed against "
        f"both **`{p2_label}`** (Prototype 2 `main` over direct HTTP `:8080`) and **`{p3_label}`** (Prototype 3 "
        "integrated branch over HTTPS `:443`).",
        "",
        "| VUs | P2 p95 (ms) | P3 p95 (ms) | Latency Overhead (Δ ms / Δ %) | P2 RPS | P3 RPS | Throughput Δ (%) | P2 Err (%) | P3 Err (%) |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]

    for v in common_vus:
        r2, r3 = p2_map[v], p3_map[v]
        d_ms = r3["p95_ms"] - r2["p95_ms"]
        d_pct = (d_ms / max(r2["p95_ms"], 1e-6)) * 100.0
        rps_pct = ((r3["rps"] - r2["rps"]) / max(r2["rps"], 1e-6)) * 100.0
        comp_rows.append(
            {
                "vus": v,
                "p2_p95_ms": r2["p95_ms"],
                "p3_p95_ms": r3["p95_ms"],
                "latency_delta_ms": d_ms,
                "latency_delta_pct": d_pct,
                "p2_rps": r2["rps"],
                "p3_rps": r3["rps"],
                "rps_delta_pct": rps_pct,
                "p2_err_pct": r2["real_error_pct"],
                "p3_err_pct": r3["real_error_pct"],
            }
        )
        sign_ms = "+" if d_ms >= 0 else ""
        sign_rps = "+" if rps_pct >= 0 else ""
        md_lines.append(
            f"| {v} | {r2['p95_ms']:.2f} | {r3['p95_ms']:.2f} | {sign_ms}{d_ms:.2f} ms ({sign_ms}{d_pct:.1f}%) | "
            f"{r2['rps']:.2f} | {r3['rps']:.2f} | {sign_rps}{rps_pct:.1f}% | "
            f"{r2['real_error_pct']:.2f}% | {r3['real_error_pct']:.2f}% |"
        )

    write_csv(
        tables_dir / "p2_vs_p3_comparison.csv",
        ["vus", "p2_p95_ms", "p3_p95_ms", "latency_delta_ms", "latency_delta_pct", "p2_rps", "p3_rps", "rps_delta_pct", "p2_err_pct", "p3_err_pct"],
        comp_rows,
    )

    md_lines.append("")
    md_lines.append(
        f"- **Knee Shift:** Prototype 2 Baseline knee = **{p2_knee.get('knee_vus', 'N/A')} VUs** "
        f"({p2_knee.get('knee_rps', 0.0):.1f} req/s) vs. Prototype 3 Hardened knee = **{p3_knee.get('knee_vus', 'N/A')} VUs** "
        f"({p3_knee.get('knee_rps', 0.0):.1f} req/s)."
    )
    md_lines.append(
        "- **Trade-off Assessment:** The observed latency delta is primarily attributable to an additional network hop "
        "and TLS termination at the Nginx `reverse-proxy` (Scenarios 1 & 2) plus per-request Redis lookups in `gateway` "
        "(Scenarios 4 & 5). This modest overhead is an intentional and acceptable architectural trade-off in exchange "
        "for end-to-end encryption in transit, perimeter surface reduction, lateral-movement isolation, brute-force "
        "mitigation, and immediate JWT revocation."
    )
    md_lines.append("")
    if chart_path:
        md_lines.append(f"![Prototype 2 vs Prototype 3 Security-Performance Trade-off](charts/{chart_path.name})")
        md_lines.append("")

    comparison_md = "\n".join(md_lines)
    # Re-render the P3 report embedding the comparison section cleanly
    analyze_single_run(out_dir, extra_comparison_md=comparison_md)
    print(f"[compare] Generated P2 vs P3 comparison chart & updated report in: {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze GeoPicto k6 + Docker stats performance results and generate English charts & report."
    )
    parser.add_argument("run_dir", nargs="?", help="Path to a single performance run directory (e.g. performance/results/p3-hardened)")
    parser.add_argument("--compare", nargs=2, metavar=("P2_DIR", "P3_DIR"), help="Compare Prototype 2 baseline run vs. Prototype 3 hardened run")
    parser.add_argument("--out", help="Output directory for --compare (defaults to P3_DIR)")
    args = parser.parse_args()

    if args.compare:
        p2_dir = Path(args.compare[0]).resolve()
        p3_dir = Path(args.compare[1]).resolve()
        out_dir = Path(args.out).resolve() if args.out else p3_dir
        run_comparison(p2_dir, p3_dir, out_dir)
    elif args.run_dir:
        analyze_single_run(Path(args.run_dir).resolve())
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

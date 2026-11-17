#!/usr/bin/env python3
"""
Procesa los archivos JSON exportados por k6 (--summary-export),
construye la tabla de resultados, identifica la rodilla de la curva
de rendimiento (knee of the performance curve) conforme a la guia del
Laboratory 6, y genera la grafica performance/results/performance_curve.png.
"""

from __future__ import annotations

import csv
import glob
import json
import math
import os
import re
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt


def _get_metric_val(metric_obj: dict[str, Any], key: str, default: float = 0.0) -> float:
    if not metric_obj:
        return default
    if "values" in metric_obj and isinstance(metric_obj["values"], dict):
        metric_obj = metric_obj["values"]
    val = metric_obj.get(key, default)
    return float(val) if val is not None else default


def _get_fail_rate_pct(metrics: dict[str, Any]) -> float:
    m = metrics.get("http_req_failed", {})
    if "values" in m and isinstance(m["values"], dict):
        m = m["values"]
    if "rate" in m:
        return float(m["rate"]) * 100.0
    if "value" in m:
        return float(m["value"]) * 100.0
    passes = float(m.get("passes", 0.0))
    fails = float(m.get("fails", 0.0))
    total = passes + fails
    return (passes / total * 100.0) if total > 0 else 0.0


def load_k6_summaries(results_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pattern = str(results_dir / "summary_vus_*.json")
    for filepath in sorted(glob.glob(pattern)):
        match = re.search(r"summary_vus_(\d+)\.json$", filepath)
        if not match:
            continue
        vus = int(match.group(1))
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        metrics = data.get("metrics", {})
        dur = metrics.get("http_req_duration", {})
        reqs = metrics.get("http_reqs", {})

        avg_ms = _get_metric_val(dur, "avg")
        min_ms = _get_metric_val(dur, "min")
        med_ms = _get_metric_val(dur, "med")
        max_ms = _get_metric_val(dur, "max")
        p90_ms = _get_metric_val(dur, "p(90)")
        p95_ms = _get_metric_val(dur, "p(95)")
        rps = _get_metric_val(reqs, "rate")
        count = int(_get_metric_val(reqs, "count"))
        fail_pct = _get_fail_rate_pct(metrics)

        rows.append(
            {
                "vus": vus,
                "samples": count,
                "avg_ms": round(avg_ms, 2),
                "min_ms": round(min_ms, 2),
                "med_ms": round(med_ms, 2),
                "p90_ms": round(p90_ms, 2),
                "p95_ms": round(p95_ms, 2),
                "max_ms": round(max_ms, 2),
                "error_pct": round(fail_pct, 2),
                "rps": round(rps, 2),
            }
        )

    rows.sort(key=lambda r: r["vus"])
    return rows


def find_knee(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Identifica la rodilla de la curva (knee of the performance curve):
    Segun la guia del Laboratorio 6 (seccion iv.e.5):
      "Conclusion: the knee of the performance curve must be below the user
       threshold at which http_req_failed exceeds 0%."
    Ademas, usa la distancia perpendicular maxima a la secante (metodo Kneedle)
    sobre la curva normalizada (VUs vs avg_ms) dentro del rango valido.
    """
    if not rows:
        raise ValueError("No hay datos de k6 para calcular el knee.")

    first_error_row = next((r for r in rows if r["error_pct"] > 0.0), None)
    zero_error_rows = [r for r in rows if r["error_pct"] == 0.0]

    # Si existe algun nivel con http_req_failed > 0%, el knee debe estar por debajo
    # de ese umbral. Evaluamos los puntos con 0% error más el primer punto con error
    # como extremo de saturacion para proyectar la secante.
    if first_error_row and len(zero_error_rows) >= 2:
        candidates = zero_error_rows + [first_error_row]
        valid_knee_pool = zero_error_rows
    else:
        candidates = rows
        valid_knee_pool = rows[:-1] if len(rows) > 2 else rows

    x_min, x_max = candidates[0]["vus"], candidates[-1]["vus"]
    y_min = min(r["avg_ms"] for r in candidates)
    y_max = max(r["avg_ms"] for r in candidates)

    x_span = max(x_max - x_min, 1e-9)
    y_span = max(y_max - y_min, 1e-9)

    # Recta secante desde (0, 0) hasta (1, 1) en coordenadas normalizadas: y = x
    # Un punto (x_n, y_n) por debajo de la secante mientras la curva es plana y que
    # luego sube abruptamente maximiza (x_n - y_n).
    best_row = valid_knee_pool[-1]
    best_score = -1e9
    for r in valid_knee_pool:
        if r["vus"] == x_min and len(valid_knee_pool) > 1:
            continue
        x_n = (r["vus"] - x_min) / x_span
        y_n = (r["avg_ms"] - y_min) / y_span
        dist = (x_n - y_n) / math.sqrt(2.0)
        # Tambien ponderamos eficiencia (throughput / avg_ms)
        if dist > best_score:
            best_score = dist
            best_row = r

    return {
        "knee_vus": best_row["vus"],
        "knee_avg_ms": best_row["avg_ms"],
        "knee_p95_ms": best_row["p95_ms"],
        "knee_rps": best_row["rps"],
        "knee_error_pct": best_row["error_pct"],
        "first_error_vus": first_error_row["vus"] if first_error_row else None,
        "first_error_pct": first_error_row["error_pct"] if first_error_row else 0.0,
        "first_error_avg_ms": first_error_row["avg_ms"] if first_error_row else None,
    }


def save_csv_and_json(
    rows: list[dict[str, Any]], knee: dict[str, Any], results_dir: Path
) -> None:
    csv_path = results_dir / "summary_table.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    json_path = results_dir / "knee_analysis.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"rows": rows, "knee": knee}, f, indent=2)


def plot_performance_curve(
    rows: list[dict[str, Any]], knee: dict[str, Any], results_dir: Path
) -> Path:
    vus = [r["vus"] for r in rows]
    avg_ms = [r["avg_ms"] for r in rows]
    p95_ms = [r["p95_ms"] for r in rows]
    err_pct = [r["error_pct"] for r in rows]
    rps = [r["rps"] for r in rows]

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(11, 8.5), dpi=160, gridspec_kw={"height_ratios": [1.5, 1]}
    )
    fig.patch.set_facecolor("white")

    # Panel 1: Curva de Rendimiento (Tiempo de respuesta promedio vs Usuarios Concurrentes)
    ax1.plot(
        vus,
        avg_ms,
        marker="o",
        linewidth=2.6,
        markersize=8,
        color="#1d4ed8",
        label="http_req_duration (avg) [ms]",
        zorder=4,
    )
    ax1.plot(
        vus,
        p95_ms,
        marker="s",
        linewidth=1.8,
        linestyle="--",
        markersize=6,
        color="#64748b",
        label="http_req_duration (p95) [ms]",
        zorder=3,
    )

    # Etiquetas de valores promedio sobre cada punto
    y_max = max(max(avg_ms), 1.0)
    for x, y, e in zip(vus, avg_ms, err_pct):
        label_txt = f"{y:.1f} ms" if e == 0 else f"{y:.1f} ms\n(err {e:.1f}%)"
        if x == 1:
            offset = (-6, 16)
        elif x == 50:
            offset = (14, 7)
        else:
            offset = (0, 10)
        ax1.annotate(
            label_txt,
            (x, y),
            textcoords="offset points",
            xytext=offset,
            ha="center",
            fontsize=8.5,
            fontweight="bold" if x == knee["knee_vus"] else "normal",
            color="#b91c1c" if e > 0 else "#0f172a",
        )

    # Marcar el Knee of the Performance Curve
    kx = knee["knee_vus"]
    ky = knee["knee_avg_ms"]
    ax1.scatter(
        [kx],
        [ky],
        s=190,
        facecolors="none",
        edgecolors="#16a34a",
        linewidths=2.8,
        zorder=6,
        label=f"Knee of the Curve ({kx} VUs, avg={ky:.2f} ms, err=0%)",
    )
    ax1.axvline(
        kx,
        color="#16a34a",
        linestyle=":",
        linewidth=2.0,
        alpha=0.85,
    )
    ax1.annotate(
        f"KNEE OF THE CURVE\n{kx} concurrent users\navg = {ky:.2f} ms | fail = 0.00%",
        xy=(kx, ky),
        xytext=(max(kx * 0.55, vus[-1] * 0.18), ky + y_max * 0.25),
        arrowprops=dict(
            arrowstyle="->",
            color="#15803d",
            lw=2.0,
            connectionstyle="arc3,rad=-0.15",
        ),
        bbox=dict(
            boxstyle="round,pad=0.5",
            facecolor="#dcfce7",
            edgecolor="#16a34a",
            lw=1.5,
        ),
        fontsize=9.5,
        fontweight="bold",
        color="#14532d",
        zorder=7,
    )

    # Sombrear region de degradacion / saturacion despues del knee (donde inicia http_req_failed > 0%)
    if knee["first_error_vus"] is not None:
        err_start = knee["first_error_vus"]
        ax1.axvspan(
            kx,
            max(vus) * 1.03,
            color="#fee2e2",
            alpha=0.35,
            label=f"Zona de degradación / saturación (> {kx} VUs; error={knee['first_error_pct']:.1f}% en {err_start} VUs)",
        )

    ax1.set_title(
        "GeoPicto — Performance Curve & Knee (k6 Load Test on GET /api/messages/nearby)",
        fontsize=13,
        fontweight="bold",
        pad=14,
    )
    ax1.set_xlabel("Concurrent Virtual Users (VUs)", fontsize=11)
    ax1.set_ylabel("Response Time — http_req_duration (ms)", fontsize=11)
    ax1.set_ylim(0, max(max(p95_ms), y_max) * 1.22)
    ax1.grid(True, linestyle="--", alpha=0.35)
    ax1.legend(loc="upper left", frameon=True, fontsize=9.5)

    # Panel 2: Tasa de Error (http_req_failed %) y Throughput (req/s)
    color_err = "#dc2626"
    color_rps = "#0284c7"

    ax2.plot(
        vus,
        err_pct,
        marker="^",
        linewidth=2.2,
        markersize=7,
        color=color_err,
        label="http_req_failed (%)",
    )
    ax2.axvline(kx, color="#16a34a", linestyle=":", linewidth=2.0, alpha=0.85)
    ax2.set_xlabel("Concurrent Virtual Users (VUs)", fontsize=11)
    ax2.set_ylabel("Error Rate — http_req_failed (%)", color=color_err, fontsize=11)
    ax2.tick_params(axis="y", labelcolor=color_err)
    ax2.set_ylim(-1, max(max(err_pct) * 1.25, 5.0))
    ax2.grid(True, linestyle="--", alpha=0.35)

    ax2_rps = ax2.twinx()
    ax2_rps.plot(
        vus,
        rps,
        marker="d",
        linewidth=2.0,
        linestyle="-.",
        markersize=6,
        color=color_rps,
        label="Throughput (req/s)",
    )
    ax2_rps.set_ylabel("Throughput (requests / sec)", color=color_rps, fontsize=11)
    ax2_rps.tick_params(axis="y", labelcolor=color_rps)
    ax2_rps.set_ylim(0, max(max(rps) * 1.25, 10.0))

    lines1, labels1 = ax2.get_legend_handles_labels()
    lines2, labels2 = ax2_rps.get_legend_handles_labels()
    ax2.legend(lines1 + lines2, labels1 + labels2, loc="upper left", fontsize=9.5)

    plt.tight_layout()
    out_path = results_dir / "performance_curve.png"
    plt.savefig(out_path, dpi=160)
    plt.close(fig)
    return out_path


def main() -> None:
    results_dir = Path(__file__).resolve().parent / "results"
    rows = load_k6_summaries(results_dir)
    knee = find_knee(rows)
    save_csv_and_json(rows, knee, results_dir)
    chart_path = plot_performance_curve(rows, knee, results_dir)

    print("\n=== TABLA DE RESULTADOS (k6) ===")
    print(
        "| VUs | Samples | Avg (ms) | Min (ms) | Med (ms) | p90 (ms) | p95 (ms) | Max (ms) | Error (%) | Throughput (req/s) |"
    )
    print(
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    )
    for r in rows:
        print(
            f"| {r['vus']} | {r['samples']} | {r['avg_ms']:.2f} | {r['min_ms']:.2f} | "
            f"{r['med_ms']:.2f} | {r['p90_ms']:.2f} | {r['p95_ms']:.2f} | "
            f"{r['max_ms']:.2f} | {r['error_pct']:.2f}% | {r['rps']:.2f} |"
        )

    print("\n=== KNEE OF THE PERFORMANCE CURVE ===")
    print(json.dumps(knee, indent=2))
    print(f"\nGrafica guardada en: {chart_path}")


if __name__ == "__main__":
    main()

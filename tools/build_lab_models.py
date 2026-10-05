#!/usr/bin/env python3
"""Train the compact models behind the browser XAI Lab and write them to docs/lab-data.js.

Usage (from any folder):  python tools/build_lab_models.py [--reference PATH]

The script downloads the UCI Cleveland heart disease file and the GlucoBench archive that contains the
Weinstock et al. CGM data, trains three small models, checks that the exported trees reproduce the
scikit-learn predictions, and writes model parameters and small data excerpts as a JavaScript file.
With --reference, reference values for the JavaScript test suite are written as JSON.
"""
import argparse
import datetime as dt
import hashlib
import json
import urllib.request
import warnings
import zipfile
from math import factorial
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore", category=ConvergenceWarning)
warnings.filterwarnings("ignore", message="X does not have valid feature names")

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tools" / ".cache"
SEED = 42
UCI_FILE = "https://archive.ics.uci.edu/ml/machine-learning-databases/heart-disease/processed.cleveland.data"
UCI_ZIP = "https://archive.ics.uci.edu/static/public/45/heart+disease.zip"
GLUCOBENCH = "https://raw.githubusercontent.com/IrinaStatsLab/GlucoBench/"
COMMIT = "661d840a98b316df51faa13a7100430afcbbb5b7"
ZIP_MD5 = "49667c2e7e14640d0e4089041ca9e948"
RAW = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope", "ca", "thal", "num"]
RENAME = {"sex": "sex_male", "cp": "chest_pain_type", "trestbps": "resting_bp", "chol": "cholesterol",
          "fbs": "fasting_glucose_high", "restecg": "resting_ecg", "thalach": "max_heart_rate",
          "exang": "exercise_angina", "oldpeak": "st_depression", "slope": "st_slope",
          "ca": "major_vessels", "thal": "thallium_scan"}
HEART_META = {
    "age": dict(label="Age", unit="years", type="num", min=29, max=77, step=1, cf=None),
    "sex_male": dict(label="Sex", type="cat", options=[[0, "female"], [1, "male"]], cf=None),
    "chest_pain_type": dict(label="Chest pain type", type="cat", cf=None,
                            options=[[1, "typical angina"], [2, "atypical angina"], [3, "non-anginal pain"], [4, "asymptomatic"]]),
    "resting_bp": dict(label="Resting blood pressure", unit="mmHg", type="num", min=94, max=200, step=1, cf=5),
    "cholesterol": dict(label="Serum cholesterol", unit="mg/dL", type="num", min=126, max=564, step=1, cf=10),
    "fasting_glucose_high": dict(label="Fasting glucose above 120 mg/dL", type="cat", options=[[0, "no"], [1, "yes"]], cf=None),
    "resting_ecg": dict(label="Resting ECG", type="cat", cf=None,
                        options=[[0, "normal"], [1, "ST-T abnormality"], [2, "LV hypertrophy"]]),
    "max_heart_rate": dict(label="Maximum heart rate", unit="bpm", type="num", min=71, max=202, step=1, cf=5),
    "exercise_angina": dict(label="Exercise-induced angina", type="cat", options=[[0, "no"], [1, "yes"]], cf="flip"),
    "st_depression": dict(label="ST depression on exercise", unit="mm", type="num", min=0, max=6.2, step=0.1, cf=0.2),
    "st_slope": dict(label="ST segment slope", type="cat", options=[[1, "upsloping"], [2, "flat"], [3, "downsloping"]], cf=None),
    "major_vessels": dict(label="Vessels seen on fluoroscopy", type="cat", options=[[0, "0"], [1, "1"], [2, "2"], [3, "3"]], cf="down"),
    "thallium_scan": dict(label="Thallium scan", type="cat", cf=None,
                          options=[[3, "normal"], [6, "fixed defect"], [7, "reversible defect"]]),
}
PAST, HORIZON, STRIDE = 12, 6, 3
CGM_FEATURES = ["glucose_now", "mean_60min", "min_60min", "max_60min", "sd_60min",
                "slope_15min", "slope_30min", "change_5min", "change_60min", "trend_change"]


def fetch(urls, dest, timeout=300):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    for url in urls:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                dest.write_bytes(response.read())
            return dest
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("No source could be reached:\n" + "\n".join(errors))


def export_gb(model, X_check):
    """Export a binary GradientBoostingClassifier; leaf values already include the learning rate."""
    lr = model.learning_rate
    trees = []
    for est in model.estimators_[:, 0]:
        t = est.tree_
        leaf = t.children_left == -1
        trees.append({"f": [-1 if lf else int(v) for v, lf in zip(t.feature, leaf)],
                      "t": [0.0 if lf else float(v) for v, lf in zip(t.threshold, leaf)],
                      "l": t.children_left.astype(int).tolist(), "r": t.children_right.astype(int).tolist(),
                      "v": [float(f"{v * lr:.12g}") if lf else 0.0 for v, lf in zip(t.value[:, 0, 0], leaf)]})
    X_check = np.asarray(X_check, dtype=float)
    tree_sum = sum(lr * est.predict(X_check) for est in model.estimators_[:, 0])
    return {"init": float(np.mean(model.decision_function(X_check) - tree_sum)), "trees": trees}


def eval_exported(exported, X):
    """Evaluate an exported model exactly as the browser does (float32 comparisons)."""
    X32 = np.asarray(X, dtype=np.float32).astype(np.float64)
    raw = np.full(len(X32), exported["init"])
    rows = np.arange(len(X32))
    for tr in exported["trees"]:
        f, th, l, r, v = (np.array(tr[k]) for k in "ftlrv")
        node = np.zeros(len(X32), dtype=int)
        while (l[node] != -1).any():
            internal = l[node] != -1
            left = X32[rows, np.maximum(f[node], 0)] <= th[node]
            node = np.where(internal, np.where(left, l[node], r[node]), node)
        raw += v[node]
    return 1.0 / (1.0 + np.exp(-raw))


def exact_shapley(predict, x, background):
    """Interventional Shapley values by enumerating all coalitions (probability scale)."""
    M, B = len(x), len(background)
    masks = ((np.arange(1 << M)[:, None] >> np.arange(M)) & 1).astype(bool)
    Z = np.where(masks[:, None, :], x[None, None, :], background[None, :, :]).reshape(-1, M)
    v = predict(Z).reshape(1 << M, B).mean(axis=1)
    w = np.array([factorial(s) * factorial(M - s - 1) / factorial(M) for s in range(M)])
    size = masks.sum(axis=1)
    phi = np.zeros(M)
    for i in range(M):
        S = np.where(~masks[:, i])[0]
        phi[i] = np.sum(w[size[S]] * (v[S | (1 << i)] - v[S]))
    return {"phi": phi.tolist(), "base": float(v[0]), "full": float(v[-1])}


def wdbc_block():
    data = load_breast_cancer()
    X, y = data.data, (data.target == 0).astype(int)
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    mlp = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-3, max_iter=2000,
                                                        random_state=SEED))
    p_mlp = cross_val_predict(mlp, X, y, cv=cv, method="predict_proba")[:, 1]
    lr = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=5000))
    p_lr = cross_val_predict(lr, X, y, cv=cv, method="predict_proba")[:, 1]
    print(f"WDBC: out-of-fold accuracy {((p_mlp >= 0.5) == y).mean():.3f}, AUROC {roc_auc_score(y, p_mlp):.3f}")
    return {"y": y.tolist(), "p": np.round(p_mlp, 5).tolist(), "p_lr": np.round(p_lr, 5).tolist()}


def heart_block(reference):
    path = CACHE / "processed.cleveland.data"
    if not path.exists():
        try:
            fetch([UCI_FILE], path)
        except RuntimeError:
            with zipfile.ZipFile(fetch([UCI_ZIP], CACHE / "heart+disease.zip")) as z:
                path.write_bytes(z.read("processed.cleveland.data"))
    heart = pd.read_csv(path, header=None, names=RAW, na_values="?").dropna().rename(columns=RENAME).reset_index(drop=True)
    y = (heart.pop("num") > 0).astype(int)
    X = heart.astype(float)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, stratify=y, random_state=SEED)
    model = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.9,
                                       random_state=SEED).fit(X_train, y_train)
    exported = export_gb(model, X_train.to_numpy())
    p_test = model.predict_proba(X_test)[:, 1]
    gap = np.abs(p_test - eval_exported(exported, X_test.to_numpy())).max()
    assert gap < 1e-8, f"heart export mismatch {gap}"
    background = X_train.sample(16, random_state=SEED).to_numpy()
    features = [{"key": k, **HEART_META[k]} for k in X.columns]
    auc = roc_auc_score(y_test, p_test)
    print(f"Heart: test AUROC {auc:.3f}, export gap {gap:.1e}")
    if reference is not None:
        reference["heart_p"] = p_test.tolist()
        predict = lambda Z: model.predict_proba(Z)[:, 1]
        reference["heart_shap"] = [dict(index=i, **exact_shapley(predict, X_test.to_numpy()[i], background))
                                   for i in (0, 10, 40)]
    return {"features": features, "model": exported, "patients": X_test.to_numpy().tolist(),
            "labels": y_test.tolist(), "background": background.tolist(),
            "pool": X_train.sample(64, random_state=SEED + 1).to_numpy().tolist(),
            "lo": X_train.quantile(0.02).tolist(), "hi": X_train.quantile(0.98).tolist(),
            "scale": X_train.std().tolist(), "test_auroc": round(auc, 3)}


def make_windows(frame):
    past, future, pids = [], [], []
    for pid, g in frame.groupby("id", sort=False):
        minutes = g["time"].to_numpy().astype("datetime64[s]").astype(np.int64) / 60.0
        values = g["gl"].to_numpy(float)
        breaks = np.where((np.diff(minutes) < 2.5) | (np.diff(minutes) > 7.5))[0] + 1
        for seg in np.split(values, breaks):
            if len(seg) < PAST + HORIZON:
                continue
            W = np.lib.stride_tricks.sliding_window_view(seg, PAST + HORIZON)[::STRIDE]
            past.append(W[:, :PAST])
            future.append(W[:, PAST:])
            pids.append(np.full(len(W), pid))
    past, future, pids = np.vstack(past), np.vstack(future), np.concatenate(pids)
    keep = past[:, -1] >= 70
    return past[keep], future[keep], (future[keep].min(axis=1) < 70).astype(int), pids[keep]


def _slope(block):
    t = np.arange(block.shape[1]) * 5.0
    t -= t.mean()
    return (block - block.mean(axis=1, keepdims=True)) @ t / (t @ t)


def cgm_features(W):
    W = np.atleast_2d(np.asarray(W, dtype=float))
    s15, s30, s15_before = _slope(W[:, -4:]), _slope(W[:, -7:]), _slope(W[:, -7:-3])
    return np.column_stack([W[:, -1], W.mean(1), W.min(1), W.max(1), W.std(1),
                            s15, s30, (W[:, -1] - W[:, -2]) / 5.0, W[:, -1] - W[:, 0], s15 - s15_before])


def margin_lower(decide, W, max_drop=20.0, tol=0.2):
    """Smallest uniform decrease (mg/dL) of all readings that raises the alert; max_drop if none does."""
    W = np.atleast_2d(W)
    shift = lambda s: np.clip(W - s[:, None], 40, 400)
    lo, hi = np.zeros(len(W)), np.full(len(W), max_drop)
    active = decide(shift(hi))
    while np.any(active & (hi - lo > tol)):
        mid = 0.5 * (lo + hi)
        fire = decide(shift(mid))
        hi = np.where(active & fire, mid, hi)
        lo = np.where(active & ~fire, mid, lo)
    return np.where(active, hi, max_drop)


def cgm_block(reference):
    zpath = fetch([GLUCOBENCH + COMMIT + "/raw_data.zip", GLUCOBENCH + "main/raw_data.zip"],
                  CACHE / "glucobench_raw_data.zip")
    if hashlib.md5(zpath.read_bytes()).hexdigest() != ZIP_MD5:
        print("Note: the GlucoBench archive differs from the pinned release.")
    with zipfile.ZipFile(zpath) as z, z.open("raw_data/weinstock.csv") as fh:
        cgm = pd.read_csv(fh, usecols=["id", "gl", "time"])
    cgm["time"] = pd.to_datetime(cgm["time"], format="%Y-%m-%d %H:%M:%S")
    cgm = cgm.sort_values(["id", "time"]).reset_index(drop=True)
    Xw, fut, yw, pid = make_windows(cgm)
    rng = np.random.default_rng(SEED)
    patients = np.unique(pid)
    test_patients = rng.choice(patients, size=int(0.3 * len(patients)), replace=False)
    train_patients = np.setdiff1d(patients, test_patients)
    val_patients = rng.choice(train_patients, size=int(0.2 * len(train_patients)), replace=False)
    te, va = np.isin(pid, test_patients), np.isin(pid, val_patients)
    idx_fit = np.where(~te & ~va)[0]
    idx_fit = rng.choice(idx_fit, size=min(60000, len(idx_fit)), replace=False)
    F = cgm_features(Xw)
    model = GradientBoostingClassifier(n_estimators=100, max_depth=3, learning_rate=0.1, subsample=0.8,
                                       random_state=SEED).fit(F[idx_fit], yw[idx_fit])
    p_va = model.predict_proba(F[va])[:, 1]
    tau = float(np.quantile(p_va[yw[va] == 1], 0.15))
    exported = export_gb(model, F[idx_fit[:500]])
    Xte, yte, fte, Fte = Xw[te], yw[te], fut[te], F[te]
    p_te = eval_exported(exported, Fte)
    gap = np.abs(p_te - model.predict_proba(Fte)[:, 1]).max()
    assert gap < 1e-8, f"CGM export mismatch {gap}"
    alert = p_te >= tau
    decide = lambda W: eval_exported(exported, cgm_features(W)) >= tau
    band = np.where((yte == 0) & (p_te >= 0.5 * tau) & (p_te < tau))[0]
    band = rng.choice(band, size=min(2000, len(band)), replace=False)
    margins = margin_lower(decide, Xte[band])
    cut = float(np.quantile(margins, 0.05))
    tp = np.where((yte == 1) & alert)[0]
    chosen = rng.choice(tp, size=min(24, len(tp)), replace=False)
    examples = [{"past": [int(round(v)) for v in Xte[i]], "future": [int(round(v)) for v in fte[i]]} for i in chosen]
    background = F[rng.choice(idx_fit, size=16, replace=False)]
    auc = roc_auc_score(yte, p_te)
    sens, spec = alert[yte == 1].mean(), 1 - alert[yte == 0].mean()
    print(f"CGM: {len(Xw):,} windows, test AUROC {auc:.3f}, sensitivity {sens:.3f}, specificity {spec:.3f}, "
          f"threshold {tau:.4f}, margin cut {cut:.2f} mg/dL, export gap {gap:.1e}")
    if reference is not None:
        pick = rng.choice(len(Xte), size=500, replace=False)
        reference["cgm_windows"] = Xte[pick].tolist()
        reference["cgm_p"] = p_te[pick].tolist()
        reference["cgm_margin_windows"] = Xte[band[:30]].tolist()
        reference["cgm_margins"] = margins[:30].tolist()
    return {"features": CGM_FEATURES, "model": exported, "threshold": tau, "budget": 15,
            "examples": examples, "background": background.tolist(), "margin_cut": round(cut, 2),
            "test_auroc": round(auc, 3), "sensitivity": round(float(sens), 3), "specificity": round(float(spec), 3)}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reference", help="optional JSON file for the JavaScript test suite")
    args = parser.parse_args()
    reference = {} if args.reference else None
    data = {"generated": dt.date.today().isoformat(), "wdbc": wdbc_block(), "heart": heart_block(reference),
            "cgm": cgm_block(reference)}
    header = ("/* Generated by tools/build_lab_models.py; do not edit by hand.\n"
              "   Data: Wisconsin Diagnostic Breast Cancer (via scikit-learn); UCI Cleveland heart disease (CC BY 4.0);\n"
              "   Weinstock et al. (2016) CGM data as distributed by GlucoBench (CC BY-SA 4.0). The CGM example\n"
              "   traces in this file are excerpts of that dataset and remain under CC BY-SA 4.0. */\n")
    out = ROOT / "docs" / "lab-data.js"
    out.write_text(header + "window.LAB_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} kB)")
    if args.reference:
        Path(args.reference).write_text(json.dumps(reference), encoding="utf-8")


if __name__ == "__main__":
    main()

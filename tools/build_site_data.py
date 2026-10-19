#!/usr/bin/env python3
"""Build the data behind the workshop pages and the XAI Lab and write docs/assets/site-data.js.

Usage (from any folder):
    python tools/build_site_data.py [--cleveland PATH] [--glucobench PATH] [--reference PATH] [--quick]

Every block is computed with the data, splits, models and random seeds of the corresponding notebook, so the
numbers on the pages match the notebooks. The script downloads the UCI Cleveland file and the GlucoBench archive
that contains the Weinstock et al. CGM data unless local copies are given. With --reference, reference values
for the JavaScript test suite are written as JSON.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import time
import urllib.request
import warnings
import zipfile
from math import factorial
from pathlib import Path

import numpy as np
import pandas as pd
import shap
from interpret.glassbox import ExplainableBoostingClassifier
from concurrent.futures import ThreadPoolExecutor

from sklearn.compose import ColumnTransformer
from threadpoolctl import threadpool_limits
from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.exceptions import ConvergenceWarning
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, SplineTransformer, StandardScaler
from sklearn.tree import DecisionTreeClassifier

warnings.filterwarnings("ignore", category=ConvergenceWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

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
CONT = ["age", "resting_bp", "cholesterol", "max_heart_rate", "st_depression"]
CAT = ["chest_pain_type", "resting_ecg", "st_slope", "thallium_scan"]
BIN = ["sex_male", "fasting_glucose_high", "exercise_angina"]
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


def r(values, digits=4):
    """Round numbers (or nested lists of numbers) for a compact JSON file."""
    if isinstance(values, (list, tuple, np.ndarray)):
        return [r(v, digits) for v in values]
    if values is None or (isinstance(values, float) and np.isnan(values)):
        return None
    return float(round(float(values), digits))


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
        f, th, l, rr, v = (np.array(tr[k]) for k in "ftlrv")
        node = np.zeros(len(X32), dtype=int)
        while (l[node] != -1).any():
            internal = l[node] != -1
            left = X32[rows, np.maximum(f[node], 0)] <= th[node]
            node = np.where(internal, np.where(left, l[node], rr[node]), node)
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


class MahalanobisDetector:
    """Distance of a vector from a reference population (mean and regularised covariance), as in NB4 to NB6."""

    def fit(self, Z):
        Z = np.asarray(Z, dtype=float)
        self.mu = Z.mean(axis=0)
        self.precision = np.linalg.pinv(np.cov(Z, rowvar=False) + 1e-6 * np.eye(Z.shape[1]))
        return self

    def score(self, Z):
        D = np.asarray(Z, dtype=float) - self.mu
        return np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", D, self.precision, D), 0.0))


def hsja_attack(decide, x0, lower, upper, init_candidates, n_iter=15, n_dirs=60, seed=0):
    """Decision-based attack in the spirit of HopSkipJump, identical to the function in NB4 and NB6."""
    rs = np.random.default_rng(seed)
    x0, lower, upper = (np.asarray(a, dtype=float) for a in (x0, lower, upper))
    queries = 0

    def alert(X):
        nonlocal queries
        X = np.atleast_2d(X)
        queries += len(X)
        return np.asarray(decide(X), dtype=bool)

    cands = np.clip(np.atleast_2d(np.asarray(init_candidates, dtype=float)), lower, upper)
    free = ~alert(cands)
    if not free.any():
        return dict(x_adv=None, success=False, queries=queries, l2=np.nan, linf=np.nan)
    x_adv = cands[free][np.argmin(np.linalg.norm(cands[free] - x0, axis=1))]

    def to_boundary(x_free, tol=1e-3):
        lo, hi = 0.0, 1.0
        while hi - lo > tol:
            mid = 0.5 * (lo + hi)
            if alert(x0 + mid * (x_free - x0))[0]:
                lo = mid
            else:
                hi = mid
        return x0 + hi * (x_free - x0)

    xb = to_boundary(x_adv)
    for t in range(1, n_iter + 1):
        dist = np.linalg.norm(xb - x0)
        if dist < 1e-6:
            break
        radius = max(0.1 * dist / np.sqrt(t), 1e-3)
        U = rs.normal(size=(n_dirs, xb.size))
        U /= np.linalg.norm(U, axis=1, keepdims=True)
        phi = np.where(alert(np.clip(xb + radius * U, lower, upper)), -1.0, 1.0)
        v = ((phi - phi.mean())[:, None] * U).mean(axis=0) if phi.std() > 0 else phi[0] * U.mean(axis=0)
        if np.linalg.norm(v) < 1e-12:
            break
        v /= np.linalg.norm(v)
        step = dist / np.sqrt(t)
        for _ in range(12):
            cand = np.clip(xb + step * v, lower, upper)
            if not alert(cand)[0]:
                xb = to_boundary(cand)
                break
            step /= 2
    return dict(x_adv=xb, success=True, queries=queries, l2=float(np.linalg.norm(xb - x0)),
                linf=float(np.abs(xb - x0).max()))


# ----------------------------------------------------------------------------------------------------------------
# NB1: Wisconsin Diagnostic Breast Cancer
# ----------------------------------------------------------------------------------------------------------------
WEAK = ["mean texture", "mean smoothness", "mean symmetry", "mean fractal dimension",
        "texture error", "smoothness error", "symmetry error", "fractal dimension error"]
CARD_FEATURES = ["mean radius", "mean concave points", "worst area"]


def wdbc_blocks(quick):
    data = load_breast_cancer(as_frame=True)
    X = data.data.copy()
    y = (data.target == 0).astype(int).rename("malignant")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    mlp = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1e-3, max_iter=2000,
                                                        random_state=SEED))
    p_mlp = cross_val_predict(mlp, X, y, cv=cv, method="predict_proba")[:, 1]
    lr = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=5000))
    p_lr = cross_val_predict(lr, X, y, cv=cv, method="predict_proba")[:, 1]
    yv = y.to_numpy()
    pred = p_mlp >= 0.5
    print(f"NB1 network: out-of-fold accuracy {(pred == yv).mean():.3f}, AUROC {roc_auc_score(yv, p_mlp):.3f}, "
          f"missed cancers at 0.5: {int((~pred & (yv == 1)).sum())}")

    # Cards for the "wrong and sure" game: confident errors and equally confident correct answers.
    conf = np.where(pred, p_mlp, 1 - p_mlp)
    wrong = np.where((pred != (yv == 1)) & (conf >= 0.9))[0]
    wrong = wrong[np.argsort(-conf[wrong])][:4]
    right = np.where((pred == (yv == 1)))[0]
    chosen_right = []
    for i in wrong:
        cand = [c for c in right if c not in chosen_right and pred[c] == pred[i]]
        chosen_right.append(min(cand, key=lambda c: abs(conf[c] - conf[i])))
    cards = []
    for i in list(wrong) + chosen_right:
        cards.append({"id": int(i), "truth": int(yv[i]), "p": r(p_mlp[i], 4),
                      "features": {k: r(X.loc[i, k], 4) for k in CARD_FEATURES}})
    rs = np.random.default_rng(SEED)
    cards = [cards[k] for k in rs.permutation(len(cards))]

    # The shortcut experiment of NB1, section 5, with the same seeds.
    rng = np.random.default_rng(SEED)
    idx_dev, idx_ext = train_test_split(np.arange(len(X)), test_size=0.4, stratify=y, random_state=SEED)
    site = np.zeros(len(X), dtype=int)
    site[idx_dev] = (rng.random(len(idx_dev)) < np.where(yv[idx_dev] == 1, 0.9, 0.1)).astype(int)
    site[idx_ext] = (rng.random(len(idx_ext)) < 0.5).astype(int)
    X_site = X[WEAK].assign(acquisition_site=site)
    idx_tr, idx_te = train_test_split(idx_dev, test_size=0.35, stratify=yv[idx_dev], random_state=SEED)
    gb_site = GradientBoostingClassifier(random_state=SEED).fit(X_site.iloc[idx_tr], y.iloc[idx_tr])
    gb_nosite = GradientBoostingClassifier(random_state=SEED).fit(X[WEAK].iloc[idx_tr], y.iloc[idx_tr])

    def auroc(model, frame, idx):
        return roc_auc_score(y.iloc[idx], model.predict_proba(frame.iloc[idx])[:, 1])

    imp = permutation_importance(gb_site, X_site.iloc[idx_te], y.iloc[idx_te], scoring="roc_auc",
                                 n_repeats=10 if quick else 30, random_state=SEED)
    order = np.argsort(-imp.importances_mean)
    table = {}
    for name, idx in [("development", idx_dev), ("external", idx_ext)]:
        table[name] = {f"site{s}_{lab}": int(((site[idx] == s) & (yv[idx] == (1 if lab == "malignant" else 0))).sum())
                       for s in (0, 1) for lab in ("benign", "malignant")}
    shortcut = {"internal": {"with_site": r(auroc(gb_site, X_site, idx_te), 3), "without_site": r(auroc(gb_nosite, X[WEAK], idx_te), 3)},
                "external": {"with_site": r(auroc(gb_site, X_site, idx_ext), 3), "without_site": r(auroc(gb_nosite, X[WEAK], idx_ext), 3)},
                "importance": [{"feature": X_site.columns[k], "mean": r(imp.importances_mean[k], 4), "std": r(imp.importances_std[k], 4)}
                               for k in order],
                "counts": table, "n_dev": int(len(idx_dev)), "n_ext": int(len(idx_ext))}
    print(f"NB1 shortcut: internal {shortcut['internal']}, external {shortcut['external']}")
    wdbc = {"y": yv.tolist(), "p": np.round(p_mlp, 5).tolist(), "p_lr": np.round(p_lr, 5).tolist()}
    return wdbc, {"cards": cards, "card_features": CARD_FEATURES, "shortcut": shortcut}


# ----------------------------------------------------------------------------------------------------------------
# NB2 and NB7: UCI Cleveland heart disease
# ----------------------------------------------------------------------------------------------------------------
def load_cleveland(local):
    if local:
        path = Path(local)
    else:
        path = CACHE / "processed.cleveland.data"
        if not path.exists():
            try:
                fetch([UCI_FILE], path)
            except RuntimeError:
                with zipfile.ZipFile(fetch([UCI_ZIP], CACHE / "heart+disease.zip")) as z:
                    path.write_bytes(z.read("processed.cleveland.data"))
    heart = pd.read_csv(path, header=None, names=RAW, na_values="?").dropna().rename(columns=RENAME).reset_index(drop=True)
    y = (heart.pop("num") > 0).astype(int).rename("disease")
    return heart.astype(float), y


def new_gb():
    return GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=SEED)


def heart_blocks(X, y, reference, quick):
    FEATURES = list(X.columns)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, stratify=y, random_state=SEED)

    # NB2, section 2: glass-box models and the black box, exactly as in the notebook.
    lr_model = make_pipeline(
        ColumnTransformer([("num", StandardScaler(), CONT + ["major_vessels"]),
                           ("cat", OneHotEncoder(handle_unknown="ignore"), CAT), ("bin", "passthrough", BIN)]),
        LogisticRegression(C=0.5, max_iter=5000)).fit(X_train, y_train)
    tree = DecisionTreeClassifier(max_depth=3, min_samples_leaf=8, random_state=SEED).fit(X_train, y_train)
    gam_prep = ColumnTransformer(
        [(f"s_{c}", SplineTransformer(n_knots=5, degree=3), [c]) for c in CONT]
        + [("cat", OneHotEncoder(handle_unknown="ignore"), CAT), ("rest", "passthrough", BIN + ["major_vessels"])])
    gam = make_pipeline(gam_prep, LogisticRegression(C=0.3, max_iter=5000)).fit(X_train, y_train)
    ebm = ExplainableBoostingClassifier(interactions=3, random_state=SEED).fit(X_train, y_train)
    gb = new_gb().fit(X_train, y_train)
    models = [("Logistic regression", "glass box", lr_model), ("Decision tree, depth 3", "glass box", tree),
              ("GAM with splines", "glass box", gam), ("Explainable boosting machine", "glass box", ebm),
              ("Gradient boosting, 150 trees", "black box", gb)]
    glassbox = [{"name": n, "kind": k, "auroc": r(roc_auc_score(y_test, m.predict_proba(X_test)[:, 1]), 3),
                 "accuracy": r(accuracy_score(y_test, m.predict(X_test)), 3)} for n, k, m in models]
    print("NB2 glass box comparison:", [(g["name"], g["auroc"]) for g in glassbox])

    coef = gam[-1].coef_[0]
    gam_shapes = {}
    for col in CONT:
        grid = np.linspace(X[col].quantile(0.02), X[col].quantile(0.98), 60)
        spline = gam[0].named_transformers_[f"s_{col}"]
        cols = gam[0].output_indices_[f"s_{col}"]
        curve = spline.transform(pd.DataFrame({col: grid})) @ coef[cols]
        centre = (spline.transform(X_train[[col]]) @ coef[cols]).mean()
        gam_shapes[col] = {"x": r(grid, 3), "y": r(curve - centre, 4)}

    t = tree.tree_
    tree_nodes = [{"f": FEATURES[t.feature[k]] if t.children_left[k] != -1 else None,
                   "t": r(t.threshold[k], 3) if t.children_left[k] != -1 else None,
                   "l": int(t.children_left[k]), "r": int(t.children_right[k]), "n": int(t.n_node_samples[k]),
                   "p": r(t.value[k, 0, 1] / t.value[k, 0].sum(), 3)} for k in range(t.node_count)]

    names = lr_model[0].get_feature_names_out()
    odds = sorted([(n.split("__")[1], c) for n, c in zip(names, lr_model[-1].coef_[0])], key=lambda p: -abs(p[1]))[:8]
    ebm_imp = sorted(zip(ebm.term_names_, ebm.term_importances()), key=lambda p: -p[1])

    # NB2, section 3: permutation importance and SHAP on the test patients.
    pi = permutation_importance(gb, X_test, y_test, scoring="roc_auc", n_repeats=10 if quick else 30, random_state=SEED)
    background100 = X_train.sample(100, random_state=SEED)
    explainer = shap.TreeExplainer(gb, data=background100, feature_perturbation="interventional", model_output="probability")
    sv = explainer(X_test)
    z = ((X_test - X_train.mean()) / X_train.std()).to_numpy()
    nb2 = {"glassbox": glassbox, "gam": gam_shapes, "tree": tree_nodes,
           "odds": [{"term": n, "odds_ratio": r(np.exp(c), 3)} for n, c in odds],
           "ebm_importance": [{"term": n, "value": r(v, 4)} for n, v in ebm_imp],
           "permutation": [{"feature": f, "mean": r(m, 4), "std": r(s, 4)} for f, m, s in
                           sorted(zip(FEATURES, pi.importances_mean, pi.importances_std), key=lambda p: -p[1])],
           "shap_test": {"values": r(sv.values, 4), "base": r(float(np.mean(sv.base_values)), 4), "z": r(np.clip(z, -3, 3), 2)}}

    # The lab model is the NB2 black box: export it with test patients, background and plausible ranges.
    exported = export_gb(gb, X_train.to_numpy())
    p_test = gb.predict_proba(X_test)[:, 1]
    gap = np.abs(p_test - eval_exported(exported, X_test.to_numpy())).max()
    assert gap < 1e-8, f"heart export mismatch {gap}"
    background = X_train.sample(16, random_state=SEED).to_numpy()
    heart = {"features": [{"key": k, **HEART_META[k]} for k in FEATURES], "model": exported,
             "patients": X_test.to_numpy().tolist(), "labels": y_test.tolist(), "background": background.tolist(),
             "pool": X_train.sample(64, random_state=SEED + 1).to_numpy().tolist(),
             "lo": X_train.quantile(0.02).tolist(), "hi": X_train.quantile(0.98).tolist(),
             "scale": X_train.std().tolist(), "test_auroc": r(roc_auc_score(y_test, p_test), 3)}
    if reference is not None:
        reference["heart_p"] = p_test.tolist()
        predict = lambda Z: gb.predict_proba(Z)[:, 1]
        reference["heart_shap"] = [dict(index=i, **exact_shapley(predict, X_test.to_numpy()[i], background)) for i in (0, 10, 40)]

    # NB7: subgroup audit with out-of-fold predictions for all patients and the sex-flip probe.
    yv = y.to_numpy()
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    p_oof = cross_val_predict(new_gb(), X, yv, cv=cv, method="predict_proba")[:, 1]
    p_oof_nosex = cross_val_predict(new_gb(), X.drop(columns="sex_male"), yv, cv=cv, method="predict_proba")[:, 1]
    full = new_gb().fit(X, yv)
    p_full = full.predict_proba(X)[:, 1]
    p_flip = full.predict_proba(X.assign(sex_male=1 - X["sex_male"]))[:, 1]
    women = X["sex_male"].to_numpy() == 0
    expl7 = shap.TreeExplainer(full, data=X.sample(100, random_state=SEED), feature_perturbation="interventional",
                               model_output="probability")
    sv7 = np.abs(expl7(X).values)
    nb7 = {"sex_male": X["sex_male"].astype(int).tolist(), "y": yv.tolist(), "p_oof": r(p_oof, 4),
           "p_oof_nosex": r(p_oof_nosex, 4), "p_full": r(p_full, 4), "p_flip": r(p_flip, 4),
           "oof_auroc": r(roc_auc_score(yv, p_oof), 3),
           "shap_by_group": {"features": FEATURES, "women": r(sv7[women].mean(axis=0), 4), "men": r(sv7[~women].mean(axis=0), 4)}}
    crossings = np.mean((p_flip >= 0.5) != (p_full >= 0.5))
    print(f"NB7: out-of-fold AUROC {nb7['oof_auroc']}, decisions changed by the sex flip {crossings:.1%}")
    return heart, nb2, nb7


# ----------------------------------------------------------------------------------------------------------------
# NB4: Weinstock et al. CGM data via GlucoBench
# ----------------------------------------------------------------------------------------------------------------
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


def cgm_blocks(local_zip, reference, quick):
    zpath = Path(local_zip) if local_zip else fetch([GLUCOBENCH + COMMIT + "/raw_data.zip", GLUCOBENCH + "main/raw_data.zip"],
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
        pick = np.random.default_rng(SEED + 1).choice(len(Xte), size=500, replace=False)
        reference["cgm_windows"] = Xte[pick].tolist()
        reference["cgm_p"] = p_te[pick].tolist()
        reference["cgm_margin_windows"] = Xte[band[:30]].tolist()
        reference["cgm_margins"] = margins[:30].tolist()
    cgm_block = {"features": CGM_FEATURES, "model": exported, "threshold": tau, "budget": 15,
                 "examples": examples, "background": background.tolist(), "margin_cut": round(cut, 2),
                 "test_auroc": round(auc, 3), "sensitivity": round(float(sens), 3), "specificity": round(float(spec), 3)}

    # Detection study for the Part 3 page: the NB4 attack and the NB4 signals, run against the lab model.
    fast_decide = lambda W: model.predict_proba(cgm_features(W))[:, 1] >= tau
    attack_pool = np.setdiff1d(tp, chosen)
    targets = rng.choice(attack_pool, size=min(40 if quick else 160, len(attack_pool)), replace=False)
    t0, rows = time.time(), []
    for k, i in enumerate(targets):
        x0 = Xte[i]
        lo, hi = np.maximum(x0 - 15, 40), np.minimum(x0 + 15, 400)
        init = np.vstack([hi, x0 + 15 * np.linspace(0, 1, PAST), rng.uniform(lo, hi, size=(100, PAST))])
        res = hsja_attack(fast_decide, x0, lo, hi, init, n_iter=15, n_dirs=60, seed=k)
        res.update(index=int(i), future_min=float(fte[i].min()))
        rows.append(res)
    ok = np.array([q["success"] for q in rows])
    W_att = np.vstack([q["x_adv"] for q in rows if q["success"]])
    still = decide(W_att)
    print(f"NB4 study: {len(rows)} attacks in {time.time() - t0:.0f} s, success {ok.mean():.0%}, "
          f"exported model still alerting on {still.mean():.1%} of the results")
    m_att = margin_lower(decide, W_att)
    half = len(band) // 2
    explainer = shap.TreeExplainer(model)
    S_fit, S_gen, S_att = (explainer.shap_values(cgm_features(W)) for W in (Xte[band[:half]], Xte[band[half:]], W_att))
    det = MahalanobisDetector().fit(S_fit)
    s_gen, s_att = det.score(S_gen), det.score(S_att)
    lab = np.r_[np.zeros(len(s_gen)), np.ones(len(s_att))]
    auc_shap = roc_auc_score(lab, np.r_[s_gen, s_att])
    m_gen = margins[half:]
    auc_margin = roc_auc_score(lab, -np.r_[m_gen, m_att])
    print(f"NB4 study: AUROC SHAP anomaly {auc_shap:.3f}, counterfactual margin {auc_margin:.3f}; "
          f"median margin genuine {np.median(m_gen):.2f}, manipulated {np.median(m_att):.2f} mg/dL")
    linf = np.array([q["linf"] for q in rows if q["success"]])
    queries = np.array([q["queries"] for q in rows if q["success"]])
    nb4 = {"attacks": int(len(rows)), "success_rate": r(ok.mean(), 3), "median_linf": r(np.median(linf), 2),
           "max_linf": r(linf.max(), 2), "median_queries": int(np.median(queries)),
           "lowest_after_silenced": r(min(q["future_min"] for q in rows if q["success"]), 0),
           "margin_genuine": r(m_gen, 2), "margin_manipulated": r(m_att, 2),
           "shap_genuine": r(s_gen, 3), "shap_manipulated": r(s_att, 3),
           "auroc_shap": r(auc_shap, 3), "auroc_margin": r(auc_margin, 3),
           "shift": {"features": CGM_FEATURES, "mean_diff": r(S_att.mean(axis=0) - S_gen.mean(axis=0), 4)}}
    return cgm_block, nb4


# ----------------------------------------------------------------------------------------------------------------
# NB5: PhysioNet/Computing in Cardiology Challenge 2019, training set A
# ----------------------------------------------------------------------------------------------------------------
SEPSIS_BASES = ["https://physionet-open.s3.amazonaws.com/challenge-2019/1.0.0/training/training_setA/",
                "https://physionet.org/files/challenge-2019/1.0.0/training/training_setA/"]
VITALS = ["HR", "O2Sat", "Temp", "SBP", "MAP", "Resp"]
LABS = ["WBC", "Lactate", "Creatinine", "Platelets", "Bilirubin_total"]
STATIC = ["Age", "Gender", "ICULOS", "HospAdmTime"]
WIN, NV = 6, len(VITALS)
CUR = slice((WIN - 1) * NV, WIN * NV)
BOUND = np.array([5.0, 1.0, 0.2, 5.0, 5.0, 2.0])
PHYS_LO = np.array([20.0, 50.0, 30.0, 40.0, 20.0, 4.0])
PHYS_HI = np.array([250.0, 100.0, 43.0, 280.0, 200.0, 70.0])


def load_sepsis(local_dir, n_patients):
    """The first n_patients files of training set A in identifier order, as NB5 downloads them."""
    frames = []
    if local_dir:
        files = sorted(Path(local_dir).glob("p*.psv"), key=lambda f: int(f.stem[1:]))[:n_patients]
        frames = [pd.read_csv(f, sep="|").assign(patient=int(f.stem[1:])) for f in files]
    else:
        def download(pid):
            for base in SEPSIS_BASES:
                try:
                    with urllib.request.urlopen(base + f"p{pid:06d}.psv", timeout=60) as response:
                        return pid, response.read()
                except Exception:
                    continue
            return pid, None
        next_id = 1
        with ThreadPoolExecutor(max_workers=16) as pool:
            while len(frames) < n_patients and next_id < 25000:
                for pid, raw in pool.map(download, range(next_id, next_id + 200)):
                    if raw is not None and len(frames) < n_patients:
                        frames.append(pd.read_csv(io.BytesIO(raw), sep="|").assign(patient=pid))
                next_id += 200
    return pd.concat(frames, ignore_index=True)


def patient_states(g):
    vit = g[VITALS].ffill().to_numpy(float)
    pad = np.vstack([np.full((WIN - 1, NV), np.nan), vit])
    windows = np.lib.stride_tricks.sliding_window_view(pad, (WIN, NV))[:, 0].reshape(len(g), WIN * NV)
    labs = g[LABS].ffill().to_numpy(float)
    return np.hstack([windows, labs, (~np.isnan(labs)).astype(float), g[STATIC].to_numpy(float)])


def state_features(S):
    S = np.atleast_2d(np.asarray(S, dtype=float))
    W = S[:, :WIN * NV].reshape(-1, WIN, NV)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        stats = [W[:, -1], np.nanmean(W, 1), np.nanmin(W, 1), np.nanmax(W, 1), np.nanstd(W, 1), W[:, -1] - W[:, 0]]
    return np.hstack(stats + [S[:, WIN * NV:]])


def sepsis_blocks(local_dir, quick):
    icu = load_sepsis(local_dir, 400 if quick else 2500)
    septic = icu.groupby("patient")["SepsisLabel"].max()
    rng = np.random.default_rng(SEED)
    groups = {pid: g for pid, g in icu.groupby("patient", sort=False)}
    S = np.vstack([patient_states(g) for g in groups.values()])
    y = icu["SepsisLabel"].to_numpy(int)
    P = icu["patient"].to_numpy()
    hour = icu.groupby("patient", sort=False).cumcount().to_numpy()
    patients = septic.index.to_numpy()
    test_p = rng.choice(patients, size=int(0.3 * len(patients)), replace=False)
    rest = np.setdiff1d(patients, test_p)
    val_p = rng.choice(rest, size=int(0.2 * len(rest)), replace=False)
    m_fit, m_val, m_te = ~np.isin(P, np.concatenate([test_p, val_p])), np.isin(P, val_p), np.isin(P, test_p)
    clf = make_pipeline(FunctionTransformer(state_features), SimpleImputer(strategy="median", keep_empty_features=True),
                        HistGradientBoostingClassifier(max_iter=100 if quick else 250, learning_rate=0.06, max_leaf_nodes=31,
                                                       l2_regularization=1.0, class_weight="balanced", random_state=SEED))
    clf.fit(S[m_fit], y[m_fit])
    risk = lambda states: clf.predict_proba(np.atleast_2d(states))[:, 1]
    p_val = risk(S[m_val])
    tau = float(np.quantile(p_val[septic.loc[P[m_val]].to_numpy() == 0], 0.95))
    test = pd.DataFrame({"patient": P[m_te], "hour": hour[m_te], "label": y[m_te], "risk": risk(S[m_te])})

    def stay_summary(df):
        first_alert = df.loc[df["risk"] >= tau, "hour"].min()
        onset = df.loc[df["label"] == 1, "hour"].min() + 6 if df["label"].any() else np.nan
        return pd.Series({"septic": bool(df["label"].any()), "first_alert": first_alert,
                          "onset": min(onset, df["hour"].max()) if df["label"].any() else np.nan})

    stays = test.groupby("patient")[["hour", "label", "risk"]].apply(stay_summary).astype({"septic": bool})
    sep_stays = stays[stays["septic"]]
    early = sep_stays["first_alert"] <= sep_stays["onset"]

    def attack_stay(g, target, n_iter):
        states = patient_states(g)
        raw = g[VITALS].to_numpy(float)
        pad = np.vstack([np.full((WIN - 1, NV), np.nan), g[VITALS].ffill().to_numpy(float)])
        T = len(g)
        r_clean, r_att, changed, queries = risk(states), np.empty(T), np.zeros(T, bool), 0
        for t in range(T):
            s_ = states[t].copy()
            s_[:WIN * NV] = pad[t:t + WIN].ravel()
            cur = s_[CUR].copy()
            free = ~np.isnan(cur)
            lo = np.where(free, np.maximum(cur - BOUND, PHYS_LO), cur)
            hi = np.where(free, np.minimum(cur + BOUND, PHYS_HI), cur)

            def score(V):
                batch = np.repeat(s_[None], len(V), axis=0)
                batch[:, CUR] = V
                return risk(batch)

            x = cur.copy()
            rr = score(x[None])[0]
            queries += 1
            for _ in range(n_iter):
                if rr < target:
                    break
                E = np.diag(np.where(free, BOUND / 2, 0.0))
                cand = np.vstack([np.clip(x + E, lo, hi), np.clip(x - E, lo, hi)])
                rc = score(cand)
                grad = (rc[:NV] - rc[NV:]) / BOUND
                step = np.clip(x - np.sign(np.nan_to_num(grad)) * BOUND / 2, lo, hi)
                rs_ = score(step[None])[0]
                queries += len(cand) + 1
                if rc.min() < rs_:
                    x, rr = cand[int(np.argmin(rc))], rc.min()
                else:
                    x, rr = step, rs_
            changed[t] = not np.allclose(x, cur, equal_nan=True)
            pad[t + WIN - 1] = x
            if t + 1 < T:
                carry = np.isnan(raw[t + 1])
                pad[t + WIN, carry] = x[carry]
            r_att[t] = rr
        return dict(r_clean=r_clean, r_att=r_att, changed=changed, queries=queries,
                    vit_clean=g[VITALS].ffill().to_numpy(float), vit_att=pad[WIN - 1:].copy())

    targets = sep_stays[sep_stays["first_alert"].notna()].index.to_numpy()
    targets = rng.choice(targets, size=min(len(targets), 8 if quick else 40), replace=False)
    t0 = time.time()
    with threadpool_limits(limits=1):
        runs = {pid: attack_stay(groups[pid], 0.9 * tau, 4 if quick else 6) for pid in targets}
    rows = []
    for pid, run in runs.items():
        clean_first = int(np.argmax(run["r_clean"] >= tau))
        fired = np.where(run["r_att"] >= tau)[0]
        rows.append({"patient": int(pid), "clean": clean_first, "attacked": int(fired[0]) if len(fired) else None,
                     "length": len(run["r_att"]), "onset": float(sep_stays.loc[pid, "onset"]),
                     "manipulated": int(run["changed"].sum()), "queries": int(run["queries"])})
    res = pd.DataFrame(rows)
    suppressed = res["attacked"].isna()
    delay = (res["attacked"] - res["clean"])[~suppressed]
    lost = int(((res["clean"] <= res["onset"]) & ~(res["attacked"].fillna(1e9) <= res["onset"])).sum())
    max_shift = np.nanmax(np.vstack([np.abs(r["vit_att"] - r["vit_clean"]) for r in runs.values()]), axis=0)
    print(f"NB5: {icu['patient'].nunique()} patients, threshold {tau:.3f}, {len(runs)} stays attacked in {time.time() - t0:.0f} s, "
          f"suppressed {suppressed.mean():.0%}, median delay {delay.median() if len(delay) else float('nan')} h, lost early alerts {lost}")

    # Replays for the page: the stays where the attack gained most, cropped around the events.
    res["gain"] = res["attacked"].fillna(res["length"]) - res["clean"]
    replays = []
    for _, row in res.sort_values("gain", ascending=False).head(8).iterrows():
        run = runs[row["patient"]]
        T = int(row["length"])
        a = max(0, int(row["clean"]) - 12)
        end_event = row["attacked"] if row["attacked"] is not None and not pd.isna(row["attacked"]) else row["clean"] + 24
        b = min(T, int(max(end_event, row["onset"])) + 8, a + 96)
        sl = slice(a, b)
        replays.append({"patient": int(row["patient"]), "start_hour": a, "onset": r(row["onset"], 0), "clean_alert": int(row["clean"]),
                        "attacked_alert": None if pd.isna(row["attacked"]) else int(row["attacked"]), "length": T,
                        "risk_clean": r(run["r_clean"][sl], 4), "risk_attacked": r(run["r_att"][sl], 4),
                        "vitals_clean": r(np.round(run["vit_clean"][sl], 2), 2), "vitals_attacked": r(np.round(run["vit_att"][sl], 2), 2),
                        "changed": run["changed"][sl].astype(int).tolist()})
    nb5 = {"patients": int(icu["patient"].nunique()), "patient_hours": int(len(icu)), "septic_share": r(septic.mean(), 4),
           "threshold": r(tau, 4), "test_auroc": r(roc_auc_score(test["label"], test["risk"]), 3),
           "early_share": r(early.mean(), 3), "median_warning_h": r((sep_stays["onset"] - sep_stays["first_alert"])[early].median(), 1),
           "false_alert_share": r(stays.loc[~stays["septic"], "first_alert"].notna().mean(), 3),
           "attacked": int(len(res)), "suppressed_share": r(suppressed.mean(), 3),
           "median_delay_h": r(delay.median(), 1) if len(delay) else None, "lost_early_alerts": lost,
           "median_queries": int(res["queries"].median()), "vitals": VITALS, "bounds": BOUND.tolist(),
           "max_shift": r(max_shift, 2), "replays": replays}
    return nb5


# ----------------------------------------------------------------------------------------------------------------
# NB6: MIT-BIH Atrial Fibrillation Database
# ----------------------------------------------------------------------------------------------------------------
AF_RECORDS = ["04015", "04043", "04048", "04126", "04746", "04908", "04936", "05091", "05121", "05261", "06426",
              "06453", "06995", "07162", "07859", "07879", "07910", "08215", "08219", "08378", "08405", "08434", "08455"]
AF_BASES = ["https://physionet-open.s3.amazonaws.com/afdb/1.0.0/", "https://physionet.org/files/afdb/1.0.0/"]
RR_FEATURES = ["mean_rr", "sdnn", "rmssd", "pnn50", "cv", "sd1", "sd2", "sd1_sd2", "turning_points", "mad_diff"]
BUDGETS = [30.0, 60.0, 90.0, 120.0, 180.0, 240.0]
LEN_RR, STEP_RR = 30, 15


def rr_features(W):
    W = np.atleast_2d(np.asarray(W, dtype=float))
    d = np.diff(W, axis=1)
    mean, sdnn = W.mean(axis=1), W.std(axis=1)
    sd1 = np.sqrt(0.5) * d.std(axis=1)
    sd2 = np.sqrt(np.maximum(2 * sdnn ** 2 - sd1 ** 2, 1e-9))
    mid = W[:, 1:-1]
    turns = (((mid > W[:, :-2]) & (mid > W[:, 2:])) | ((mid < W[:, :-2]) & (mid < W[:, 2:]))).mean(axis=1)
    mad = np.median(np.abs(d - np.median(d, axis=1, keepdims=True)), axis=1)
    return np.column_stack([mean, sdnn, np.sqrt((d ** 2).mean(axis=1)), (np.abs(d) > 50).mean(axis=1) * 100,
                            sdnn / mean, sd1, sd2, sd1 / sd2, turns, mad])


def af_blocks(local_dir, quick, reference):
    import wfdb
    folder = Path(local_dir) if local_dir else CACHE / "afdb"
    if not local_dir:
        for rec in AF_RECORDS:
            for ext in ("hea", "atr", "qrs"):
                fetch([b + f"{rec}.{ext}" for b in AF_BASES], folder / f"{rec}.{ext}")
    windows, labels, owner = [], [], []
    for rec in AF_RECORDS:
        path = str(folder / rec)
        fs = wfdb.rdheader(path).fs
        beats = wfdb.rdann(path, "qrs").sample
        atr = wfdb.rdann(path, "atr")
        notes = np.array([note.strip("\x00 ").strip() for note in atr.aux_note])
        k = np.searchsorted(atr.sample, beats, side="right") - 1
        rhythm = np.where(k >= 0, notes[np.clip(k, 0, None)], "")[1:]
        rr = np.diff(beats) / fs * 1000.0
        if len(rr) < LEN_RR:
            continue
        W = np.lib.stride_tricks.sliding_window_view(rr, LEN_RR)[::STEP_RR]
        R = np.lib.stride_tricks.sliding_window_view(rhythm, LEN_RR)[::STEP_RR]
        af = (R == "(AFIB").mean(axis=1)
        keep = (W.min(axis=1) >= 250) & (W.max(axis=1) <= 2500) & (R != "").all(axis=1) & ((af >= 0.8) | (af <= 0.2))
        windows.append(W[keep])
        labels.append((af[keep] >= 0.8).astype(int))
        owner.append(np.full(keep.sum(), rec))
    Xrr, yrr, rec_of = np.vstack(windows), np.concatenate(labels), np.concatenate(owner)
    rng = np.random.default_rng(SEED)
    recs = np.unique(rec_of)
    for _ in range(50):
        test_recs = rng.choice(recs, size=max(2, int(round(0.3 * len(recs)))), replace=False)
        te = np.isin(rec_of, test_recs)
        if 0 < yrr[te].mean() < 1 and 0 < yrr[~te].mean() < 1:
            break
    gb = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, subsample=0.8, random_state=SEED)
    gb.fit(rr_features(Xrr[~te]), yrr[~te])
    X_te, y_te = Xrr[te], yrr[te]
    p_te = gb.predict_proba(rr_features(X_te))[:, 1]
    pred = p_te >= 0.5
    decide = lambda W: gb.predict_proba(rr_features(W))[:, 1] >= 0.5

    def attack_window(x0, seed):
        total = 0
        for budget in BUDGETS:
            lo, hi = np.maximum(x0 - budget, 300), np.minimum(x0 + budget, 2000)
            regular = x0 + np.clip(x0.mean() - x0, -budget, budget)
            smooth = np.clip(np.convolve(np.pad(x0, 2, mode="edge"), np.ones(5) / 5, mode="valid"), lo, hi)
            init = np.vstack([regular, smooth, rng.uniform(lo, hi, size=(100, LEN_RR))])
            res = hsja_attack(decide, x0, lo, hi, init, n_iter=8 if quick else 15, n_dirs=40 if quick else 60, seed=seed)
            total += res["queries"]
            if res["success"]:
                return {**res, "queries": total, "budget": budget}
        return {**res, "queries": total, "budget": np.nan}

    tp_idx = np.where((y_te == 1) & pred)[0]
    attack_idx = rng.choice(tp_idx, size=min(len(tp_idx), 12 if quick else 60), replace=False)
    t0 = time.time()
    att = [{**attack_window(X_te[i], seed=k), "index": int(i)} for k, i in enumerate(attack_idx)]
    budgets = np.array([a["budget"] for a in att], dtype=float)
    ok = ~np.isnan(budgets)
    curve = [{"budget": b, "share": r(np.mean(budgets <= b), 3)} for b in BUDGETS]
    print(f"NB6: {len(np.unique(rec_of))} records, {len(Xrr):,} windows, test AUROC {roc_auc_score(y_te, p_te):.3f}, "
          f"{len(att)} attacks in {time.time() - t0:.0f} s, budget curve {[(c['budget'], c['share']) for c in curve]}")
    exported = export_gb(gb, rr_features(Xrr[~te][:500]))
    gap = np.abs(eval_exported(exported, rr_features(X_te)) - p_te).max()
    assert gap < 1e-8, f"AF export mismatch {gap}"
    order = np.argsort(np.nan_to_num(budgets, nan=1e9))
    examples = [{"rr": r(X_te[att[j]["index"]], 1), "budget": None if np.isnan(budgets[j]) else budgets[j]}
                for j in order[:: max(1, len(order) // 10)][:10]]
    normal = np.where((y_te == 0) & ~pred)[0]
    normals = [r(X_te[i], 1) for i in rng.choice(normal, size=min(3, len(normal)), replace=False)]
    if reference is not None:
        pick = np.random.default_rng(SEED + 2).choice(len(X_te), size=300, replace=False)
        reference["af_windows"] = X_te[pick].tolist()
        reference["af_features"] = rr_features(X_te[pick]).tolist()
        reference["af_p"] = p_te[pick].tolist()
    linf = np.array([a["linf"] for a, good in zip(att, ok) if good])
    nb6 = {"records": int(len(np.unique(rec_of))), "windows": int(len(Xrr)), "af_share": r(yrr.mean(), 3),
           "test_records": sorted(test_recs.tolist()), "test_auroc": r(roc_auc_score(y_te, p_te), 3),
           "sensitivity": r(pred[y_te == 1].mean(), 3), "specificity": r(1 - pred[y_te == 0].mean(), 3),
           "features": RR_FEATURES, "model": exported, "budgets": BUDGETS, "curve": curve,
           "attacked": int(len(att)), "median_linf": r(np.median(linf), 1) if len(linf) else None,
           "median_queries": int(np.median([a["queries"] for a in att])), "examples": examples, "normals": normals}
    return nb6


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cleveland", help="local copy of processed.cleveland.data")
    parser.add_argument("--glucobench", help="local copy of the GlucoBench raw_data.zip")
    parser.add_argument("--sepsis-dir", help="local folder with training set A psv files of the 2019 challenge")
    parser.add_argument("--afdb-dir", help="local folder with the .hea, .atr and .qrs files of the AF database")
    parser.add_argument("--reference", help="optional JSON file for the JavaScript test suite")
    parser.add_argument("--quick", action="store_true", help="fewer attacks and permutation repeats, for testing")
    args = parser.parse_args()
    reference = {} if args.reference else None
    wdbc, nb1 = wdbc_blocks(args.quick)
    X, y = load_cleveland(args.cleveland)
    heart, nb2, nb7 = heart_blocks(X, y, reference, args.quick)
    cgm, nb4 = cgm_blocks(args.glucobench, reference, args.quick)
    nb5 = sepsis_blocks(args.sepsis_dir, args.quick)
    nb6 = af_blocks(args.afdb_dir, args.quick, reference)
    data = {"generated": dt.date.today().isoformat(), "wdbc": wdbc, "heart": heart, "cgm": cgm,
            "nb1": nb1, "nb2": nb2, "nb4": nb4, "nb5": nb5, "nb6": nb6, "nb7": nb7}
    header = ("/* Generated by tools/build_site_data.py; do not edit by hand.\n"
              "   Data: Wisconsin Diagnostic Breast Cancer (via scikit-learn); UCI Cleveland heart disease (CC BY 4.0);\n"
              "   Weinstock et al. (2016) CGM data as distributed by GlucoBench (CC BY-SA 4.0); PhysioNet/CinC Challenge 2019\n"
              "   (CC BY 4.0); MIT-BIH Atrial Fibrillation Database (ODC Attribution 1.0). The CGM traces, ICU vital signs and\n"
              "   RR intervals in this file are excerpts of those datasets and keep their licences. */\n")
    out = ROOT / "docs" / "assets" / "site-data.js"
    out.write_text(header + "window.LAB_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} kB)")
    if args.reference:
        Path(args.reference).write_text(json.dumps(reference), encoding="utf-8")


if __name__ == "__main__":
    main()

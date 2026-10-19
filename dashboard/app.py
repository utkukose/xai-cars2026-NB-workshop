"""Clinician-facing dashboard for the IEEE CARS 2026 workshop on explainable AI in medical systems.

Run from the repository root:  streamlit run dashboard/app.py

The app trains the heart disease model used in NB2 and NB7 on the UCI Cleveland data and shows a patient's
predicted risk with its SHAP explanation, a what-if panel with a counterfactual search, the population view,
a subgroup audit with bootstrap intervals, and a model card. It is a teaching tool, not a medical device.
"""
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
import streamlit as st
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, train_test_split

st.set_page_config(page_title="XAI clinical dashboard, IEEE CARS 2026", page_icon="🫀", layout="wide")

SEED = 42
CACHE = Path(tempfile.gettempdir()) / "xai_cars2026"
UCI_FILE = "https://archive.ics.uci.edu/ml/machine-learning-databases/heart-disease/processed.cleveland.data"
UCI_ZIP = "https://archive.ics.uci.edu/static/public/45/heart+disease.zip"
RAW = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope", "ca", "thal", "num"]
RENAME = {"sex": "sex_male", "cp": "chest_pain_type", "trestbps": "resting_bp", "chol": "cholesterol",
          "fbs": "fasting_glucose_high", "restecg": "resting_ecg", "thalach": "max_heart_rate",
          "exang": "exercise_angina", "oldpeak": "st_depression", "slope": "st_slope",
          "ca": "major_vessels", "thal": "thallium_scan"}
LABELS = {"age": "Age (years)", "sex_male": "Sex", "chest_pain_type": "Chest pain type",
          "resting_bp": "Resting blood pressure (mmHg)", "cholesterol": "Serum cholesterol (mg/dL)",
          "fasting_glucose_high": "Fasting glucose above 120 mg/dL", "resting_ecg": "Resting ECG",
          "max_heart_rate": "Maximum heart rate (bpm)", "exercise_angina": "Exercise-induced angina",
          "st_depression": "ST depression on exercise (mm)", "st_slope": "ST segment slope",
          "major_vessels": "Vessels seen on fluoroscopy", "thallium_scan": "Thallium scan"}
CODES = {"sex_male": {0: "female", 1: "male"},
         "chest_pain_type": {1: "typical angina", 2: "atypical angina", 3: "non-anginal pain", 4: "asymptomatic"},
         "fasting_glucose_high": {0: "no", 1: "yes"},
         "resting_ecg": {0: "normal", 1: "ST-T abnormality", 2: "LV hypertrophy"},
         "exercise_angina": {0: "no", 1: "yes"}, "st_slope": {1: "upsloping", 2: "flat", 3: "downsloping"},
         "major_vessels": {0: "0", 1: "1", 2: "2", 3: "3"},
         "thallium_scan": {3: "normal", 6: "fixed defect", 7: "reversible defect"}}
NUMERIC = {"age": (29, 77, 1), "resting_bp": (94, 200, 1), "cholesterol": (126, 564, 1),
           "max_heart_rate": (71, 202, 1), "st_depression": (0.0, 6.2, 0.1)}
STEPS = {"resting_bp": 5.0, "cholesterol": 10.0, "max_heart_rate": 5.0, "st_depression": 0.2,
         "exercise_angina": None, "major_vessels": None}


@st.cache_data(show_spinner="Loading the UCI Cleveland heart disease data")
def load_data():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "processed.cleveland.data"
    if not path.exists():
        try:
            with urllib.request.urlopen(UCI_FILE, timeout=60) as response:
                path.write_bytes(response.read())
        except Exception:
            zpath = CACHE / "heart+disease.zip"
            with urllib.request.urlopen(UCI_ZIP, timeout=120) as response:
                zpath.write_bytes(response.read())
            with zipfile.ZipFile(zpath) as z:
                path.write_bytes(z.read("processed.cleveland.data"))
    heart = pd.read_csv(path, header=None, names=RAW, na_values="?").dropna().rename(columns=RENAME).reset_index(drop=True)
    y = (heart.pop("num") > 0).astype(int)
    return heart.astype(float), y


def new_model():
    return GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.9,
                                      random_state=SEED)


@st.cache_resource(show_spinner="Training the model")
def build():
    X, y = load_data()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, stratify=y, random_state=SEED)
    model = new_model().fit(X_train, y_train)
    explainer = shap.TreeExplainer(model, data=X_train.sample(100, random_state=SEED),
                                   feature_perturbation="interventional", model_output="probability")
    return model, explainer, X_train, X_test.reset_index(drop=True), y_train, y_test.reset_index(drop=True)


@st.cache_data(show_spinner="Running the subgroup audit")
def audit(n_boot=300):
    X, y = load_data()
    y = y.to_numpy()
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    p = cross_val_predict(new_model(), X, y, cv=cv, method="predict_proba")[:, 1]
    women = X["sex_male"].to_numpy() == 0
    rs = np.random.default_rng(SEED)

    def metrics(yt, pt):
        pred = pt >= 0.5
        return {"AUROC": roc_auc_score(yt, pt), "sensitivity": (pred & (yt == 1)).sum() / max((yt == 1).sum(), 1),
                "specificity": (~pred & (yt == 0)).sum() / max((yt == 0).sum(), 1),
                "observed prevalence": yt.mean(), "mean predicted risk": pt.mean()}

    table = {}
    for name, mask in [("women", women), ("men", ~women)]:
        yt, pt = y[mask], p[mask]
        boots = [metrics(yt[i], pt[i]) for i in (rs.integers(0, len(yt), len(yt)) for _ in range(n_boot))
                 if 0 < yt[i].mean() < 1]
        lo, hi = pd.DataFrame(boots).quantile(0.025), pd.DataFrame(boots).quantile(0.975)
        table[f"{name} (n = {mask.sum()})"] = {k: f"{v:.2f} [{lo[k]:.2f}, {hi[k]:.2f}]" for k, v in metrics(yt, pt).items()}
    return pd.DataFrame(table), roc_auc_score(y, p)


def show_value(name, value):
    return CODES[name].get(int(value), str(value)) if name in CODES else f"{value:g}"


def waterfall(explanation, title):
    fig = plt.figure()
    shap.plots.waterfall(explanation, max_display=10, show=False)
    plt.title(title)
    st.pyplot(plt.gcf(), clear_figure=True)
    plt.close(fig)


def counterfactual(model, x_row, low, high, scale, target=0.5, max_steps=40):
    x = x_row.copy()
    for _ in range(max_steps):
        p_now = model.predict_proba(x.to_frame().T)[0, 1]
        if p_now < target:
            break
        moves = []
        for f, step in STEPS.items():
            options = ([1.0 - x[f]] if f == "exercise_angina" else [x[f] - 1.0]) if step is None else [x[f] - step, x[f] + step]
            moves += [(f, v) for v in options if low[f] <= v <= high[f]]
        if not moves:
            break
        cand = pd.DataFrame([x.to_dict()] * len(moves))
        for k, (f, v) in enumerate(moves):
            cand.loc[k, f] = v
        gain = (p_now - model.predict_proba(cand)[:, 1]) / np.array([abs(v - x[f]) / scale[f] for f, v in moves])
        if gain.max() <= 0:
            break
        f, v = moves[int(np.argmax(gain))]
        x[f] = round(v, 3)
    for f in STEPS:
        if x[f] != x_row[f]:
            trial = x.copy()
            trial[f] = x_row[f]
            if model.predict_proba(trial.to_frame().T)[0, 1] < target:
                x = trial
    return x


model, explainer, X_train, X_test, y_train, y_test = build()
probs = model.predict_proba(X_test)[:, 1]

st.title("Explainable clinical decision support")
st.caption("IEEE CARS 2026 workshop dashboard. A teaching model trained on the UCI Cleveland heart disease data; "
           "it is not a medical device and must not be used for clinical decisions.")

with st.sidebar:
    st.header("Patient")
    options = list(range(len(X_test)))
    patient = st.selectbox("Test patient", options, key="patient",
                           format_func=lambda i: f"Patient {i + 1}: {'disease' if y_test[i] else 'no disease'}, risk {probs[i]:.2f}")
    threshold = st.slider("Referral threshold", 0.10, 0.90, 0.50, 0.05, key="threshold")
    st.markdown("Source: [github.com/utkukose/xai-cars2026-NB-workshop](https://github.com/utkukose/xai-cars2026-NB-workshop)")

x_pat = X_test.iloc[patient]
p_pat = probs[patient]
tab_patient, tab_whatif, tab_population, tab_groups, tab_card = st.tabs(
    ["Patient", "What if", "Population", "Subgroups", "Model card"])

with tab_patient:
    c1, c2 = st.columns([1, 2])
    with c1:
        st.metric("Predicted risk of coronary artery disease", f"{p_pat:.2f}")
        if p_pat >= threshold:
            st.error(f"Above the threshold of {threshold:.2f}: refer for angiography.")
        else:
            st.success(f"Below the threshold of {threshold:.2f}: no referral suggested.")
        st.write(f"Recorded diagnosis: **{'disease' if y_test[patient] else 'no disease'}**")
        st.dataframe(pd.DataFrame({"value": [show_value(n, x_pat[n]) for n in X_test.columns]},
                                  index=[LABELS[n] for n in X_test.columns]), width="stretch")
    with c2:
        waterfall(explainer(x_pat.to_frame().T)[0], "Why this risk: SHAP contributions (probability scale)")

with tab_whatif:
    st.write("Change the patient's values and compare the prediction with the recorded one.")
    edited = x_pat.copy()
    cols = st.columns(3)
    for k, name in enumerate(X_test.columns):
        with cols[k % 3]:
            if name in NUMERIC:
                lo, hi, step = NUMERIC[name]
                value = float(np.clip(x_pat[name], lo, hi))
                edited[name] = st.slider(LABELS[name], float(lo), float(hi), value, float(step), key=f"wi-{name}-{patient}")
            else:
                codes = list(CODES[name])
                edited[name] = float(st.selectbox(LABELS[name], codes, index=codes.index(int(x_pat[name])),
                                                  format_func=lambda c, n=name: CODES[n][c], key=f"wi-{name}-{patient}"))
    p_new = model.predict_proba(edited.to_frame().T)[0, 1]
    st.metric("Predicted risk with the edited values", f"{p_new:.2f}", delta=f"{p_new - p_pat:+.2f}", delta_color="inverse")
    waterfall(explainer(edited.to_frame().T)[0], "SHAP contributions for the edited values")
    if st.button("Find the smallest plausible change below the threshold of 0.5", key="cf"):
        cf = counterfactual(model, edited, X_train.quantile(0.02), X_train.quantile(0.98), X_train.std())
        changed = [n for n in X_test.columns if cf[n] != edited[n]]
        p_cf = model.predict_proba(cf.to_frame().T)[0, 1]
        if p_new < 0.5:
            st.info("The prediction is already below 0.5.")
        elif not changed or p_cf >= 0.5:
            st.warning("No counterfactual exists within the plausible ranges of the variables that may change.")
        else:
            st.table(pd.DataFrame({"now": [show_value(n, edited[n]) for n in changed],
                                   "counterfactual": [show_value(n, cf[n]) for n in changed]},
                                  index=[LABELS[n] for n in changed]))
            st.write(f"Risk {p_new:.2f} becomes {p_cf:.2f}. Only blood pressure, cholesterol, maximum heart rate, "
                     "ST depression, exercise angina and the vessel count may change.")

with tab_population:
    st.metric("Test AUROC", f"{roc_auc_score(y_test, probs):.3f}")
    fig = plt.figure()
    shap.plots.beeswarm(explainer(X_test), max_display=13, show=False)
    plt.title("SHAP summary for all test patients")
    st.pyplot(plt.gcf(), clear_figure=True)
    plt.close(fig)

with tab_groups:
    table, auc_oof = audit()
    st.write("Out-of-fold predictions for all patients, with 95 percent bootstrap intervals. "
             "Wide intervals are a finding in their own right.")
    st.dataframe(table, width="stretch")
    X_all, _ = load_data()
    flipped = X_all.assign(sex_male=1 - X_all["sex_male"])
    change = model.predict_proba(flipped)[:, 1] - model.predict_proba(X_all)[:, 1]
    st.write(f"Flipping only the recorded sex changes the predicted risk by {np.abs(change).mean():.3f} on average "
             f"and changes the decision at 0.5 for {np.mean((model.predict_proba(flipped)[:, 1] >= 0.5) != (model.predict_proba(X_all)[:, 1] >= 0.5)):.1%} of patients.")

with tab_card:
    table, auc_oof = audit()
    card = f"""# Model card: coronary artery disease risk (teaching model)

**Intended use.** Education and research on explainable AI. Not a medical device; not clinically validated.

**Data.** UCI Cleveland heart disease data, {len(load_data()[1])} patients referred for angiography, single centre, 1988.

**Model.** Gradient boosting, 150 trees of depth 3. Out-of-fold AUROC {auc_oof:.2f}; test AUROC {roc_auc_score(y_test, probs):.2f}.

**Subgroups.**

{table.to_markdown()}

**Explainability.** SHAP explanations for every prediction; what-if analysis and counterfactual search.

**Robustness and security.** The workshop notebooks show that alerts can be manipulated with changes inside measurement
noise while validation metrics stay unchanged; any deployment needs input integrity controls and monitoring.

**Limitations.** Historical referral population, few women, no external validation.
"""
    st.markdown(card)
    st.download_button("Download the model card", card, file_name="model_card.md", key="card")

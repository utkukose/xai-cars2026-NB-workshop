# Workshop guide

This guide is the run sheet for the session *Explainable Artificial Intelligence in Medical Systems: From Black Box Models to Reliable Clinical Decision Support* at IEEE CARS 2026 on 28 October 2026. It lists what happens in each block, which material is on screen, what participants do, and what to do when something fails. Times follow the official programme.

## Before the session

On the day before, the XAI Lab address should be opened on a phone and on a laptop to confirm that GitHub Pages serves the latest version. Each notebook should be run once in Colab, which also confirms that the external data sources respond.

On the day, about thirty minutes before the start, NB4, NB5 and NB6 should be opened in Colab and run up to their first attack cell. Their data then sit in the runtime, and the live demonstrations start without waiting. NB5 downloads 2,500 patient files from PhysioNet, which takes a few minutes. When time is short, a first cell containing `%env XAI_WORKSHOP_QUICK=1` makes every notebook finish in about a minute with smaller samples.

The following message can be posted in the conference chat at the start of the session:

> Browser lab for this session, no installation needed: https://utkukose.github.io/xai-cars2026-NB-workshop/
> Notebooks, data sources and the dashboard: https://github.com/utkukose/xai-cars2026-NB-workshop
> Each notebook opens in Colab from the badges in the README.

## Run sheet

| Time | Block | On screen | Participants | Poll |
|---|---|---|---|---|
| 10:00 | Opening and the question of the day | README, programme | open the XAI Lab | |
| 10:03 | A model with 97 percent accuracy | NB1, sections 1 and 2 | Lab, *Deploy?*: move the threshold | Poll 1 |
| 10:10 | Wrong and sure; calibration | NB1, sections 3 and 4 | Lab, *Deploy?*: confident errors | |
| 10:14 | The shortcut and the legal mandates | NB1, sections 5 to 7 | | |
| 10:20 | Glass-box models and global attribution | NB2, sections 2 and 3 | | |
| 10:28 | Local explanations and counterfactuals | NB2, sections 4 and 5 | Lab, *Explain a patient* | Poll 2 |
| 10:34 | Shapley values by hand, GEMEX, evaluation | NB2, sections 6 and 7 | Lab, *Shapley by hand* | |
| 10:39 | Grad-CAM and the sanity check | NB3, sections 3 and 4 | | |
| 10:45 | Break | | | |
| 11:00 | Attack 1: CGM hypoglycaemia alerts | NB4, sections 2 and 3 | Lab, *Spoof the sensor* | Poll 3 |
| 11:10 | What explanations reveal | NB4, section 4 | Lab: counterfactual margin | |
| 11:15 | Attack 2: ICU sepsis alerts | NB5, sections 3 and 4 | | |
| 11:22 | Attack 3: wearable AF detection | NB6, sections 3 and 4 | | |
| 11:30 | The EU AI Act and the subgroup audit | NB7, sections 1 and 2 | | Poll 4 |
| 11:38 | Model card and dashboard | NB7, sections 3 and 4; `dashboard/app.py` | | |
| 11:46 | Walkthrough of the repository | README | | |
| 11:50 | Questions and discussion | | | |

## Polls

**Poll 1, 10:05.** A hospital committee sees an accuracy of 0.970 and an AUROC of 0.992. Should the model triage biopsies? *Yes / No / It depends on what else we know.*

**Poll 2, 10:30.** LIME and SHAP rank the variables of the same patient differently. What should the clinician see? *SHAP / LIME / Both, with the disagreement shown / Neither.*

**Poll 3, 11:02.** Asked before the demonstration: can a correct hypoglycaemia alert be silenced if every CGM reading may change by at most 15 mg/dL? *Rarely / Sometimes / Most of the time.*

**Poll 4, 11:32.** Where does a sepsis early warning system that is part of a medical device sit under the EU AI Act? *Minimal risk / Transparency obligations / High risk / Prohibited.*

## Fallback plan

If Colab is slow or a participant cannot sign in, every key result of Parts 1 to 3 can be shown in the XAI Lab, which needs only a browser. If PhysioNet responds slowly, NB5 can run with fewer patients by lowering `N_PATIENTS` in its data cell, or in quick mode. If the pinned GlucoBench commit cannot be reached, NB4 falls back to the main branch of the same repository. If the Lab page does not load, the `docs/` folder of a local clone opens directly from disk, because the page has no server-side part. If screen sharing fails, the addresses in the chat let participants follow on their own screens.

## Timing notes

Part 2 is the densest block. When it runs long, the MAPLE and Anchors cells of NB2 can be summarised, because the Lab covers Shapley values and counterfactuals interactively. In Part 3 the attack cells carry the argument; the GEMEX comparisons can be summarised from their printed values. NB3 benefits from a GPU runtime when it is run live.

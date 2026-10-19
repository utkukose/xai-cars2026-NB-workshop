# Workshop guide

This guide is the run sheet for the session *Explainable Artificial Intelligence in Medical Systems: From Black Box Models to Reliable Clinical Decision Support* at IEEE CARS 2026, organised by the Center for Cyber Security Research (C2SR) of the University of North Dakota in Grand Forks, ND, USA, on 28 October 2026. Times follow the official programme.

The whole session runs from the workshop site, https://utkukose.github.io/xai-cars2026-NB-workshop/. Every part follows the same rhythm. An interactive page opens the part with a short cold open and a few stations, each built around one prediction and one reveal on real data. The matching Colab notebook then carries the full analysis. At the end, the XAI Lab puts every tool on one bench and closes with a debrief of the session.

## Before the session

On the day before, the start page, the four part pages, the break screen and the XAI Lab should be opened once on a laptop and once on a phone, and each notebook should be run once in Colab, which also confirms that the external data sources respond.

About thirty minutes before the start, NB4, NB5 and NB6 should be opened in Colab and run up to their first attack cell. Their data then sit in the runtime, and the live demonstrations start without waiting. NB5 downloads 2,500 patient files from PhysioNet, which takes a few minutes. When time is short, a first cell containing `%env XAI_WORKSHOP_QUICK=1` makes every notebook finish in about a minute with smaller samples.

The following message can be posted in the conference chat at the start of the session:

> Workshop site, no installation needed: https://utkukose.github.io/xai-cars2026-NB-workshop/
> Each part opens with an interactive page; the notebooks open in Colab from the orange buttons.
> Repository with notebooks, data sources and the dashboard: https://github.com/utkukose/xai-cars2026-NB-workshop

## Presenter controls

On every page the right and left arrow keys move to the next or previous station, `]` and `[` move to the next or previous part with a short transition, `T` switches between the paper view and the dark monitor view, `F` toggles full screen, and `?` lists the keys. Answers and results are kept only in the browser that is used, and they feed the debrief at the end of the XAI Lab, so the presenter's own browser produces the debrief shown at the close.

## Run sheet

| Time | Block | On screen | Participants |
|---|---|---|---|
| 10:00 | Opening: today the patient is the model | Start page | open the site |
| 10:03 | Part 1 cold open; would you deploy this model? | `part1.html`, stations 1 and 2 | answer the deployment question, find the confident errors |
| 10:09 | Calibration, the shortcut, the three mandates | `part1.html`, stations 3 to 5 | predict, then reveal |
| 10:14 | The analysis in code | NB1, sections 2, 3 and 5 | run NB1 |
| 10:20 | Part 2 cold open; glass boxes; Shapley values | `part2.html`, stations 1 and 2 | open the box, predict the winner |
| 10:27 | LIME twice, counterfactual, deletion test, sanity check | `part2.html`, stations 3 to 6 | run LIME, find the counterfactual |
| 10:35 | The toolkit in code | NB2, sections 7 and 8; NB3, sections 3 and 4 | run NB2 or NB3 |
| 10:45 | Break | `break.html` with the countdown | answer the question for 11:00 |
| 11:00 | Part 3 cold open; three attackers; silence the alarm | `part3.html`, stations 1 and 2 | run the attacker by hand |
| 11:08 | What gave it away; the campaign monitor | `part3.html`, stations 3 and 4 | move the detection threshold |
| 11:14 | The sepsis replay; hiding atrial fibrillation | `part3.html`, stations 5 and 6 | replay a stay, choose a budget |
| 11:20 | The attacks in code | NB4 live, results of NB5 and NB6 | run NB4 |
| 11:30 | Part 4 cold open; sort the systems under the AI Act | `part4.html`, station 1 | sort eight systems |
| 11:35 | Audit, model card, dashboard with oversight | `part4.html`, stations 2 to 4 | resample, write the card, override |
| 11:42 | Governance in code and the Streamlit dashboard | NB7, `dashboard/app.py` | run NB7 |
| 11:47 | Ward round and debrief | `lab.html`, the debrief tab | open the debrief |
| 11:50 | Questions and discussion | the debrief tab | |

## Questions for the conference platform

The pages ask their own prediction questions, and the four questions below can be mirrored in the platform's poll tool so that the room's answers are visible together.

**10:04, Part 1.** A hospital committee sees an accuracy of 0.970 and an AUROC of 0.992. Should the model triage biopsies? *Yes / No / It depends on what else we know.*

**10:28, Part 2.** Two LIME runs on the same patient: will the top five variables be the same? *Always / Usually / Not necessarily.*

**10:58, break.** Each glucose reading may change by at most 15 mg/dL. Can a correct hypoglycaemia alert be silenced? *Rarely / Sometimes / Most of the time.*

**11:31, Part 4.** Where does a sepsis early warning system that is part of a medical device sit under the EU AI Act? *Minimal risk / Transparency obligations / High risk / Prohibited.*

## Fallback plan

If Colab is slow or a participant cannot sign in, every key result of Parts 1 to 4 can be shown on the part pages and in the XAI Lab, which need only a browser. If PhysioNet responds slowly, NB5 can run with fewer patients by lowering `N_PATIENTS` in its data cell, or in quick mode; the Part 3 page replays real stays from the same cohort without any download. If the pinned GlucoBench commit cannot be reached, NB4 falls back to the main branch of the same repository. If GitHub Pages does not load, the `docs/` folder of a local clone opens directly from disk, because the site has no server-side part. If screen sharing fails, the addresses in the chat let participants follow on their own screens.

## Timing notes

Part 2 is the densest block. When it runs long, the deletion test and the sanity check on the page can be shown briefly, because NB2 and NB3 cover them in full. In Part 3 the page carries the argument; NB5 and NB6 can be summarised from their printed tables. In NB4 and NB5 the GEMEX cell is the slowest step, two to three minutes on a free CPU, so in a live run it can be started and discussed while it computes, or skipped, because no later cell depends on it. The campaign station of the Part 3 page shows the contrast between the two signals most clearly at its default setting: with the counterfactual margin, a campaign that manipulates one window in five is caught within a few dozen windows, and with the SHAP anomaly it usually is not. The debrief works best when the presenter's browser has been used for the whole session, so the polls and stations should be answered on the presenter's screen as the session goes.

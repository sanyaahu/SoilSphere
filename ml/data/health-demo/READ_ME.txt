SOIL-CONDITION DEMO: MEASURED NPK AND PARTLY SYNTHETIC MOISTURE

APPENDED TABLE (uploaded November 17, collection date unspecified)
new_readings_2026-11-17.json records 20 additional measured NPK/moisture entries.
Oxygen was measured within soil in 9 cells; other oxygen values remain null.
The bottom-right NPK values 218/205/699 were explicitly confirmed by the user.
Original readings_review.csv, real_measurements_pending.csv, and
synthetic_demo_training.csv remain unchanged by the combined-data rebuild.
combined_demo_training.csv preserves all 26 original rows and adds the 20 new
ones, retaining original split assignments. Combined counts: 15 healthy,
8 unhealthy, 23 could_be_better. Training 32; demonstration test 14.
The uploaded table's labels follow the same corner/edge/interior rule below.
No new moisture or oxygen measurements are invented.
Oxygen is an optional fifth feature, with 9 measured and 37 missing values.
The forest learns missing-value routing; no oxygen imputation is used.
Original table details and counts below describe that source batch only.
Whether the same physical pots/calibration were reused across batches is
unverified. Assigned batch IDs do not prove independent test experiments.

Source: Testing Data.pdf, page 2, bottom "New NPK Model" table.
The user confirmed triples are N/P/K in mg/kg, percentages use the app's
ADC-based calibrated dry-to-wet scale, and separate entries are different pots.
Collection timestamps and actual calibration profile were not supplied.
Pot IDs were assigned during transcription and must be mapped to physical pots.

FILES
readings_review.csv / readings_review.xlsx: full 26-row audit, with measured and
synthetic moisture in separate columns, label basis, and proposed demo split.
real_measurements_pending.csv: original measurements only, with missing values
preserved and provisional labels. Not ready for the existing trainer.
synthetic_demo_training.csv: 16 missing moisture values filled using explicit
assumptions. For demos only. Never combine this file with measured training data.
synthetic_demo_artifacts/: separately trained demo Random Forest and report.
The demo model is integrated into the app and explicitly marked experimental.

ASSUMPTIONS
User-defined 4-row by 5-column table layout:
- Corners (control or 3 tbsp fertilizer AND dry or waterlogged): unhealthy.
- All remaining outer-edge cells: could_be_better.
- All interior cells (1 or 2 tbsp fertilizer and control/2 tbsp/4 tbsp water): healthy.
Two readings in the same cell share its label. This replaces the earlier
40-60% moisture label rule. It does not define an agronomic health standard.

Synthetic moisture values, deliberately chosen rather than measured:
2 tbsp fertilizer: dry 24/26%; control 42/45%; 2 tbsp water 54/57%;
4 tbsp water 64/67%; waterlogged 99/100%.
3 tbsp fertilizer: dry 25%; control 43/46%; 2 tbsp water 56%;
4 tbsp water 66%; waterlogged 100%.
These are illustrative values near treatment headings and first-row observations.
They are not statistically estimated measurements or evidence about those pots.

COUNTS AND VALIDATION
26 rows: 10 recorded moisture values and 16 synthetic moisture values.
Demo labels: 9 healthy, 4 unhealthy, 13 could_be_better.
18 training pots and 8 test pots, selected by row position within each class
before fitting. No tuning on test results. Split membership is in review CSV.
The model has 200 trees, depth 6, balanced class weights, and minimum leaf size 1.
The smaller leaf permits the three training corners to be represented.
Rebuild with python ml/rebuild_health_demo.py; no tuning on the test pots.
The test report measures agreement with assumed labels, partly on synthetic
inputs. It provides NO real-world soil-health accuracy estimate.
The exported demo JSON intentionally has no health-accuracy metric.

NEXT REAL-DATA REQUIREMENTS
Supply actual moisture values for missing rows and the real calibration profile.
Document original pot IDs and measurement times where available.
Collect independently supported health assessments for training labels.
The measured-only subset has three complete interior readings. Labels remain
experimental assumptions; the independent binary health trainer is a separate
pipeline and does not accept the third class. Collect more measured pots and
independent health assessments before claiming predictive reliability.

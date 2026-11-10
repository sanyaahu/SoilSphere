SOIL-CONDITION DEMO: MEASURED NPK AND PARTLY SYNTHETIC MOISTURE

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
Acceptable proxy label (encoded as healthy for existing trainer compatibility):
1-2 tbsp fertilizer AND moisture 40-60% inclusive.
Stressed proxy label (encoded as unhealthy): deliberate dry/waterlogged treatment
OR 3 tbsp fertilizer (user-designated excessive treatment).
Other combinations receive the provisional third class could_be_better.
These labels describe experimental assumptions, not independently verified health.
Do not infer that zero fertilizer proves deficiency or all moderate doses are safe.

Synthetic moisture values, deliberately chosen rather than measured:
2 tbsp fertilizer: dry 24/26%; control 42/45%; 2 tbsp water 54/57%;
4 tbsp water 64/67%; waterlogged 99/100%.
3 tbsp fertilizer: dry 25%; control 43/46%; 2 tbsp water 56%;
4 tbsp water 66%; waterlogged 100%.
These are illustrative values near treatment headings and first-row observations.
They are not statistically estimated measurements or evidence about those pots.

COUNTS AND VALIDATION
26 rows: 10 recorded moisture values and 16 synthetic moisture values.
Demo labels: 6 healthy, 14 unhealthy, 6 could_be_better.
18 training pots and 8 test pots, selected by row position within each class
before fitting. No tuning on test results. Split membership is in review CSV.
The model has 200 trees using the existing training pipeline and four features.
The test report measures agreement with assumed labels, partly on synthetic
inputs. It provides NO real-world soil-health accuracy estimate.
The exported demo JSON intentionally has no health-accuracy metric.

NEXT REAL-DATA REQUIREMENTS
Supply actual moisture values for missing rows and the real calibration profile.
Document original pot IDs and measurement times where available.
Collect independently supported health assessments for training labels.
The measured-only subset has just two acceptable complete rows; at least one
additional separate acceptable pot is needed even for the current trainer's tiny
train/test minimum. More diverse pots and fresh tests are needed for reliability.
Labeling from moisture itself makes moisture-only agreement unsurprising.

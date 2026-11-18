"""Rebuild the three-class table-layout demo, preserving synthetic-data provenance.

Run with the project's Python ML environment. This never trains the independent
plant-health pipeline and never reports a real-world accuracy estimate.
"""
import csv
import json
import hashlib
from collections import Counter
from pathlib import Path

import pandas as pd
import numpy as np

from soilsphere.core import forest, metrics, ranges

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'health-demo'
FEATURES = ['moisture', 'nitrogen', 'phosphorus', 'potassium', 'oxygen']


def grid_label(dose, water):
    outer_row = dose in (0, 3)
    outer_column = water in ('dry', 'waterlogged')
    if outer_row and outer_column:
        return 'unhealthy'
    return 'could_be_better' if outer_row or outer_column else 'healthy'


def main():
    review = list(csv.DictReader((DATA / 'readings_review.csv').open(encoding='utf-8')))
    data = pd.read_csv(DATA / 'synthetic_demo_training.csv', keep_default_na=False)
    expected = {r['sample_id']: grid_label(int(r['fertilizer_tbsp']), r['water_treatment']) for r in review}
    assert len(data) == len(review) == 26
    assert data.sample_id.is_unique
    assert all(row.label == expected[row.sample_id] for row in data.itertuples())
    assert Counter(data.label) == {'healthy': 9, 'unhealthy': 4, 'could_be_better': 13}
    old_bytes = {name: (DATA / name).read_bytes() for name in ['readings_review.csv', 'synthetic_demo_training.csv', 'real_measurements_pending.csv']}
    data['batch_id'] = 'original-table'
    data['oxygen'] = np.nan
    new_source = json.loads((DATA / 'new_readings_2026-11-17.json').read_text())
    new_review = [dict(zip(new_source['columns'], row)) for row in new_source['readings']]
    assert len(new_review) == 20
    new_rows = []
    for i, row in enumerate(new_review):
        label = grid_label(row['fertilizer_tbsp'], row['water_treatment'])
        sample_id = f'batch2-pot-{i+1:02d}'
        row.update(sample_id=sample_id, demo_label=label)
        new_rows.append(dict(sample_id=sample_id, **{f: row[f] for f in FEATURES}, label=label,
                             batch_id=new_source['batchId'], split='unassigned',
                             label_basis='PROXY: user-defined table position, not independently assessed health',
                             moisture_unit='relative_percent', oxygen_unit='percent' if row['oxygen'] is not None else '',
                             condition=f"{row['fertilizer_tbsp']} tbsp fertilizer; {row['water_treatment']}"))
    # Keep original train/test assignments. Assign new entries before fitting.
    for label in ['healthy', 'unhealthy', 'could_be_better']:
        for j, row in enumerate(r for r in new_rows if r['label'] == label):
            row['split'] = 'test' if j % 3 == 2 else 'train'
    data = pd.concat([data, pd.DataFrame(new_rows)], ignore_index=True)
    data[FEATURES] = data[FEATURES].apply(pd.to_numeric)
    data.to_csv(DATA / 'combined_demo_training.csv', index=False, na_rep='')
    review += new_review
    assert len(data) == 46 and data.sample_id.is_unique
    assert Counter(data.label) == {'healthy': 15, 'unhealthy': 8, 'could_be_better': 23}
    assert data.oxygen.notna().sum() == 9
    train, test = data[data.split == 'train'], data[data.split == 'test']
    assert set(train.sample_id).isdisjoint(test.sample_id)
    assert len(train) + len(test) == 46
    # Fixed before evaluation. Leaf size 1 accommodates just three training
    # corners; balanced weights keep the minority corner class represented.
    # Native missing-value routes retain absent oxygen as missing. No imputer
    # replaces it with an invented oxygen measurement.
    fitted = forest().set_params(class_weight='balanced', min_samples_leaf=1)
    fitted.fit(train[FEATURES], train.label)
    classifier = fitted
    scores = fitted.predict_proba(data[FEATURES])
    fixtures = [dict(input={k: None if pd.isna(v) else v for k,v in row.items()}, prediction=str(classifier.classes_[int(score.argmax())]), scores=score.tolist(),
                     assignedLabel=review_row['demo_label'], fertilizerTbsp=int(review_row['fertilizer_tbsp']),
                     waterTreatment=review_row['water_treatment'], batchId=batch)
                for row, score, review_row, batch in zip(data[FEATURES].to_dict(orient='records'), scores, review, data.batch_id)]
    artifacts = ROOT / 'artifacts'
    (artifacts / 'health_demo_parity.json').write_text(json.dumps(fixtures, separators=(',', ':')))
    model = dict(version=1, task='health', demoOnly=True, status='synthetic_assumption_demo',
                 labelDefinition='table_grid_corners_edges_interior_v1',
                 classes=classifier.classes_.tolist(), numericFeatures=FEATURES, optionalFeatures=['oxygen'], categories={},
                 ranges=ranges(train, FEATURES),
                 units=dict(moisture='relative_percent', nitrogen='mg/kg', phosphorus='mg/kg', potassium='mg/kg', oxygen='percent'),
                 moistureCalibrationId='SYNTHETIC-DEMO-NOT-A-DEVICE-PROFILE',
                 metrics=dict(rows=46, testRows=len(test), testAccuracy=None, cvAccuracy=None),
                 limitations=['16 moisture inputs are synthetic.', 'All labels describe table position, not independently assessed plant health.'],
                 trees=[])
    for estimator in classifier.estimators_:
        tree = estimator.tree_
        model['trees'].append(dict(left=tree.children_left.tolist(), right=tree.children_right.tolist(),
                                   feature=tree.feature.tolist(), threshold=np.nan_to_num(tree.threshold).tolist(),
                                   missingGoToLeft=tree.missing_go_to_left.tolist(), values=tree.value[:, 0, :].tolist()))
    (ROOT.parent / 'src' / 'ml' / 'health-model.json').write_text(json.dumps(model, separators=(',', ':')))
    # Runtime fixtures with oxygen removed also verify native missing routing
    # for readings that originally included it.
    masked = data[FEATURES].copy(); masked['oxygen'] = np.nan
    mask_scores = fitted.predict_proba(masked)
    mask_fixtures = [dict(input={k: None if pd.isna(v) else v for k,v in row.items()}, scores=score.tolist(),
                         prediction=str(classifier.classes_[int(score.argmax())]))
                     for row, score in zip(masked.to_dict(orient='records'), mask_scores)]
    (artifacts / 'health_demo_missing_oxygen_parity.json').write_text(json.dumps(mask_fixtures, separators=(',', ':')))
    report = dict(task='synthetic_grid_label_agreement_NOT_plant_health_accuracy',
                  rows_by_batch=data.batch_id.value_counts().to_dict(), measured_oxygen_rows=int(data.oxygen.notna().sum()),
                  missing_oxygen_rows=int(data.oxygen.isna().sum()),
                  original_file_sha256={name: hashlib.sha256(value).hexdigest() for name,value in old_bytes.items()},
                  label_counts=dict(Counter(data.label)), training_pots=train.sample_id.tolist(), test_pots=test.sample_id.tolist(),
                  demo_test_agreement=metrics(test.label, fitted.predict(test[FEATURES])),
                  note='Synthetic/proxy agreement only. Physical pot independence across experiments and shared moisture calibration are not verified. Do not present as real-world health accuracy.')
    (artifacts / 'health_demo_evaluation.json').write_text(json.dumps(report, indent=2) + '\n')
    assert all((DATA/name).read_bytes() == original for name,original in old_bytes.items())
    print(json.dumps(dict(labels=dict(Counter(data.label)), train=len(train), test=len(test))))


if __name__ == '__main__':
    main()

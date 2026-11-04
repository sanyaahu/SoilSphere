import type { ForestModel, ModelInput } from './types';

export function predictFertilizer(model: ForestModel, input: ModelInput) {
  const encoded: number[] = [];
  const warnings: string[] = [];
  for (const feature of model.numericFeatures) {
    const value = input[feature];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing measurement: ${feature}`);
    encoded.push(Math.fround(value));
    const range = model.ranges[feature];
    if (range && (value < range.min || value > range.max)) warnings.push(`${feature} is outside the training range (${range.min.toFixed(1)}–${range.max.toFixed(1)}).`);
  }
  for (const [feature, options] of Object.entries(model.categories)) {
    const value = input[feature];
    if (typeof value !== 'string' || !options.includes(value)) throw new Error(`Choose a supported ${feature.replace('_', ' ')}.`);
    encoded.push(...options.map(option => option === value ? 1 : 0));
  }
  const scores = model.classes.map(() => 0);
  for (const tree of model.trees) {
    let node = 0;
    while (tree.left[node] !== -1) {
      node = encoded[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    }
    const total = tree.values[node].reduce((sum, value) => sum + value, 0);
    tree.values[node].forEach((value, i) => { scores[i] += value / total / model.trees.length; });
  }
  const best = scores.indexOf(Math.max(...scores));
  return { prediction: model.classes[best], scores, warnings };
}

export function missingInputs(model: ForestModel, input: ModelInput): string[] {
  return model.numericFeatures.filter(feature => typeof input[feature] !== 'number' || !Number.isFinite(input[feature]));
}

/**
 * Beta distribution sampling for Thompson Sampling.
 *
 * Uses the gamma variate method: Beta(a,b) = X/(X+Y) where X~Gamma(a), Y~Gamma(b).
 * Gamma sampling uses Marsaglia and Tsang's method for a>=1, with Ahrens-Dieter shift for a<1.
 *
 * @module Beta Distribution
 */

/**
 * Sample from Gamma(shape, 1) distribution.
 * Marsaglia and Tsang's method (2000) for shape >= 1.
 */
function gammaSample(shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter: Gamma(a) = Gamma(a+1) * U^(1/a)
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  // Marsaglia and Tsang's method
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number;
    let v: number;

    do {
      // Standard normal via Box-Muller
      x = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Sample from Beta(alpha, beta) distribution.
 * Returns a value in [0, 1].
 *
 * @param alpha - First shape parameter (>0). Higher = more mass near 1.
 * @param beta - Second shape parameter (>0). Higher = more mass near 0.
 */
export function betaSample(alpha: number, beta: number): number {
  if (alpha <= 0 || beta <= 0) {
    throw new Error(`Beta parameters must be positive: alpha=${alpha}, beta=${beta}`);
  }

  const x = gammaSample(alpha);
  const y = gammaSample(beta);

  // Guard against both being zero (extremely unlikely but possible with tiny params)
  if (x + y === 0) return 0.5;

  return x / (x + y);
}

/**
 * Mean of Beta(alpha, beta) distribution.
 */
export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Variance of Beta(alpha, beta) distribution.
 */
export function betaVariance(alpha: number, beta: number): number {
  const n = alpha + beta;
  return (alpha * beta) / (n * n * (n + 1));
}

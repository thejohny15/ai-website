
# OptimizerES — Tail‑Risk (ES) Optimizer Documentation
_(Human‑Readable Math Version)_

This document explains how the **Expected Shortfall (ES)** optimizer works inside `optimizerES.ts` using clean, readable formulas.

---

# 1. Goal

The ES optimizer finds portfolio weights **w** that:

1. Minimize **Expected Shortfall** (tail risk)
2. Allocate that tail risk according to **risk budgets**  
3. Produce **ES‑risk‑parity** when budgets are equal

---

# 2. Portfolio Statistics

Portfolio return:
```
μₚ = Σᵢ ( wᵢ × μᵢ )
```

Portfolio volatility:
```
σₚ = √( wᵀ × Σ × w )
```

---

# 3. Gaussian ES Formula

We use a fast, analytical (Gaussian) ES:

```
zₐ = inverseNormalCDF(α)
kₐ = φ(zₐ) / (1 − α)

ES(w) = −μₚ + kₐ × σₚ
```

This is efficient to compute and differentiable.

---

# 4. ES Tail‑Risk Contributions

Marginal ES for asset i:
```
dES/dwᵢ ≈ −μᵢ + kₐ × ( (Σ × w)ᵢ / σₚ )
```

Absolute tail‑risk contribution:
```
RC_ESᵢ = wᵢ × (dES/dwᵢ)
```

Normalized share:
```
RC_ES_shareᵢ = RC_ESᵢ / Σⱼ RC_ESⱼ
```

These are the values matched against **risk budgets**.

---

# 5. Optimization Objective

```
Objective(w) =
      ES(w)
    + λ × Σᵢ ( RC_ES_shareᵢ − budgetᵢ )²
    + regularization_terms
```

Where:
- λ = `budgetStrength`
- Larger λ forces contributions closer to budgets
- Regularizers include entropy, weight bounds, diversification, etc.

---

# 6. Why ES ≈ ERC (Under Gaussian ES)

Gaussian ES tail‑risk contribution structure:

```
RC_ESᵢ ∝ wᵢ × (Σ × w)ᵢ
```

This is **identical** to the volatility‑risk contribution used in ERC.

Thus ES‑risk‑parity (Gaussian) ≈ ERC.

---

# 7. Output Returned to the API

`optimizerES.ts` returns:

- `weights`
- `es` (the ES value)
- `risk_contributions` (RC_ESᵢ)
- `risk_contribution_shares` (RC_ES_shareᵢ)
- diagnostics

These feed into:
- the frontend (displays risk shares)
- the backtest (used during rebalancing)

---

End.

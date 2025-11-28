
# Unified Risk Models — ERC (Risk Budgeting) + ES (Tail-Risk Budgeting)
_(BCUL Portfolio Optimizer — Human‑Readable Version)_

This document explains **both** risk‑budgeting models used in the optimizer:

1. **ERC (Equal Risk Contribution)** — volatility‑based risk budgeting  
2. **ES Risk Budgeting** — tail‑risk contribution budgeting (Gaussian ES)

Equations use clean, readable notation (√, Σ, ×, ^2) and **no LaTeX**.

---

# PART I — ERC (Volatility Risk Budgeting)

ERC equalizes **volatility risk contributions**.

## 1. Portfolio Inputs

- weights: `w = (w₁, …, wₙ)`
- covariance matrix: `Σ`  
- returns μ are *not used* in ERC

Portfolio volatility:
```
σₚ = √( wᵀ × Σ × w )
```

---

## 2. Volatility Risk Contributions

### Marginal contribution
```
dσₚ/dwᵢ = (Σ × w)ᵢ / σₚ
```

### Absolute risk contribution
```
RCᵢ = wᵢ × (dσₚ/dwᵢ)
```

### Risk‑share
```
RC_shareᵢ = RCᵢ / Σⱼ RCⱼ
```

---

## 3. ERC Objective (with risk budgets)

User chooses budgets:
```
b = (b₁, …, bₙ),  Σᵢ bᵢ = 1
```

Equal‑risk (ERC):
```
bᵢ = 1/n
```

Optimizer minimizes:
```
Objective(w) =
      σₚ
    + λ × Σᵢ (RC_shareᵢ − bᵢ)²
    + regularization_terms
```

Where:
- **λ = riskBudgetStrength**
- larger λ enforces closer RC matching

---

# PART II — ES Risk Budgeting (Tail‑Risk Parity)

ES model equalizes **tail‑risk contributions**, not volatility contributions.

## 4. Gaussian ES Model

Portfolio mean:
```
μₚ = Σᵢ (wᵢ × μᵢ)
```

Portfolio volatility:
```
σₚ = √( wᵀ × Σ × w )
```

Gaussian ES:
```
zₐ = inverseNormalCDF(α)
kₐ = φ(zₐ) / (1 − α)

ES(w) = −μₚ + kₐ × σₚ
```

---

## 5. ES Tail‑Risk Contributions

Marginal ES:
```
dES/dwᵢ ≈ −μᵢ + kₐ × ( (Σ × w)ᵢ / σₚ )
```

Absolute ES contribution:
```
RC_ESᵢ = wᵢ × (dES/dwᵢ)
```

Normalized ES share:
```
RC_ES_shareᵢ = RC_ESᵢ / Σⱼ RC_ESⱼ
```

These are the **tail‑risk shares** the optimizer modifies.

---

# 6. ES Budgeting Objective

User budgets:
```
bᵢ ≥ 0,   Σᵢ bᵢ = 1
```

ES optimization minimizes:
```
Objective(w) =
      ES(w)
    + λ × Σᵢ (RC_ES_shareᵢ − bᵢ)²
    + regularization_terms
```

Where:
- **λ = budgetStrength** (set e.g. 0.5 → 400)
- larger λ forces ES contributions toward budgets

---

# PART III — How ERC and ES Compare

## 7. Why ES ≈ ERC under Gaussian ES

Because under Gaussian ES:
```
ES(w) ≈ kₐ × σₚ      (when μₚ is small)
```

And:
```
dES/dwᵢ ≈ kₐ × ( (Σ × w)ᵢ / σₚ )
```

Thus ES contributions:
```
RC_ESᵢ ∝ wᵢ × (Σ × w)ᵢ
```

But ERC uses the same structure:
```
RCᵢ ∝ wᵢ × (Σ × w)ᵢ
```

Therefore:
- Large λ in ES ⇒ ES‑risk‑parity ≈ ERC  
- With identical Σ, Gaussian ES behaves like volatility risk

## 8. When ERC and ES differ

They differ when the ES model includes **non‑Gaussian** tail information:
- historical return distributions
- fat‑tailed / skewed losses
- higher‑moment‑aware ES

Your current model uses *Gaussian ES*, so ES ≈ ERC by construction.

---

# PART IV — Summary of What route.ts Does

## For ERC mode
- Computes ERC weights using volatility contributions
- Enforces budgets with `riskBudgetStrength`
- Sends ERC weights + ERC risk shares to frontend

## For ES mode
- Computes ES weights using Gaussian ES
- Enforces tail‑risk budgets with `budgetStrength`
- Returns:
  - ES weights  
  - ES tail‑risk contributions  
  - ES tail‑risk shares  
- Backtest uses ES optimizer at every rebalance with same λ

Thus:
- **ERC panel** shows volatility‑risk contributions  
- **ES panel** shows tail‑risk contributions  
- Both feed into backtest → rebalancing → metrics  

---

# END

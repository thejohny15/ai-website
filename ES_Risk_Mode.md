
# Expected Shortfall (ES) Risk Model — Human‑Readable Version  
_(BCUL Portfolio Optimizer)_

This document describes the ES model used in the optimizer using **clean, human‑readable mathematical notation**  
(No LaTeX, no unreadable symbols — just √, Σ, ^2, ×, etc.)

---

# 1. Portfolio Statistics

Given:
- weights: **w = (w₁, w₂, …, wₙ)**
- expected returns: **μ = (μ₁, μ₂, …, μₙ)**
- covariance matrix: **Σ**

### Portfolio expected return  
```
μₚ = Σᵢ ( wᵢ × μᵢ )
```

### Portfolio volatility  
```
σₚ = √( wᵀ × Σ × w )
```

---

# 2. Gaussian Expected Shortfall

For confidence level **α**:

```
zₐ = inverseNormalCDF(α)
kₐ = φ(zₐ) / (1 − α)     (φ = normal PDF)
```

Expected Shortfall:
```
ES(w) = −μₚ + kₐ × σₚ
```

Interpretation:
- **−μₚ** → expected drift loss  
- **kₐ × σₚ** → tail‑risk component under Gaussian approximation

---

# 3. Tail‑Risk Contributions

To understand how each asset contributes to the total ES risk, we compute marginal effects.

### 3.1 Marginal contribution  
For asset i:
```
dES/dwᵢ ≈ −μᵢ + kₐ × ( (Σ × w)ᵢ / σₚ )
```

### 3.2 Tail‑risk contribution (absolute)
```
RCᵢ = wᵢ × (dES/dwᵢ)
```

### 3.3 Tail‑risk contribution share (normalized)
```
RC_shareᵢ = RCᵢ / Σⱼ RCⱼ
```

These **RC_shareᵢ** values are what the optimizer tries to match to user risk budgets.

---

# 4. Risk Budgets

Budgets define the **desired share of total risk** each asset should contribute.

```
b = (b₁, b₂, …, bₙ)
Σᵢ bᵢ = 1
bᵢ ≥ 0
```

Special case — **equal tail‑risk budgeting**:
```
bᵢ = 1/n
```

---

# 5. Optimization Objective

The optimizer chooses weights **w** to minimize:

```
Objective(w) =
      ES(w)
    + λ × Σᵢ ( RC_shareᵢ − bᵢ )²
    + regularization_terms
```

Where:
- **λ = budgetStrength** controls how strongly we force risk contributions toward budgets.
- Regularizers include:
  - diversification
  - entropy/smoothness
  - long‑only constraints
  - weight caps

⚠️ **Important:**  
The optimizer tries to equalize **risk contributions**, not weights.  
Equal weights only happen by coincidence if equal risk ⇒ equal allocation under Σ.

---

# 6. Why ES‑Risk‑Parity Looks Similar to ERC (Volatility Risk Parity)

Under Gaussian ES:

```
ES(w) ≈ kₐ × σₚ     (when μₚ is small)
```

And:

```
dES/dwᵢ ≈ kₐ × ( (Σ × w)ᵢ / σₚ )
```

So:

```
RCᵢ ∝ wᵢ × (Σ × w)ᵢ
```

But this is **exactly the same form** used in classical:

### **ERC (Equal Risk Contribution) portfolios**

Therefore:
- When λ is large → ES tail‑risk contributions ≈ equal  
- When ES tail‑risk contributions ≈ equal → weight structure ≈ ERC  

To get ES‑risk‑parity portfolios **truly different** from ERC, you need **historical ES**  
(non‑Gaussian, scenario‑based tails).

---

# 7. Effect of λ (budgetStrength)

### Small λ (0.5)
- ES term dominates  
- Tail‑risk shares differ from budgets  

### Medium λ (5–80)
- Contributions shift toward budgets  

### Large λ (100–400)
- Close to perfect ES‑risk‑parity  
- Weights stabilize because constraints limit exact equality  

---

# 8. Summary

- Portfolio ES uses a **Gaussian tail‑risk approximation**  
- Tail‑risk contributions use **marginal ES sensitivity**  
- Risk budgets target **shares of ES risk**, not weights  
- `budgetStrength` determines enforcement strength  
- Gaussian ES‑risk‑parity ≈ ERC because both equalize  
  `wᵢ × (Σ × w)ᵢ`  
- Non‑Gaussian ES gives richer behavior  

---

This file provides a **clean, readable** explanation of the ES model with uncluttered math notation.

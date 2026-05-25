"""
scorer.py - Proximity Score pipeline wrapped as a callable.
Loads Qwen3-8B once; score_text() runs inference and returns the JSON schema dict.

Hook placement: q_norm and k_norm inside the LAST attention layer only
(post-RMSNorm, pre-RoPE). The full N×N raw QK logit matrix is computed
for all 32 heads — (Q @ K.T / sqrt(d_k)) — without applying causal masking,
then averaged across heads and symmetrized:

    A_sym = (A + A.T) / 2

Symmetrization removes the directional artifact introduced by causal
(left-to-right) masking. The underlying relational structure we measure —
mutual implication between tokens — is symmetric: if Romeo implicates Juliet,
Juliet implicates Romeo equally. Which direction the model resolved first is
a computational artifact, not a linguistic one.

This is distinct from hidden-state dot products (h @ h.T), which ask "are
these two token representations geometrically similar?" QK attention asks
"did token i actively seek out token j during processing?" — a contextual,
per-input signal that reflects the specific relational demands of this text.

Using only the last layer captures the fully-contextualized representations
after all 36 rounds of attention, where token meanings are most resolved.

AP (Attention Proximity) for token i = mean of row i, diagonal excluded.
APE (Attention Proximity Entropy) = Shannon entropy of row i, diagonal excluded.
"""

import os
import torch
import numpy as np
from transformers import AutoTokenizer, AutoModelForCausalLM
from huggingface_hub import login

MODEL_ID = "Qwen/Qwen3-8B"

_tokenizer = None
_model     = None
_hooks     = []
_q_cache:  dict[int, torch.Tensor] = {}
_k_cache:  dict[int, torch.Tensor] = {}
_cfg       = None
_ready     = False


def is_ready() -> bool:
    """Return True only once load_model() has fully completed."""
    return _ready


def _make_q_hook(layer_idx: int):
    def hook(module, input, output):
        # output: (batch, seq, num_heads, head_dim)
        # transpose → (batch, num_heads, seq, head_dim)
        _q_cache[layer_idx] = output.transpose(1, 2).detach()
    return hook


def _make_k_hook(layer_idx: int):
    def hook(module, input, output):
        _k_cache[layer_idx] = output.transpose(1, 2).detach()
    return hook


def _row_entropy(row: np.ndarray) -> float:
    """
    Shannon entropy of a row shifted to [0, inf) before treating as probs.
    Rows contain raw QK dot products (no fixed range, can be negative) so we
    shift before normalizing.
    """
    shifted = row - row.min() + 1e-8
    probs   = shifted / shifted.sum()
    return float(-np.sum(probs * np.log(probs + 1e-10)))


def load_model():
    """Load tokenizer and model, register hooks on the last layer only. Safe to call multiple times."""
    global _tokenizer, _model, _cfg, _ready

    if _model is not None:
        return

    token = os.environ.get("HF_TOKEN")
    if token:
        print("HF_TOKEN found, logging in.", flush=True)
        login(token=token, add_to_git_credential=False)

    _HF_AUTH_HINT = (
        "\n\n  ── HuggingFace authentication required ──────────────────────────\n"
        "  Qwen3-8B is a gated model. To access it:\n"
        "    1. Accept the license at https://huggingface.co/Qwen/Qwen3-8B\n"
        "    2. Create an access token at https://huggingface.co/settings/tokens\n"
        "    3. Set the environment variable before running:\n"
        "         Windows:  $env:HF_TOKEN = 'hf_...'\n"
        "         Linux/Mac: export HF_TOKEN='hf_...'\n"
        "  ─────────────────────────────────────────────────────────────────\n"
    )

    print(f"Loading tokenizer: {MODEL_ID}", flush=True)
    try:
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    except OSError as e:
        if "401" in str(e) or "403" in str(e) or "gated" in str(e).lower() or "access" in str(e).lower():
            print(_HF_AUTH_HINT, flush=True)
        raise
    print("Tokenizer loaded.", flush=True)

    print(f"Loading model (fp16, device_map=auto)...", flush=True)
    try:
        _model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            dtype=torch.float16,
            device_map="auto",
        )
    except OSError as e:
        if "401" in str(e) or "403" in str(e) or "gated" in str(e).lower() or "access" in str(e).lower():
            print(_HF_AUTH_HINT, flush=True)
        raise
    _model.eval()
    print("Model loaded.", flush=True)

    first_param_dtype = next(_model.parameters()).dtype
    print(f"Model param dtype: {first_param_dtype}", flush=True)
    if first_param_dtype != torch.float16:
        raise RuntimeError(
            f"Expected fp16 but model loaded as {first_param_dtype}. "
            f"Aborting — check that CUDA is available and the GPU has enough VRAM (~16 GB)."
        )

    _cfg         = _model.config
    num_q_heads  = _cfg.num_attention_heads
    num_kv_heads = _cfg.num_key_value_heads
    head_dim     = _cfg.hidden_size // num_q_heads
    num_layers   = _cfg.num_hidden_layers
    last_idx     = num_layers - 1

    print(
        f"Model config: layers={num_layers}  "
        f"hidden_size={_cfg.hidden_size}  "
        f"q_heads={num_q_heads}  "
        f"kv_heads={num_kv_heads}  "
        f"head_dim={head_dim}",
        flush=True,
    )

    print(f"Registering hooks on last layer (layer {last_idx})...", flush=True)
    attn = _model.model.layers[last_idx].self_attn
    _hooks.append(attn.q_norm.register_forward_hook(_make_q_hook(last_idx)))
    _hooks.append(attn.k_norm.register_forward_hook(_make_k_hook(last_idx)))
    print(f"Registered {len(_hooks)} hooks (layer {last_idx} × 2).", flush=True)

    _ready = True


def score_text(text: str) -> dict:
    """
    Run the Proximity Score pipeline on text.
    Returns a dict with keys: text, tokens, char_spans, ap, ape,
    scalar_ap, scalar_ape, matrix, model, metric.
    load_model() must be called before this.

    The last attention layer's full N×N raw QK logit matrix is computed for all
    32 heads (Q @ K.T / sqrt(d_k), no causal mask), averaged across heads, then
    symmetrized: A_sym = (A + A.T) / 2.

    AP (Attention Proximity) for token i = mean of row i, diagonal excluded.
    APE (Attention Proximity Entropy) = Shannon entropy of row i, diagonal excluded.
    """
    if _model is None:
        raise RuntimeError("Call load_model() before score_text().")

    _q_cache.clear()
    _k_cache.clear()

    num_q_heads  = _cfg.num_attention_heads
    num_kv_heads = _cfg.num_key_value_heads
    head_dim     = _cfg.hidden_size // num_q_heads
    kv_repeat    = num_q_heads // num_kv_heads
    last_idx     = _cfg.num_hidden_layers - 1

    enc = _tokenizer(
        text,
        return_tensors="pt",
        return_offsets_mapping=True,
    )
    offset_mapping = enc["offset_mapping"][0]
    char_spans     = offset_mapping.tolist()
    input_ids      = enc["input_ids"].to("cuda")
    attention_mask = enc.get("attention_mask")
    if attention_mask is not None:
        attention_mask = attention_mask.to("cuda")

    tokens = _tokenizer.convert_ids_to_tokens(input_ids[0])
    N      = len(tokens)
    print(f"Scoring {N} tokens...", flush=True)

    with torch.no_grad():
        _model(input_ids=input_ids, attention_mask=attention_mask, use_cache=False)

    assert len(_q_cache) == 1, f"Expected 1 Q tensor (last layer), got {len(_q_cache)}"
    assert len(_k_cache) == 1, f"Expected 1 K tensor (last layer), got {len(_k_cache)}"

    scale = head_dim ** 0.5
    q = _q_cache[last_idx].float()          # (1, num_q_heads,  N, head_dim)
    k = _k_cache[last_idx].float()          # (1, num_kv_heads, N, head_dim)
    k = k.repeat_interleave(kv_repeat, dim=1)  # (1, num_q_heads, N, head_dim)

    # Raw QK logits — no softmax. Rows can be negative; range is unbounded.
    scores = torch.bmm(
        q[0],                      # (num_q_heads, N, head_dim)
        k[0].transpose(1, 2),      # (num_q_heads, head_dim, N)
    ) / scale                      # (num_q_heads, N, N)

    A = scores.mean(dim=0).cpu().float().numpy()   # (N, N), averaged across heads

    # Symmetrize to remove causal directionality
    proximity_matrix = (A + A.T) / 2              # (N, N), symmetric

    del _q_cache[last_idx]
    del _k_cache[last_idx]
    torch.cuda.empty_cache()

    # Exclude diagonal: self-similarity carries no relational information
    # about surrounding context.
    off_diag = ~np.eye(N, dtype=bool)
    per_token_ap  = [float(proximity_matrix[i][off_diag[i]].mean()) for i in range(N)]
    per_token_ape = [_row_entropy(proximity_matrix[i][off_diag[i]]) for i in range(N)]

    return {
        "text":       text,
        "tokens":     tokens,
        "char_spans": char_spans,
        "ap":         per_token_ap,
        "ape":        per_token_ape,
        "scalar_ap":  float(np.mean(per_token_ap)),
        "scalar_ape": float(np.mean(per_token_ape)),
        "matrix":     proximity_matrix.tolist(),   # (N, N), symmetric
        "model":      MODEL_ID,
        "metric":     "attention_proximity_qk",
    }

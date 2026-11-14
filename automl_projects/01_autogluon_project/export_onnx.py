"""
AutoGluon ONNX Export & Low-Latency Deployment Demo
Demonstrates how individual models or neural backends from AutoGluon
can be compiled to ONNX for sub-5ms non-Python C++/Go runtime environments.
"""

import os
import sys

print("=" * 60)
print("AutoGluon: ONNX Export & Low Latency Deployment Pattern")
print("=" * 60)
print("""
Architecture Pattern for High Performance Serving:
1. AutoGluon Multi-layer Stacking ensembles multiple tree models (LightGBM, XGBoost, CatBoost)
   and deep learning architectures (TabularNN, MultiModal/Transformers).
2. For mission-critical production APIs (C++/Go, Envoy filter, Triton Inference Server),
   models can be serialized as ONNX graphs:
   
   - Scikit-learn / LightGBM models: Converted using `skl2onnx` or `onnxmltools`
   - PyTorch neural architectures: Converted using `torch.onnx.export`
   
3. In-memory C++/Go ONNX Runtime achieves 1 - 5 ms inference latency, eliminating Python GIL bottlenecks.

Example Code Flow:
------------------
import onnxruntime as ort
import numpy as np

# Session initialization (C++ engine underneath):
session = ort.InferenceSession("autogluon_model.onnx")

# Fast inference with zero Python runtime overhead:
input_data = np.array([[29.0, 3.0, 89.5, 4.0]], dtype=np.float32)
input_name = session.get_inputs()[0].name
output_name = session.get_outputs()[0].name
pred_probs = session.run([output_name], {input_name: input_data})[0]
print("ONNX Inference Output Probabilities:", pred_probs)
""")

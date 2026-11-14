"""
H2O MOJO (Model Object, Optimized) Production Guide & Architecture
Explains sub-millisecond (<1ms) deployment in Java / C++ without Python runtime dependencies.
"""

import sys

print("=" * 60)
print("H2O MOJO / POJO Ultra-Low Latency (<1ms) Deployment Architecture")
print("=" * 60)
print("""
What is an H2O MOJO?
--------------------
- MOJO (Model Object, Optimized) is a standalone binary zip file containing the entire model
  structure, hyperparameters, feature transformations, and decision logic.
- It requires ONLY the lightweight Java library `h2o-genmodel.jar` (or C++ runtime).
- ZERO Python runtime or Scikit-learn or H2O server is required during serving!
- Reaches < 1 ms inference latency, making it the industry standard for:
  * High-frequency financial trading & fraud scoring
  * Real-time AdTech bidding engines
  * Low-latency Java / Spring Boot microservices

Java In-Memory Serving Example (Spring Boot / Java Microservice):
-----------------------------------------------------------------
import hex.genmodel.easy.EasyPredictModelWrapper;
import hex.genmodel.easy.RowData;
import hex.genmodel.easy.prediction.BinomialModelPrediction;
import hex.genmodel.MojoModel;

public class FraudScoringService {
    public static void main(String[] args) throws Exception {
        // 1. Load MOJO directly into Java memory:
        MojoModel mojo = MojoModel.load("saved_models/GBM_model.zip");
        EasyPredictModelWrapper model = new EasyPredictModelWrapper(mojo);

        // 2. Populate input row:
        RowData row = new RowData();
        row.put("age", "28");
        row.put("department", "Sales");
        row.put("monthly_income", "3200");
        row.put("overtime", "Yes");

        // 3. Ultra-fast inference (< 1ms):
        BinomialModelPrediction p = model.predictBinomial(row);
        System.out.println("Predicted Label: " + p.label);
        System.out.println("Probability: " + p.classProbabilities[1]);
    }
}
""")

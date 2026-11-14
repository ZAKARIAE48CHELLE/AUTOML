"""
Agentic AutoML Pipeline Runner
Orchestrates Architect, Coder, and Reviewer agents in an autonomous self-healing loop.
"""

import os
from dataset import generate_customer_value_dataset
from agent_system import ArchitectAgent, CoderAgent, ReviewerAgent


def run_agentic_automl():
    print("=" * 60)
    print("Agentic AutoML: Multi-Agent System (Architect -> Coder -> Reviewer)")
    print("=" * 60)

    # 1. Initialize dataset
    csv_file = "customer_lifetime_value.csv"
    df = generate_customer_value_dataset(n_samples=1500)
    df.to_csv(csv_file, index=False)
    print(f"Dataset ready: '{csv_file}' with {len(df)} records.")

    # 2. Agent 1: Architect
    print("\n[AGENT 1: ARCHITECT] Analyzing domain problem, schema, and strategy...")
    architect = ArchitectAgent()
    plan = architect.analyze(df, target_col="customer_lifetime_value")
    print(f"  -> Task Type: {plan['task_type'].upper()}")
    print(f"  -> Primary Metric: {plan['primary_metric']}")
    print(f"  -> Numeric Features: {plan['numeric_features']}")
    print(f"  -> Categorical Features: {plan['categorical_features']}")
    print(f"  -> Recommended Model: {plan['recommended_models'][0]}")

    # 3. Agent 2: Coder
    coder = CoderAgent()
    reviewer = ReviewerAgent()

    max_attempts = 3
    attempt = 1
    error_feedback = ""
    verified_code = ""

    while attempt <= max_attempts:
        print(f"\n[AGENT 2: CODER] Generating pipeline implementation (Attempt {attempt}/{max_attempts})...")
        code = coder.generate_code(plan, attempt=attempt, error_feedback=error_feedback)

        print("[AGENT 3: REVIEWER] Executing code in sandbox & intercepting runtime exceptions...")
        success, logs, metrics = reviewer.execute_and_review(code)

        if success:
            print("  [SUCCESS] Code executed with zero exceptions!")
            print(f"  [METRICS] Validation Results: {metrics}")
            verified_code = code
            break
        else:
            print(f"  [EXCEPTION INTERCEPTED] Reviewer detected runtime error:\n{logs}")
            error_feedback = logs
            attempt += 1

    if verified_code:
        out_script = "verified_agentic_pipeline.py"
        with open(out_script, "w", encoding="utf-8") as f:
            f.write(verified_code)
        print("\n" + "=" * 60)
        print(f"Autonomous Multi-Agent Loop Completed Successfully!")
        print(f"Production-ready script saved to: {out_script}")
        print("=" * 60)


if __name__ == "__main__":
    run_agentic_automl()

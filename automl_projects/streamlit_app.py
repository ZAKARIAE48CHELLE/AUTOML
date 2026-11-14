"""
Streamlit Interface for AutoML Multi-Paradigm Studio
Alternative dashboard providing full interactive access to all 8 projects
with dataset exploration, pipeline execution, live inference, and bottom-right floating guide.
"""

import streamlit as st
import pandas as pd
import numpy as np
import time

from integration_hub import (
    PROJECTS_META,
    get_dataset,
    execute_pipeline,
    predict_interactive,
    get_manual_content
)

st.set_page_config(
    page_title="AutoML Multi-Paradigm Studio",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown("""
<style>
    .metric-card {
        background-color: #1e293b;
        border-radius: 12px;
        padding: 16px;
        border: 1px solid #334155;
    }
    .floating-guide {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        color: white;
        padding: 12px 20px;
        border-radius: 50px;
        box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.5);
        font-weight: bold;
        font-size: 13px;
    }
</style>
""", unsafe_allow_html=True)

# Sidebar Project Selector
st.sidebar.title("⚡ AutoML Studio")
st.sidebar.caption("8 Paradigms from Guide_Complet_Intégration_AutoML.pdf")

project_names = [f"{p['name']} ({p['folder'].split('_')[1]})" for p in PROJECTS_META.values()]
project_keys = list(PROJECTS_META.keys())

selected_idx = st.sidebar.radio(
    "Select Framework:",
    range(len(project_keys)),
    format_func=lambda i: project_names[i]
)

current_proj_id = project_keys[selected_idx]
project = PROJECTS_META[current_proj_id]

st.sidebar.markdown("---")
st.sidebar.markdown(f"**Paradigm:** {project['paradigm']}")
st.sidebar.markdown(f"**Target Metric / Latency:** `{project['latency']}`")
st.sidebar.markdown(f"**Export:** `{project['serialization']}`")

# Header
st.title(f"{project['name']} — {project['creator']}")
st.markdown(f"*{project['paradigm']}*")
st.info(project['description'])

# Main Tabs
tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "🏛️ Architecture & Overview",
    "📊 Dataset Studio",
    "🚀 Run Pipeline",
    "✨ Live Inference Playground",
    "📖 Project Manual (Full)"
])

# Tab 1: Overview
with tab1:
    col1, col2, col3 = st.columns(3)
    col1.metric("Serving Latency", project["latency"])
    col2.metric("Task Type", project["task_type"])
    col3.metric("Export Target", project["serialization"].split("/")[0])

    st.subheader("Pipeline Flow")
    st.code(f"""
# Standard {project['name']} Workflow:
1. cd automl_projects/{project['folder']}
2. python dataset.py      # Generate {project['dataset_name']}
3. python train.py        # Fit model under {project['paradigm'].split()[0]} paradigm
4. python predict.py      # Batch inference & evaluation
    """, language="bash")

# Tab 2: Dataset Studio
with tab2:
    st.subheader(f"Dataset: {project['dataset_name']}")
    if st.button("Generate Fresh Dataset"):
        st.session_state["dataset"] = get_dataset(current_proj_id, 300)
        st.success("Fresh dataset generated!")

    data = get_dataset(current_proj_id, 300)
    df = pd.DataFrame(data["preview"])
    st.dataframe(df, use_container_width=True)

# Tab 3: Run Pipeline
with tab3:
    st.subheader("AutoML Training / Agent Loop")
    if st.button("▶ Execute AutoML Pipeline", type="primary"):
        with st.spinner(f"Executing {project['name']} pipeline..."):
            res = execute_pipeline(current_proj_id)
            st.success(f"Pipeline executed in {res['duration_seconds']}s")
            
            c1, c2 = st.columns(2)
            c1.json(res["metrics"])
            if "leaderboard" in res:
                c2.dataframe(pd.DataFrame(res["leaderboard"]))
            
            st.code("\n".join(res["logs"]), language="log")

# Tab 4: Live Inference
with tab4:
    st.subheader("Real-Time Prediction Form")
    sample = project["sample_input"]
    inputs = {}
    cols = st.columns(2)
    for idx, (k, v) in enumerate(sample.items()):
        col = cols[idx % 2]
        if isinstance(v, (int, float)):
            inputs[k] = col.number_input(f"{k.capitalize()}:", value=float(v))
        else:
            inputs[k] = col.text_input(f"{k.capitalize()}:", value=str(v))

    if st.button("Run Inference"):
        res = predict_interactive(current_proj_id, inputs)
        st.success(f"Outcome: {res.get('predicted_class') or res.get('predicted_value')}")
        st.json(res)

# Tab 5: Full Manual
with tab5:
    manual = get_manual_content(current_proj_id)
    st.markdown(manual)

# Bottom-Right Floating Guide Indicator
st.sidebar.markdown("---")
st.sidebar.info(f"💡 Bottom-Right Guide: You are viewing the **{project['name']}** project manual and execution guide.")

#!/bin/bash
# Stands in for "python -m mlx_lm generate" in tests: prints a fixed analysis.
cat <<'JSON'
<think>ok</think>
{"call_summary":"Counsellor pitched the data analytics program; lead booked a free demo for Saturday 11 am.",
 "call_type":"sales_conversation",
 "customer":{"name":"Priya","current_status":"working","qualification":"B.Tech electronics","graduation_year":"2022",
   "background":"tech","experience":"2.5 years","designation":"Technical support engineer","company":null,"location":"Pune"},
 "intent":"Move into a data analyst role","goals":["Work with dashboards and SQL"],
 "interest_level":"hot","interest_reason":"booked demo, EMI works","course_discussed":"Data Analytics",
 "fees_discussed":"85,000; 12-month no-cost EMI about 7,000/month; 10% scholarship this week",
 "demo_status":"booked",
 "objections":[{"concern":"Fee higher than expected","counsellor_response":"No-cost EMI and scholarship","resolved":true}],
 "next_steps":[{"action":"Attend demo class","owner":"lead","when":"Saturday 11 am"},{"action":"Feedback call","owner":"counsellor","when":"Sunday"}],
 "key_quotes":["I want to move into a data analyst role where I can work with dashboards and SQL.","Seven thousand a month is manageable for me."],
 "outcome":"interested","follow_up_required":true,"audit_applicable":true,
 "audit":{"profiling_completed":true,"need_identified":true,"objection_handled":true,"closing_attempted":true}}
JSON

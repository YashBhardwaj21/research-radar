import urllib.request
import psycopg2
import json
import os
import uuid
from typing import TypedDict, List
from langgraph.graph import StateGraph, END
from langchain.prompts import PromptTemplate
from langchain_ollama import ChatOllama
from pydantic import BaseModel, Field

llm = ChatOllama(model="llama3.1:8b", temperature=0)
DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

def update_job_status(job_id: str, status: str, current_step: str = None):
    if not job_id:
        return
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute('UPDATE "ResearchRequest" SET status = %s, "currentStep" = %s, "updatedAt" = NOW() WHERE id = %s', (status, current_step, job_id))
    conn.commit()
    cur.close()
    conn.close()

def save_scrape_task(task_id: str, request_id: str, query: str):
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute('INSERT INTO "ScrapeTask" (id, "researchRequestId", source, query, status) VALUES (%s, %s, %s, %s, %s)',
                (task_id, request_id, 'all', query, 'PENDING'))
    conn.commit()
    cur.close()
    conn.close()

class Phase1State(TypedDict):
    job_id: str
    topic: str
    search_queries: List[str]

class QueriesOutput(BaseModel):
    queries: List[str] = Field(description="3 to 4 optimized search queries")

plan_prompt = PromptTemplate.from_template("""
You are an expert academic research assistant. 
The user wants a deep dive on the following topic: "{topic}"

Generate 3 highly optimized search queries that can be fed into academic databases (like arXiv or PubMed) to retrieve the most relevant literature.
Ensure they capture different aspects of the topic.
""")

def plan_search_node(state: Phase1State):
    topic = state["topic"]
    job_id = state.get("job_id")
    update_job_status(job_id, "PLANNING_SEARCH", "Generating optimized search queries")
    
    chain = plan_prompt | llm.with_structured_output(schema=QueriesOutput)
    try:
        res = chain.invoke({"topic": topic})
        queries = res.queries
    except Exception:
        queries = [topic]
        
    return {"search_queries": queries}

def enqueue_scrape_node(state: Phase1State):
    job_id = state.get("job_id")
    update_job_status(job_id, "SCRAPING", "Enqueuing jobs to distributed scraping cluster")
    queries = state.get("search_queries", [])
    
    for q in queries:
        try:
            # We don't have the exact ID the queue generates until it replies, 
            # so we let the node API generate it and we save it.
            req = urllib.request.Request(
                "http://localhost:3000/api/jobs",
                data=json.dumps({"source": "all", "query": q, "maxResults": 3, "researchRequestId": job_id}).encode('utf-8'),
                headers={"Content-Type": "application/json", "x-api-key": "default-secret-key-change-me"},
                method='POST'
            )
            resp = urllib.request.urlopen(req, timeout=5)
            data = json.loads(resp.read().decode('utf-8'))
            scrape_task_id = data.get("jobId", str(uuid.uuid4()))
            save_scrape_task(scrape_task_id, job_id, q)
        except Exception as e:
            print(f"Failed to enqueue scrape for {q}: {e}")
            
    # Workflow ends here! The TS orchestrator will resume it.
    update_job_status(job_id, "WAITING_FOR_DATA", "Waiting for web scrapers and embedding models to finish processing")
    return {}

workflow = StateGraph(Phase1State)
workflow.add_node("plan_search", plan_search_node)
workflow.add_node("enqueue_scrape", enqueue_scrape_node)

workflow.set_entry_point("plan_search")
workflow.add_edge("plan_search", "enqueue_scrape")
workflow.add_edge("enqueue_scrape", END)

phase1_graph = workflow.compile()

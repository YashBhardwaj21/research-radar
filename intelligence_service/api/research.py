from fastapi import APIRouter
from pydantic import BaseModel
from ..graph.queries import get_most_used_entities, compare_methods
from ..rag.engine import run_hybrid_rag
from ..workflow.graph import app_graph
from ..discovery.gap_analysis import discover_opportunities

router = APIRouter(prefix="/api/research", tags=["Research Intelligence"])

class AnalyzeRequest(BaseModel):
    topic: str

class CompareRequest(BaseModel):
    methodA: str
    methodB: str

class RAGRequest(BaseModel):
    query: str

class DeepDiveRequest(BaseModel):
    topic: str

class DiscoverRequest(BaseModel):
    topic: str

@router.post("/analyze")
def analyze_topic(req: AnalyzeRequest):
    """
    Analyzes a specific research topic and returns intelligence insights.
    """
    topic = req.topic
    # Use the first major keyword for simple matching
    # In a full hybrid system, this uses pgvector first to resolve Papers, then queries the graph
    keyword = topic.split()[0] if " " in topic else topic
    
    return {
        "topic": topic,
        "most_used_datasets": get_most_used_entities(keyword, "Dataset", "USES_DATASET"),
        "most_common_methods": get_most_used_entities(keyword, "Method", "USES_METHOD"),
        "best_reported_metrics": get_most_used_entities(keyword, "Metric", "REPORTS_METRIC")
    }

@router.post("/compare")
def compare_methodologies(req: CompareRequest):
    """
    Compares two methodologies side-by-side using the Knowledge Graph.
    """
    return compare_methods(req.methodA, req.methodB)

@router.post("/rag")
def research_assistant(req: RAGRequest):
    """
    Structured RAG endpoint. Uses pgvector for semantic search, combines with Graph extractions, and synthesizes an answer.
    """
    return run_hybrid_rag(req.query)

import uuid
from fastapi import BackgroundTasks
import psycopg2
from psycopg2.extras import RealDictCursor
import os

DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

def run_background_deep_dive(job_id: str, topic: str):
    try:
        initial_state = {"job_id": job_id, "topic": topic}
        app_graph.invoke(initial_state)
    except Exception as e:
        print(f"Workflow failed: {e}")
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        cur.execute('UPDATE "ResearchRequest" SET status = %s, "updatedAt" = NOW() WHERE id = %s', ("FAILED", job_id))
        conn.commit()
        cur.close()
        conn.close()

@router.post("/deep-dive")
def deep_dive_async(req: DeepDiveRequest, background_tasks: BackgroundTasks):
    """
    Kicks off an asynchronous multi-step LangGraph workflow that retrieves, filters, synthesizes, and ranks papers.
    Returns a job_id immediately.
    """
    job_id = str(uuid.uuid4())
    topic = req.topic
    
    # Create the ResearchRequest in PostgreSQL
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO "ResearchRequest" (id, topic, status, progress, "createdAt", "updatedAt") VALUES (%s, %s, %s, %s, NOW(), NOW())',
        (job_id, topic, "QUEUED", 0)
    )
    conn.commit()
    cur.close()
    conn.close()
    
    # Launch LangGraph in the background
    background_tasks.add_task(run_background_deep_dive, job_id, topic)
    
    return {
        "job_id": job_id,
        "topic": topic,
        "status": "QUEUED"
    }

@router.get("/job/{job_id}")
def get_job_status(job_id: str):
    """
    Poll this endpoint to get the status and progress of an asynchronous Deep Dive job.
    """
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT id, topic, status, progress, result FROM "ResearchRequest" WHERE id = %s', (job_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    
    if not row:
        return {"error": "Job not found"}
        
    return dict(row)

@router.post("/discover")
def discover_gaps(req: DiscoverRequest):
    """
    Executes a structural graph analysis to find disconnected methods and generates novel research hypotheses.
    """
    return discover_opportunities(req.topic)

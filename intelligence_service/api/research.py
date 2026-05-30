from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import uuid
import hashlib

from ..graph.queries import get_most_used_entities, compare_methods
from ..rag.engine import run_hybrid_rag
from ..workflow.graph import phase1_graph
from ..workflow.synthesis_graph import phase2_graph
from ..discovery.gap_analysis import discover_opportunities

router = APIRouter(prefix="/api/research", tags=["Research Intelligence"])
DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

class DeepDiveRequest(BaseModel):
    topic: str

def run_phase1_background(job_id: str, topic: str):
    try:
        phase1_graph.invoke({"job_id": job_id, "topic": topic})
    except Exception as e:
        print(f"Phase 1 failed: {e}")
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        cur.execute('UPDATE "ResearchRequest" SET status = %s, "errorMessage" = %s, "updatedAt" = NOW() WHERE id = %s', ("FAILED", str(e), job_id))
        conn.commit()
        cur.close()
        conn.close()

def run_phase2_background(job_id: str, topic: str):
    try:
        phase2_graph.invoke({"job_id": job_id, "topic": topic})
    except Exception as e:
        print(f"Phase 2 failed: {e}")
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        cur.execute('UPDATE "ResearchRequest" SET status = %s, "errorMessage" = %s, "updatedAt" = NOW() WHERE id = %s', ("FAILED", str(e), job_id))
        conn.commit()
        cur.close()
        conn.close()

@router.post("/deep-dive")
def deep_dive_async(req: DeepDiveRequest, background_tasks: BackgroundTasks):
    """
    Idempotent endpoint. Starts the deep dive workflow Phase 1.
    """
    topic = req.topic.strip()
    topic_hash = hashlib.sha256(topic.lower().encode('utf-8')).hexdigest()
    
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Check Idempotency
    cur.execute('SELECT id, status FROM "ResearchRequest" WHERE "topicHash" = %s', (topic_hash,))
    existing = cur.fetchone()
    
    if existing:
        if existing["status"] not in ["FAILED", "CANCELLED"]:
            # Already running or completed, return existing
            cur.close()
            conn.close()
            return {"job_id": existing["id"], "topic": topic, "status": existing["status"], "cached": True}
        else:
            # Overwrite failed/cancelled
            job_id = existing["id"]
            cur.execute('UPDATE "ResearchRequest" SET status = %s, "currentStep" = %s, "errorMessage" = NULL, "startedAt" = NOW(), "updatedAt" = NOW() WHERE id = %s',
                        ("QUEUED", "Initializing workflow", job_id))
            # Delete old ScrapeTasks
            cur.execute('DELETE FROM "ScrapeTask" WHERE "researchRequestId" = %s', (job_id,))
            conn.commit()
    else:
        job_id = str(uuid.uuid4())
        cur.execute(
            'INSERT INTO "ResearchRequest" (id, topic, "topicHash", status, "currentStep", "createdAt", "updatedAt", "startedAt") VALUES (%s, %s, %s, %s, %s, NOW(), NOW(), NOW())',
            (job_id, topic, topic_hash, "QUEUED", "Initializing workflow")
        )
        conn.commit()
        
    cur.close()
    conn.close()
    
    # Launch Phase 1
    background_tasks.add_task(run_phase1_background, job_id, topic)
    
    return {
        "job_id": job_id,
        "topic": topic,
        "status": "QUEUED",
        "cached": False
    }

@router.post("/job/{job_id}/analyze")
def trigger_analysis(job_id: str, background_tasks: BackgroundTasks):
    """
    Internal webhook used by the Node.js Orchestrator to trigger Phase 2 once scraping/embedding completes.
    """
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT topic, status FROM "ResearchRequest" WHERE id = %s', (job_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if row["status"] in ["COMPLETED", "FAILED", "CANCELLED"]:
        return {"status": "Already finished or cancelled"}
        
    background_tasks.add_task(run_phase2_background, job_id, row["topic"])
    return {"status": "Triggered Phase 2"}

@router.get("/job/{job_id}")
def get_job_status(job_id: str):
    """
    Poll this endpoint for progress.
    """
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT id, topic, status, "currentStep", "errorMessage", "startedAt", "finishedAt" FROM "ResearchRequest" WHERE id = %s', (job_id,))
    req_row = cur.fetchone()
    
    if not req_row:
        cur.close()
        conn.close()
        return {"error": "Job not found"}
        
    cur.execute('SELECT source, query, status FROM "ScrapeTask" WHERE "researchRequestId" = %s', (job_id,))
    tasks = cur.fetchall()
    
    report = None
    if req_row["status"] == "COMPLETED":
        cur.execute('SELECT markdown FROM "ResearchReport" WHERE "researchRequestId" = %s', (job_id,))
        rep_row = cur.fetchone()
        if rep_row:
            report = rep_row["markdown"]
            
    cur.close()
    conn.close()
        
    return {
        "request": dict(req_row),
        "scrape_tasks": [dict(t) for t in tasks],
        "report": report
    }

@router.post("/job/{job_id}/cancel")
def cancel_job(job_id: str):
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    cur.execute('UPDATE "ResearchRequest" SET status = %s, "currentStep" = %s, "updatedAt" = NOW() WHERE id = %s AND status NOT IN (%s, %s)', 
                ("CANCELLED", "Cancelled by user", job_id, "COMPLETED", "FAILED"))
    conn.commit()
    cur.close()
    conn.close()
    return {"status": "CANCELLED"}

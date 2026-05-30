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

@router.post("/deep-dive")
def deep_dive(req: DeepDiveRequest):
    """
    Kicks off a multi-step LangGraph workflow that retrieves, filters, synthesizes, and ranks papers.
    """
    initial_state = {"topic": req.topic}
    final_state = app_graph.invoke(initial_state)
    
    return {
        "topic": req.topic,
        "synthesis": final_state.get("synthesis"),
        "ranking": final_state.get("ranking"),
        "papers_used": len(final_state.get("filtered_papers", []))
    }

@router.post("/discover")
def discover_gaps(req: DiscoverRequest):
    """
    Executes a structural graph analysis to find disconnected methods and generates novel research hypotheses.
    """
    return discover_opportunities(req.topic)

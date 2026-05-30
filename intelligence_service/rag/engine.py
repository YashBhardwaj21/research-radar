import os
import psycopg2
from psycopg2.extras import DictCursor
from langchain.prompts import PromptTemplate
from langchain_ollama import ChatOllama, OllamaEmbeddings

DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

llm = ChatOllama(model="llama3.1:8b", temperature=0)
embeddings = OllamaEmbeddings(model="nomic-embed-text")

def get_similar_papers(query: str, limit: int = 5):
    """
    Uses pgvector to find semantically similar papers, and enriches them with structured data (methods, datasets).
    """
    # 1. Embed query
    query_vector = embeddings.embed_query(query)
    query_vector_str = "[" + ",".join(map(str, query_vector)) + "]"
    
    with psycopg2.connect(DB_URL) as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            # 2. Vector search on Paper table (assumes 768 dim vector)
            cur.execute("""
                SELECT p.id, p.title, p.abstract, p.year, 
                       p.embedding <=> %s::vector AS distance,
                       pe.limitations, pe."futureWork"
                FROM "Paper" p
                LEFT JOIN "PaperExtraction" pe ON p.id = pe."paperId"
                WHERE p.embedding IS NOT NULL
                ORDER BY distance ASC
                LIMIT %s
            """, (query_vector_str, limit))
            
            papers = cur.fetchall()
            
            # 3. Hybridize with Graph Extractions
            results = []
            for p in papers:
                paper_id = p['id']
                # Get Methods
                cur.execute('SELECT m.name FROM "Method" m JOIN "PaperMethod" pm ON m.id = pm."methodId" WHERE pm."paperId" = %s', (paper_id,))
                methods = [r[0] for r in cur.fetchall()]
                
                # Get Datasets
                cur.execute('SELECT d.name FROM "Dataset" d JOIN "PaperDataset" pd ON d.id = pd."datasetId" WHERE pd."paperId" = %s', (paper_id,))
                datasets = [r[0] for r in cur.fetchall()]
                
                results.append({
                    "title": p['title'],
                    "abstract": p['abstract'],
                    "year": p['year'],
                    "methods": methods,
                    "datasets": datasets,
                    "limitations": p['limitations'],
                    "future_work": p["futureWork"],
                })
            return results

rag_prompt = PromptTemplate.from_template("""
You are an expert AI research assistant. Answer the user's query based ONLY on the provided research context.
The context includes summaries of research papers, the methodologies they used, and the datasets they evaluated on.

User Query: {query}

Research Context:
{context}

Provide a synthesized answer with citations to the provided paper titles.
""")

def run_hybrid_rag(query: str):
    """
    Executes the Hybrid RAG pipeline: retrieval -> graph enrichment -> synthesis
    """
    papers = get_similar_papers(query, limit=5)
    
    if not papers:
        return {
            "answer": "I don't have enough indexed papers with embeddings to answer this query.",
            "sources": []
        }
        
    context_str = ""
    for i, p in enumerate(papers):
        context_str += f"[{i+1}] Paper: {p['title']} ({p['year']})\n"
        context_str += f"Methods Used: {', '.join(p['methods'])}\n"
        context_str += f"Datasets Evaluated: {', '.join(p['datasets'])}\n"
        context_str += f"Abstract: {p['abstract']}\n"
        context_str += f"Limitations: {p['limitations']}\n"
        context_str += f"Future Work: {p['future_work']}\n\n"
        
    chain = rag_prompt | llm
    response = chain.invoke({"query": query, "context": context_str})
    
    return {
        "answer": response.content,
        "sources": papers
    }

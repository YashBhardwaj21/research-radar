import os
from langchain.prompts import PromptTemplate
from langchain_ollama import ChatOllama
from ..graph.neo4j_client import neo4j_client

llm = ChatOllama(model="llama3.1:8b", temperature=0.7)

def get_disconnected_methods_for_topic(topic_keyword: str):
    """
    Finds highly used methods in the graph that have NEVER been used for the specific research task.
    """
    query = """
    // 1. Find the specific research task matching the topic
    MATCH (t:Task)
    WHERE toLower(t.name) CONTAINS toLower($keyword)
    
    // 2. Find methods used generally in the graph (most popular)
    MATCH (m:Method)<-[:USES_METHOD]-(p:Paper)
    
    // 3. Ensure the method has NEVER been used on the target Task
    WHERE NOT EXISTS {
        MATCH (p2:Paper)-[:ADDRESSES_TASK]->(t)
        MATCH (p2)-[:USES_METHOD]->(m)
    }
    
    RETURN m.name AS method, count(p) AS global_usage
    ORDER BY global_usage DESC
    LIMIT 5
    """
    
    with neo4j_client.get_session() as session:
        result = session.run(query, keyword=topic_keyword)
        return [{"method": record["method"], "global_usage": record["global_usage"]} for record in result]

def get_future_work_themes(topic_keyword: str):
    """
    Retrieves explicitly extracted future work themes for papers related to the topic.
    """
    query = """
    MATCH (p:Paper)-[:ADDRESSES_TASK]->(t:Task)
    MATCH (pe:PaperExtraction {paperId: p.id})
    WHERE toLower(t.name) CONTAINS toLower($keyword) AND pe.futureWork IS NOT NULL
    RETURN p.title AS title, pe.futureWork AS future_work
    LIMIT 10
    """
    with neo4j_client.get_session() as session:
        result = session.run(query, keyword=topic_keyword)
        return [{"title": record["title"], "future_work": record["future_work"]} for record in result]


hypothesis_prompt = PromptTemplate.from_template("""
You are an expert AI Research Director. Your goal is to identify a novel research gap and propose a new paper hypothesis.

Target Topic: {topic}

Highly successful methods from OTHER domains that have NEVER been applied to this topic:
{methods}

Stated future work and limitations from recent papers on this topic:
{future_work}

Based on this structural graph analysis, propose 3 novel research hypotheses. For each hypothesis, explain WHY it is novel and HOW it addresses the field's limitations by borrowing an unused method.
""")

def discover_opportunities(topic: str):
    keyword = topic.split()[0] if " " in topic else topic
    
    unused_methods = get_disconnected_methods_for_topic(keyword)
    future_work = get_future_work_themes(keyword)
    
    if not unused_methods or not future_work:
        return {"error": "Not enough structured graph data to find gaps for this topic. Run extraction on more papers."}
        
    methods_str = "\n".join([f"- {m['method']} (Used {m['global_usage']} times elsewhere)" for m in unused_methods])
    fw_str = "\n".join([f"- {fw['title']}: {fw['future_work']}" for fw in future_work])
    
    chain = hypothesis_prompt | llm
    res = chain.invoke({"topic": topic, "methods": methods_str, "future_work": fw_str})
    
    return {
        "topic": topic,
        "novel_methods_to_apply": unused_methods,
        "identified_gaps": future_work,
        "hypotheses": res.content
    }

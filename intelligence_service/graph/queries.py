from .neo4j_client import neo4j_client

def get_most_used_entities(topic_keyword: str, entity_label: str, rel_type: str, limit: int = 5):
    """
    Finds papers matching a keyword in the title, follows relationships to entities, and returns the most frequent ones.
    """
    query = f"""
    MATCH (p:Paper)-[:{rel_type}]->(e:{entity_label})
    WHERE toLower(p.title) CONTAINS toLower($keyword)
    RETURN e.name AS name, count(p) AS count
    ORDER BY count DESC
    LIMIT $limit
    """
    with neo4j_client.get_session() as session:
        result = session.run(query, keyword=topic_keyword, limit=limit)
        return [{"name": record["name"], "count": record["count"]} for record in result]

def compare_methods(method_a: str, method_b: str):
    """
    Compares two methodologies based on the datasets they are used with and the metrics they report.
    """
    query = """
    MATCH (p:Paper)-[:USES_METHOD]->(m:Method)
    WHERE toLower(m.name) = toLower($method_name)
    
    OPTIONAL MATCH (p)-[:USES_DATASET]->(d:Dataset)
    OPTIONAL MATCH (p)-[:REPORTS_METRIC]->(metric:Metric)
    
    RETURN 
        count(DISTINCT p) as paper_count,
        collect(DISTINCT d.name)[0..5] as top_datasets,
        collect(DISTINCT metric.name)[0..5] as top_metrics,
        avg(p.year) as avg_year
    """
    
    with neo4j_client.get_session() as session:
        res_a = session.run(query, method_name=method_a).single()
        res_b = session.run(query, method_name=method_b).single()
        
        return {
            method_a: {
                "paper_count": res_a["paper_count"] if res_a else 0,
                "top_datasets": res_a["top_datasets"] if res_a else [],
                "top_metrics": res_a["top_metrics"] if res_a else [],
                "avg_year": res_a["avg_year"] if res_a else None
            },
            method_b: {
                "paper_count": res_b["paper_count"] if res_b else 0,
                "top_datasets": res_b["top_datasets"] if res_b else [],
                "top_metrics": res_b["top_metrics"] if res_b else [],
                "avg_year": res_b["avg_year"] if res_b else None
            }
        }

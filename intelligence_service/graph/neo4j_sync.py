import os
import logging
import psycopg2
from psycopg2.extras import DictCursor
from .neo4j_client import neo4j_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

def get_postgres_connection():
    return psycopg2.connect(DB_URL)

def sync_papers(session, pg_conn):
    logger.info("Syncing Papers...")
    with pg_conn.cursor(cursor_factory=DictCursor) as cur:
        cur.execute('SELECT id, title, year FROM "Paper"')
        papers = cur.fetchall()
        for p in papers:
            session.execute_write(
                lambda tx: tx.run(
                    "MERGE (n:Paper {id: $id}) SET n.title = $title, n.year = $year",
                    id=p['id'], title=p['title'], year=p['year']
                )
            )

def sync_authors(session, pg_conn):
    logger.info("Syncing Authors and WRITTEN_BY...")
    with pg_conn.cursor(cursor_factory=DictCursor) as cur:
        cur.execute('SELECT id, name FROM "Author"')
        authors = cur.fetchall()
        for a in authors:
            session.execute_write(
                lambda tx: tx.run(
                    "MERGE (n:Author {id: $id}) SET n.name = $name",
                    id=a['id'], name=a['name']
                )
            )
            
        cur.execute('SELECT "paperId", "authorId" FROM "PaperAuthor"')
        rels = cur.fetchall()
        for r in rels:
            session.execute_write(
                lambda tx: tx.run(
                    """
                    MATCH (p:Paper {id: $pid}), (a:Author {id: $aid})
                    MERGE (p)-[:WRITTEN_BY]->(a)
                    """,
                    pid=r['paperId'], aid=r['authorId']
                )
            )

def sync_entities(session, pg_conn, table_name, node_label, relation_table, relation_type):
    logger.info(f"Syncing {node_label}s and {relation_type}...")
    with pg_conn.cursor(cursor_factory=DictCursor) as cur:
        cur.execute(f'SELECT id, name FROM "{table_name}"')
        entities = cur.fetchall()
        for e in entities:
            session.execute_write(
                lambda tx: tx.run(
                    f"MERGE (n:{node_label} {{id: $id}}) SET n.name = $name",
                    id=e['id'], name=e['name']
                )
            )
            
        # Handling the casing correctly based on Prisma schema (e.g., taskId, methodId)
        target_id_col = table_name[0].lower() + table_name[1:] + "Id"
        if table_name == "ResearchTask":
            target_id_col = "taskId"

        cur.execute(f'SELECT "paperId", "{target_id_col}" as target_id FROM "{relation_table}"')
        rels = cur.fetchall()
        for r in rels:
            session.execute_write(
                lambda tx: tx.run(
                    f"""
                    MATCH (p:Paper {{id: $pid}}), (t:{node_label} {{id: $tid}})
                    MERGE (p)-[:{relation_type}]->(t)
                    """,
                    pid=r['paperId'], tid=r['target_id']
                )
            )

def run_sync():
    pg_conn = get_postgres_connection()
    try:
        with neo4j_client.get_session() as session:
            sync_papers(session, pg_conn)
            sync_authors(session, pg_conn)
            sync_entities(session, pg_conn, "Method", "Method", "PaperMethod", "USES_METHOD")
            sync_entities(session, pg_conn, "Dataset", "Dataset", "PaperDataset", "USES_DATASET")
            sync_entities(session, pg_conn, "Metric", "Metric", "PaperMetric", "REPORTS_METRIC")
            sync_entities(session, pg_conn, "ResearchTask", "Task", "PaperResearchTask", "ADDRESSES_TASK")
            sync_entities(session, pg_conn, "Modality", "Modality", "PaperModality", "USES_MODALITY")
            sync_entities(session, pg_conn, "Condition", "Condition", "PaperCondition", "STUDIES_CONDITION")
            logger.info("Graph sync complete!")
    finally:
        pg_conn.close()
        neo4j_client.close()

if __name__ == "__main__":
    run_sync()

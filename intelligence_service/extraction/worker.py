import os
import time
import logging
import psycopg2
from psycopg2.extras import DictCursor
from .chain import extract_paper_metadata

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_URL = os.getenv("POSTGRES_URL", "postgresql://postgres:postgres@localhost:5432/pipeline")

def get_unextracted_papers(conn, limit=10):
    with conn.cursor(cursor_factory=DictCursor) as cur:
        # Get papers that do not have a PaperExtraction record
        cur.execute("""
            SELECT p.id, p.title, p.abstract, pc."fullText"
            FROM "Paper" p
            LEFT JOIN "PaperExtraction" pe ON p.id = pe."paperId"
            LEFT JOIN "PaperContent" pc ON p.id = pc."paperId"
            WHERE pe.id IS NULL
            LIMIT %s
        """, (limit,))
        return cur.fetchall()

def ensure_entity(cur, table_name, name):
    cur.execute(f'SELECT id FROM "{table_name}" WHERE name = %s', (name,))
    row = cur.fetchone()
    if row:
        return row['id']
    import uuid
    new_id = str(uuid.uuid4())
    cur.execute(f'INSERT INTO "{table_name}" (id, name) VALUES (%s, %s)', (new_id, name))
    return new_id

def process_extractions():
    try:
        conn = psycopg2.connect(DB_URL)
        conn.autocommit = False
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        return

    try:
        papers = get_unextracted_papers(conn)
        if not papers:
            return

        for p in papers:
            paper_id = p['id']
            title = p['title']
            text_to_analyze = p['fullText'] if p['fullText'] else p['abstract']

            if not text_to_analyze:
                logger.warning(f"Paper {paper_id} has no abstract or full text. Skipping extraction.")
                # Insert empty to prevent infinite looping over unextractable papers
                with conn.cursor() as cur:
                    import uuid
                    cur.execute("""
                        INSERT INTO "PaperExtraction" (id, "paperId") VALUES (%s, %s)
                    """, (str(uuid.uuid4()), paper_id))
                conn.commit()
                continue

            logger.info(f"Extracting metadata for paper: {title}")
            try:
                extraction = extract_paper_metadata(title, text_to_analyze)
            except Exception as e:
                logger.error(f"LLM extraction failed for paper {paper_id}: {e}")
                continue

            with conn.cursor() as cur:
                import uuid
                extraction_id = str(uuid.uuid4())
                
                # Insert main extraction record
                cur.execute("""
                    INSERT INTO "PaperExtraction" (id, "paperId", "limitations", "futureWork")
                    VALUES (%s, %s, %s, %s)
                """, (extraction_id, paper_id, extraction.limitations, extraction.future_work))

                # Helper to link entities
                def link_entities(entities, table_name, join_table, join_col):
                    for entity_name in entities:
                        if not entity_name.strip(): continue
                        entity_id = ensure_entity(cur, table_name, entity_name.strip())
                        # Check if link exists
                        cur.execute(f'SELECT 1 FROM "{join_table}" WHERE "paperId" = %s AND "{join_col}" = %s', (paper_id, entity_id))
                        if not cur.fetchone():
                            cur.execute(f'INSERT INTO "{join_table}" ("paperId", "{join_col}") VALUES (%s, %s)', (paper_id, entity_id))

                link_entities(extraction.research_tasks, "ResearchTask", "PaperResearchTask", "taskId")
                link_entities(extraction.modalities, "Modality", "PaperModality", "modalityId")
                link_entities(extraction.conditions, "Condition", "PaperCondition", "conditionId")
                link_entities(extraction.datasets, "Dataset", "PaperDataset", "datasetId")
                link_entities(extraction.methods, "Method", "PaperMethod", "methodId")
                link_entities(extraction.metrics, "Metric", "PaperMetric", "metricId")

            conn.commit()
            logger.info(f"Successfully saved extraction for paper {paper_id}")
            time.sleep(1) # Basic rate limiting
            
    except Exception as e:
        logger.error(f"Worker error: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    logger.info("Starting Paper Extraction Worker...")
    while True:
        process_extractions()
        time.sleep(10) # Poll every 10 seconds

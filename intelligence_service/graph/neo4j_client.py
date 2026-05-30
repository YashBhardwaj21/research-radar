import os
import logging
from neo4j import GraphDatabase

logger = logging.getLogger(__name__)

class Neo4jClient:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Neo4jClient, cls).__new__(cls)
            uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
            user = os.getenv("NEO4J_USER", "neo4j")
            password = os.getenv("NEO4J_PASSWORD", "password")
            cls._instance.driver = GraphDatabase.driver(uri, auth=(user, password))
            logger.info("Neo4jClient initialized")
        return cls._instance

    def close(self):
        if self.driver:
            self.driver.close()

    def get_session(self):
        return self.driver.session()

# Singleton instance access
neo4j_client = Neo4jClient()

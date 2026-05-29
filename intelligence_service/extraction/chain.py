import os
from langchain.prompts import PromptTemplate
from langchain_ollama import ChatOllama
from .schemas import PaperExtractionSchema

# Initialize LLM - Defaults to Ollama llama3.1:8b
llm = ChatOllama(model="llama3.1:8b", temperature=0)

prompt = PromptTemplate.from_template("""
You are an expert academic researcher. Read the following scientific paper text and extract the key structured information requested.
If a field is not mentioned, return an empty list or null as appropriate. Do not hallucinate or invent information.

Paper Title: {title}
Paper Text: 
{text}
""")

# Create the extraction chain using the Pydantic schema
extraction_chain = prompt | llm.with_structured_output(schema=PaperExtractionSchema)

def extract_paper_metadata(title: str, text: str) -> PaperExtractionSchema:
    """
    Invokes the LLM to extract structured metadata from the paper's text.
    """
    return extraction_chain.invoke({"title": title, "text": text})

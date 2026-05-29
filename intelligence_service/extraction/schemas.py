from pydantic import BaseModel, Field
from typing import List, Optional

class PaperExtractionSchema(BaseModel):
    research_tasks: List[str] = Field(default_factory=list, description="The specific research tasks or problems addressed by the paper (e.g., 'ADHD Classification', 'Image Segmentation')")
    modalities: List[str] = Field(default_factory=list, description="The modalities of data used (e.g., 'fMRI', 'EEG', 'Text', 'Images')")
    conditions: List[str] = Field(default_factory=list, description="The medical conditions or domains studied (e.g., 'ADHD', 'Autism')")
    datasets: List[str] = Field(default_factory=list, description="The specific names of datasets used for evaluation or training")
    methods: List[str] = Field(default_factory=list, description="The core methodologies or algorithms proposed or used (e.g., 'Transformer', 'Graph Neural Network')")
    metrics: List[str] = Field(default_factory=list, description="The evaluation metrics reported (e.g., 'Accuracy', 'F1 Score')")
    limitations: Optional[str] = Field(None, description="Any limitations mentioned by the authors")
    future_work: Optional[str] = Field(None, description="Future work proposed by the authors")
